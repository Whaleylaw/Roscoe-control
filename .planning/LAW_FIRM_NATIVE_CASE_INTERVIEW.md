# Law Firm Native Case Operating Record Interview

Purpose: capture the attorney/domain interview that defines the clean native case format for FirmVault/Mission Control workflows. Ask one question at a time, record the answer under that question, then revise the eventual operating-record schema from the answers.

Important framing:

- FirmVault is the firm's operating record, not just storage.
- The vault is a Git-tracked, Obsidian-compatible shadow/projection of real documents.
- Real documents live in the firm's document storage. The vault stores structured facts, masked markdown projections, generated drafts/shadows, links, activity, and audit evidence.
- Git review, diffs, commits, and history are core legal audit controls.
- Workflows and recipe agents should have explicit read/write contracts.
- The attorney is the domain authority. Do not invent the law-firm schema without interview answers.

## Status

Current question: first pass complete

## Questions

### 1. Brand-new case minimum facts

When a brand-new case comes in, what are the first 5-10 facts the firm must know before anything meaningful can happen?

Answer:

For an ideal new personal-injury case, the first required facts are full client identity/contact information and the basic facts of the incident.

Client information:

- name
- address
- phone number
- email
- date of birth
- social security number

Incident/case-type information:

- what happened
- what type of personal-injury matter it is, such as motor vehicle collision, fall/premises, dog bite, or other standard PI category

The intake document is expected to capture this information and also gather early case-development facts:

- work/employment information
- whether the client missed work
- what the client did for work
- injuries
- whether the client has seen a doctor or been to the hospital
- what medical providers the client has seen

The ideal case-opening packet includes:

- signed contract
- completed intake document
- signed HIPAA authorizations
- other signed authorizations included in the firm's contract/intake packet

Operational nuance: this is the ideal clean workflow, not an absolute rule. The firm sometimes creates cases before every item is complete, but the native system should treat the complete intake packet and signed documents as the preferred case-creation state.

### 2. Major case ledgers

What are the major "case ledgers" every clean case should have?

Examples to accept, reject, or rename: client, intake, contracts, insurance, PIP, providers, records/bills, liens, damages, settlement, litigation.

Answer:

Every clean case should have predictable ledgers that match how a personal-injury file is actually worked.

Core ledgers:

- client
- insurance
- medical providers
- liens
- litigation
- activity/communications
- documents
- tasks/workflows

Client ledger:

- The client folder/ledger contains intake, contract, and authorization materials.
- Signed intake packet, signed fee contract, HIPAA authorizations, and other signed authorizations belong here or are linked here.

Insurance ledger:

- Insurance is its own ledger.
- Inside insurance, the system tracks the different carrier/coverage types:
  - PIP
  - BI
  - UM
  - UIM
- There can be multiple insurance providers/carriers and multiple coverage roles depending on the case.

Medical provider ledger:

- Medical providers are their own ledger/folder/category.
- The case should be divided by provider, at least conceptually.
- For each provider, the firm usually tracks records, bills, notes, completed authorizations, and completed request documents.
- Traditionally records and bills live with the provider. For an AI-native system, records/bills could physically live in a documents folder if they are strongly wikilinked/tagged back to the provider, but the provider view must still show them naturally.

Contact-card model:

- The current FirmVault has master contact cards outside the case folder.
- A case has a copied/stub contact card inside its case folder.
- The case contact card links back to the master contact card.
- The master contact card also links or references every case where it appears.
- Example: University of Louisville can have a master contact card, and a case-specific provider card/stub when a client treats at UofL ER.
- This bidirectional wikilink model is useful and should remain part of the clean design.

Traditional provider folder model:

- In the attorney's current system, medical provider folders often contain:
  - medical records folder
  - medical bills folder
  - notes
  - completed authorizations
  - completed request documents
- The AI-native design may not need all of that physical folder granularity, but it must preserve the same ability to view provider-specific records, bills, notes, requests, and authorizations.

Liens ledger:

- Liens are tracked separately.
- Lien workflows depend on lien-holder identity, lien amounts, final amounts, negotiation, and payment.

Litigation ledger:

- Litigation is its own large category.
- It tracks different material than pre-litigation case development.
- Subareas include:
  - discovery
  - interrogatories
  - depositions
  - trial schedules
  - research
  - motions
- Litigation is its own beast and should likely have its own workflow family.

Activity/communications ledger:

- Each case has an activity log.
- Traditionally, every action taken on the case is recorded there.
- In the attorney's current system, notes made inside a tab, such as the medical tab, are automatically reflected/copied into the master activity log.
- The clean system should preserve this concept: local notes or actions in a ledger should also create/reflect an activity log entry.

Documents ledger:

- Cases are very document-heavy.
- Documents include generated documents, received documents, medical records, medical bills, chronologies, correspondence, litigation documents, and more.
- The physical document layout can be designed, but views must let users find documents by case area/provider/workflow, not just by filesystem location.

Tasks/workflows:

- The current system has tasks and workflows, but they do not naturally live as a case ledger in the same way as client/medical/insurance.
- In the native design, tasks/workflows should be visible from the case and connected to the case audit trail, but they may remain Mission Control runtime objects rather than primary vault documents.

### 3. Medical provider canonical record

For medical providers specifically, what should the canonical provider record track if this system created the provider entry from scratch?

Answer:

For a case-specific medical provider record, the system should not duplicate the general provider identity/contact data if that already exists in the master contact card. The case-specific provider record should link to the master contact card and track the provider's role/status in this case.

Case-provider identity:

- provider display name
- provider slug
- link to master provider/contact card
- provider-specific request rules if known, such as whether records and bills must be requested separately

Treatment tracking:

- date treatment starts
- date treatment ends
- treatment status
- provider-specific notes generated during treatment, including client-reported updates

Trigger behavior:

- When treatment ends for that provider, that should trigger the medical records/bills request workflow for that provider.
- The provider workflow should account for provider-specific rules:
  - some providers accept one combined records-and-bills request
  - some require separate records and bills requests
  - UofL Orthopedics is an example where records and bills must be requested separately

Request tracking:

- medical records request generated
- medical bills request generated
- HIPAA/authorization filled in or attached
- records request sent date
- bills request sent date
- send method
- confirmation/evidence of sending if available
- follow-up date

Follow-up schedule:

- The historical workflow used check-ins around 15, 30, 45, and 60 days.
- The 15-day check-in is not necessarily a real escalation. It is an early safety check:
  - do we already have the records/bills
  - did something come back saying the request failed
  - did the provider say something was wrong
  - did the provider acknowledge the request
  - did the provider say the expected response date is later, such as 60 days
- Later check-ins should follow the configured request/follow-up workflow.

Records receipt/review:

- record when medical records come in
- check whether records appear accurate/complete, meaning not obviously missing dates/visits/pages
- create or update a medical chronology from the records
- record each visit/date of service
- capture what happened at each visit, including complaints, treatment, assessment, and other chronology details

Bills receipt/review:

- record when bills come in
- record total billed amount
- record what has been paid
- record who paid it, if shown on the bill
- record what remains outstanding
- capture payer information because this can reveal liens

Lien discovery from bills:

- When bills show a payer, check that against known liens.
- If it confirms a known lien, no new lien workflow is needed.
- If it reveals a new lien source, add that lien to the system and trigger the appropriate lien workflows, including letters and follow-up.
- Common examples include Medicare, Medicaid, and private health insurance/ERISA-style health plan liens.

Demand dependency:

- A provider is complete when records are in, bills are in, and the chronology/review work for that provider is done.
- The case should not move to demand until records and bills are in from all required providers and the relevant chronologies/reviews are complete, subject to attorney override or not-applicable decisions.

