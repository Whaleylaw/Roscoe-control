# P10 Build Gate Investigation Plan

Date: 2026-05-20
Repo: Mission Control
Branch: `feat/waypoint-runtime-slice`

## Goal

Resolve or precisely characterize the P10 full build gate failure after the referral-package host smoke landed. The build gate is not green until `pnpm build` or an approved equivalent build command completes successfully, or until the failure is documented as an unrelated/environmental blocker with primary-source evidence.

## Current verified starting point

- Branch: `feat/waypoint-runtime-slice`
- Latest commit at investigation start: `c0b4d95 test(waypoint): add referral package host smoke`
- `pnpm build` previously timed out/hung under the default Next/Turbopack path.
- `pnpm exec next build --webpack` previously hit Node heap OOM on default heap.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec next build --webpack` previously still timed out after 600 seconds.

## Phase B1 — Reproduce and capture build failure cleanly

Deliverables:
- Fresh build logs under `.hermes/build-gate/`.
- Process/memory/environment snapshot.
- Confirmation whether stale `.next` or lingering build workers are involved.

Commands/gates:
- `git status --short --branch`
- `node -v && pnpm -v`
- inspect/clear stale build artifacts and old build worker processes only if they are confirmed stale.
- run build with explicit log capture and bounded timeout.

## Phase B2 — Isolate Turbopack vs webpack vs environment

Deliverables:
- Separate evidence for default `next build` and webpack build behavior.
- Heap/GC signal if OOM recurs.
- Determination whether failure occurs before/after compile, prerender/static generation, or standalone tracing.

Commands/gates:
- `pnpm build`
- `pnpm exec next build --webpack`
- optional diagnostic env: `NODE_OPTIONS=--max-old-space-size=8192 --trace-gc` only for bounded reproduction logs.

## Phase B3 — Narrow likely root cause

Deliverables:
- Root-cause hypothesis tied to logs/source/config, not guesswork.
- Minimal code/config change only if the root cause is clear.

Investigation targets:
- `next.config.js` standalone output/tracing/transpile config.
- app route/page dynamic/static behavior.
- imports that initialize DB, filesystem, gateway, package catalog, or local runtime during build.
- Node 24 + Next 16 behavior if the failure is version-sensitive.

## Phase B4 — Fix or document blocker

If root cause is code/config:
- make the smallest fix;
- run focused verification;
- run build gate;
- commit.

If root cause is environment/toolchain:
- document exact repro and workaround recommendation;
- do not claim P10 fully green unless the accepted gate passes.

## Done criteria

One of:

1. `pnpm build` passes with output captured, and the fix is committed if files changed.
2. A narrower approved build command passes and the plan documents why it is the correct gate.
3. A build blocker doc is committed with exact reproduction logs, root-cause evidence, and next action.

## Reporting rule

Every report must quote current-turn primary-source output for:
- commit hashes;
- test/build status;
- file changes;
- whether the working tree is clean.

## Investigation findings — 2026-05-20

### Reproduced failures

Captured logs live under `.hermes/build-gate/` and are intentionally not committed.

Observed build behavior:

- Default build command: `pnpm build`
  - Reproduced timeout at the build phase with:
    - `.hermes/build-gate/36-pnpm-build-tsconfig-excludes.log`
    - `.hermes/build-gate/45-pnpm-build-data-hidden-after-code-fixes.log`
  - Symptom: Next stays at `Creating an optimized production build ...` until the 600-second Hermes command timeout.
- Webpack build command: `pnpm exec next build --webpack`
  - Reproduced Node heap OOM under Node 22 and Node 24 paths.
  - Representative captured logs:
    - `.hermes/build-gate/41-webpack-after-trace-exclude-fix.log`
    - `.hermes/build-gate/42-webpack-after-obfuscated-localbin.log`
    - `.hermes/build-gate/43-webpack-after-hermes-sessions-obfuscation.log`
    - `.hermes/build-gate/44-webpack-after-agent-runtimes-obfuscation.log`
  - Representative failure: `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory` with max RSS around 3.6–4.5 GB before abort.

### Root-cause evidence gathered

A diagnostic `NODE_OPTIONS=--require=.hermes/build-gate/trace-readdir-stack.cjs` shim showed @vercel/nft/Next standalone trace collection expanding a broad glob that walks the local runtime `.data` tree:

- `.hermes/build-gate/38-readdir-stack-trace.log`
- Stack source:
  - `next/dist/compiled/@vercel/nft/index.js`
  - `next/dist/compiled/glob/glob.js`
- Representative traced path shape:
  - `/Users/aaronwhaley/Github/mission-control/.data/.../.local/bin`

The local `.data` tree on this machine is large:

- `.data` measured at approximately `8.2G` during the investigation.

Several attempted code/config mitigations did **not** clear the build gate and were reverted:

- adding broader `outputFileTracingExcludes` patterns in `next.config.js`;
- adding broader local directories to `tsconfig.exclude`;
- obfuscating local `.local/bin` candidate construction in Hermes runtime detection helpers.

These attempts were reverted because the same OOM/timeout behavior persisted. No code fix is landed from this investigation yet.

### Current decision

P10 runtime/API host smoke remains implemented, but the full Next production build gate is **not green** on this machine.

This blocker is documented enough to proceed to P9 UI/operator review work without claiming P10 build completion, because:

- the failure is reproducible outside the P10 smoke test itself;
- the failure is in Next standalone trace/build behavior walking local runtime data and/or hanging in optimized production build;
- the implementation changes attempted during the investigation did not produce a verified fix and were not retained.

### Recommended next action for build gate

Treat this as a separate build-infrastructure hardening issue before release sign-off:

1. Build from a clean checkout with no local runtime `.data` tree, or move runtime data outside the repo and rerun `pnpm build`.
2. If that still fails, run Next build under a longer external watchdog with heap snapshots enabled so the exact Turbopack/webpack phase can be isolated beyond the 600-second Hermes foreground cap.
3. Consider disabling `output: 'standalone'` for local operator builds if standalone packaging is not required for Mission Control's current deployment path.

P10 may be considered functionally smoke-tested, but not build-gate complete, until a production build pass is captured.
