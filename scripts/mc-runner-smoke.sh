#!/usr/bin/env bash
#
# Mission Control Phase 14 Runner Smoke Harness
#
# End-to-end smoke for the Phase 14 runner + reference container pipeline:
#
#   recipe-indexed -> task-created -> runner-claimed -> container-ran -> task-done
#
# Exercises every seam authored in Plans 14-01 .. 14-11 against a live dev
# server + Docker daemon. Authoritative human-verify harness for Plan 14-10
# (end-to-end checkpoint).
#
# Subcommands (v1):
#   hello-world   - Full happy-path smoke against the mc-hello-world-agent image
#   help          - Show this banner
#
# Planned future subcommands (Phase 15 / 17 - NOT yet implemented):
#   preserve-on-stop      - Verify worktree persists when runner is SIGTERMed mid-run
#   preserve-across-crash - Verify worktree + attempt-counter persist across daemon restart
#
# Prereqs for `hello-world`:
#   - Docker daemon running (`docker info` must succeed)
#   - MC dev server reachable at http://127.0.0.1:3000 (pnpm dev)
#   - mc-hello-world-agent:latest built locally (`pnpm mc:build-hello-world`)
#   - jq available (falls back to node if not)
#   - MC_API_KEY env var (or .data/.auto-generated carries API_KEY=...)
#
# See .planning/phases/14-runner-container-v1-2/14-10-PLAN.md.

set -euo pipefail

# ----------------------------------------------------------------------------
# Globals
# ----------------------------------------------------------------------------
MC_URL="${MC_URL:-http://127.0.0.1:3000}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POLL_INTERVAL_SEC=2
POLL_BUDGET_SEC=180
SMOKE_PROJECT_SLUG="mc-runner-smoke"
RUNNER_PID=""
TASK_ID=""