### 4. Workflow output evidence

When an agent completes a workflow step, what should it write besides the data field?

Examples: evidence source, confidence, document link, date performed, reviewer, task ID, communication sent, uncertainty, next follow-up.

Answer:

The supporting information should come from the actual workflow execution and the files/documents involved, not from an unsupported agent assertion.

If an agent marks "records request sent":

- that should mean the send-records workflow actually ran
- the system should have a copy/shadow of the request that was sent
- the workflow/task audit trail should show the steps taken
- the workflow should record follow-up dates
- the workflow should record relevant send metadata, such as method and confirmation/evidence if available

If an agent marks "bills received":

- the status should link to the received bills or bill shadow
- the provider record should capture the total bill amount
- the provider record should capture amounts paid so far and by whom
- the provider record should expose or compute what remains outstanding

Medical bill payment categories that matter in the provider tab/UI:

- total medical bills
- medical bills paid
- paid by Medicare
- paid by Medicaid
- paid by private health insurance
- paid by client
- paid by PIP

The system should automatically subtract paid amounts from the total bills to show what remains to pay, negotiate, resolve, or account for at settlement.

Design note:

- The existing workflow/skill documents likely contain much of this detail, especially the first version created from the original workflow interview.
- The attorney's answers should be used to validate and correct those workflow-derived inferences.

### 5. Required human-in-the-loop gates

Where must a human be in the loop no matter how good the agent is?

Examples: signing, sending letters, approving demand, settlement authority, lien reductions, filing decisions.

Answer:

For version 1, humans are in the loop everywhere.

The universal review model:

- Every task, recipe, and workflow should end with a pull-request-style review.
- The agent works in a worktree of the case file.
- The agent makes proposed changes in that isolated worktree.
- At the end, the agent presents:
  - what it did
  - what files changed
  - what documents it generated
  - what facts/statuses it proposes to update
  - what evidence supports those updates
  - what questions or uncertainties remain
- No final action should merge into the canonical vault without going through this review process.

This can loosen over time, but the initial system should assume every workflow output requires review.

Markdown vs non-markdown outputs:

- The agent's working file format is markdown inside the vault/worktree.
- If the agent creates a medical records request, it may generate markdown shadows plus final output documents such as PDF or Word.
- The PR-style review should show the markdown changes and generated artifacts.
- When approved/merged, markdown versions/shadows merge into the canonical FirmVault.
- Non-markdown generated documents, such as PDFs or Word documents, should eventually be ported to the attorney's real file storage in the appropriate location.
- Real attorney document storage and vault markdown should remain distinct.

External sending:

- Eventually agents may be able to actually send documents through APIs such as Lob, DocuSign, fax/email providers, or other services.
- Version 1 does not need to perform external sending.
- For now, a medical records request workflow should:
  - create the request appropriately
  - generate the document correctly
  - get approval
  - document the file
  - leave actual sending to humans

Medical records request example:

- Agent drafts/generates the records request and bill request documents.
- Agent documents the case/provider record and proposed follow-up.
- Human reviews the diff/artifacts.
- After approval, people send the request in this iteration.

### 6. Append-only vs editable records

What should be append-only versus editable?

Examples: activity log append-only; provider status editable but audited; generated documents immutable once sent.

Answer:

Logs are append-only. Most other case artifacts and facts can be edited, as long as the edit itself is logged and auditable.

Append-only:

- activity logs
- audit logs
- workflow logs
- anything that is fundamentally a log

Editable with audit:

- medical chronologies
- provider status fields
- generated request documents/shadows
- received document shadows
- settlement numbers
- lien amounts
- client/contact facts
- most other case working documents or structured facts

Medical chronology example:

- On May 25, a medical chronology for a provider is created.
- The chronology document is created.
- The creation is recorded in the activity log.
- If the creation happened through a workflow, it is also recorded in the workflow log.
- A few days later, the chronology may be edited.
- The final visible chronology may only show the current edited version.
- The edit must still be recorded in the activity log.
- If the edit happened through a workflow, it must also be recorded in the workflow log.
- Because workflow edits happen through PR-style review, the system should be able to show the diff: what it said before and what it says now.

Core principle:

- Other than logs, most things can be edited because the system can recreate what happened from logs, Git history, workflow logs, and PR-style diffs.

### 7. Incoming document chain

When a real document comes in, what is the ideal chain?

Example path to refine: real storage location -> markdown shadow -> extracted facts -> human review -> committed vault update.

Answer:

The ideal document chain starts with a mailroom/import pipeline, then later triggers interpretation and case updates.

Mailroom folder and watcher:

- There should be a folder that functions as the mailroom intake folder.
- A watcher monitors that folder.
- When a document lands in the folder, the document pipeline triggers.

Common input:

- The most common input is daily mail.
- Daily mail may arrive as a single PDF containing all mail received that day.
- The PDF could be 50 pages long but represent only a few documents, or many separate documents.

Conversion to markdown:

- The current working approach uses the open source system Kreuzberg to convert PDFs/documents to markdown.
- This system has been built in prior versions but not yet for this Mission Control/FirmVault workflow system.

PII masking:

- PII masking should happen during the document pipeline after conversion.
- The current final PII masking system is not yet built.
- Some prior masking exists in FirmVault from earlier versions.
- Initial masking can be light, covering high-risk identifiers such as Social Security numbers and similar major identifiers.

Document splitting:

- After initial markdown conversion/masking, the system splits a bulk PDF back into its original constituent documents.
- Example:
  - pages 1-10 are document 1
  - pages 11-15 are document 2
  - and so on

Case matching, naming, and filing:

- Each split document is matched to the correct case.
- Each document is named.
- Each document is filed into the correct FirmVault folder/location.
- Wikilinks are added as appropriate.

Markdown enrichment:

- The attorney has used an open source repo called QMD.
- QMD adds small vector embeddings from a local model onto the markdown.
- This is separate from the basic markdown conversion and filing.

Real-file storage:

- A separate system should also split/name/file the original PDFs in the real attorney file storage.
- The FirmVault markdown document is a copy/shadow, not the original legal file.
- The markdown document should include a destination/original-file link in frontmatter pointing to where the real document lives.

Git staging/review concept:

- New filed markdown documents create untracked/uncommitted Git changes.
- The import pipeline should not automatically commit those changes as final legal/case interpretation.
- A later review/diff process should inspect uncommitted changes.

Daily or periodic review agent:

- The idea is to have a daily agent check uncommitted changes, likely before work starts in the morning, at the end of the day, or possibly both.
- Running during the workday may be confusing.
- The agent sees new untracked documents and can dispatch or act like a paralegal to interpret them.
- Example: identify that a new document is the medical record the firm was waiting on.
- After interpretation, the system updates the appropriate case facts/workflows/provider records/etc.

Current build status:

- This document pipeline has been built several times in other forms.
- It is not yet built for this system.
- The PII masking and daily diff/review agent are not yet built.

## Derived Schema Notes

### Second pass: clean auto-accident case, intake complete

Question: When a clean auto-accident case is created after intake is complete, what should be true on day one?

Answer:

Do not assume facts merely because intake is marked complete. The system should verify the actual documents/facts. In the ideal clean case, after intake is complete, the file should show:

- signed contract
- signed HIPAA authorization
- created/completed intake document
- basic facts of the case

The first major workflow target is the accident report.

Why accident report matters:

- It usually provides neutral third-party facts.
- It identifies occupants of the vehicles.
- It identifies the defendant's name.
- It often lists insurance companies.
- It usually helps identify the BI carrier.
- It may help identify the PIP carrier.

