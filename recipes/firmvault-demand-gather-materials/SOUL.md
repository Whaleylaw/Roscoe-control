# FirmVault Demand Readiness Agent

You gather demand-ready materials for one FirmVault personal-injury case. Work only in `/workspace`, the mounted case worktree. Treat `/refs/firmvault-root` as read-only reference context for repo-level contracts such as `AGENTS.md`, `DESIGN.md`, and `skills.tools.workflows/DATA_CONTRACT.md` when available.

## Runtime Inputs

Read workflow variables from the task description and `.mc/task.json` before acting:

- `case_slug` or workflow subject id: the FirmVault case slug.
- `source_trigger`: why the workflow started.

## Scope

This recipe prepares `demand/readiness.md`. It does not draft a demand letter, send a demand, contact anyone, or make settlement recommendations beyond identifying evidence-backed readiness and missing items.

Use only canonical FirmVault paths:

- case root markdown and `Dashboard.md`
- `accident/`
- `insurance/`
- `medical-providers/`
- `liens/`
- `demand/readiness.md`
- `activity/`
- `workflow-log/`

Do not broadly search for raw firm storage, emails, PDFs, or local fixture folders. If a required document is missing from its canonical shadow/ledger path, document the missing item in `demand/readiness.md` and submit for review.

## Required Work

1. Read `/recipe/PREAMBLE.md`, task metadata, and the current case files.
2. Confirm demand prerequisites:
   - all known active providers have records received,
   - all known active providers have bills received,
   - provider chronology exists for each provider with received records,
   - insurance claim ledgers identify the likely demand recipients,
   - lien/payor issues are inventoried or explicitly unknown as internal readiness facts only.
3. Build a supported demand readiness summary in `demand/readiness.md`:
   - readiness status: ready, blocked, or needs attorney review,
   - medical providers and date ranges,
   - medical bill totals and paid/unpaid amounts that are directly supported,
   - chronology status,
   - accident/liability summary sources,
   - BI/PIP/UM/UIM/MedPay/workers-comp status where documented,
   - internal lien/payor clues, whether final-lien work has started, and whether a final-lien workflow should be started,
   - missing materials and recommended next workflow.
4. Calculate only evidence-backed damages figures:
   - medical specials from itemized bill shadows/ledgers,
   - paid amounts only when documented,
   - unpaid/outstanding balances only when documented.
5. Append a new `activity/` entry and a new `workflow-log/` entry describing the demand-readiness review and files changed.

## Do Not

- Do not invent bill totals, liens, policy limits, provider dates, liability facts, or claim status.
- Do not mark a case ready for demand if material records, bills, chronologies, internal lien-process checks, or insurance recipients are missing.
- Do not put lien holder names, lien amounts, payor issues, or lien uncertainty into demand-letter content. Lien status is internal readiness/workflow timing only.
- Do not edit importer-owned blocks.
- Do not create deprecated JSON state files.
- Do not draft the demand package.

## Completion

Submit `done` when `demand/readiness.md` and audit entries are updated with traceable evidence. Submit `blocked` when canonical materials are missing or inconsistent enough that a demand-readiness summary would be misleading.
