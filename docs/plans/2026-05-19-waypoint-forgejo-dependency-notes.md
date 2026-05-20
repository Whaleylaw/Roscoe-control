# Waypoint ForgeJo Dependency Notes

**Date:** 2026-05-20

**Purpose:** Record the pinned-package consumption evidence for `docs/plans/2026-05-19-waypoint-mission-control-host-runtime-plan.md` Task P0.2 before Mission Control starts importing Waypoint runtime APIs.

## Current verified state

### Mission Control

- Repo path: `/Users/aaronwhaley/Github/mission-control`
- Current branch: `feat/waypoint-runtime-slice`
- `package.json` currently has no `@waypoint/core` or `@waypoint/folder-host` dependency.
- Mission Control has a `forgejo` remote at `ssh://git@localhost:2222/aaron/mission-control.git`, but this session did not prove Waypoint package registry access.

### Waypoint

- Repo path: `/Users/aaronwhaley/Github/active projects/waypoint`
- Current branch: `main`
- Recent verified commit at time of inspection: `c1c423d feat(referral): stage chronology generation contract`
- Existing tags include:
  - `waypoint-firmvault-bootstrap-rc.1`
  - `waypoint-package-rc.1`
- `@waypoint/core` is the root package at version `0.1.0`.
- `@waypoint/folder-host` is `packages/waypoint-folder-host` at version `0.1.0`.
- Both packages are currently marked `private: true`.

## Dependency mode findings

### Preferred merge-ready mode

Use ForgeJo/private package registry packages with exact versions, once published:

```json
{
  "dependencies": {
    "@waypoint/core": "0.1.0-mc.0",
    "@waypoint/folder-host": "0.1.0-mc.0"
  }
}
```

Registry routing may live in a committed `.npmrc` only if it contains no token values. Credentials must come from environment variables or user-level config.

### Fallback git tag mode is not currently merge-ready

A direct git tag dependency against the Waypoint monorepo resolves the root package, but the subpackage path dependency for `@waypoint/folder-host` fails because its source `package.json` depends on `@waypoint/core` via `workspace:*`.

Observed failure from a temp smoke install:

```text
ERR_PNPM_WORKSPACE_PKG_NOT_FOUND In : "@waypoint/core@workspace:*" is in the dependencies but no package named "@waypoint/core" is present in the workspace
This error happened while installing the dependencies of @waypoint/folder-host@0.1.0
```

This means `@waypoint/folder-host` cannot be consumed from the monorepo subdirectory as-is unless the publishing/packaging step rewrites `workspace:*` before the package is consumed.

### Packed tarball smoke works only with a core override

`pnpm pack` rewrites the folder-host package dependency from `workspace:*` to `@waypoint/core: 0.1.0`. Installing both local tarballs still tries to fetch `@waypoint/core@0.1.0` from the default npm registry unless the consumer supplies an override.

A temp smoke install succeeded with this shape:

```json
{
  "dependencies": {
    "@waypoint/core": "file:/tmp/path/waypoint-core-0.1.0.tgz",
    "@waypoint/folder-host": "file:/tmp/path/waypoint-folder-host-0.1.0.tgz"
  },
  "pnpm": {
    "overrides": {
      "@waypoint/core": "file:/tmp/path/waypoint-core-0.1.0.tgz"
    }
  }
}
```

The import smoke then returned:

```json
{"parseQuestManifest":"function","createQuestRegistry":"function","loadBundledWaypointCatalog":"function","runReferralPackageBuilder":"function"}
```

This is acceptable for local spike/debug only. It is not merge-ready because it relies on local tarball paths.

## Decision for P1

Do not start P1.2 as a committed dependency change until one of these is true:

1. ForgeJo/private registry has exact-version packages for `@waypoint/core` and `@waypoint/folder-host`; or
2. Waypoint publishes tarballs/releases to a stable non-local URL and Mission Control can pin those exact tarball URLs with no local paths; or
3. Waypoint changes packaging so git-tag package consumption works without `workspace:*` leakage and Mission Control can pin immutable git refs.

For P1.1, Mission Control can still add the RED import smoke test. Expected failure remains unresolved imports until the package distribution decision is completed.

## Security rule

Do not commit package registry tokens, auth headers, or local-only absolute tarball paths to Mission Control.