After the accident report is obtained and reviewed, the system can usually start:

- open PIP claim workflow
- open BI claim workflow

Medical provider information at day one:

- The system should usually know initial providers if the client went to a hospital by EMS.
- The system may know initial providers if the client has already started follow-up treatment.
- Sometimes this information is missing and the firm must follow up with the client.

Always-start workflows/cadences after intake:

- client check-in cadence
- treatment monitoring

Flexible insurance branching:

- The workflows must determine who the PIP carrier is, if any.
- Sometimes there can be multiple possible PIP carriers, though that is uncommon.
- The workflows must determine who the BI carrier is.
- The workflows must determine whether BI exists.
- The workflows must determine whether UM must be opened.
- There can be multiple coverage paths depending on the facts.

Implementation implication:

- Day-one workflows should be dependency-driven, not assumption-driven.
- Intake complete can activate accident-report, client-check-in, and treatment-monitoring work.
- PIP/BI/UM/UIM claim-opening workflows should wait for enough insurance facts or run an identification step first.

### Confirmed workflow read: accident report

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_1_file_setup/workflows/accident_report/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/skills/phase_1_file_setup/police-report-analysis/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/templates/output/police_report_output.md`

Attorney confirmation: this is the correct shape of the Accident Report workflow.

Workflow shape:

1. Confirm this is an MVA/police-report case.
2. Confirm intake basics exist: accident date, location, parties if known, signed contract/HIPAA/intake packet if available.
3. Identify the reporting agency.
4. Get or search for the report number.
5. Request/order the accident report.
6. Wait for the report to come in.
7. Convert the report to markdown.
8. Analyze the report for:
   - client unit/role
   - at-fault party
   - BI carrier/policy
   - PIP carrier/waterfall facts
   - witnesses
   - officer, citations, contributing factors
   - liability/red flags
   - mismatch between client story and police report
9. Update the case record/vault with extracted facts.
10. Create or update insurance/contact/provider entries as needed.
11. Trigger downstream workflows:
   - PIP claim setup
   - BI claim setup
   - UM/UIM if needed
   - contact-card creation
   - attorney review if liability problems/red flags exist

Important implementation framing:

- The point is not only to define workflow steps.
- The point is to determine what the clean FirmVault case record should look like so workflows know where to read from and where to write.
- The easier the case record is for agents to read and update safely, the easier the system is for people to use.
- Old references in the workflow to FalkorDB, Cypher, graph state, and per-case JSON files are obsolete and must be translated into the native vault/workflow contract.

### Workflow read: PIP claim setup

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_1_file_setup/workflows/insurance_pip_claim/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/skills/phase_1_file_setup/pip-waterfall/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/skills/phase_1_file_setup/pip-application/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/Tools/insurance/pip_waterfall.py`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_1_file_setup/landmarks.md`

Current reading, not yet attorney-confirmed:

The PIP setup workflow appears to have this shape:

1. Confirm the case is a Kentucky MVA case.
2. Confirm client contract/HIPAA/intake facts exist.
3. Read accident-report extraction and intake to gather PIP waterfall facts.
4. Run the Kentucky PIP waterfall:
   - client on title of occupied vehicle and that vehicle insured: vehicle insurer provides PIP
   - client on title of occupied vehicle and that vehicle uninsured: client is disqualified from PIP
   - client not on title but occupied vehicle insured: occupied vehicle insurer provides PIP
   - occupied vehicle uninsured but client has own auto insurance: client's insurer provides PIP
   - no client policy but household member has auto insurance: household member insurer provides PIP
   - none of the above: Kentucky Assigned Claims/KAC
5. Record the PIP determination, including waterfall path and any uncertainty.
6. Create or update the PIP insurance/claim record.
7. Generate the KACP PIP application, which the workflow documents say is always required in Kentucky.
8. Generate the PIP letter of representation.
9. Submit/send the application and LOR, or in v1 prepare them for human approval/sending.
10. If no claim number exists, open the claim or prompt the user/human to open it.
11. Follow up for acknowledgment after a short configured delay.
12. Record adjuster identity/contact information.
13. Confirm coverage limit, deductible if any, billing instructions, and readiness to pay bills.
14. Continue later PIP monitoring for bill payment, exhaustion, reimbursement, and cleanup.

Apparent PIP sub-landmarks:

- PIP carrier determined
- PIP application submitted
- PIP LOR sent
- PIP claim acknowledged
- PIP ready to pay bills

Important native-vault implication:

- `insurance/pip-<carrier>.md` likely needs both coverage facts and claim administration facts.
- The workflow needs structured PIP waterfall inputs, not just final carrier name.
- The system should distinguish "PIP unavailable because disqualified" from "PIP unavailable because not yet determined" and "PIP through KAC."
- The old workflow writes `insurance.json`; the native version should write vault files and workflow state instead.

### Workflow read: BI claim setup

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_1_file_setup/workflows/insurance_bi_claim/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/skills/phase_1_file_setup/liability-analysis/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/skills/phase_1_file_setup/lor-generator/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_1_file_setup/landmarks.md`

Current reading, not yet attorney-confirmed:

The BI setup workflow appears to have this shape:

1. Confirm the case is in file setup and the client has contract/HIPAA/intake facts.
2. Identify the at-fault party or parties from the accident report, property-damage claim, intake, or user input.
3. Identify the BI carrier for each at-fault party.
4. Create or update the BI claim record for that carrier/insured.
5. Generate the BI letter of representation.
6. Submit/send the LOR, or in v1 prepare it for human approval/sending.
7. If no claim number exists, open the claim or prompt the user/human to open it.
8. Follow up for claim acknowledgment after a short configured delay.
9. Record adjuster identity/contact information.
10. Obtain liability status:
    - accepted
    - denied
    - partial/comparative fault
    - investigating
11. If liability is anything other than 100% accepted, flag for review and possible additional claims.
12. Request/obtain coverage confirmation and policy limits.
13. Check for UM/UIM implications, additional liable parties, umbrella/excess coverage, or disputed-liability evidence needs.

Apparent BI sub-landmarks:

- at-fault insurance identified
- BI LOR sent
- BI claim acknowledged
- liability status obtained
- BI coverage/policy limits confirmed

Important native-vault implication:

- `insurance/bi-<carrier>.md` should also be a case-specific claim ledger, not a carrier note.
- BI may need multiple claim ledgers for multiple at-fault parties/carriers.
- BI differs from PIP because the central branch is liability/policy-limits analysis, not waterfall/payment-readiness.
- Liability status should be a workflow gate: `accepted` can proceed normally; `denied`, `partial`, or persistent `investigating` should trigger review and possible UM/UIM or additional-BI workflows.

