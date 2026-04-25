# Request Records and Bills Reconciled Workflow Spec

Last updated: 2026-04-25
Mission Control workflow target: `firmvault-request-medical-records`
FirmVault source workflow: `request_records_bills`

This is the reconciled source-of-truth spec for converting the FirmVault medical records and bills request process into Mission Control workflow YAML and recipe cards.

## Source Decision

Use these sources together:

- Process source: `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_2_treatment/workflows/request_records_bills/workflow.md`
- Execution/data-contract source: `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/Skills/medical-records-request/SKILL.md`
- Follow-up source: `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/Skills/medical-records-request/references/follow-up-process.md`
- Send/error/template source: `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/Skills/medical-records-request/references/`
- Vault contract: `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/DATA_CONTRACT.md`

Use v2 for workflow coverage, timing, provider-level repetition, and common issue handling. Use v1 for every actual read/write, output path, recipe prompt, and task instruction.

## Purpose

For each eligible medical provider on a FirmVault case, request medical records and itemized bills, track the request, follow up on delays, process receipt, and trigger chronology work when the records arrive.

This workflow is not a single case-level checkbox. It is repeatable per provider. A case may have several active instances at once, one per provider, or a manually scoped instance for a single provider.

## Trigger Conditions

Supported triggers:

- `provider_treatment_complete`: a provider's treatment status becomes complete or discharged.
- `law_firm.landmarks.treatment_complete == true`: case-level treatment complete, making all untreated/unrequested providers eligible for demand preparation.
- Manual activation for a specific `provider_slug`.
- Demand preparation activation when records are needed before demand.

Trigger guard:

- If records and bills are already received for the provider, do not start the workflow.
- If records and bills have already been requested and a follow-up timer is pending, do not create a duplicate request workflow.
- If HIPAA/medical authorization is missing, start only the authorization check node and route to review/blocker if missing.

## Workflow Variables

Required:

- `case_slug`: FirmVault case slug.
- `provider_slug`: provider contact stub slug for provider-specific runs.
- `provider_name`: display name, derived from the provider stub when possible.

Optional:

- `request_records`: boolean, default `true`.
- `request_bills`: boolean, default `true`.
- `litigation_certified_records`: boolean, default `false`; request certified records if true.
- `send_method_preference`: `fax | email | mail | manual`, default `fax`.
- `source_trigger`: text label such as `provider_treatment_complete`, `demand_preparation`, or `manual`.

Open implementation issue:

- Current Mission Control workflow YAML only has `provider_scope`; it should be tightened to provider-specific variables so each workflow instance has a clear subject and worktree task context.

## Vault Reads

Every recipe must start by reading the case workspace mounted at `/workspace`.

Read:

- `cases/<case_slug>/<case_slug>.md`
- `cases/<case_slug>/contacts/<provider_slug>.md`
- linked provider master card under `Contacts/Medical/<slug>.md`, when linked
- linked client master card under `Contacts/Clients/<slug>.md`, when linked
- `cases/<case_slug>/documents/`
- `cases/<case_slug>/Activity Log/`
- `state.yaml`, if present in the mounted case workspace

Never read:

- `medical_providers.json`
- `case_state.json`
- `overview.json`
- `contacts.json`
- `insurance.json`
- `liens.json`
- FalkorDB or Cypher sources
- raw firm storage outside the mounted worktree

## Vault Writes

Allowed writes:

- Provider stub frontmatter in `cases/<case_slug>/contacts/<provider_slug>.md`
- New request draft or request packet shadow under `cases/<case_slug>/documents/`
- Activity log entries under `cases/<case_slug>/Activity Log/`
- Case frontmatter landmarks only when the recipe has enough evidence and the workflow node is explicitly responsible for that completion effect

Required provider fields after request is sent:

```yaml
records_requested: "YYYY-MM-DD"
bills_requested: "YYYY-MM-DD"
request_method: fax | email | mail | manual
fax_confirmation: "<confirmation or blank>"
follow_up_date: "YYYY-MM-DD"
```

Required follow-up entry shape:

```yaml
follow_ups:
  - date: "YYYY-MM-DD"
    method: phone | fax | email
    contact: "<dept or person>"
    result: "<short outcome>"
    next_follow_up: "YYYY-MM-DD"
```

Required receipt fields:

```yaml
records_received: "YYYY-MM-DD"
records_path: "cases/<case_slug>/documents/<filename>.pdf"
records_pages: <count>
bills_received: "YYYY-MM-DD"
bills_path: "cases/<case_slug>/documents/<filename>.pdf"
```

Do not edit importer-owned blocks between `<!-- roscoe-medical-start -->` / `<!-- roscoe-medical-end -->`.

## Workflow Nodes

### 1. `verify_medical_authorization`

Type: recipe
Recipe: `firmvault-medical-records-verify-authorization`

Purpose:

- Confirm signed HIPAA or medical authorization exists.
- Check whether the authorization is usable for records and bills requests.
- Surface the missing authorization if it cannot be verified.

