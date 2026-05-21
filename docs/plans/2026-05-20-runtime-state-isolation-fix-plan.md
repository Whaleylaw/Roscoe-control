# Mission Control Runtime State Isolation Fix Plan

> **For Hermes:** Use systematic-debugging before changing runtime/build behavior, then implement this plan task-by-task with source-backed verification.

**Goal:** Make the long-lived Mission Control checkout build and run reliably even when local runtime state exists, by keeping build-time data paths out of repo-local runtime folders and making runtime state placement explicit.

**Architecture:** Mission Control should treat source code and runtime data as separate concerns. Production builds must use build-scoped scratch paths and Next file tracing must exclude local runtime/diagnostic directories. Runtime/dev execution should continue to support `MISSION_CONTROL_DATA_DIR`, with a documented path for moving existing `.data` out of the repository before live Mission Control testing.

**Tech Stack:** Next.js 16, TypeScript, Node.js path/env config, pnpm, Vitest, Next standalone output tracing.

---

## Ground truth at plan creation

Verified on 2026-05-20 from `/Users/aaronwhaley/Github/mission-control`:

- Current source parity commit: `340901d chore: merge upstream main into forgejo source`.
- `HEAD`, local `main`, `forgejo/main`, `forgejo/feat/waypoint-runtime-slice`, `fork/main`, and `fork/feat/waypoint-runtime-slice` all point to `340901d2e4db7015dcb188214d480d1342c13e6d`.
- Primary checkout contains repo-local runtime/build state:
  - `.data`: 8.2G
  - `.hermes`: 1.2M
  - `node_modules`: 975M
  - `.next`: 452M
- Current `src/lib/config.ts` already uses build-scoped data paths when `NEXT_PHASE === 'phase-production-build'`:
  - `MISSION_CONTROL_BUILD_DATA_DIR` or `${os.tmpdir()}/mission-control-build`
  - per-worker `worker-${process.pid}` data directories
  - build-specific DB/token overrides
- Current `next.config.js` excludes `./.data/**/*` and `./.git/**/*` from output file tracing, but does not yet exclude every local runtime/diagnostic directory.
- The previous verified workaround was to build from a clean detached worktree. This plan should make the primary checkout safe enough for normal build/runtime use, then keep the clean worktree script as an operational fallback if needed.

## Root-cause hypothesis to verify

The earlier primary checkout build failures were caused by checkout-local runtime/diagnostic state being visible to build-time module evaluation or Next standalone file tracing. A clean worktree succeeded because it lacked the large repo-local `.data` and diagnostic state.

This is a narrow hypothesis: the code at the parity commit is buildable, but the primary checkout is vulnerable to local runtime state. The fix should reduce or eliminate build-time coupling to repo-local runtime directories.

## Task 1: Reproduce current primary-checkout behavior

**Objective:** Establish whether the parity commit still fails in the primary checkout before making code changes.

**Commands:**

```bash
git status --short --branch
git log --oneline -3
pnpm build
```

**Expected:** Either the build now passes after parity/upstream merge, or it still fails/times out. Record the exact result in this plan before implementation.

## Task 2: Audit build-time runtime state references

**Objective:** Identify any remaining build-time references to repo-local `.data`, `.hermes`, `.next`, heap snapshots, or local runtime paths.

**Files to inspect:**

- `src/lib/config.ts`
- `src/lib/config.test.ts`
- `next.config.js`
- `.env.example`
- `AGENTS.md`
- `docs/deployment.md`
- Any source paths found by searches for:
  - `process.cwd()`
  - `.data`
  - `MISSION_CONTROL_DATA_DIR`
  - `outputFileTracingExcludes`

**Verification commands:**

```bash
rg "process\.cwd\(\)|\.data|MISSION_CONTROL_DATA_DIR|outputFileTracingExcludes" src scripts next.config.js .env.example AGENTS.md docs/deployment.md
```

## Task 3: Harden Next build tracing exclusions

**Objective:** Ensure local runtime/diagnostic artifacts are not traced into standalone output and cannot poison release builds.

**Likely file:** `next.config.js`

**Implementation direction:** Extend `outputFileTracingExcludes` to cover local-only runtime/diagnostic paths, including at minimum:

- `./.data/**/*`
- `./.git/**/*`
- `./.hermes/**/*`
- `./.claude/**/*`
- `./Heap.*.heapsnapshot`
- `./test-results/**/*`
- `./playwright-report/**/*`
- `./.playwright-mcp/**/*`

Keep the existing `.git` comment, but generalize it to runtime/diagnostic state.

**Verification:**

```bash
pnpm typecheck
pnpm build
```

## Task 4: Make runtime data relocation explicit

**Objective:** Provide a safe documented/automated path to keep live runtime state outside the repo before actual Mission Control testing.

**Likely files:**

- `.env.example`
- `AGENTS.md`
- `docs/deployment.md`
- optionally a small script under `scripts/`

**Implementation direction:**

- Document that production/dev runtime should set `MISSION_CONTROL_DATA_DIR` outside the repository, e.g. `$HOME/.mission-control/data` or another operator-selected path.
- Keep `.data/` as supported local fallback for zero-config development, but not the recommended long-lived runtime path.
- If adding a script, make it non-destructive and explicit; it should not move data automatically without operator action.

## Task 5: Verify primary checkout and clean worktree builds

**Objective:** Prove both the dirty/long-lived checkout and the clean release path work after the fix.

**Commands:**

```bash
pnpm typecheck
pnpm build
rm -rf /tmp/mission-control-runtime-fix-clean
git worktree add --detach /tmp/mission-control-runtime-fix-clean HEAD
cd /tmp/mission-control-runtime-fix-clean
pnpm install --frozen-lockfile
pnpm build
```

**Expected:** Typecheck exits 0, primary checkout build exits 0, clean worktree build exits 0.

## Task 6: Commit and push parity

**Objective:** Keep Forgejo and fork aligned after the runtime fix.

**Commands:**

```bash
git add <changed-files>
git commit -m "fix(build): isolate runtime state from production builds"
git push forgejo HEAD:main HEAD:feat/waypoint-runtime-slice
git push fork HEAD:main HEAD:feat/waypoint-runtime-slice
git ls-remote forgejo refs/heads/main refs/heads/feat/waypoint-runtime-slice
git ls-remote fork refs/heads/main refs/heads/feat/waypoint-runtime-slice
```

## Definition of done

- Primary checkout `pnpm build` passes with the existing repo-local `.data` present.
- Clean worktree `pnpm build` still passes.
- Runtime data placement is documented as explicit operational policy.
- Forgejo remains the source of truth.
- Forgejo/fork `main` and `feat/waypoint-runtime-slice` all point to the same final fix commit.