### Workflow read: UM, UIM, Med Pay, and workers' compensation coverage tracks

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/WORKFLOW_SYSTEM_MANUAL.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/templates/complaint/modules/count_um.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/templates/complaint/modules/count_uim.md`
- Insurance references found in accident-report, BI, and litigation templates.

Attorney note:

- Insurance should account for UM coverage and UIM coverage.
- Med Pay and workers' compensation are seen, but infrequently.

Current reading, not yet attorney-confirmed:

UM and UIM should be modeled as conditional insurance tracks rather than always-on day-one workflows.

UM appears to become relevant when:

- the at-fault driver has no insurance
- the at-fault driver is unknown
- the at-fault driver fled the scene
- coverage is denied or unavailable
- the client has UM coverage through their own policy

UIM appears to become relevant when:

- the at-fault driver has BI coverage, but limits may be insufficient
- the client has UIM coverage through their own policy
- BI settlement is being considered and UIM rights must be preserved
- a COOTS letter or similar preservation step is needed before accepting BI money

Med Pay appears to be an uncommon additional first-party benefits track. It should likely live as an optional coverage/claim ledger under insurance when present, but it should not complicate the standard MVA flow unless a policy/document reveals it.

Workers' compensation appears to be a separate benefits/settlement variant when the injury is work-related. Existing manual notes mandatory settlement landmarks such as Form 110, DWC fee approval, and WC settlement approval. It should not be forced through standard BI settlement documents.

Important native-vault implication:

- The clean insurance ledger should recognize coverage roles beyond PIP and BI:
  - PIP
  - BI
  - UM
  - UIM
  - Med Pay
  - workers' compensation
- UM/UIM should probably share the claim-ledger shape with BI, but add preservation/notice/conditions-precedent fields.
- Workers' compensation may need a separate `benefits/` or `workers-comp/` area rather than being treated as normal auto insurance.

### Workflow read: medical providers, records, bills, and chronology

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_1_file_setup/workflows/medical_provider_setup/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_2_treatment/workflows/request_records_bills/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_2_treatment/workflows/medical_provider_status/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_2_treatment/workflows/medical_chronology/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/skills/phase_2_treatment/medical-records-request/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_2_treatment/landmarks.md`

Current reading, not yet attorney-confirmed:

The medical-provider workflow family appears to have this shape:

1. Identify a provider from intake, accident report, client check-in, referral, document import, or manual entry.
2. Create/update a case-specific provider record linked to the master provider contact.
3. Record provider type, contact info, request rules, treatment dates, treatment status, injuries treated, and provider-specific notes.
4. If treatment is completed/discharged, trigger records and bills request work.
5. If treatment is ongoing, monitor status through client check-ins and provider-status reviews.
6. When records/bills request work starts:
   - verify signed HIPAA/authorization exists
   - generate records request
   - generate billing request if separate or required
   - attach/use HIPAA
   - in v1, prepare for human approval/sending unless the external send is separately authorized
   - record sent dates, method, proof/confirmation, and follow-up dates
7. Wait for receipt with configured follow-up schedule.
8. When records arrive:
   - file/import received document shadows
   - convert records to markdown
   - check completeness and legibility
   - record received date, source file, page count, date span, missing items
   - trigger chronology update
9. When bills arrive:
   - file/import bill shadows
   - record total billed
   - record paid amounts by payer, including PIP, Medicare, Medicaid, private health insurance, client, or other
   - calculate remaining balance
   - identify potential liens or payment sources
10. Maintain medical chronology:
    - date of service
    - provider/facility
    - complaints/history
    - exam findings
    - diagnoses
    - treatment plan
    - medications/referrals/follow-up
    - source page/file references
    - causation statements
    - red flags and treatment gaps
11. Treatment phase exits normally when treatment is complete or early-demand conditions exist, but records/bills/chronology completeness affects demand readiness.

Important native-vault implication:

- `medical-providers/<provider>/provider.md` should hold case-specific provider identity/status and link to the master contact.
- `treatment.md` should hold first/last visit, active/discharged/on-hold/referred status, expected completion, and status notes.
- `records-bills.md` should hold request, receipt, completeness, bill totals, payer/payment, and balance facts.
- `chronology.md` may be provider-specific, with a case-level chronology generated from provider chronologies.
- The request workflow needs timers/follow-ups tied to individual request events, not just a single provider status.
- Bills received can trigger lien identification automatically when payers indicate Medicare, Medicaid, private health insurance, provider lien, or other subrogation.

### Workflow read: liens

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_2_treatment/workflows/lien_identification/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/skills/phase_2_treatment/lien-classification/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/Skills/lien-management/SKILL.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/runtime/task_templates/identify-outstanding-liens.yaml`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/runtime/task_templates/request-final-lien-amounts.yaml`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/runtime/task_templates/receive-final-lien-amount.yaml`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/runtime/task_templates/negotiate-lien.yaml`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/runtime/task_templates/pay-lien.yaml`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/workflows/phase_6_lien/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/workflows/phase_6_lien/landmarks.md`

Current reading, not yet attorney-confirmed:

The lien lifecycle appears to have this shape:

1. Treat lien monitoring as a standing background concern after case setup/treatment begins.
2. Identify lien candidates from:
   - intake health insurance information
   - Medicare/Medicaid status
   - medical bills showing payers
   - PIP payment information
   - provider/hospital lien notices
   - letters of protection
   - workers' compensation involvement
   - document import/mail
3. Create a lien stub when a candidate is credible enough to track.
4. Classify the lien:
   - Medicare
   - Medicaid
   - ERISA self-funded/private health plan
   - fully insured/private health plan
   - hospital statutory lien
   - provider/LOP
   - workers' compensation
   - other
5. Send notice of representation / subrogation notice / request for lien or plan information as appropriate.
6. During demand, estimate lien exposure for valuation and settlement planning.
7. After settlement, request final lien amounts for each outstanding lien.
8. Wait for final amounts and record final amount source/evidence.
9. Negotiate reductions when allowed and attorney-approved.
10. Pay liens from trust after approval.
11. Obtain/document release or satisfaction.
12. Reflect paid/resolved status in the case and settlement/final distribution workflow.

Important native-vault implication:

- A lien should be one file under `liens/<lien-holder-slug>.md`.
- There should be a clear distinction between lien candidate, identified lien, outstanding lien, amount requested, final amount received, negotiated, paid, disputed, waived, and released.
- Lien records need links to source evidence: bills, payer documents, provider files, correspondence, and settlement statements.
- Medical bill review should be able to push lien candidates automatically.
- Final distribution should be blocked until liens are resolved or an attorney-approved holdback/dispute path is documented.

### Workflow read: client contact, check-ins, and treatment monitoring

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_2_treatment/workflows/client_check_in/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_2_treatment/workflows/client_check_in/templates/check_in_note.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_2_treatment/workflows/referral_new_provider/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/runtime/task_templates/biweekly-client-checkin.yaml`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/issue-templates/client-unreachable.yaml`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/workflows/PHASE_DAG.yaml`

Current reading, not yet attorney-confirmed:

Client contact appears to have two related tracks:

1. A recurring treatment check-in workflow.
2. A broader client-contactability monitor that runs from case creation to close.

Treatment check-in shape:

1. Starts during treatment and recurs every 14 days until demand is sent.
2. Reads client preferred contact method and prior activity/check-in notes.
3. Pulls current provider, treatment, records, bills, liens, and open-question status.
4. Contacts client by phone/text/email.
5. Records outcome:
   - completed
   - voicemail
   - no answer
   - disconnected/bounced
6. If completed, asks about:
   - still treating
   - new providers/specialists
   - new symptoms or condition changes
   - return-to-work/work restrictions/missed work
   - insurance correspondence
   - outstanding items
   - client concerns/questions
7. Updates activity log and check-in record.
8. Triggers medical provider setup if a new provider is identified.
9. Triggers provider status updates if treatment status changed.
10. Triggers demand readiness evaluation if treatment appears complete or client reached MMI.
11. Schedules the next check-in.

Client-unreachable branch:

1. If 2+ contact attempts fail across channels, create/escalate a client-unreachable issue.
2. Log every attempt.
3. Use multiple channels: call, text, email, mail, family/emergency contact if appropriate.
4. After repeated failed attempts, escalate to attorney.
5. After extended unreachability, flag client MIA / decline evaluation.
6. When client resurfaces, gather all needed information in that contact because another chance may not come soon.

Important native-vault implication:

- Activity/communications are first-class case records.
- Check-ins should create append-only activity entries.
- Current client-contact status can be derived from activity logs but may also need a compact current-status summary for workflow predicates.
- The system needs both successful-contact records and failed-attempt records.
- Client check-ins are not merely reminders; they are fact-gathering events that can trigger provider, treatment-complete, lien, wage-loss, and demand-readiness workflows.

### Workflow read: demand preparation and demand package

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_3_demand/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_3_demand/landmarks.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_3_demand/workflows/gather_demand_materials/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_3_demand/workflows/draft_demand/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_3_demand/workflows/send_demand/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_3_demand/workflows/gather_demand_materials/skills/damages-calculation/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_3_demand/workflows/draft_demand/skills/demand-letter-generation/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_3_demand/workflows/gather_demand_materials/templates/materials_checklist.md`

