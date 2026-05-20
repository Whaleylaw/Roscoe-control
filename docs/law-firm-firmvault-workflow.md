# FirmVault v2 Workflow Bridge

Mission Control can materialize FirmVault v2 case workflow landmarks into case-scoped Mission Control tasks.

## Source Inputs

The bridge reads the local FirmVault checkout from `MISSION_CONTROL_LAW_FIRM_ROOT`, or from the default path:

```text
/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault
```

For each case it uses:

- `cases/<slug>/<slug>.md` as the canonical v2 case state.
- `cases/<slug>/<slug>.md` frontmatter `status` as the active phase indicator.
- `cases/<slug>/<slug>.md` frontmatter `landmarks` as the first source of truth for landmark completion.
- `skills.tools.workflows/workflows/PHASE_DAG.yaml` as the phase, track, landmark, and condition contract.
- `skills.tools.workflows/runtime/task_templates/*.yaml` as the task body, skill, priority, review flag, and dependency contract.

Legacy landmark aliases are handled during translation so active cases imported before v2 can still map to v2 landmarks:

- `attorney_reviewed_demand` reads `attorney_approved_demand`.
- `bi_claim_opened` reads `insurance_claims_setup`.
- `providers_identified` reads `providers_setup`.
- `records_received_sufficient` reads `all_records_received`.
- `liens_identified` reads `outstanding_liens_identified`.

## Mission Control Outputs

The bridge creates a hidden Mission Control project per case, using the same case-project mechanism as the Law Firm task tab. Generated tasks are scoped to that project, so opening the case task board shows only the case's workflow queue.

Each materialized task includes:

- A title in the form `[FirmVault] <Client>: <Landmark>`.
- The `firmvault-workflow-task` recipe slug.
- Tags for law firm, FirmVault, case slug, phase, landmark, and skill.
- `metadata.implementation_repo` pointing at the FirmVault root.
- `metadata.code_location` pointing at `cases/<slug>/<slug>.md`.
- `metadata.law_firm` with the case slug, phase, phase kind, landmark, template, skill, review flag, dependency blockers, and stable `workflow_key`.
- A `workspace_source` pointing at the hidden case project and the configured FirmVault base ref.

The stable `workflow_key` is:

```text
<case_slug>:<phase_or_track_id>:<landmark_id>:<task_template_id>
```

Mission Control uses that key to avoid creating duplicates while a task is still open.

The bridge also ensures `runtime.project_repo_map` contains the hidden case project id mapped to the local FirmVault checkout. That gives the runner enough information to create an isolated git worktree for the task.

## Task Readiness

Unsatisfied landmarks in the active phase or active parallel tracks become candidate tasks. If a matching FirmVault task template has dependencies and those dependency landmarks are not satisfied, the task is created in `backlog` and records the blockers in `metadata.law_firm.blocked_by`. Otherwise it is created in `inbox`.

Active workflow ids are derived conservatively:

- Core statuses such as `onboarding`, `file_setup`, `treatment`, `demand`, `negotiation`, `settlement`, and `closed` map to the v2 core phases.
- Legacy `phase_6_lien` maps to `lien_track`.
- Legacy `phase_7_litigation` and canonical `litigation` map to `litigation_track`.
- `lien_track` and `client_contact` are active for open non-onboarding cases.
- `pip_track` is active when the case markdown shows a PIP claim.

## Operator Flow

1. Open a law-firm case in Mission Control.
2. Open the Workflow tab.
3. Mission Control previews v2-ready task candidates by reading `PHASE_DAG.yaml` and the case frontmatter.
4. Click **Create Mission Control tasks**.
5. Mission Control creates only missing tasks and skips any open task with the same `workflow_key`.
6. Open the Tasks tab to run the case's workflow queue through the standard Mission Control board.

## Recipe

Generated tasks point to `recipes/firmvault-workflow-task/`. The recipe instructions tell the worker to load:

- `/recipe/PREAMBLE.md`
- `/workspace/AGENTS.md`
- `/workspace/DESIGN.md`
- `/workspace/skills.tools.workflows/DATA_CONTRACT.md`
- `/workspace/MEMORY.md`
- `/workspace/skills.tools.workflows/workflows/PHASE_DAG.yaml`
- The matching task template.
- The matching FirmVault skill when one is named.

The recipe intentionally repeats FirmVault's safety rules: do not handle raw PHI, do not edit generated Roscoe marker blocks, do not invent vault paths outside `DATA_CONTRACT.md`, and hand off human-signature or attorney-judgment work to review or owner input.

## Worktree Review Lifecycle

FirmVault workflow tasks use `workspace_mode: worktree`. When a runner claims a task, Mission Control resolves `workspace_source.project_id` through `runtime.project_repo_map`, creates a task branch named `mc/task-<task_id>` from the task's `base_ref`, and mounts that worktree at `/workspace`.

The runner does all vault edits inside that task worktree. The normal FirmVault checkout is not edited while the runner is working.

When the runner submits `{ "status": "done" }`, Mission Control moves the task to `review`. Aegis reviews the submitted resolution. If Aegis rejects the work, the task is requeued with review feedback and the source checkout remains untouched.

If Aegis approves the work, Mission Control promotes the worktree before marking the task `done`:

1. Stage and commit any remaining worktree diff on `mc/task-<task_id>`.
2. Verify the target FirmVault checkout is clean.
3. Check out the task `base_ref`.
4. Merge the task branch into the base ref with a merge commit.
5. Mark the task `done`.

If promotion fails, the task moves to `awaiting_owner` with an error comment and the worktree is left intact for inspection. The task is not marked done, so failed promotion cannot silently pollute the base checkout.

## Runtime Requirement

The recipe uses the generic recipe-agent image:

```yaml
image: mc-recipe-agent:latest
```

Mission Control does not build recipe images automatically. Before assigning these tasks to the recipe runner, build the generic image:

```bash
pnpm mc:build-recipe-agent
```

The recipe also declares `OPENROUTER_API_KEY` as a runner secret. The runner loads it from `.data/runner/secrets/OPENROUTER_API_KEY` and injects it into the container env-file at run time.

By default, generated tasks branch from the current branch of `MISSION_CONTROL_LAW_FIRM_ROOT`. Set `MISSION_CONTROL_LAW_FIRM_BASE_REF` if FirmVault tasks should always branch from a specific base such as `main`.
