# P11 Build Gate Hardening Plan

Date: 2026-05-20
Repo: Mission Control
Branch: `feat/waypoint-runtime-slice`

## Goal

Turn the P10 documented production build blocker into a release decision:

1. prove whether a clean checkout/runtime-data separation makes `pnpm build` pass;
2. if it does, land the smallest repo/process hardening needed to keep runtime data out of Next tracing;
3. if it does not, isolate the remaining Next build phase enough to define a release-blocking issue with a concrete owner and workaround.

P11 does **not** change Waypoint runtime semantics unless a root-cause-backed build fix requires it.

## Verified starting state

- Current branch head before this plan: `ec16b0e feat(waypoint): add operator review surface`.
- Feature branch was pushed to GitHub fork: `fork/feat/waypoint-runtime-slice` at `ec16b0e2d9ae2fcfb4a1148fe068485c6f8c0568`.
- Forgejo SSH push failed with `Permission denied (publickey)` and is not the active checkpoint target for this slice.
- P10 build blocker is documented in `docs/plans/2026-05-20-p10-build-gate-investigation.md`.
- Known blocker signature: full production Next build times out or OOMs; local `.data` measured about 8.2G during investigation; trace logs indicated @vercel/nft/glob walking `.data/.../.local/bin` paths during standalone tracing.

## Phase P11.1 — Clean-worktree build reproduction

Deliverables:
- Create a disposable clean worktree outside the current repo path.
- Confirm whether the clean worktree contains local runtime data (`.data`) or diagnostic artifacts.
- Install dependencies from the lockfile.
- Run `pnpm build` in the clean worktree with a tracked timeout/log.

Verification gate:
- Capture command output showing either a successful build or the exact failure signature.

## Phase P11.2 — Runtime-data separation test

Deliverables:
- If clean worktree build passes, compare clean worktree conditions against the current repo:
  - `.data` presence/size;
  - `.hermes` diagnostic artifacts;
  - Next config and output tracing behavior.
- If clean worktree build fails, collect enough build/heap/log evidence to avoid repeating the earlier speculative fixes.

Verification gate:
- A documented root-cause hypothesis with primary-source evidence.

## Phase P11.3 — Minimal hardening fix or release workaround

Possible outcomes:

- **Fix path:** land a small repo/config/process change that prevents runtime data from affecting production builds, then verify `pnpm build`.
- **Workaround path:** document the release build procedure, e.g. build from a clean worktree or with runtime data outside the repo.
- **Escalation path:** if clean builds still fail, mark production build as a release blocker independent of Waypoint P2–P10 feature work.

Verification gate:
- If claiming fixed: quote a passing `pnpm build` output from the same turn.
- If claiming workaround: quote the command and output proving the workaround.
- If claiming blocked: quote the failing output and update the P10/P11 docs accordingly.

## Reporting rules

- Do not claim production build success without visible same-turn `pnpm build` output.
- Do not delete or mutate the primary repo `.data` tree as a fix during this slice.
- Do not preserve or print credentials.
- Keep diagnostic logs/artifacts out of commits unless they are intentionally summarized in docs.

## Findings — 2026-05-20

### Checkpoint

The feature branch was pushed to GitHub fork as the checkpoint target:

- remote: `fork`
- branch: `feat/waypoint-runtime-slice`
- remote ref: `ec16b0e2d9ae2fcfb4a1148fe068485c6f8c0568`

Forgejo SSH push was attempted first and failed with:

```text
git@localhost: Permission denied (publickey).
fatal: Could not read from remote repository.
```

So Forgejo branch checkpoint remains a separate SSH-key setup issue; the GitHub fork checkpoint succeeded.

### Clean-worktree build reproduction

A disposable clean worktree was created at:

```text
/tmp/mission-control-p11-clean
```

Primary evidence from setup:

```text
Preparing worktree (detached HEAD ec16b0e)
HEAD is now at ec16b0e feat(waypoint): add operator review surface
--- clean worktree data dirs ---
--- clean worktree head ---
ec16b0e feat(waypoint): add operator review surface
```

The clean worktree had no top-level `.data`, `.hermes`, or `node_modules` before install.

Dependency install passed from the lockfile:

```text
pnpm install --frozen-lockfile
Done in 13.1s
```

Production build passed in the clean worktree:

```text
pnpm build
▲ Next.js 16.1.6 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 47s
  Running TypeScript ...
  Collecting page data using 17 workers ...
✓ Generating static pages using 17 workers (137/137) in 618.2ms
  Finalizing page optimization ...
```

The route table included the Waypoint routes added in this integration track, including:

```text
/api/projects/[id]/waypoint/routes
/api/projects/[id]/waypoint/routes/[routeId]
/api/projects/[id]/waypoint/routes/[routeId]/events
/api/projects/[id]/waypoint/routes/[routeId]/gate
/api/projects/[id]/waypoint/routes/[routeId]/state
/api/projects/[id]/waypoint/status
```

### Root-cause conclusion

The P10 full production build failure is environment/worktree-state sensitive, not an inherent compile failure in the Waypoint integration code.

The clean worktree passes production build at the same commit (`ec16b0e`) that timed out/OOMed in the primary working tree. That strongly supports the earlier trace-based finding: local runtime/diagnostic state in the primary checkout, especially the large `.data` tree and/or diagnostic artifacts, is poisoning Next standalone trace/build behavior.

### Release workaround

For release sign-off, build Mission Control from a clean checkout/worktree that does not contain local runtime state:

```bash
git worktree add --detach /tmp/mission-control-release-build HEAD
cd /tmp/mission-control-release-build
pnpm install --frozen-lockfile
pnpm build
```

Do not use a long-lived development checkout containing `.data` as the release build workspace until the Next tracing/pathology is independently fixed.

### Recommended hardening follow-up

Create a separate infrastructure task to prevent local runtime state from entering release builds by default. Options:

1. Move development runtime data outside the repo by setting `MISSION_CONTROL_DATA_DIR` to a path under `~/Library/Application Support/mission-control` or another external runtime directory.
2. Add a release-build script that creates a disposable worktree and runs `pnpm install --frozen-lockfile && pnpm build` there.
3. Revisit `output: 'standalone'` and `outputFileTracingExcludes` only with a minimal reproduction; earlier config/code attempts did not fix the primary checkout.

P11 release-readiness result: **production build is verified green from a clean worktree; primary development checkout remains unsuitable as the release build workspace while it contains large runtime data.**