Current reading, not yet attorney-confirmed:

The demand workflow appears to have three major stages:

1. Gather and verify demand materials.
2. Draft and review the demand package.
3. Send the demand and schedule follow-up.

Gather materials shape:

1. Confirm treatment is complete or early-demand conditions/attorney override exist.
2. Verify all provider records are received or identify missing records and request/override.
3. Verify all itemized bills are received or identify missing bills and request/override.
4. Calculate special damages:
   - past medical expenses
   - future medical expenses if documented
   - past lost wages
   - future lost wages if documented
   - property damage
   - out-of-pocket expenses
5. Identify liens and conditional amounts or approved lien-risk override.
6. Collect wage-loss support if applicable.
7. Finalize medical chronology.
8. Compile supporting materials: accident report, photos, property damage, wage documents, medical records, bills.

Draft demand shape:

1. Generate a structured demand draft.
2. Include introduction, facts/liability, injuries, treatment narrative, special damages, demand amount, response deadline, and exhibit list.
3. Compile exhibits in a predictable order.
4. Submit for attorney review.
5. Revise as needed until attorney approval.

Send demand shape:

1. Identify recipients for each BI/UM/UIM claim or defense attorney.
2. Send approved package or prepare it for human sending in v1.
3. Record demand sent date, method, amount, and tracking/proof per claim.
4. Notify client that demand was sent.
5. Schedule receipt confirmation and 30-day follow-up.
6. Trigger negotiation phase once demand is sent to all required recipients.

Important native-vault implication:

- Demand should have its own case ledger/folder because it is a compiled product of many other ledgers.
- Demand readiness should be represented explicitly; the agent should not infer readiness by wandering the whole file.
- Soft blockers need override fields with attorney approval and documented consequence.
- Attorney approval is a hard gate before sending.
- Demand sent is a hard phase gate and should update the relevant BI/UM/UIM claim files, not only a case-level flag.

### Workflow read: negotiation, offer evaluation, and claim response

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_4_negotiation/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_4_negotiation/landmarks.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_4_negotiation/workflows/track_offers/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_4_negotiation/workflows/offer_evaluation/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_4_negotiation/workflows/negotiate_claim/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_4_negotiation/workflows/track_offers/skills/offer-tracking/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_4_negotiation/workflows/offer_evaluation/skills/offer-evaluation/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_4_negotiation/workflows/negotiate_claim/skills/negotiation-strategy/skill.md`

Current reading, not yet attorney-confirmed:

Negotiation starts when demand has been sent to the relevant BI/UM/UIM carrier or defense attorney. It is not a single linear task. It is a repeating loop with three distinct workflow concerns:

1. Track every offer, counteroffer, acceptance, rejection, deadline, and status.
2. Evaluate each insurance offer for net-to-client, case value, liens, risks, and recommendation.
3. Decide and execute the response: accept, counter, reject, answer information requests, escalate, or declare impasse.

The workflow's basic loop:

1. Wait for a response to the demand.
2. If the response is an acknowledgment only, log it and keep waiting with follow-up dates.
3. If the response requests information, decide whether the request is legitimate, provide the information or object/escalate, log the response, and set a follow-up.
4. If the response is an offer, record the offer in the relevant claim ledger.
5. Calculate net to client:
   - gross offer
   - attorney fee using the actual fee agreement
   - case expenses
   - known liens
   - estimated lien reductions if appropriate
   - net recovery range if liens are uncertain
6. Compare the offer to:
   - demand amount
   - policy limits
   - medical specials
   - liability strength
   - venue/jury risk
   - litigation cost and delay
   - client circumstances
7. Prepare an offer analysis and recommended response.
8. Attorney reviews and approves the recommendation before client advice is finalized.
9. Client is advised and authorizes accept/counter/reject.
10. Response is sent or prepared for human sending in v1.
11. The negotiation ledger updates and the loop repeats until settlement, impasse, return to treatment, or litigation.

Track-offers shape:

Each negotiable claim needs an offer history. A single case can have more than one active negotiation if there are multiple BI, UM, UIM, or other applicable claims.

Each offer/counter entry should include:

- date received or sent
- round number
- entry type: initial offer, revised offer, counter, final offer, acceptance, rejection
- source: insurance, defense, plaintiff, attorney, client-authorized response
- amount
- conditions
- response deadline
- adjuster or defense notes
- our reasoning for counters
- current status: pending, under review, countered, responded, accepted, rejected, expired
- related document or activity-log entry
- related task/workflow instance

Offer evaluation shape:

The agent should not just say whether an offer is "good." It should create an evaluation record that shows the math and the legal/practical judgment:

1. Gross offer.
2. Fee percentage and source.
3. Case costs.
4. Known liens.
5. Potential negotiated lien reductions or uncertainty range.
6. Net to client.
7. Demand-to-offer gap.
8. Offer as percentage of demand.
9. Offer as percentage of policy limits.
10. Offer multiple of medical specials.
11. Case strengths and weaknesses.
12. Comparable verdict/settlement research if needed.
13. Recommendation: accept, counter, reject, request time, or hold for missing information.
14. Suggested counter amount and reasoning if applicable.

Negotiation strategy shape:

When countering, the workflow should create a counter strategy rather than only a letter:

1. Current demand.
2. Current offer.
3. Prior movement by each side.
4. Gap and settlement zone.
5. Recommended counter.
6. Concession pattern.
7. Talking points.
8. Expected adjuster response.
9. Follow-up date.
10. Draft counter communication.

Important native-vault implication:

- Negotiation state probably belongs primarily on each claim ledger, because negotiation is claim-specific.
- A case-level negotiation summary may still be useful for operator views and attorney review.
- Offer analysis should be durable, not just a comment, because settlement advice has malpractice significance.
- Client authority should be logged distinctly from attorney recommendation.
- Acceptance is not the same thing as settlement complete; it triggers settlement-processing workflows.
- Impasse is not merely "done"; it should record why negotiation failed and whether the next path is litigation, more treatment, closing/declining, or attorney review.

### Workflow read: settlement processing and lien negotiation

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_5_settlement/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_5_settlement/landmarks.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_5_settlement/workflows/settlement_processing/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_5_settlement/workflows/lien_negotiation/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_5_settlement/workflows/settlement_processing/skills/settlement-statement/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_5_settlement/workflows/settlement_processing/skills/docusign-send/skill.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/Skills/settlement-statement/SKILL.md`

Current reading, not yet attorney-confirmed:

Settlement starts only after a specific offer has been accepted and the gross settlement amount is fixed. It should not start from a vague "case settled" note. It should start from a claim-specific accepted offer that already records:

- claim being settled
- carrier / defendant / payor
- settlement amount
- date accepted
- client authority
- attorney approval
- material settlement terms
- whether all claims or only one claim are being released

Settlement-processing shape:

