# FirmVault Workflow Source Reconciliation

Last updated: 2026-04-25

This file records how to choose source material for converting FirmVault workflows into Mission Control workflow YAML and recipe cards.

## Source Folders

Two historical workflow folders exist in FirmVault:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2`

Do not blindly copy either folder. The correct source is a reconciliation of both.

## Short Answer

Use `skills.tools.workflows` as the contract baseline.

Use `skills.tools.workflows.2` as the workflow catalog and conditionality baseline.

For each workflow we convert, create a reconciled Mission Control version that keeps the useful process detail from v2 but rewrites stale data access, paths, tools, and task boundaries to match the v1 vault contract and the Mission Control recipe runner.

## Why Not Use v1 Alone?

The first folder is better for the current vault architecture:

- It has `DATA_CONTRACT.md`, which correctly says the vault is the state store.
- It has `PHASE_DAG.yaml`, which is the strongest lifecycle model.
- Its top-level skills are closer to the current file-based FirmVault reality.
- Example: `Skills/medical-records-request/SKILL.md` reads from `cases/<slug>/...`, writes to `cases/<slug>/documents/`, updates provider stubs, and writes Activity Log entries.

But v1 is incomplete as a concrete workflow catalog:

- Many phase folders only have landmarks and README files.
- It has far fewer concrete workflow definitions.
- It is better at lifecycle/contract than detailed step orchestration.

## Why Not Use v2 Alone?

The second folder is better for workflow coverage:

- It contains many actual workflow files across onboarding, file setup, treatment, demand, negotiation, settlement, lien, and litigation.
- It captures conditionality, repeatability, per-provider/per-claim/per-lien work, human steps, follow-up timing, and optional branches.
- It includes useful templates, tools, and phase-to-skill mapping material.

But v2 is stale as an implementation source:

- It still references FalkorDB and graph queries.
- It still references per-case JSON state such as `medical_providers.json`, `insurance.json`, `liens.json`, and `case_state.json`.
- It still references `${ROSCOE_ROOT}` in some skill/tool examples.
- Its workflow files often describe a good legal process but not the current vault-backed data model.

Measured stale-reference scan:

- v1 stale references found: 125
- v2 stale references found: 801

That confirms v2 should not be copied directly into recipes or workflow YAML.

## Reconciliation Rule

For each workflow:

1. Start with the v2 workflow file if one exists.
2. Use v1 `PHASE_DAG.yaml` and phase landmarks to decide whether the workflow belongs in the current lifecycle.
3. Use v1 `DATA_CONTRACT.md` to rewrite all reads and writes.
4. Use v1 top-level `Skills/<slug>/SKILL.md` when it is more current than the v2 embedded skill.
5. Use v2 embedded workflow/skill detail only for legal/process richness, branch logic, timing, escalation rules, and templates.
6. Split each agent-executable workflow step into a Mission Control recipe.
7. Keep human-only steps as review/gateway/wait nodes unless they can be made deterministic.
8. Register only tools that can actually run safely inside the constrained recipe workspace.
9. Mark stale graph/JSON/path language as rejected source material.

## Medical Records Example

The v2 workflow:

`skills.tools.workflows.2/workflows/phase_2_treatment/workflows/request_records_bills/workflow.md`

is the better process source. It includes:

- HIPAA prerequisite
- provider-level repeatability
- prepare request
- send request
- wait/follow-up schedule
- receive/process records
- chronology trigger
- quality checklist
- common provider problems

The v1 skill:

`skills.tools.workflows/Skills/medical-records-request/SKILL.md`

is the better execution source. It already uses:

- `cases/<slug>/<slug>.md`
- `cases/<slug>/contacts/<provider-slug>.md`
- `cases/<slug>/documents/`
- `Templates/INDEX.md`
- Activity Log files
- provider stub frontmatter
- no graph or per-case JSON state

So the reconciled Mission Control workflow should use:

- v2 for step structure and timing.
- v1 for SOUL.md content, data reads/writes, and output locations.
- Mission Control workflow YAML for dependencies/timers/review gates.
- Mission Control recipes for each executable step.

## Recommended Reconciled Medical Records Workflow Shape

Workflow: `firmvault-request-medical-records`

Trigger:

- provider treatment complete
- demand preparation
- manual provider-specific activation

Variables:

- `case_slug`
- `provider_slug`
- `provider_name`
- `request_records`
- `request_bills`
- `litigation_certified_records`

Nodes:

1. Verify HIPAA authorization exists.
2. Prepare records/bills request documents.
3. Human/send gateway, unless sending is later automated.
4. Mark request sent and write follow-up date.
5. Wait 14 days unless records/bills received.
6. First follow-up.
7. Wait 7 days unless records/bills received.
8. Second follow-up.
9. Wait 9 days unless records/bills received.
10. Escalate request.
11. Receive/process records and bills.
12. Trigger medical chronology update.

## Candidate Workflow Catalog From v2

Use this as the starting list, subject to reconciliation:

- `phase_0_onboarding/workflows/case_setup`
- `phase_0_onboarding/workflows/document_collection`
- `phase_1_file_setup/workflows/accident_report`
- `phase_1_file_setup/workflows/insurance_bi_claim`
- `phase_1_file_setup/workflows/insurance_pip_claim`
- `phase_1_file_setup/workflows/medical_provider_setup`
- `phase_2_treatment/workflows/client_check_in`
- `phase_2_treatment/workflows/lien_identification`
- `phase_2_treatment/workflows/medical_chronology`
- `phase_2_treatment/workflows/medical_provider_status`
- `phase_2_treatment/workflows/referral_new_provider`
- `phase_2_treatment/workflows/request_records_bills`
- `phase_3_demand/workflows/draft_demand`
- `phase_3_demand/workflows/gather_demand_materials`
- `phase_3_demand/workflows/send_demand`
- `phase_4_negotiation/workflows/negotiate_claim`
- `phase_4_negotiation/workflows/offer_evaluation`
- `phase_4_negotiation/workflows/track_offers`
- `phase_5_settlement/workflows/lien_negotiation`
- `phase_5_settlement/workflows/settlement_processing`
- `phase_6_lien/workflows/final_distribution`
- `phase_6_lien/workflows/get_final_lien`
- `phase_6_lien/workflows/negotiate_lien`
- litigation workflows under `phase_7_litigation/subphases/*/workflows/*`

## Conversion Checklist

For every workflow conversion, produce:

- Mission Control workflow YAML.
- Recipe card for each agent node.
- `SOUL.md` for each recipe.
- `review.md` for each recipe.
- References copied or linked into the recipe package.
- Tool list narrowed to only what the recipe actually needs.
- Variables required by the workflow.
- Trigger conditions.
- Timer dependencies.
- Human review/gateway nodes.
- Bypass/not-applicable behavior.
- Completion effects, including landmarks satisfied.
- Tests or fixture validation where feasible.

## Current Recommendation

Before building more law-firm workflows, do one source-reconciliation pass for the first workflow: `request_records_bills`.

Output should be a reconciled workflow spec, not just code:

- final intended workflow nodes
- each node's recipe slug
- dependencies and timers
- human gates
- data reads/writes under the vault contract
- templates and references
- tools needed
- stale source content explicitly rejected

After that, build or adjust the Mission Control YAML and recipes from the reconciled spec.