# ----------------------------------------------------------------------------
# Logging helpers
# ----------------------------------------------------------------------------
log()   { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
info()  { log "INFO  $*"; }
warn()  { log "WARN  $*" >&2; }
err()   { log "ERROR $*" >&2; }
die()   { err "$*"; exit 1; }

usage() {
  cat <<EOF
Mission Control Runner Smoke Harness

Usage: bash scripts/mc-runner-smoke.sh <subcommand>

Subcommands:
  hello-world   Run the full Phase 14 end-to-end smoke against mc-hello-world-agent.
  help          Show this message.

Env overrides:
  MC_URL            Mission Control base URL (default: http://127.0.0.1:3000)
  MC_API_KEY        Bearer token; falls back to .data/.auto-generated API_KEY=
  POLL_BUDGET_SEC   Seconds to wait for the task to reach 'done' (default: 180)

Examples:
  bash scripts/mc-runner-smoke.sh hello-world
  POLL_BUDGET_SEC=300 bash scripts/mc-runner-smoke.sh hello-world

Verification output is intended for capture to
.planning/phases/14-runner-container-v1-2/14-10-VERIFICATION.md.
EOF
}

# ----------------------------------------------------------------------------
# JSON helpers — prefer jq, fall back to node for portability
# ----------------------------------------------------------------------------
if command -v jq >/dev/null 2>&1; then
  json_get() { jq -r "$1"; }
else
  # Usage: echo "$json" | json_get '.some.field'
  # Node fallback: translate jq-ish dotted selector to JS.
  json_get() {
    local selector="$1"
    node -e "
      let raw='';
      process.stdin.on('data', c => raw += c);
      process.stdin.on('end', () => {
        try {
          const obj = JSON.parse(raw || 'null');
          const sel = process.argv[1] || '.';
          let cur = obj;
          const parts = sel.replace(/^\\./,'').split('.').filter(Boolean);
          for (const p of parts) cur = cur == null ? cur : cur[p];
          process.stdout.write(cur == null ? '' : typeof cur === 'object' ? JSON.stringify(cur) : String(cur));
        } catch (e) { process.exit(1); }
      });
    " "$selector"
  }
fi

# ----------------------------------------------------------------------------
# Cleanup trap
# ----------------------------------------------------------------------------
cleanup() {
  local exit_code=$?
  if [[ -n "$RUNNER_PID" ]] && kill -0 "$RUNNER_PID" 2>/dev/null; then
    info "Stopping runner daemon (PID $RUNNER_PID)"
    kill "$RUNNER_PID" 2>/dev/null || true
    # Give it a chance to shut down cleanly
    for _ in 1 2 3 4 5; do
      kill -0 "$RUNNER_PID" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$RUNNER_PID" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# ----------------------------------------------------------------------------
# Preflights
# ----------------------------------------------------------------------------
resolve_api_key() {
  if [[ -n "${MC_API_KEY:-}" ]]; then
    return 0
  fi
  local gen="$REPO_ROOT/.data/.auto-generated"
  if [[ -f "$gen" ]]; then
    local key
    key=$(grep -E '^API_KEY=' "$gen" | head -1 | cut -d= -f2- || true)
    if [[ -n "$key" ]]; then
      export MC_API_KEY="$key"
      return 0
    fi
  fi
  die "MC_API_KEY not set and could not be read from $gen. Set MC_API_KEY=... and retry."
}

preflight_docker() {
  info "Preflight: docker info"
  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon is not reachable. Start Docker Desktop and retry."
  fi
}

preflight_mc() {
  info "Preflight: MC reachable at $MC_URL"
  # /api/health returns 401 without auth; any 2xx/4xx means the server is up.
  # A connection refused / curl exit code !=0 is the real failure.
  local http
  http=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$MC_URL/api/recipes" \
    -H "Authorization: Bearer $MC_API_KEY" || echo "000")
  if [[ "$http" == "000" ]]; then
    die "MC not reachable at $MC_URL (connection refused). Start it with: pnpm dev"
  fi
  if [[ "$http" != "200" ]]; then
    die "MC returned HTTP $http on GET /api/recipes. Check MC_API_KEY + server logs."
  fi
}

preflight_image() {
  info "Preflight: docker image mc-hello-world-agent:latest"
  if ! docker image inspect mc-hello-world-agent:latest >/dev/null 2>&1; then
    warn "Image mc-hello-world-agent:latest not found; attempting build"
    bash "$REPO_ROOT/docker/hello-world-agent/build.sh"
  fi
  docker image inspect mc-hello-world-agent:latest --format '{{.Id}} {{.Size}}' \
    | while read -r id size; do
        info "  image id=$id size=${size}B"
      done
}

# ----------------------------------------------------------------------------
# Recipe + project + settings setup
# ----------------------------------------------------------------------------
ensure_recipe_indexed() {
  info "Ensure recipe 'hello-world' is indexed"
  local http
  http=$(curl -s -o /tmp/mc-smoke-recipe.json -w "%{http_code}" \
    -H "Authorization: Bearer $MC_API_KEY" "$MC_URL/api/recipes/hello-world" || echo "000")
  if [[ "$http" == "200" ]]; then
    info "  hello-world recipe present"
    return 0
  fi
  info "  recipe not found (HTTP $http); calling POST /api/recipes/resync"
  curl -s -X POST -H "Authorization: Bearer $MC_API_KEY" \
    "$MC_URL/api/recipes/resync" -o /tmp/mc-smoke-resync.json
  cat /tmp/mc-smoke-resync.json | head -c 400; echo
  # Re-check
  http=$(curl -s -o /tmp/mc-smoke-recipe.json -w "%{http_code}" \
    -H "Authorization: Bearer $MC_API_KEY" "$MC_URL/api/recipes/hello-world" || echo "000")
  if [[ "$http" != "200" ]]; then
    err "Recipe 'hello-world' still not indexed after resync (HTTP $http)."
    err "Likely cause: the MC server's cwd is not the repo root (e.g. running from"
    err ".next/standalone). Restart the server with MISSION_CONTROL_RECIPES_DIR pointed"
    err "at $REPO_ROOT/recipes before retrying. Example:"
    err "  MISSION_CONTROL_RECIPES_DIR=$REPO_ROOT/recipes pnpm dev"
    die "recipe resync did not produce hello-world row"
  fi
  info "  hello-world recipe indexed"
}

ensure_smoke_project() {
  info "Ensure smoke project '$SMOKE_PROJECT_SLUG' exists"
  local list
  list=$(curl -s -H "Authorization: Bearer $MC_API_KEY" "$MC_URL/api/projects")
  local project_id
  if command -v jq >/dev/null 2>&1; then
    project_id=$(echo "$list" | jq -r --arg slug "$SMOKE_PROJECT_SLUG" \
      '.projects[] | select(.slug==$slug) | .id' | head -1)
  else
    project_id=$(node -e "
      let raw=''; process.stdin.on('data',c=>raw+=c);
      process.stdin.on('end',()=>{
        const j=JSON.parse(raw||'null')||{};
        const p=(j.projects||[]).find(x=>x.slug===process.argv[1]);
        process.stdout.write(p?String(p.id):'');
      });" "$SMOKE_PROJECT_SLUG" <<<"$list")
  fi
  if [[ -n "$project_id" && "$project_id" != "null" ]]; then
    info "  smoke project exists (id=$project_id)"
    echo "$project_id"
    return 0
  fi
  info "  creating smoke project"
  local body
  body=$(cat <<JSON
{ "name": "MC Runner Smoke", "slug": "$SMOKE_PROJECT_SLUG", "description": "Phase 14 runner end-to-end smoke tests (auto-created).", "ticket_prefix": "SMOKE" }
JSON
)
  local create
  create=$(curl -s -X POST -H "Authorization: Bearer $MC_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" "$MC_URL/api/projects")
  if command -v jq >/dev/null 2>&1; then
    project_id=$(echo "$create" | jq -r '.project.id // .id // empty')
  else
    project_id=$(node -e "
      let raw=''; process.stdin.on('data',c=>raw+=c);
      process.stdin.on('end',()=>{
        const j=JSON.parse(raw||'null')||{};
        const id = (j.project&&j.project.id) || j.id;
        process.stdout.write(id?String(id):'');
      });" <<<"$create")
  fi
  if [[ -z "$project_id" || "$project_id" == "null" ]]; then
    err "Could not create smoke project. Response: $create"
    die "project create failed"
  fi
  info "  smoke project created (id=$project_id)"
  echo "$project_id"
}

configure_runtime_settings() {
  local project_id="$1"
  info "Configuring runtime.project_repo_map for project $project_id -> $REPO_ROOT"
  # GET current map, merge, PUT back.
  local current
  current=$(curl -s -H "Authorization: Bearer $MC_API_KEY" "$MC_URL/api/settings")
  local existing_map
  if command -v jq >/dev/null 2>&1; then
    existing_map=$(echo "$current" | jq -r \
      '(.settings[] | select(.key=="runtime.project_repo_map") | .value) // "{}"')
  else
    existing_map=$(node -e "
      let raw=''; process.stdin.on('data',c=>raw+=c);
      process.stdin.on('end',()=>{
        const j=JSON.parse(raw||'null')||{};
        const s=(j.settings||[]).find(x=>x.key==='runtime.project_repo_map');
        process.stdout.write(s&&s.value?s.value:'{}');
      });" <<<"$current")
  fi
  local merged
  merged=$(node -e "
    const existing = JSON.parse(process.argv[1] || '{}');
    existing[process.argv[2]] = process.argv[3];
    process.stdout.write(JSON.stringify(existing));
  " "$existing_map" "$project_id" "$REPO_ROOT")
  info "  merged project_repo_map: $merged"
  local settings_body
  settings_body=$(node -e "
    const v = process.argv[1];
    process.stdout.write(JSON.stringify({
      settings: [{ key: 'runtime.project_repo_map', value: v }]
    }));
  " "$merged")
  local http
  http=$(curl -s -o /tmp/mc-smoke-settings.json -w "%{http_code}" \
    -X PUT -H "Authorization: Bearer $MC_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$settings_body" "$MC_URL/api/settings")
  if [[ "$http" != "200" && "$http" != "204" ]]; then
    warn "PUT /api/settings returned HTTP $http. Body:"
    cat /tmp/mc-smoke-settings.json | head -c 500; echo
    warn "Continuing — the setting may already be configured admin-side."
  fi

  info "Configuring runtime.mount_allowlist to include $REPO_ROOT/.data/runner/worktrees"
  local worktree_parent="$REPO_ROOT/.data/runner/worktrees"
  mkdir -p "$worktree_parent"
  local existing_allowlist
  if command -v jq >/dev/null 2>&1; then
    existing_allowlist=$(echo "$current" | jq -r \
      '(.settings[] | select(.key=="runtime.mount_allowlist") | .value) // "[]"')
  else
    existing_allowlist=$(node -e "
      let raw=''; process.stdin.on('data',c=>raw+=c);
      process.stdin.on('end',()=>{
        const j=JSON.parse(raw||'null')||{};
        const s=(j.settings||[]).find(x=>x.key==='runtime.mount_allowlist');
        process.stdout.write(s&&s.value?s.value:'[]');
      });" <<<"$current")
  fi
  local merged_allowlist
  merged_allowlist=$(node -e "
    let arr;
    try { arr = JSON.parse(process.argv[1] || '[]'); } catch { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    const add = process.argv[2];
    if (!arr.includes(add)) arr.push(add);
    if (!arr.includes(process.argv[3])) arr.push(process.argv[3]);
    process.stdout.write(JSON.stringify(arr));
  " "$existing_allowlist" "$worktree_parent" "$REPO_ROOT")
  local allowlist_body
  allowlist_body=$(node -e "
    process.stdout.write(JSON.stringify({
      settings: [{ key: 'runtime.mount_allowlist', value: process.argv[1] }]
    }));
  " "$merged_allowlist")
  http=$(curl -s -o /tmp/mc-smoke-allowlist.json -w "%{http_code}" \
    -X PUT -H "Authorization: Bearer $MC_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$allowlist_body" "$MC_URL/api/settings")
  if [[ "$http" != "200" && "$http" != "204" ]]; then
    warn "PUT /api/settings (mount_allowlist) returned HTTP $http"
  fi
  info "  mount_allowlist: $merged_allowlist"
}

# ----------------------------------------------------------------------------
# Task creation + polling
# ----------------------------------------------------------------------------
create_smoke_task() {
  local project_id="$1"
  info "Creating hello-world smoke task"
  local body
  body=$(node -e "
    process.stdout.write(JSON.stringify({
      title: 'smoke: hello world',
      recipe_slug: 'hello-world',
      status: 'assigned',
      project_id: Number(process.argv[1]),
      workspace_source: { project_id: Number(process.argv[1]), base_ref: 'main' }
    }));
  " "$project_id")
  local resp
  resp=$(curl -s -o /tmp/mc-smoke-task.json -w "%{http_code}" \
    -X POST -H "Authorization: Bearer $MC_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" "$MC_URL/api/tasks")
  if [[ "$resp" != "200" && "$resp" != "201" ]]; then
    err "POST /api/tasks returned HTTP $resp. Body:"
    cat /tmp/mc-smoke-task.json; echo
    die "task creation failed"
  fi
  local id
  if command -v jq >/dev/null 2>&1; then
    id=$(jq -r '.task.id // .id // empty' </tmp/mc-smoke-task.json)
  else
    id=$(node -e "
      const j=JSON.parse(require('fs').readFileSync('/tmp/mc-smoke-task.json','utf8'));
      process.stdout.write(String((j.task&&j.task.id)||j.id||''));
    ")
  fi
  if [[ -z "$id" ]]; then
    err "Could not extract task id from response:"
    cat /tmp/mc-smoke-task.json; echo
    die "task id missing"
  fi
  info "  task id=$id"
  echo "$id"
}

start_runner() {
  local log_dir="$REPO_ROOT/.data/runner"
  mkdir -p "$log_dir"
  local out="$log_dir/smoke-daemon.out"
  local err_log="$log_dir/smoke-daemon.err"
  : > "$out"
  : > "$err_log"
  info "Starting runner daemon: node scripts/mc-runner.mjs"
  info "  stdout -> $out"
  info "  stderr -> $err_log"
  (
    cd "$REPO_ROOT"
    node scripts/mc-runner.mjs >"$out" 2>"$err_log" &
    echo $! >/tmp/mc-smoke-runner.pid
  )
  RUNNER_PID=$(cat /tmp/mc-smoke-runner.pid)
  info "  runner PID $RUNNER_PID"
  sleep 1
  if ! kill -0 "$RUNNER_PID" 2>/dev/null; then
    err "Runner exited immediately. Tail of stderr:"
    tail -n 40 "$err_log" >&2 || true
    die "runner failed to start"
  fi
}

poll_task_done() {
  local task_id="$1"
  info "Polling GET /api/tasks/$task_id for 'done' (budget: ${POLL_BUDGET_SEC}s, interval: ${POLL_INTERVAL_SEC}s)"
  local elapsed=0
  local last_status=""
  while (( elapsed < POLL_BUDGET_SEC )); do
    local resp
    resp=$(curl -s -H "Authorization: Bearer $MC_API_KEY" \
      "$MC_URL/api/tasks/$task_id" 2>/dev/null || echo '{}')
    local status
    if command -v jq >/dev/null 2>&1; then
      status=$(echo "$resp" | jq -r '.task.status // .status // empty')
    else
      status=$(node -e "
        const j=JSON.parse(process.argv[1]||'{}')||{};
        const s=(j.task&&j.task.status)||j.status||'';
        process.stdout.write(s);" "$resp")
    fi
    if [[ "$status" != "$last_status" ]]; then
      info "  t=${elapsed}s status=$status"
      last_status="$status"
    fi
    case "$status" in
      done)
        info "Task $task_id reached 'done' after ${elapsed}s"
        return 0
        ;;
      failed|cancelled)
        err "Task $task_id reached terminal non-done status: $status"
        # Dump failure details
        echo "--- Task body ---" >&2
        echo "$resp" | head -c 2000 >&2; echo >&2
        return 1
        ;;
    esac
    sleep "$POLL_INTERVAL_SEC"
    elapsed=$(( elapsed + POLL_INTERVAL_SEC ))
  done
  err "Task $task_id did not reach 'done' within ${POLL_BUDGET_SEC}s (last status: $last_status)"
  return 1
}

# ----------------------------------------------------------------------------
# Post-run verification
# ----------------------------------------------------------------------------
verify_artifacts() {
  local task_id="$1"
  local worktree="$REPO_ROOT/.data/runner/worktrees/task-$task_id"
  local logs="$REPO_ROOT/.data/runner/logs/task-$task_id"

  info "Verifying worktree artifacts at $worktree"
  if [[ ! -d "$worktree" ]]; then
    warn "  worktree dir missing (may have been GC'd early)"
  else
    [[ -f "$worktree/HELLO.md" ]] && info "  HELLO.md present ($(wc -l <"$worktree/HELLO.md" | tr -d ' ') lines)" \
      || warn "  HELLO.md missing"
    [[ -f "$worktree/.mc/progress.md" ]] && info "  .mc/progress.md present" || warn "  .mc/progress.md missing"
    [[ -f "$worktree/.mc/checkpoints.jsonl" ]] && info "  .mc/checkpoints.jsonl present" || warn "  .mc/checkpoints.jsonl missing"
  fi

  info "Verifying log artifacts at $logs"
  if [[ ! -d "$logs" ]]; then
    warn "  logs dir missing"
  else
    find "$logs" -maxdepth 2 -type f -o -type l | sort | while read -r f; do info "  $f"; done
  fi

  info "Post-run docker ps -a --filter label=mc.task_id=$task_id:"
  docker ps -a --filter "label=mc.task_id=$task_id" --format \
    'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Labels}}' || true
}

# ----------------------------------------------------------------------------
# Main — hello-world flow
# ----------------------------------------------------------------------------
run_hello_world() {
  info "=== Mission Control runner smoke: hello-world ==="
  info "repo root: $REPO_ROOT"
  info "mc url:    $MC_URL"

  resolve_api_key
  preflight_docker
  preflight_mc
  preflight_image

  ensure_recipe_indexed
  local project_id
  project_id=$(ensure_smoke_project | tail -1)
  [[ -n "$project_id" ]] || die "could not resolve smoke project id"
  configure_runtime_settings "$project_id"

  TASK_ID=$(create_smoke_task "$project_id" | tail -1)
  [[ -n "$TASK_ID" ]] || die "could not resolve smoke task id"

  start_runner

  local poll_ok=0
  if poll_task_done "$TASK_ID"; then
    poll_ok=1
  fi

  verify_artifacts "$TASK_ID"

  if (( poll_ok == 1 )); then
    echo
    info "========================================="
    info "  SMOKE PASSED"
    info "  task id = $TASK_ID"
    info "  project = $project_id ($SMOKE_PROJECT_SLUG)"
    info "========================================="
    return 0
  else
    echo
    err "========================================="
    err "  SMOKE FAILED"
    err "  task id = $TASK_ID"
    err "  Check: .data/runner/smoke-daemon.err"
    err "  Check: .data/runner/logs/task-$TASK_ID/latest/"
    err "  Check: GET /api/tasks/$TASK_ID (runner_last_failure_reason)"
    err "========================================="
    return 1
  fi
}

# ----------------------------------------------------------------------------
# Entrypoint
# ----------------------------------------------------------------------------
case "${1:-help}" in
  hello-world)
    run_hello_world
    ;;
  preserve-on-stop|preserve-across-crash)
    die "Subcommand '$1' is reserved for Phase 15/17; not yet implemented."
    ;;
  help|--help|-h)
    usage
    exit 0
    ;;
  *)
    err "Unknown subcommand: $1"
    usage
    exit 1
    ;;
esac