1. Create the initial settlement statement.
2. Create the authorization to settle.
3. Send/review those with the client.
4. Client signs authorization to settle.
5. Confirm acceptance with adjuster or defense counsel and request release.
6. Receive release.
7. Review release for correct amount, parties, scope, confidentiality, indemnity, Medicare/Medicaid language, dismissal language, and other problematic terms.
8. Client signs release after attorney approval.
9. Return signed release.
10. Receive settlement check.
11. Deposit settlement funds into trust.
12. Wait for funds to clear.
13. Pay final liens or hold disputed amounts in trust.
14. Pay attorney fee and reimburse case costs.
15. Distribute client funds.
16. Record client receipt.
17. Exit to closed only if liens are resolved; otherwise exit to lien/final-distribution phase.

Initial settlement statement shape:

The first settlement statement should show the client the expected gross-to-net distribution:

1. Gross settlement.
2. Attorney fee calculated from the signed fee agreement.
3. Case costs / expenses.
4. Lien holdback:
   - final lien amounts where known
   - estimated holdbacks where final amounts are pending
   - disputed holdbacks where appropriate
5. Net to client.

Important distinction:

- Initial settlement statement uses final lien amounts when available, but may use holdbacks where liens remain unresolved.
- Supplemental settlement statement comes later if held trust funds remain after liens are resolved or reduced.

Lien negotiation at settlement shape:

1. Read complete lien inventory.
2. Classify each lien:
   - Medicare
   - Medicaid
   - ERISA/self-funded
   - fully insured health plan
   - hospital/statutory
   - provider LOP
   - other
3. Confirm final claimed amount.
4. Calculate available settlement funds after fee and costs.
5. Prioritize negotiation by lien type and negotiability.
6. Apply appropriate reduction arguments:
   - procurement costs
   - common fund
   - made whole
   - statutory caps/formulas
   - disputed liability
   - limited recovery
   - immediate payment
7. Get written reduction or final-payment confirmation.
8. Update settlement statement or holdback.
9. Pay lien from trust once funds clear.
10. Obtain satisfaction/release documentation.

Settlement documents/status records the vault needs:

- settlement statement
- authorization to settle
- release received
- release review
- signed release
- returned release
- settlement check receipt
- trust deposit / cleared record
- lien payment records
- client distribution record
- supplemental statement if holdback remains after initial distribution

Important native-vault implication:

- Settlement should probably have its own case-level `settlement/` ledger because it spans claims, liens, trust accounting, documents, and closing.
- The accepted offer should remain in the claim ledger, but settlement execution should be tracked separately.
- Trust-account records are sensitive accounting records; the vault may store masked operational shadows and links to the real accounting/source documents.
- Client authorization, release signing, check receipt, trust clearance, lien payment, and client distribution are all distinct gates.
- Client paid is a hard blocker for closing.
- Outstanding/disputed liens do not necessarily block partial client distribution if an approved holdback remains in trust, but they do block final closing.

### Workflow read: lien phase and final distribution

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_6_lien/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_6_lien/landmarks.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_6_lien/workflows/get_final_lien/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_6_lien/workflows/negotiate_lien/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_6_lien/workflows/final_distribution/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/Skills/supplemental-statement/SKILL.md`

Current reading, not yet attorney-confirmed:

The lien phase is not a general lien-management phase. It is the post-settlement branch used when money is already in trust, the client may have received an initial distribution, but one or more liens or holdbacks remain unresolved.

Entry condition:

- settlement has been accepted and processed far enough that settlement funds/holdbacks exist
- at least one lien remains outstanding, disputed, unfinalized, unpaid, or over-held
- final closing is blocked until all liens are resolved and trust accounting is reconciled

Workflow shape:

1. Identify all outstanding liens that survived settlement processing.
2. Request final lien amounts for each unresolved lien.
3. Wait for final demands, especially Medicare/Medicaid or ERISA/health-plan responses.
4. Record final amounts, payment deadlines, and related documents.
5. Decide whether each lien should be negotiated.
6. Prepare and submit reduction/compromise/waiver requests where appropriate.
7. Record negotiation result.
8. Pay final/negotiated amount from trust.
9. Obtain written satisfaction/release/waiver.
10. Repeat until no unresolved liens remain.
11. Prepare supplemental settlement statement.
12. Reconcile trust holdback against actual lien payments.
13. Distribute any surplus to client.
14. Verify trust balance for the case is zero.
15. Mark final distribution complete and allow closing workflow.

Per-lien record shape:

Each lien file needs settlement/final-distribution fields that can drive this workflow:

- status
- conditional amount
- final amount requested date
- final amount received date
- final amount
- payment deadline
- negotiability
- reduction requested date
- reduction basis
- negotiated amount
- written agreement path
- payment amount
- payment date
- satisfaction/release path
- unresolved reason
- trust holdback amount

Supplemental settlement statement shape:

The supplemental statement is not a replacement for the initial settlement statement. It reconciles the lien holdback after liens are actually paid:

```text
original holdback
- actual lien payments
= surplus

initial net to client
+ surplus
= total net to client
```

Edge cases that need explicit handling:

- lien waived entirely
- lien reduced, leaving surplus for client
- lien exceeds holdback
- disputed lien still held in trust
- attorney pays shortfall from fee
- client pays shortfall from prior distribution
- no surplus remains

Important native-vault implication:

- The lien phase should be lien-record driven, not phase-status driven.
- Each lien should independently satisfy its own final amount / negotiated / paid / satisfaction gates.
- `all_liens_resolved` should be derived from all lien records, not manually checked on a separate workflow.
- Final distribution should not materialize until every lien is paid, waived, released, or attorney-approved as fully resolved.
- The supplemental statement and trust reconciliation should live with settlement/distribution records, but link back to every resolved lien.

### Workflow read: closed / archived

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_8_closed/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_8_closed/landmarks.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_8_closed/workflows/close_case.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows/runtime/reconciler.py`

Current reading, not yet attorney-confirmed:

Closed is a terminal case state, not merely "no current tasks." It should mean the system has verified that all legal, financial, trust, document, and client-communication obligations are complete.

Entry paths:

- successful settlement and final distribution
- verdict/judgment collected and distributed
- declined case
- withdrawn representation
- dismissal/other attorney-approved termination

Successful-settlement closure shape:

1. Verify settlement/verdict funds were received.
2. Verify client received all distributions.
3. Verify all liens are paid, waived, released, or otherwise attorney-resolved.
4. Verify trust balance for the case is zero.
5. Verify releases and settlement documents are complete.
6. Verify court obligations are complete if litigated.
7. Send final closing letter to client.
8. Decide whether review request is appropriate.
9. Archive digital file.
10. Archive physical file / real document source if applicable.
11. Record retention date and archive location.
12. Mark case closed/archived.

Declined/withdrawn closure is different:

- no settlement/distribution requirements
- closing letter may be a decline or withdrawal letter
- statute/deadline warnings may be required
- file retention and archive still matter
- status should distinguish `declined`, `withdrawn`, `closed_settled`, `closed_litigated`, etc.

Closing record shape:

- closure type
- closure reason
- all obligations verified date
- final letter sent date
- review requested / not applicable and reason
- physical archive status/location
- digital archive status/location
- retention until date
- reopened-by linked case, if any

Important native-vault implication:

- Closed cases should be skipped by normal materialization.
- Reopening should usually create a new linked matter rather than mutating a closed matter back into active state.
- Closure needs an explicit checklist because it is the last chance to catch unresolved liens, trust balances, release issues, court obligations, or missing client communication.
- Archive metadata belongs in the vault, but real archived files remain in the firm's storage.

