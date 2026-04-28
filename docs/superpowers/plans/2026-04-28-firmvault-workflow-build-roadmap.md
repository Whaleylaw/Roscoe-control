# FirmVault Workflow Build Roadmap

> **For agentic workers:** This document is the working roadmap for building and live-testing FirmVault workflows in Mission Control. Update the checkboxes, status table, and issue log after each workflow test. Do not choose the next workflow from memory; use this document.

**Goal:** Track the order, implementation readiness, test state, and discovered issues for FirmVault workflows as they are converted into executable Mission Control workflows.

**Architecture:** Workflows are ordered by dependency waves, not a fake strict sequence. Each wave lists workflows that become eligible at the same time, with a recommended test path through the parallel branches. FirmVault remains the case-state source of truth; Mission Control owns workflow/task/session runtime state and this roadmap.

**Tech Stack:** Mission Control workflow YAML, recipe cards, SQLite workflow/task runtime, FirmVault markdown vault, Forgejo PR review gate, local recipe runner.

---

## Current Anchor

**Active test case:** `test-ladder-006-template-tool`

**Current live-test state:** Phase 0 is complete.

| Workflow | Mission Control definition | Status | Live test evidence | Notes |
| --- | --- | --- | --- | --- |
| Case Setup | `firmvault-case-setup` | Live Tested | Workflow instance `25`; tasks `2163`, `2164`; Forgejo PR `#9` manually merged | Created canonical case scaffold and passed human review. |
| Initial Document Collection | `firmvault-document-collection` | Live Tested | Workflow instance `26`; tasks `2165`-`2168`; Forgejo PRs `#10`-`#13` manually merged/closed as needed | Signed-document wait completed early from canonical shadows; final human review task `2168` approved. |
| Accident Report | planned `firmvault-accident-report` | Next | Not started | Next recommended build/test target. |

## Status Key

Use the first matching status in this order:

| Status | Meaning |
| --- | --- |
| Not Started | Workflow exists only in the catalog or original FirmVault docs. |
| Designing | Workflow steps, gates, recipes, or canonical paths are being clarified. |
| Executable YAML | Mission Control workflow YAML exists and can be registered. |
| Recipes Ready | Every recipe node has a specific recipe, `SOUL.md`, and `REVIEW.md`; no generic `firmvault-workflow-task` placeholder remains. |
| Live Tested | Workflow has run through Mission Control task lifecycle, quality review, and Forgejo PR gate where file changes exist. |
| Issue | Workflow ran but exposed a blocker or design gap that must be resolved before relying on it. |

## Dependency Waves

### Wave 0: New Case Foundation

These workflows create the case and finish minimum onboarding.

| Workflow | Build status | Trigger / dependency gate | Output landmarks | Canonical FirmVault paths | Test state needed | Issues |
| --- | --- | --- | --- | --- | --- | --- |
| Case Setup | Live Tested | Manual new intake upload or `law_firm.new_intake_uploaded` | `case_setup_complete`, `client_info_received`, `case_setup_reviewed` | root case file, `Dashboard.md`, case `AGENTS.md`, starter ledgers, `activity/`, `workflow-log/`, `documents/` folders | Intake upload or equivalent new-case seed | Forgejo merge API hangs; manual merge path used. |
| Initial Document Collection | Live Tested | `case_setup_complete == true` | `onboarding_document_checklist_loaded`, `onboarding_documents_requested`, `onboarding_signature_packets_sent`, `contract_signed`, `medical_auth_signed`, `full_intake_complete` | `client/intake.md`, `client/contracts.md`, `client/authorizations.md`, `documents/shadows/client/*-signed.md` | Canonical case scaffold | Needed passive resolver support for `client_info_received`; fixed in Mission Control commit `6a83e35`. |

**Wave 0 completion rule:** Do not move into Wave 1 for a test case until `full_intake_complete` is satisfied and the document collection workflow is complete.

### Wave 1: File Setup Opens After `full_intake_complete`

These workflows become eligible once intake and signed authorizations are in place.

