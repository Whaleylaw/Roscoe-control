# Recipes

**Source of truth:** [`src/lib/recipe-schema.ts`](../../src/lib/recipe-schema.ts), [`src/lib/recipe-indexer.ts`](../../src/lib/recipe-indexer.ts), [`src/lib/recipe-watcher.ts`](../../src/lib/recipe-watcher.ts), [`src/lib/model-registry.ts`](../../src/lib/model-registry.ts), [`recipes/hello-world/`](../../recipes/hello-world/), [`src/app/api/recipes/*/route.ts`](../../src/app/api/recipes/)

**Who reads this:** Operators authoring a new `recipe.yaml`, or debugging why a recipe failed to index.

**Prerequisites:** Mission Control running; the `recipes/` directory reachable by the server process (see [Filesystem layout](#filesystem-layout) below).

## Map

| Section | Anchor |
|---|---|
| Filesystem layout | [#filesystem-layout](#filesystem-layout) |
| `recipe.yaml` schema | [#recipeyaml-schema](#recipeyaml-schema) |
| `SOUL.md` convention | [#soulmd-convention](#soulmd-convention) |
| Canonical `recipe.yaml` example | [#canonical-recipeyaml-example](#canonical-recipeyaml-example) |
| Indexing pipeline | [#indexing-pipeline](#indexing-pipeline) |
| Recipe REST endpoints | [#recipe-rest-endpoints](#recipe-rest-endpoints) |
| Model registry | [#model-registry](#model-registry) |
| Common errors | [#common-errors](#common-errors) |
| Pitfall callouts | [#pitfall-callouts](#pitfall-callouts) |

## Filesystem layout

A recipe is a directory under the recipes root whose basename is the recipe's `slug`. The indexer treats `recipes/<slug>/` as an atomic unit — every file within it contributes to the directory content hash that drives dedup (see [Indexing pipeline](#indexing-pipeline)).

```
recipes/<slug>/
├── recipe.yaml        # required — Zod-validated (see schema below)
├── SOUL.md            # optional — long-form agent brief, mounted read-only at /recipe/SOUL.md
├── README.md          # optional — human-facing notes (author / history / changelog)
├── tools/             # optional — arbitrary static files mounted at /recipe/tools/
└── skills/            # optional — arbitrary static files mounted at /recipe/skills/
```

The recipes root is resolved by [`getRecipesRoot()`](../../src/lib/recipe-watcher.ts#L44-L48) as follows:

1. If `MISSION_CONTROL_RECIPES_DIR` is set, resolve that path (absolute or cwd-relative).
2. Otherwise default to `<process.cwd()>/recipes`.

> 🟢 **Standalone builds:** `node .next/standalone/server.js` runs with `cwd` = `.next/standalone/`, which does **not** contain the authored `recipes/` tree. Standalone deployments MUST export `MISSION_CONTROL_RECIPES_DIR` pointing at the repo's absolute `recipes/` path — see [`admin-config.md` → Environment variables](./admin-config.md) (to be written in Plan 18.1-02) for the full standalone checklist.

Source: [`src/lib/recipe-watcher.ts:33-48`](../../src/lib/recipe-watcher.ts#L33-L48).

## `recipe.yaml` schema

The Zod schema at [`src/lib/recipe-schema.ts`](../../src/lib/recipe-schema.ts) **is** the truth. Paraphrase invites drift — quote it. The block below is copied verbatim from [`src/lib/recipe-schema.ts:37-71`](../../src/lib/recipe-schema.ts#L37-L71):

```typescript
export const recipeYamlSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message:
        'slug must be lowercase kebab-case (a-z, 0-9, hyphens, no leading/trailing dash), 1-64 chars',
    })
    .min(1)
    .max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  when_to_use: z.string().max(2000).optional(),
  image: z.string().min(1),
  workspace_mode: z.enum(['worktree', 'readonly', 'none']),
  timeout_seconds: z.number().int().min(10).max(86400),
  max_concurrent: z.number().int().min(1).max(100).default(1),
  max_attempts: z.number().int().min(1).max(10).optional(),
  env: z.record(z.string(), z.string()).default({}),
  secrets: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  model: z.object({
    primary: z
      .string()
      .min(1)
      .refine(isKnownModel, {
        error: (issue) =>
          `recipe.model.primary '${String(issue.input)}' is not in the model registry. ` +
          `Known models: ${MODEL_IDS.join(', ')}`,
      }),
    fallback: z.string().optional(),
    provider: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  version: z.number().int().min(1).default(1),
})
```

### Field reference

| Field | Type | Default | Source |
|---|---|---|---|
| `slug` | `string` (lowercase kebab-case, 1–64 chars) | — (required) | [`recipe-schema.ts:38-45`](../../src/lib/recipe-schema.ts#L38-L45) |
| `name` | `string` (1–200 chars) | — (required) | [`recipe-schema.ts:46`](../../src/lib/recipe-schema.ts#L46) |
| `description` | `string` (≤2000 chars) | — (optional) | [`recipe-schema.ts:47`](../../src/lib/recipe-schema.ts#L47) |
| `when_to_use` | `string` (≤2000 chars) | — (optional) | [`recipe-schema.ts:48`](../../src/lib/recipe-schema.ts#L48) |
| `image` | `string` (1+ chars; Docker image reference) | — (required) | [`recipe-schema.ts:49`](../../src/lib/recipe-schema.ts#L49) |
| `workspace_mode` | `'worktree' \| 'readonly' \| 'none'` | — (required) | [`recipe-schema.ts:50`](../../src/lib/recipe-schema.ts#L50) |
| `timeout_seconds` | `integer [10, 86400]` | — (required) | [`recipe-schema.ts:51`](../../src/lib/recipe-schema.ts#L51) |
| `max_concurrent` | `integer [1, 100]` | `1` | [`recipe-schema.ts:52`](../../src/lib/recipe-schema.ts#L52) |
| `max_attempts` | `integer [1, 10]` | — (optional; filesystem-only) | [`recipe-schema.ts:53`](../../src/lib/recipe-schema.ts#L53) |
| `env` | `Record<string, string>` | `{}` | [`recipe-schema.ts:54`](../../src/lib/recipe-schema.ts#L54) |
| `secrets` | `string[]` (ENV VAR **names**, min 1 char) | `[]` | [`recipe-schema.ts:55`](../../src/lib/recipe-schema.ts#L55) |
| `tags` | `string[]` (min 1 char each) | `[]` | [`recipe-schema.ts:56`](../../src/lib/recipe-schema.ts#L56) |
| `model.primary` | `string` (must match a [model registry](#model-registry) id) | — (required) | [`recipe-schema.ts:58-65`](../../src/lib/recipe-schema.ts#L58-L65) |
| `model.fallback` | `string` | — (optional) | [`recipe-schema.ts:66`](../../src/lib/recipe-schema.ts#L66) |
| `model.provider` | `string` | — (optional) | [`recipe-schema.ts:67`](../../src/lib/recipe-schema.ts#L67) |
| `model.params` | `Record<string, unknown>` | — (optional) | [`recipe-schema.ts:68`](../../src/lib/recipe-schema.ts#L68) |
| `version` | `integer ≥ 1` | `1` | [`recipe-schema.ts:70`](../../src/lib/recipe-schema.ts#L70) |

## Pitfall callouts

Two schema fields have surprising runtime behavior. Read these before authoring a recipe.

### ⚠️ `max_attempts` is filesystem-only

`max_attempts` is **not** a column of the `recipes` DB table. The claim route re-parses `recipe.yaml` from disk on every claim via [`resolveRecipeMaxAttempts(slug)`](../../src/lib/runner-claim.ts#L365-L381) in `src/lib/runner-claim.ts`. Do **NOT** attempt `SELECT max_attempts FROM recipes` — the column does not exist.

Why it matters: bumping `max_attempts` in `recipe.yaml` takes effect on the next claim without any DB migration. Conversely, rolling back the value requires editing the file — you cannot "patch" it via SQL.

Sources:
- [`src/lib/recipe-schema.ts:14-18`](../../src/lib/recipe-schema.ts#L14-L18) — "NOT round-tripped through the recipes DB row; Plan 14-05 / 14-06 re-read recipe.yaml from disk"
- [`src/lib/runner-claim.ts:347-381`](../../src/lib/runner-claim.ts#L347-L381) — `resolveRecipeMaxAttempts` is the canonical resolver
- [`src/lib/recipe-indexer.ts:177-233`](../../src/lib/recipe-indexer.ts#L177-L199) — `getIndexedRecipeBySlug` projects a fixed column set; `max_attempts` is not among them

The claim-time resolution rule (from [`src/lib/runner-claim.ts:12-16`](../../src/lib/runner-claim.ts#L12-L16)):

```
final_max_attempts = task.runner_max_attempts
                  ?? resolveRecipeMaxAttempts(slug)
                  ?? 3
```

### ⚠️ `recipe.secrets` is a list of ENV VAR NAMES, not values

`recipe.secrets: [NAME1, NAME2]` declares which env var **names** the runner should populate inside the container. The runner reads values from `.data/runner/secrets/<NAME>` at claim time and injects them via `--env-file`. **NEVER** put secret values in `recipe.yaml` — `recipe.yaml` is committed to git and indexed into the `recipes` table.

The canonical [`recipes/hello-world/recipe.yaml`](../../recipes/hello-world/recipe.yaml) omits `secrets` entirely because it makes no model calls. A recipe that needs an Anthropic API key looks like this:

```yaml
# secrets is a list of ENV VAR NAMES ONLY — values live in .data/runner/secrets/<NAME>
secrets:
  - ANTHROPIC_API_KEY       # runner injects .data/runner/secrets/ANTHROPIC_API_KEY as env var
  - OPENAI_API_KEY          # same convention, one file per name
```

Source: [`src/lib/recipe-schema.ts:55`](../../src/lib/recipe-schema.ts#L55) (`secrets: z.array(z.string().min(1)).default([])`). Runner-side resolution is documented in [`runner-daemon.md`](./runner-daemon.md) (to be written in Plan 18.1-02).

## `SOUL.md` convention

Every recipe MAY ship a sibling `SOUL.md`. The runner mounts it **read-only** at `/recipe/SOUL.md` inside the container. `SOUL.md` is authored by the recipe author and describes the agent's domain — the steps, invariants, and persona the agent should embody.

The canonical minimal example lives at [`recipes/hello-world/SOUL.md`](../../recipes/hello-world/SOUL.md):

```markdown
# Hello World Agent

You are the Mission Control hello-world smoke agent.

Your job:

1. Read `/recipe/PREAMBLE.md` for the runtime contract.
2. Append a line to `/workspace/.mc/progress.md`.
3. Append a JSON line to `/workspace/.mc/checkpoints.jsonl`.
4. Create and commit a `HELLO.md` file in `/workspace`.
5. POST `${MC_API_URL}/api/runner/tasks/${MC_TASK_ID}/submit` with `{ "status": "done" }` using `Authorization: Bearer $MC_API_TOKEN`.
6. Exit 0.

Keep it short. No model calls. No retries. This exists to prove the pipeline.
```

> ⚠️ **`/recipe/PREAMBLE.md` is authored by the RUNNER, not the recipe author.** At claim time the runner writes `PREAMBLE.md` alongside your `SOUL.md` and will **overwrite** any recipe-authored `PREAMBLE.md`. If you need to ship content that survives, put it in `SOUL.md` or `README.md`. The full preamble contract is covered in [`agent-contract.md`](./agent-contract.md#preamble) (to be written in Plan 18.1-03).

## Canonical `recipe.yaml` example

Quoted verbatim from [`recipes/hello-world/recipe.yaml`](../../recipes/hello-world/recipe.yaml):

```yaml
slug: hello-world
name: Hello World Agent
description: Reference agent proving the Mission Control container contract. Emits a checkpoint, commits HELLO.md, and marks the task done.
when_to_use: Smoke-testing the Phase 14 runner pipeline. Do NOT use for real work.
image: mc-hello-world-agent:latest
workspace_mode: worktree
timeout_seconds: 120
max_concurrent: 1
max_attempts: 2
tags:
  - smoke
  - reference
model:
  primary: claude-haiku-4-5-20251001
  provider: anthropic
  params:
    temperature: 0
```

## Indexing pipeline

Three code paths drive rows into the `recipes` table. All three funnel through [`indexRecipe()`](../../src/lib/recipe-indexer.ts#L80-L149) — there is no alternative write path.

### 1. Boot-time full scan

At server boot, [`scanRecipesDir()`](../../src/lib/recipe-watcher.ts#L69-L90) in `src/lib/recipe-watcher.ts` walks every subdirectory of the recipes root and calls `indexRecipe()` per slug. DB rows whose slug does **not** correspond to an on-disk directory are removed. The scan is blocking: the server does not accept traffic until it finishes, so the DB matches disk when the first request arrives.

Source: [`src/lib/recipe-watcher.ts:69-90`](../../src/lib/recipe-watcher.ts#L69-L90).

### 2. Chokidar watcher

After the boot scan, `src/lib/recipe-watcher.ts` installs a chokidar watcher on the recipes root. File-change events for `recipe.yaml`, `SOUL.md`, `README.md`, and anything under `tools/` or `skills/` trigger a per-slug 250ms-debounced reindex via the internal `scheduleReindex` path. Editor/OS noise (`.swp`, `*~`, `*.tmp`, `.DS_Store`) is ignored.

### 3. Admin resync endpoint

`POST /api/recipes/resync` (admin only) invokes [`resyncRecipes()`](../../src/lib/recipe-watcher.ts#L183) — the same full-rescan code path as boot, exposed as an HTTP surface. Operators trigger it from the Recipes panel's **Resync** button (cross-linked in [`task-board-surfaces.md`](./task-board-surfaces.md), to be written in Plan 18.1-04) when the watcher has fallen behind or after bulk external edits (`git pull`, external editor writes).

### Error-row flow

When `indexRecipe()` fails validation (YAML syntax, bad schema, unknown model, slug mismatch), it **does not** skip the recipe silently. It writes a minimal row with `status='error'` and a human-readable `error_message` column. The Recipes panel UI reads these rows and surfaces the error text to operators so they can see the root cause without grepping server logs.

> ⚠️ **Drift-guard:** the column is named `error_message`. An earlier narrative used a different legacy column name for this field — that drift was corrected in Phase 18 Plan 04 (commit `d42983a`). If any runtime code or doc references a non-`error_message` column for recipe validation failures, it is stale — file an issue. The authoritative column write happens in [`src/lib/recipe-indexer.ts:118-124`](../../src/lib/recipe-indexer.ts#L118-L124).

Source: [`src/lib/recipe-indexer.ts:118-134`](../../src/lib/recipe-indexer.ts#L118-L134) (error-row write path) and [`src/app/api/recipes/route.ts:65-96`](../../src/app/api/recipes/route.ts#L65-L96) (`mapRow` discriminating error rows for API callers).

## Recipe REST endpoints

Four routes live under `src/app/api/recipes/`:

| Method | Path | Auth tier | Returns | Source |
|---|---|---|---|---|
| `GET` | `/api/recipes` | viewer | `{ recipes: FullRecipeDto[] }` — indexed recipes; `?include_broken=1` (admin only) includes error rows | [`src/app/api/recipes/route.ts:35-57`](../../src/app/api/recipes/route.ts#L35-L57) |
| `GET` | `/api/recipes/[slug]` | viewer | `{ recipe: FullRecipeDto \| ErrorRecipeDto }` — single recipe by slug, including deserialised `soul_md`, `env`, `secrets`, `tags`, `model` | [`src/app/api/recipes/[slug]/route.ts:29-54`](../../src/app/api/recipes/[slug]/route.ts#L29-L54) |
| `GET` | `/api/recipes/search?q=...&limit=N` | viewer | `{ recipes: FullRecipeDto[] }` — FTS5 BM25 search with tag-weight 2× (used by RecipeCombobox with 300ms debounce) | [`src/app/api/recipes/search/route.ts:40-89`](../../src/app/api/recipes/search/route.ts#L40-L89) |
| `POST` | `/api/recipes/resync` | admin | `{ scanned, inserted, updated, deleted, errors: [{slug, reason}] }` — full rescan ResyncReport | [`src/app/api/recipes/resync/route.ts:28-48`](../../src/app/api/recipes/resync/route.ts#L28-L48) |

Notes:

- The listing and search endpoints both filter `error_message IS NOT NULL` by default — broken recipes only appear via `?include_broken=1` (admin) on the list endpoint or via `GET /api/recipes/[slug]`, which always returns the row so the UI can render the failure surface.
- `POST /api/recipes/resync` is synchronous: it awaits `scanRecipesDir()` before responding ([`resync/route.ts:36`](../../src/app/api/recipes/resync/route.ts#L36)). Not intended for hot paths.
- `POST /api/recipes` (admin) exists for programmatic creation and lives in [`src/app/api/recipes/route.ts:139-258`](../../src/app/api/recipes/route.ts#L139-L258). It is intentionally omitted from the operator-facing table above — authoring recipes via disk + git commit is the blessed path.

## Model registry

`model.primary` in `recipe.yaml` is validated at index time against the [model registry](../../src/lib/model-registry.ts). If the string is unknown, `indexRecipe()` writes an error row and the recipe will not dispatch (MODEL-02). The registry is code-seeded and immutable — adding a model is a pull request against [`src/lib/model-registry.ts`](../../src/lib/model-registry.ts).

The v1.2 registry ships three models (quoted from [`src/lib/model-registry.ts:43-65`](../../src/lib/model-registry.ts#L43-L65)):

| Model ID | Provider | Context window |
|---|---|---|
| `claude-opus-4-7` | `anthropic` | 200,000 |
| `claude-sonnet-4-6` | `anthropic` | 200,000 |
| `claude-haiku-4-5-20251001` | `anthropic` | 200,000 |

> ⚠️ **Use the FULL model id.** Phase 14-10 locked that the validator uses `isKnownModel()` ([`src/lib/model-registry.ts:91-93`](../../src/lib/model-registry.ts#L91-L93)) which does an **exact** key lookup. Abbreviated forms like `claude-haiku-4-5` are **not** aliases — they will fail validation and produce an error row. Always quote the dated id exactly as it appears in the registry.

The recipe's effective model at claim time is resolved by [`resolveEffectiveModel()`](../../src/lib/runner-claim.ts#L45-L53) with precedence `task.model_override ?? recipe.model.primary` (MODEL-04).

## Common errors

When `indexRecipe()` writes an error row, the `error_message` column quotes the underlying cause. The common failure modes:

- **Invalid slug (regex mismatch)** — `recipe.yaml`'s `slug` does not match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Error message comes from [`recipe-schema.ts:40-43`](../../src/lib/recipe-schema.ts#L40-L43).
- **Slug mismatch** — directory is `foo-bar` but `recipe.yaml` declares `slug: baz`. Hard fail ([`recipe-indexer.ts:130-135`](../../src/lib/recipe-indexer.ts#L130-L135)); rename the directory OR edit the YAML, then let the watcher re-index.
- **Unknown model** — `model.primary` is not in the registry (`isKnownModel()` returned `false`). Error message enumerates the known IDs ([`recipe-schema.ts:62-64`](../../src/lib/recipe-schema.ts#L62-L64)).
- **Missing `recipe.yaml`** — directory exists but has no `recipe.yaml`. `indexRecipe()` returns `skipped_missing` and writes **no** row ([`recipe-indexer.ts:89-95`](../../src/lib/recipe-indexer.ts#L89-L95)). If a row exists for that slug from a prior scan, the watcher calls `removeRecipe()` to drop it.
- **YAML syntax error** — caught by `parseRecipeYaml` ([`recipe-schema.ts:101-114`](../../src/lib/recipe-schema.ts#L101-L114)); error message starts with `YAML parse error:`.
- **Duplicate slug across directories** — the indexer writes each directory's row keyed by `slug`, so two sibling directories with the same `slug` collide; last writer wins. Use unique directory names that match the recipe's declared slug.

At runtime, the runner daemon performs additional claim-time rejections (recipe's image not pulled, `max_attempts` exceeded, etc.) that do **not** round-trip through the indexer. Those are documented in [`scripts/README.runner.md`](../../scripts/README.runner.md) (troubleshooting section) and in [`runner-daemon.md`](./runner-daemon.md) (to be written in Plan 18.1-02).