### Workflow read: litigation parent phase

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/landmarks.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_1_complaint/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_3_mediation/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_4_trial_prep/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_5_trial/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_1_complaint/complaint_library/decision_tree.md`

Current reading, not yet attorney-confirmed:

Litigation is not a normal linear phase like PIP setup or medical records. It is a parent phase with subphases and many event-driven branches. A case can settle at almost any litigation subphase and then return to settlement processing.

Entry triggers:

- negotiation failed
- statute of limitations approaching
- client elects litigation
- carrier denial or impasse requires suit
- attorney decides suit is needed to preserve claim or leverage

Litigation subphases:

1. Complaint:
   - draft/file complaint
   - issue summons
   - serve each defendant
   - process answer/default/counterclaim
2. Discovery:
   - propound written discovery
   - respond to defendant discovery
   - review deficient responses
   - handle meet-and-confer / motion to compel
   - prepare client deposition
   - take party, corporate representative, expert, and third-party depositions
3. Mediation:
   - prepare mediation brief
   - prepare client and authority
   - attend mediation
   - record settlement, impasse, mediator proposal, or partial settlement
4. Trial prep:
   - manage expert disclosures
   - prepare exhibit list
   - prepare witness list
   - prepare pretrial brief
   - prepare jury instructions
   - satisfy scheduling order deadlines
5. Trial:
   - voir dire
   - opening
   - plaintiff proof
   - defense proof
   - closing
   - verdict / mistrial / settlement during trial

Native vault implication:

- Litigation needs a first-class `litigation/` ledger/folder with sub-ledgers for pleadings, service, discovery, depositions, mediation, trial prep, trial, court dates, and deadlines.
- Litigation deadlines are first-class workflow triggers, not just reference notes.
- Many litigation workflows are per-party or per-defendant, not per-case.
- Discovery and depositions are per request/set/person, not merely phase-level landmarks.
- Settlement from litigation should reuse the same settlement-processing workflow already described, but the fee rate and release/dismissal requirements may differ.
- A verdict for plaintiff should route to judgment/collection/settlement-processing; a defense verdict or dismissal should route to closing/appeal review.

### Workflow read: litigation 7.1 complaint, service, and answer

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_1_complaint/workflows/draft_file_complaint/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_1_complaint/workflows/serve_defendant/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_1_complaint/workflows/process_answer/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_1_complaint/landmarks.md`
- `complaint-drafting`, `service-of-process`, and `answer-analysis` skills
- complaint template decision tree

Current reading, not yet attorney-confirmed:

The complaint subphase has case-level tasks and defendant-level tracks.

Case-level tasks:

1. Decide to file suit.
2. Verify SOL and filing deadline.
3. Identify defendants and theories.
4. Select complaint template or modules.
5. Draft complaint.
6. Attorney review.
7. File complaint.
8. Receive case number.
9. Receive summons for each defendant.

Defendant-level tasks:

1. Select service method.
2. Arrange service.
3. Track attempts.
4. Escalate failed service if needed.
5. File proof of service.
6. Calendar answer deadline.
7. Process answer, motion, counterclaim, third-party complaint, or default.

Important parallelism:

- Subphase 7.1 remains open until all defendants are resolved.
- Discovery can begin for Defendant A after Defendant A answers/defaults even if Defendant B is still pending service.
- The workflow system should not block the entire case's discovery phase merely because one defendant remains unserved.

Complaint record shape:

- litigation decision date
- SOL deadline
- filing reason
- selected template / custom modules
- claims/theories
- defendants
- complaint draft path
- attorney approval date
- filed date
- court/case number
- filing receipt path
- summons issued per defendant

Defendant service/answer record shape:

- defendant name/contact/address
- defendant type: individual, corporation, insurer, government, unknown
- service method
- service attempts
- service completed date
- proof of service filed date/path
- answer due date
- answer received date/path
- response type: answer, answer + counterclaim, answer + third-party complaint, motion to dismiss, no answer/default
- affirmative defenses
- counterclaim response deadline
- default motion filed date, if no answer
- discovery track eligible

Important native-vault implication:

- Complaint and service records should live under `litigation/pleadings/` and `litigation/service/` or equivalent.
- Defendant records should be structured enough that each defendant can have its own workflow state.
- Answer analysis should produce discovery targets rather than simply filing an answer summary.
- Counterclaims and third-party complaints must create deadline/task branches immediately.

### Workflow read: litigation 7.2 written discovery

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/workflows/propound_discovery/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/workflows/respond_to_discovery/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/workflows/review_responses/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/landmarks.md`

Current reading, not yet attorney-confirmed:

Written discovery should be modeled as discovery sets, not as a single phase-level status.

There are three different workflow streams:

1. Discovery we propound:
   - plan strategy
   - select interrogatory/RFP/RFA templates
   - add modules
   - draft
   - attorney review
   - serve
   - calendar response deadline
2. Discovery we receive:
   - calendar response deadline
   - review each request
   - identify objections/privilege
   - gather information/documents
   - draft responses
   - prepare production and privilege log
   - client verification for interrogatories
   - attorney/client review
   - serve responses
3. Responses we review:
   - confirm verification
   - check completeness and specificity
   - review production
   - identify deficiencies
   - send deficiency/meet-and-confer letter
   - track cure deadline
   - file motion to compel if needed

Discovery set record shape:

- id
- direction: propounded or received
- party served / serving party
- defendant track, if tied to a defendant
- discovery type: interrogatories, RFP, RFA, mixed
- served date
- response due date
- templates/modules used
- attorney approved
- responses received date
- response served date
- verification required/signed
- production status
- privilege log required/provided
- deficiencies
- meet-and-confer status
- motion to compel status
- complete

Important native-vault implication:

- Discovery deadlines should be generated per discovery set.
- RFAs need special handling because late/non-response can create deemed admissions.
- Deficiencies are their own branch, not merely notes.
- Discovery can be substantially complete even if one dispute remains, but that needs attorney judgment.
- Discovery completion should be derived from discovery-set, deposition, and scheduling-order records, with any attorney override documented.

### Workflow read: litigation 7.2 depositions

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/workflows/client_deposition_prep/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/workflows/party_depositions/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/workflows/corp_rep_deposition/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/workflows/defense_expert_depo/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/workflows/third_party_deposition/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/deposition_library/decision_tree.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_2_discovery/landmarks.md`

Current reading, not yet attorney-confirmed:

Depositions should be modeled as deposition events, not as only two landmarks for client and defendant deposition complete.

Each deposition event needs:

- id
- deponent
- deponent type: client, individual adverse party, corporate representative, defense expert, third-party witness
- related party/defendant/claim
- workflow type
- strategic purpose
- notice path
- subpoena path, if non-party
- subpoena duces tecum/document request path, if used
- deposition date/time/location
- court reporter/videographer
- prep status
- outline path
- exhibit list
- transcript ordered/received
- transcript path
- testimony summary path
- page-line citation extracts
- follow-up tasks
- completion status

Type-specific branches:

1. Client deposition defense:
   - receive notice
   - verify logistics and adequacy
   - calendar date
   - schedule prep sessions
   - compile documents
   - identify privilege issues
   - send client preparation letter
   - conduct attorney prep sessions
   - support day-of deposition
   - analyze transcript
   - create testimony log and trial notes
2. Individual adverse party deposition:
   - identify deponent
   - select rules-based examination strategy
   - draft notice
   - prepare outline
   - prepare exhibits
   - conduct deposition
   - order transcript
   - extract admissions, rules, inconsistencies, and impeachment material
3. Corporate representative deposition:
   - identify strategic goals
   - draft CR 30.02(6) topics with reasonable particularity
   - coordinate RFP/document request
   - serve notice/RFP
   - prepare topic-by-topic outline
   - handle know-nothing witness branch
   - analyze binding corporate testimony
   - consider motion to compel if topics not answered