| Workflow | Build status | Trigger / dependency gate | Output landmarks | Canonical FirmVault paths | Test state needed | Issues |
| --- | --- | --- | --- | --- | --- | --- |
| Accident Report | Not Started | `full_intake_complete == true` | `accident_reporting_agency_identified`, `accident_report_number_identified`, `accident_report_requested`, `accident_report_obtained` | `accident/police-report.md`, `accident/accident.md`, `accident/liability.md`, `documents/shadows/accident/`, defendant/contact stubs, insurance clues | Phase 0 complete case; optional accident report shadow for passive arrival test | Next recommended workflow. Current catalog uses one broad `firmvault-accident-report-analyze` recipe for all steps; split or refine before live test. |
| Medical Provider Setup | Not Started | `full_intake_complete == true`; provider facts from intake/report/client | `providers_setup`, `provider_treatment_dates_recorded`, `injury_summary_recorded` | `medical-providers/<provider-slug>/`, provider contact stubs, `client/intake.md`, `activity/` | Phase 0 complete case with provider facts | Can run in parallel with Accident Report if intake already has provider facts. |
| Client Check-In Cadence | Not Started | Case active / full intake complete | `client_reachable`, `client_check_in_active`, possible `provider_referral_needed` | `client/check-ins.md`, `activity/`, provider notes | Phase 0 complete case | Catalog still uses generic `firmvault-workflow-task`; needs real recipes. |

**Recommended Wave 1 test path:** Build and live-test Accident Report first, then Medical Provider Setup, then Client Check-In.

### Wave 2: Accident Report Outputs Unlock Insurance

These workflows depend on accident report facts or insurance facts found during intake/report analysis.

| Workflow | Build status | Trigger / dependency gate | Output landmarks | Canonical FirmVault paths | Test state needed | Issues |
| --- | --- | --- | --- | --- | --- | --- |
| BI Claim Setup | Not Started | `accident_report_obtained == true` or at-fault carrier identified elsewhere | `at_fault_insurance_identified`, `bi_lor_sent`, `insurance_claims_setup` / `bi_claim_opened` | `insurance/bi-<carrier-slug>.md`, `contacts/<adjuster-or-carrier>.md`, `documents/generated/insurance/`, `documents/sent/insurance/` | Accident report analyzed or carrier facts manually supplied | Recipe exists as `firmvault-insurance-bi-send-lor`, but workflow YAML is not executable yet. |
| PIP Claim Setup | Not Started | PIP carrier identified or PIP track active | `pip_carrier_identified`, `pip_application_filed`, `pip_approved`, optional `pip_benefits_exhausted` | `insurance/pip-<carrier-slug>.md`, PIP application/request shadows, `activity/` | Intake/report insurance facts | Prior testing showed not-applicable/bypass behavior is needed for exhaustion-style tasks. |
| UM/UIM/MedPay/Workers Comp branches | Not Started | Coverage facts indicate branch applies | branch-specific coverage/claim landmarks | `insurance/um-*.md`, `insurance/uim-*.md`, `insurance/medpay-*.md`, `insurance/workers-comp-*.md` | Coverage facts from report/intake/policy docs | Treat as conditional branches, not always-on tasks. |

**Recommended Wave 2 test path:** BI Claim Setup first, then PIP Claim Setup, then conditional coverage branches only when the test case contains facts that require them.

### Wave 3: Treatment Monitoring

These workflows manage treatment and early lien discovery while the client treats.

| Workflow | Build status | Trigger / dependency gate | Output landmarks | Canonical FirmVault paths | Test state needed | Issues |
| --- | --- | --- | --- | --- | --- | --- |
| Medical Provider Status | Not Started | `providers_setup == true` | `provider_list_reviewed`, `provider_status_updated`, `treatment_complete`, `provider_followups_flagged` | `medical-providers/<provider-slug>/records-bills.md`, provider ledgers, `client/check-ins.md` | Provider ledgers exist | Needs provider-scoped passive condition support for treatment status. |
| Referral to New Provider | Not Started | `provider_referral_needed == true` | `referred_provider_selected`, `referred_provider_appointment_scheduled`, `providers_setup` | `medical-providers/<provider-slug>/`, contacts, `client/check-ins.md` | Client check-in indicates referral need | Requires human review at referral-need gate. |
| Early Lien Identification | Not Started | `providers_setup == true` or payor/lien clues found | `health_coverage_categorized`, Medicare/Medicaid/private/provider lien landmarks, `liens_identified`, `liens_opened` | `liens/`, provider bills/payor notes, `activity/` | Provider or insurance facts exist | Must avoid materializing downstream lien tasks until a lien exists. |
| Treatment Complete Gate | Not Started | All active providers done treating | `treatment_complete` | provider ledgers and case root landmarks | Provider treatment statuses exist | This is a gate that unlocks records/bills and demand work. |

### Wave 4: Records, Bills, and Chronology

These workflows run after provider treatment completion or when records are otherwise needed.