Dependencies:

- Provider exists.
- Case exists.

Completion effects:

- If verified, satisfy `law_firm.landmarks.medical_auth_verified == true` for this workflow context.
- If missing, move task to review/blocker with precise missing item.

Notes:

- The current YAML also requires `law_firm.landmarks.treatment_complete == true`. That is too strict for provider-specific records requests because a single provider may be complete while the whole case is still treating.

### 2. `prepare_records_request`

Type: recipe
Recipe: `firmvault-medical-records-prepare-request`

Purpose:

- Identify provider contact details and treatment date range.
- Determine whether records, bills, imaging, or narrative reports are needed.
- Prepare a request packet or draft shadow.
- Note certified-records language if litigation applies.

Dependencies:

- `verify_medical_authorization` complete.
- Authorization verified.
- Provider contact information exists or the agent has enough information to draft a manual-send packet.

Completion effects:

- Create or update request packet shadow under `cases/<case_slug>/documents/`.
- Satisfy `records_request_packet_prepared` for this provider workflow instance.

Human review:

- If provider fax/email/address or treatment dates are missing, route to review with the missing fields.

### 3. `send_records_request`

Type: gateway or recipe-backed human-assist task
Current recipe: `firmvault-medical-records-send-request`

Purpose:

- Confirm the packet was sent or route to the human who must send it.
- Record request method and confirmation.
- Set `follow_up_date` to 14 days after send.

Preferred model:

- Treat this as a human send gateway until fax/email integrations are safely wrapped.
- The recipe may prepare exact instructions and verify evidence of send, but it should not pretend to send externally unless a real constrained send tool exists.

Dependencies:

- `prepare_records_request` complete.

Completion effects:

- Write `records_requested` and/or `bills_requested`.
- Write `request_method`, confirmation, and `follow_up_date`.
- Write Activity Log entry.
- Satisfy provider-scoped `records_request_sent`.

Case-level landmark rule:

- `records_requested_all_providers` should be satisfied only when every eligible provider has `records_requested`.
- `bills_requested_all_providers` should be satisfied only when every eligible provider has `bills_requested`.
- A single provider workflow should not blindly mark all-provider landmarks true.

### 4. `wait_14_days_for_records`

Type: wait

Purpose:

- Wait 14 days after the send node.
- End early if records and bills are received before the timer matures.

Dependencies:

- `send_records_request` complete.
- Timer: 14 days after `send_records_request`.

Exit condition:

- If `records_received` and `bills_received` are true for this provider, skip follow-up and continue to receipt processing.

### 5. `first_follow_up_records_request`

Type: recipe
Recipe: `firmvault-medical-records-first-follow-up`

Purpose:

- Check whether records/bills arrived.
- If not, call or resend request.
- Document status, fee issue, wrong fax/address, HIPAA issue, or expected production date.
- Set next follow-up date.

Dependencies:

- `wait_14_days_for_records` complete or timer due.
- Provider still lacks records or bills.

Completion effects:

- Append provider `follow_ups`.
- Write Activity Log entry.
- Satisfy `first_follow_up_complete`.

### 6. `wait_7_days_for_second_follow_up`

Type: wait

Purpose:

- Wait 7 days after the first follow-up.
- End early if records and bills arrive.

Dependencies:

- `first_follow_up_records_request` complete.
- Timer: 7 days after first follow-up.

### 7. `second_follow_up_records_request`

Type: recipe
Recipe: `firmvault-medical-records-second-follow-up`

Purpose:

- Perform second follow-up if records or bills remain outstanding.
- Re-send written request if needed.
- Capture expected production date or escalation reason.

Dependencies:

- `wait_7_days_for_second_follow_up` complete or timer due.
- Provider still lacks records or bills.

Completion effects:

- Append provider `follow_ups`.
- Write Activity Log entry.
- Satisfy `second_follow_up_complete`.

### 8. `wait_9_days_for_escalation`

Type: wait

Purpose:

- Wait 9 days after the second follow-up, reaching the 30-day escalation point.
- End early if records and bills arrive.

Dependencies:

- `second_follow_up_records_request` complete.
- Timer: 9 days after second follow-up.

### 9. `escalate_records_request`

Type: recipe
Recipe: `firmvault-medical-records-escalate-delay`

Purpose:

- Escalate delayed records/bills.
- Options include office manager, compliance/privacy officer, formal demand, attorney review, or subpoena if litigation is active.

Dependencies:

- `wait_9_days_for_escalation` complete or timer due.
- Provider still lacks records or bills.

Completion effects:

- Write escalation Activity Log entry.
- Append follow-up/escalation status to provider stub.
- Route to attorney/human review if legal intervention is needed.

### 10. `receive_and_process_records_bills`

Type: recipe
Recipe needed: `firmvault-medical-records-receive-and-process`

Purpose:

- Confirm received documents are present in the vault shadow.
- Verify completeness enough for case use.
- Update provider stub with records/bills received date and document paths.
- Trigger chronology update.

Dependencies:

- Condition: records and/or bills received for provider.
- Can be triggered independently when documents arrive, even if the workflow is currently waiting.

Completion effects:

- Write `records_received`, `records_path`, `records_pages`.
- Write `bills_received`, `bills_path`, and amount if available.
- Write Activity Log entry.
- If every eligible provider has records, satisfy `law_firm.landmarks.all_records_received == true`.
- If every eligible provider has bills, satisfy `law_firm.landmarks.all_bills_received == true`.
- Trigger `firmvault-medical-chronology-update` workflow or recipe.

Open implementation issue:

- This recipe does not exist yet in Mission Control. Current YAML ends with a human review condition instead.

### 11. `confirm_workflow_complete`

Type: review
Mode: human or recipe-specific review

Purpose:

- Confirm records/bills workflow is complete for this provider.
- Confirm no follow-up timer remains necessary.
- Confirm medical chronology trigger has been emitted or is intentionally bypassed.

Dependencies:

- `receive_and_process_records_bills` complete or the provider has been bypassed/not applicable.

Completion effects:

- Satisfy provider-scoped `medical_records_request_workflow_complete`.

## Recommended YAML Changes From Current File

Current file: `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-request-medical-records.yaml`

Recommended changes:

- Replace broad `provider_scope` with provider-specific variables.
- Add explicit provider-level trigger support.
- Remove case-level `treatment_complete` as a hard dependency for authorization verification.
- Do not have one provider's `send_records_request` complete `records_requested_all_providers` unless an all-provider aggregate check confirms it.
- Add wait nodes as explicit nodes, not only timer dependencies hidden on follow-up recipe nodes.
- Add early-exit conditions on waits/follow-ups when records arrive.
- Add `receive_and_process_records_bills` as a first-class recipe node.
- Add chronology trigger/completion effect after receipt.
- Keep human send as a gateway unless a constrained external send tool exists.

## Recipe Inventory

Existing recipes:

- `firmvault-medical-records-verify-authorization`
- `firmvault-medical-records-prepare-request`
- `firmvault-medical-records-send-request`
- `firmvault-medical-records-first-follow-up`
- `firmvault-medical-records-second-follow-up`
- `firmvault-medical-records-escalate-delay`

Needed recipes:

- `firmvault-medical-records-receive-and-process`
- `firmvault-medical-chronology-update` or equivalent, unless this is handled by a separate workflow.

Review file issue:

- Existing recipe packages use `REVIEW.md`. The roadmap/checklist says `review.md`. Pick one convention and make recipe loading match it. Preferred convention should be lowercase `review.md` unless the loader already expects uppercase.

## Tool Policy

Allowed current capability tools:

- `read_file`
- `list_dir`
- `grep_files`
- `write_file`

Do not grant broad shell execution.

Legacy source tools remain reference-only until wrapped:

- `medical_request_generator.py`
- `generate_document.py`
- `read_pdf.py`
- PDF merge/fax/email/send tools

Future deterministic tools should be narrow:

- `fill_medical_request_template`
- `merge_request_with_authorization`
- `extract_pdf_text`
- `record_provider_request_sent`
- `record_provider_documents_received`

## Human Gates

Human input is required when:

- HIPAA/authorization is missing.
- Provider contact information is missing.
- The request must be sent externally and no constrained send tool exists.
- Provider requests payment.
- Provider says HIPAA is invalid or missing.
- Records are incomplete or belong to the wrong patient.
- Escalation requires attorney involvement.
- Case is in litigation and subpoena/certified records strategy is needed.

## Bypass and Not Applicable

Provider-level bypass should be available.

Bypass examples:

- Provider was entered by mistake.
- Provider has no treatment records.
- Records already exist from another source.
- Attorney decides records are unnecessary for demand.
- Provider is unrelated to the claim.

Bypass effects:

- Mark provider workflow node or instance skipped/not applicable.
- Write an Activity Log entry explaining who bypassed it and why.
- Do not mark `all_records_received` or `all_bills_received` true unless the aggregate condition remains true after excluding the bypassed provider.

## Rejected Source Material

Do not carry forward:

- Any instruction to read or write `medical_providers.json`.
- Any instruction to update `case_state.json`.
- Any instruction to use FalkorDB, Cypher, `graph_client`, or `graph_manager`.
- Any instruction that assumes `${ROSCOE_ROOT}`.
- Any instruction that stores raw PHI outside the FirmVault shadow contract.
- Any instruction that claims the agent sent a fax/email without a real constrained send tool.

## Acceptance Criteria

This workflow is ready to implement when:

- YAML is provider-scoped.
- Every node maps to either an existing recipe, a new needed recipe, a wait, or a human review/gateway.
- All reads/writes are expressed in FirmVault vault paths.
- All timers have early-exit conditions for receipt.
- All all-provider landmarks require aggregate checks.
- The receipt/process node exists.
- The review file naming convention is settled.
- At least one test or dry-run fixture proves a provider-specific workflow starts and materializes only the first eligible task.