4. Defense expert deposition:
   - ensure expert disclosed/report received
   - serve expert discovery/RFP before deposition
   - compile expert dossier
   - map conflict opportunities
   - draft trial-use notice
   - send KRE 804 notice
   - arrange video
   - conduct deposition as trial testimony
   - extract conflicts and impeachment material
5. Third-party deposition:
   - identify witness and information needed
   - evaluate subpoena power
   - prepare subpoena and notice
   - serve witness and parties
   - handle documents via subpoena duces tecum
   - prepare outline
   - conduct deposition
   - analyze testimony and documents

Important native-vault implication:

- Deposition events should live under `litigation/discovery/depositions/` or equivalent.
- A deposition schedule should be derived from the event records rather than separately maintained by hand.
- Testimony trackers should be durable, citation-based outputs that later feed mediation, dispositive motions, and trial prep.
- Depositions can create follow-up written discovery, motion-to-compel, expert challenge, mediation, or trial-prep tasks.
- Discovery completion should depend on required deposition events being complete or expressly waived/marked unnecessary by attorney judgment.

### Workflow read: litigation 7.3 mediation

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_3_mediation/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_3_mediation/landmarks.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_3_mediation/workflows/prepare_mediation/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_3_mediation/workflows/attend_mediation/workflow.md`

Current reading, not yet attorney-confirmed:

Mediation should be modeled as a mediation event with preparation, attendance, negotiation history, authority, and outcome.

The workflows split into:

1. Prepare mediation:
   - mediation date scheduled
   - discovery complete or substantially complete
   - damages calculated
   - client prep meeting scheduled
   - mediation brief drafted
   - damage summary prepared
   - settlement authority confirmed
   - client prepared
   - brief submitted to mediator/opposing counsel
2. Attend mediation:
   - opening session
   - caucuses
   - offers and counteroffers
   - net-to-client analysis
   - client consultations
   - outcome documented

Mediation event record shape:

- id
- mediator
- date/time/location
- ordered/agreed/manual trigger
- related scheduling order
- discovery readiness status
- mediation brief path
- damage summary path
- settlement authority
- client preparation status
- submitted date
- attendance status
- offers/counteroffers
- mediator proposal
- result: full settlement, partial settlement, impasse, continued, proposal pending
- settlement terms path, if settled
- trial-prep next steps, if impasse

Important native-vault implication:

- Mediation does not end litigation by itself. It branches based on result.
- A full settlement should route to settlement processing.
- A partial settlement may leave some defendants/claims in litigation.
- An impasse should route to 7.4 trial prep.
- A mediator proposal needs its own deadline/timer and response workflow.
- Authority and negotiation strategy may need privileged/confidential handling distinct from public-facing mediation documents.

### Workflow read: litigation 7.4 trial prep

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_4_trial_prep/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_4_trial_prep/landmarks.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_4_trial_prep/workflows/expert_management/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_4_trial_prep/workflows/trial_materials/workflow.md`

Current reading, not yet attorney-confirmed:

Trial prep should be modeled around a trial settings/deadlines record plus expert, exhibit, witness, instruction, and pretrial-filing records.

The workflows split into:

1. Expert management:
   - identify disclosure deadline from scheduling order
   - confirm retained experts and opinions
   - draft and serve/file expert disclosure
   - review defense expert disclosure
   - complete expert depositions
   - prepare our experts for trial
2. Trial materials:
   - prepare exhibit list
   - prepare witness list
   - draft pretrial brief
   - draft proposed jury instructions
   - organize trial notebook
   - file required pretrial documents
   - attend pretrial conference

Trial-prep record shape:

- trial date
- pretrial conference date
- scheduling order path
- expert disclosure deadline
- rebuttal expert deadline
- expert discovery cutoff
- exhibit list deadline/status/path
- witness list deadline/status/path
- pretrial brief deadline/status/path
- jury instruction deadline/status/path
- trial notebook status/path
- unresolved objections
- unresolved motions in limine
- trial ready status

Expert record shape:

- expert name
- retained/treating/rebuttal/defense
- specialty
- disclosure deadline
- disclosure served/filed
- opinions finalized
- report path
- CV path
- compensation
- prior testimony list
- deposition status
- trial preparation status

Important native-vault implication:

- Trial prep depends heavily on scheduling-order dates, so the scheduling order should be machine-readable enough to generate timers.
- Exhibit and witness lists should be first-class records, not only generated documents.
- Trial readiness is a hard blocker that should be derived from all pretrial requirements, with attorney override only if explicitly documented.
- Expert management links backward to discovery/depositions and forward to trial presentation.

### Workflow read: litigation 7.5 trial

Source reviewed:

- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_5_trial/README.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_5_trial/landmarks.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_5_trial/workflows/conduct_trial/workflow.md`
- `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/workflows/skills.tools.workflows.2/workflows/phase_7_litigation/subphases/7_5_trial/workflows/conduct_trial/skills/trial-presentation/skill.md`

Current reading, not yet attorney-confirmed:

Trial should be modeled as a trial event/proceeding record that starts only after trial-ready status is confirmed and the trial date arrives.

Trial event phases:

1. Voir dire / jury selection
2. Opening statement
3. Plaintiff's case
4. Defense motions during trial
5. Defense case / cross-examination
6. Closing argument
7. Deliberation / jury questions
8. Verdict or other resolution

Trial event record shape:

- trial id
- trial date(s)
- judge/court
- jury selected status
- opening statement status/path
- witness order
- plaintiff case status
- admitted exhibits
- defense motions
- defense case status
- jury instructions used
- closing status/path
- deliberation status
- jury questions
- verdict or other resolution
- judgment path
- next branch

Outcome branches:

- plaintiff verdict routes to settlement/collection/distribution
- defense verdict routes to closure or appeal evaluation
- mistrial routes to retry, settlement, or closure decision
- settlement during trial routes to settlement processing
- directed verdict or other court resolution routes based on result

Important native-vault implication:

- The live-trial record should be mostly a proceeding/audit summary, not an attempt to have agents run the trial.
- Agents can prepare outlines, organize daily notes, track admitted exhibits, update witness/evidence status, and summarize verdict/next steps.
- Post-trial routing must be explicit because "trial concluded" can mean plaintiff recovery, defense win, mistrial, settlement, directed verdict, or appeal issue.

### Consolidation note: native case contract candidate

Current FirmVault `DATA_CONTRACT.md` says the canonical case file frontmatter is the source for phase/status and landmarks. That should remain true until the contract is formally changed.

The clean-case proposal should therefore avoid creating a second hidden state system. The better model is:

- canonical case file frontmatter stores compact global case state: status, phase, landmarks, case identity
- first-class markdown ledgers store entity/workflow state: insurance claims, providers, liens, demand, negotiation, settlement, litigation
- append-only activity/workflow logs store the audit trail
- Mission Control SQLite stores runtime execution state only: workflow instances, node state, task sessions, timers

Candidate vNext folder families:

- `client/`
- `accident/`
- `contacts/`
- `insurance/`
- `medical-providers/`
- `liens/`
- `demand/`
- `negotiation/`
- `settlement/`
- `litigation/`
- `documents/`
- `activity/`
- `workflow-log/`

The materializer should not ask "does this task exist?" first. It should ask:

1. What workflow instances are active or eligible?
2. What node dependencies are satisfied by case ledgers/frontmatter/timers?
3. Which eligible nodes do not yet have a task/session?
4. Which completed nodes satisfy downstream dependencies?

Workflow nodes should read/write through stable ledgers, not through ad hoc task text.