| Workflow | Build status | Trigger / dependency gate | Output landmarks | Canonical FirmVault paths | Test state needed | Issues |
| --- | --- | --- | --- | --- | --- | --- |
| Request Medical Records and Bills | Executable YAML | provider `treatment_complete == true` or manual records request event | `medical_auth_verified`, provider request prepared/sent/follow-up/escalation landmarks | `client/authorizations.md`, `documents/shadows/client/*authorization*`, `medical-providers/<provider-slug>/requests/`, `activity/`, `workflow-log/` | Provider ledger with completed treatment and signed auth | YAML exists as `firmvault-request-medical-records`; provider-scoped passive resolver and fixtures still need live testing. |
| Receive and Process Records/Bills | Executable YAML | provider records or bills arrive | `records_and_bills_processed` | provider documents, records/bills ledger, bill totals/payors, `activity/` | Incoming provider record/bill shadows | Needs passive document-arrival rules for provider records/bills. |
| Medical Chronology | Not Started | records processed | `medical_chronology_updated` | provider chronology or case chronology, records shadows | Processed records | Catalog has generic chronology workflow; recipe `firmvault-medical-chronology-update` exists. |

**Recommended Wave 4 test path:** Use one provider test fixture first. Prove authorization verification, request preparation, human send gateway, wait release, receipt processing, and chronology update before adding multi-provider aggregation.

### Wave 5: Demand

These workflows start when treatment and records/bills work are complete enough to value the case.

| Workflow | Build status | Trigger / dependency gate | Output landmarks | Canonical FirmVault paths | Test state needed | Issues |
| --- | --- | --- | --- | --- | --- | --- |
| Gather Demand Materials | Not Started | treatment complete plus records/bills available | `all_records_received`, `all_bills_received`, `damages_calculated` | `demand/readiness.md`, provider ledgers, liens, damages summaries | Records, bills, liens, chronology ready | Catalog uses generic recipe; needs real demand-readiness recipes. |
| Draft Demand | Not Started | `damages_calculated == true` | `demand_drafted`, `attorney_reviewed_demand` | `demand/`, generated demand docs, supporting exhibits | Demand materials ready | Attorney review is mandatory. |
| Send Demand | Not Started | `attorney_reviewed_demand == true` | `demand_recipients_identified`, `demand_sent` | `documents/sent/insurance/`, insurance claim ledgers, `activity/` | Approved demand draft | Human send gateway required. |

### Wave 6: Negotiation

These workflows track offers, evaluate them, and negotiate.

| Workflow | Build status | Trigger / dependency gate | Output landmarks | Canonical FirmVault paths | Test state needed | Issues |
| --- | --- | --- | --- | --- | --- | --- |
| Track Offers | Not Started | `demand_sent == true` | `initial_offer_received` | `negotiation/offers.md`, insurance claim ledgers, `activity/` | Demand sent | Needs passive offer-arrival signal/document intake rule. |
| Offer Evaluation | Not Started | `initial_offer_received == true` | `offer_documented`, net-to-client, case-factor, attorney/client decision landmarks | `negotiation/offers.md`, settlement estimates, lien summaries | Offer logged | Requires attorney and client review gates. |
| Negotiate Claim | Not Started | client decision to counter/negotiate | `counter_prepared`, `counter_sent`, `settlement_reached` or `impasse_declared` | `negotiation/`, insurance ledgers, `activity/` | Evaluated offer | Needs loop support for repeated negotiation rounds. |

### Wave 7: Settlement and Distribution

These workflows process settlement, liens, and final distribution.

| Workflow | Build status | Trigger / dependency gate | Output landmarks | Canonical FirmVault paths | Test state needed | Issues |
| --- | --- | --- | --- | --- | --- | --- |
| Settlement Processing | Not Started | `settlement_reached == true` | settlement statement, authorization, client authorization, release, funds landmarks | `settlement/`, `documents/generated/settlement/`, `documents/received/settlement/` | Settlement reached | Needs real settlement recipes/templates. |
| Settlement Lien Negotiation | Not Started | `settlement_reached == true` and open liens | `liens_prioritized`, available funds calculated, `liens_negotiated` | `liens/`, `settlement/distribution.md` | Settlement and liens exist | Must handle no-lien bypass cleanly. |
| Lien Resolution | Not Started | liens exist or lien track active | `liens_identified`, `liens_opened`, `final_amounts_requested`, `final_amounts_received`, `liens_negotiated`, `liens_paid` | `liens/`, provider/payor bill ledgers, `activity/` | Lien inventory | Catalog marks enabled but still uses generic recipe; do not run broadly until real recipes exist. |
| Final Distribution | Not Started | `liens_paid == true` or no liens applicable | `supplemental_statement_prepared`, `additional_distribution_issued`, `client_distributed`, `trust_account_zeroed` | `settlement/distribution.md`, final activity entries | Settlement funds and lien resolution complete | Requires human gates and trust-account reconciliation rules. |

### Wave 8: Litigation

Litigation is a separate branch, not part of the first non-litigation PI happy path.

| Workflow | Build status | Trigger / dependency gate | Output landmarks | Canonical FirmVault paths | Test state needed | Issues |
| --- | --- | --- | --- | --- | --- | --- |
| Litigation branch | Not Started | impasse, limitations, attorney decision, or suit filed | complaint, service, discovery, deposition, mediation, trial landmarks | `litigation/` subtree | A litigation-triggered test case | Current Mission Control workflow YAML does not yet include a complete litigation workflow file. Add after non-litigation path stabilizes. |

## Recommended Build/Test Queue

- [x] Wave 0.1: Case Setup live test complete.
- [x] Wave 0.2: Initial Document Collection live test complete.
- [ ] Wave 1.1: Design and implement executable Accident Report workflow.
- [ ] Wave 1.2: Live-test Accident Report on `test-ladder-006-template-tool` or a new `test-ladder-007-accident-report` state.
- [ ] Wave 1.3: Design and implement Medical Provider Setup.
- [ ] Wave 1.4: Live-test Medical Provider Setup.
- [ ] Wave 1.5: Design Client Check-In Cadence after provider setup assumptions are stable.
- [ ] Wave 2.1: Design and implement BI Claim Setup.
- [ ] Wave 2.2: Design and implement PIP Claim Setup.
- [ ] Wave 3.1: Design provider treatment status and treatment-complete gates.
- [ ] Wave 4.1: Live-test provider-scoped Request Medical Records and Bills.
- [ ] Wave 4.2: Add provider records/bills passive document-arrival rules.
- [ ] Wave 5+: Continue only after the treatment/records loop is stable.

## Per-Workflow Test Checklist

Copy this checklist under the workflow section when actively working on it.

- [ ] Fixture/test case state exists in canonical FirmVault paths.
- [ ] Workflow definition is executable Mission Control YAML, not only a catalog entry.
- [ ] Every recipe node has a specific recipe, `SOUL.md`, `REVIEW.md`, and reference files.
- [ ] No normal-path step tells the agent to broadly search for canonical documents.
- [ ] Passive conditions are defined for canonical file arrival or ledger truth.
- [ ] First task materializes in the expected column.
- [ ] Recipe runner completes work in a task worktree.
- [ ] Human review gate appears where required.
- [ ] Quality review can approve/reject without looping.
- [ ] Forgejo PR opens for file-changing tasks.
- [ ] Merge/reconcile marks task done and advances workflow.
- [ ] Workflow completion or wait state is visible in Mission Control.
- [ ] Issues discovered are logged below.

## Running Issue Log

| Date | Area | Issue | Status | Resolution / next action |
| --- | --- | --- | --- | --- |
| 2026-04-28 | Forgejo | Forgejo merge API can hang after PR approval. | Open | Manual merge through temp worktree works; keep using until Forgejo/API issue is fixed. |
| 2026-04-28 | Passive landmarks | `client_info_received` did not re-satisfy later workflow dependencies even though case setup completed. | Fixed | Added passive resolver support in Mission Control commit `6a83e35`. |
| 2026-04-28 | Audit safety | Agents can accidentally modify existing activity/workflow log entries. | Guarded | Append-only review PR validation added; existing log edits should block PR publication. |
| 2026-04-28 | Workflow design | Many catalog workflows still use generic `firmvault-workflow-task`. | Open | Replace with workflow-specific recipes before live testing those workflows. |
| 2026-04-28 | Branching | Lien, PIP exhaustion, UM/UIM/MedPay/Workers Comp tasks can be not applicable. | Open | Ensure bypass/not-applicable marks the corresponding dependency satisfied without polluting the case. |

## Update Rules

- Update this document after every workflow design session, live test, quality review failure, PR merge, or blocker.
- Mark a workflow `Live Tested` only after it has completed the actual Mission Control lifecycle through review/quality review and Forgejo PR gate when applicable.
- Keep the next recommended workflow explicit. As of this version, it is **Accident Report**.
- Do not enable broad materialization against real cases while the current test queue is active.

