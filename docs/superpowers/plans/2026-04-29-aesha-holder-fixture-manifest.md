# Aesha Holder Fixture Manifest

Source folder: `/Users/aaronwhaley/Whaley/Aesha Holder`

Purpose: use this closed, document-rich file as a realistic FirmVault workflow fixture. This manifest maps the old flat-folder documents into the canonical FirmVault case structure and identifies which workflows each document can test or unblock.

## Extraction Summary

- Source items: 126 files.
- File types: 87 PDFs, 29 Word `.doc` files, 5 Excel `.xls` billing summaries, 3 audio files, 1 video file, 1 image.
- Text extracted successfully from most Word files and text-based PDFs. Several PDFs are image/scanned or redacted and produced little or no text.
- This is a messy legacy case. Agents must treat it as a fixture for import/normalization, not as proof that old naming and placement are correct.

## High-Value Case Facts

These are the facts that make this folder useful for workflow testing.

| Fact | Source evidence | FirmVault destination |
| --- | --- | --- |
| Motor vehicle collision on 2019-05-04 | `KY72348406.pdf`, demand letters, medical records | `accident/accident.md` |
| Police report exists | `KY72348406.pdf` | `accident/police-report.md`, `documents/shadows/accident/police-report.md` |
| Investigating agency is Louisville Metro Police Department | `KY72348406.pdf` | `accident/police-report.md`, contact stub for LMPD if needed |
| Police report master file number is `72348406` | `KY72348406.pdf` | `accident/police-report.md` |
| Collision report lists two units and a sideswipe same-direction crash | `KY72348406.pdf` | `accident/accident.md`, `accident/liability.md` |
| BI claim against Progressive exists | `BI LOR.doc/pdf`, demand letters, blank insurance correspondence | `insurance/bi-progressive.md` |
| Progressive claim number appears as `194828898` | `BI LOR.doc`, demand letters, Conduent lien request | `insurance/bi-progressive.md` |
| KAC / Travelers assigned-claims PIP track exists | `LoR to KAC.doc`, `Completed PIP app.pdf`, `KAC ack letter with supporting docs.pdf`, `KAC Exhaust ltr.pdf` | `insurance/pip-travelers-kac.md` |
| State Farm coverage / PIP / UM-UIM branch exists and appears denied or released | `State Farm LOR.doc/pdf`, `STate Farm denial letter.pdf`, `State Farm denial.pdf`, `A Holder SF signed release.pdf` | `insurance/pip-state-farm.md`, `insurance/um-state-farm.md`, `insurance/uim-state-farm.md` as applicable |
| Medical providers include chiropractic, ER/hospital, emergency physicians, pharmacy, imaging, pain/spine providers | provider request letters, records, bills, billing summaries | `medical-providers/<provider-slug>/` |
| Bills and PIP payments can be tracked over time | `Billing Summary 9.5.19.xls` through `Billing Summary 11.11.19.xls` | `demand/damages-summary.md`, provider `records-bills.md`, PIP ledger |
| Medicaid/Passport lien exists through Conduent | `First Lien Letter.pdf`, `Conduent lien request 12.28.19.*`, `Conduent lien with ledger.pdf`, Conduent letters | `liens/conduent-passport-medicaid.md` |
| Litigation/case expenses exist | `LawsuitExpenseSummary.pdf`, `INVOICE.pdf` | settlement/trust ledger or future `expenses/` contract path |
| Demand package exists and was updated | `Aesha Holder Demand.*`, `Aesha Holder Demand updated 9.23.19.*` | `demand/demand-letter.md`, `demand/demand-package.md`, `demand/damages-summary.md` |
| Offer and settlement documents exist | `Offer letter.pdf`, `SETTLEMENT.doc`, releases, settlement docs/check PDFs | `negotiation/offers.md`, `settlement/settlement.md`, `settlement/distribution.md`, `settlement/release.md`, `settlement/authorization.md` |

## Important Data Quality Issues

These should become agent review flags during import.

- The demand letters refer to “Madeline Jones” in the body even though the file and caption are for Aesha Holder. Treat this as a template carryover error needing human review.
- `INSREPCL1.doc` appears to invert “Your Insured” and “Our Client” compared to `State Farm LOR.doc`; treat as potentially wrong legacy template data.
- Dates of birth vary between extracted documents. Do not reconcile automatically; flag for owner review.
- Some signed releases and settlement PDFs are scanned/image-only. They should be filed by filename and context first, then OCR/manual review can enrich the shadow.
- The folder includes duplicate files: settlement docs/check, KAC ROI, SE Emergency Physicians authorization, PT orders, request templates, audio recordings. Preserve duplicates as source artifacts but normalize the FirmVault ledgers to one canonical current status.

## Canonical Case Layout Target

For a clean imported fixture, the target case should be `cases/aesha-holder/` with raw originals staying outside the vault and markdown shadows inside FirmVault.

```text
cases/aesha-holder/
  aesha-holder.md
  Dashboard.md
  AGENTS.md
  client/
  accident/
  contacts/
  insurance/
  medical-providers/
  liens/
  demand/
  negotiation/
  settlement/
  activity/
  workflow-log/
  documents/
    shadows/
      client/
      accident/
      insurance/
      medical/
      liens/
      demand/
      settlement/
    generated/
    sent/
    received/
```

If a destination below does not yet exist in `DATA_CONTRACT.md`, the contract should be extended before agents write there.

## Workflow Fixture Map

| Workflow | Documents that can test it | Expected workflow use |
| --- | --- | --- |
| Case Setup | `AHolder initial doc.pdf`, contact/activity/email exports | Build case shell, intake facts, case contacts, opening activity. |
| Initial Document Collection | `Contract.pdf`, `AHolder med auth*.pdf`, `AHolder KY1 ROI*.pdf`, `AHolder non soli.pdf`, `AHolder CMS.pdf`, `AHolder DL passport card.pdf` | Verify signed contract and authorizations exist and normalize them into fixed client paths. |
| Accident Report | `KY72348406.pdf`, `Ltr from LMPD RE ORR.pdf`, `53789 fill-in.pdf` | Prove the “report found” branch: file canonical report shadow, extract report number, agency, location, date/time, units, narrative, liability clues. |
| Accident Media / Investigation | `Ambers-Redacted.mp4`, `510 Village West*.wav`, `510 Village West P19175965_Redacted.pdf`, `asdf.jpg` | Store media shadows/references, create investigation notes, link to accident evidence if confirmed relevant. |
| BI Claim Setup | `BI LOR.doc/pdf`, `INSREP1.doc`, `BLANKINS.doc`, Progressive demand files | Create/update `insurance/bi-progressive.md`, carrier contact, claim number, LOR sent status. |
| PIP / KAC Assigned Claims | `LoR to KAC.doc`, `AHolder PIP app.pdf`, `Completed PIP app.pdf`, `KAC ack letter with supporting docs.pdf`, `KACPDOCS.pdf`, `KAC Exhaust ltr.pdf`, `Aesha Holder KAC documents Travelers.pdf`, billing summaries | Prove assigned-claims setup, PIP application, PIP payments, and PIP exhaustion branch. |
| State Farm PIP / UM / UIM | `State Farm LOR.doc/pdf`, `INSREPCL1.doc`, `BLANKINC.doc`, `STate Farm denial letter.pdf`, `State Farm denial.pdf`, `A Holder SF signed release.pdf` | Create conditional State Farm coverage ledgers and test denial/release/not-applicable outcomes. |
| Medical Provider Setup | provider request letters, authorizations, contacts export, medical records/bills | Create provider folders and contact stubs before request/receipt workflows run. |
| Request Medical Records and Bills | `*Request.doc`, request PDFs, provider-specific authorizations | Prove generated/sent request ledgers for each provider. |
| Receive and Process Records/Bills | provider records and bills PDFs, billing summaries | File records/bills shadows, update bill totals, payment by PIP/insurance, outstanding balances, payer/lien clues. |
| Medical Chronology | all medical records PDFs | Build provider chronology and global treatment chronology. |
| Lien Identification / Lien Opening | `First Lien Letter.pdf`, `PROTECT1.doc`, `Aluvalife Rx LOP.pdf`, `MedAuth - Conduent.pdf`, Conduent docs, Barrister loan docs | Create lien ledgers, identify Medicaid/Passport, provider lien/LOP, and litigation funding interests. |
| Demand Readiness / Draft Demand | demand docs, billing summaries, records, itemized statements, accident report | Gather damages, prepare demand package, flag template errors. |
| Negotiation | `Offer letter.pdf`, demand files | Track initial offer/counter/evaluation. |
| Settlement / Distribution | `SETTLEMENT.doc`, `A Holder stlmn docs, ID, Check*.pdf`, releases, liens, expenses | Build settlement statement, releases, trust/distribution ledger, lien payoff tracking. |
| Activity / Legacy Import | `Holder, Aesha ... activity_log_*.pdf`, emails, contacts | Import legacy activity as historical activity summaries, not as new work events. |

## Provider Destination Map

| Provider / entity | Source files | Canonical destination |
| --- | --- | --- |
| West Louisville Accident & Injury / Charles Bennett DC | `Aesha Holder Medical Records.pdf`, `Aesha Holder Itemized stmt.pdf`, `Aesha Holder update itemized stat for dos 08 08 19.pdf`, `Aesha Holder note for 08 08 19.pdf`, `PROTECT1.doc` | `medical-providers/west-louisville-accident-and-injury/` and possible `liens/west-louisville-accident-and-injury.md` |
| North Dixie Medical Center | `North Dixie Request.*`, `North Dixie records and bill.pdf` | `medical-providers/north-dixie-medical-center/` |
| Jewish Hospital / KentuckyOne Health | `Jewish Hospital Request.*`, `Jewish Hospital Billing Request.doc`, `Jewish records pt1.pdf`, `Jewish records pt2.pdf`, `8.28.19 Jewish ER Records.pdf`, `Jewish ER bill.pdf`, `REQMED kentucky One Health.doc`, `Med Auth Kentucky One Health.pdf`, `AHolder KY1 ROI*.pdf` | `medical-providers/jewish-hospital/` and `medical-providers/kentuckyone-health/` if billing is tracked separately |
| Physicians in Emergency Medicine / Southeastern Emergency Physicians | `REQMED Physicians in Emergency Medicine.doc`, `Med Auth Physicians in Emergency Medicine.pdf`, `AHolder med auth SE EM PHY*.pdf`, `Physicians in Emergency Medicine bill DOS 5.4.19 and 8.28.19.pdf`, `Physicians in Emergency Medicine bill unrelated.pdf` | `medical-providers/physicians-in-emergency-medicine/` |
| Norton Leatherman Spine / Norton Physician Services | `Leatherman Request.*`, `Leatherman Request w auth.pdf`, `AHolder med auth Norton Leatherman.pdf`, `Norton Leatherman records.pdf`, `Norton Priors.pdf`, `Norton Physician Services Bill DOS 8.13.19.pdf`, `Aesha Holder Norton new pt evaluation.pdf` | `medical-providers/norton-leatherman-spine/` |
| Aptiva Health | `09.09.19 NPE.pdf`, `09.12.19 Bilateral L5-S1 TESI..pdf`, `9.12.19 INJECTION NOTES.pdf`, `9.9.19 C&L-Spine X-Ray Report.pdf`, `Itemization.pdf` | `medical-providers/aptiva-health/` |
| Metro Pain Relief Center | `MEtro Pain records.pdf`, `Metro Bill.pdf` | `medical-providers/metro-pain-relief-center/` |
| Foundation Radiology | `Foundation Radiology Request.*`, `AHolder med auth Foundation Radiology.pdf`, `Foundation Radiology bill.pdf`, `7.13.19 L spine MRI.pdf`, `Lumbar MRI.pdf` | `medical-providers/foundation-radiology/` |
| KORT Physical Therapy | `KORT Request.doc`, `AHolder med auth KORT.pdf`, `AHolder PT order*.pdf` | `medical-providers/kort-physical-therapy/` |
| Aluvalife RX | `Aluvalife Rx Request*.doc`, `Aluvalife RX bill.pdf`, `Aluvalife Rx LOP.pdf` | `medical-providers/aluvalife-rx/` and possible `liens/aluvalife-rx.md` |

## Document Manifest

### Client / Intake / Authority

| Source file | What it is | Canonical FirmVault destination | Workflows |
| --- | --- | --- | --- |
| `AHolder initial doc.pdf` | Initial intake/opening packet. Mostly scanned. | `client/intake.md`, `documents/shadows/client/intake-packet.md` | Case Setup, Initial Document Collection |
| `Contract.pdf` | Fee agreement / representation contract. Scanned. | `client/contracts.md`, `documents/shadows/client/fee-agreement-signed.md` | Initial Document Collection |
| `AHolder med auth.pdf` | General medical authorization. Scanned. | `client/authorizations.md`, `documents/shadows/client/medical-authorization-signed.md` | Initial Document Collection, Records/Bills |
| `AHolder med auth Foundation Radiology.pdf` | Provider-specific Foundation Radiology authorization. | `client/authorizations.md`, provider request evidence | Records/Bills |
| `AHolder med auth KORT.pdf` | Provider-specific KORT authorization. | `client/authorizations.md`, provider request evidence | Records/Bills |
| `AHolder med auth Norton Leatherman.pdf` | Provider-specific Norton Leatherman authorization. | `client/authorizations.md`, provider request evidence | Records/Bills |
| `AHolder med auth SE EM PHY.pdf`, `AHolder med auth SE EM PHY (1).pdf` | Provider-specific Southeastern Emergency Physicians authorization duplicates. | `client/authorizations.md`, provider request evidence | Records/Bills |
| `Med Auth Kentucky One Health.pdf`, `AHolder KY1 ROI.pdf`, `AHolder KY1 ROI 10.22.19.pdf` | KentuckyOne / Jewish authorization and ROI forms. | `client/authorizations.md`, `documents/shadows/client/provider-authorizations/` if added | Records/Bills |
| `Med Auth Physicians in Emergency Medicine.pdf` | Emergency physicians authorization. | `client/authorizations.md` | Records/Bills |
| `MedAuth - Conduent.pdf` | Authorization for lien/subrogation entity. | `client/authorizations.md`, `liens/conduent-passport-medicaid.md` evidence | Lien Management |
| `AHolder non soli.pdf` | Non-solicitation or client authority form. Scanned. | `client/authorizations.md`, `documents/shadows/client/non-solicitation-signed.md` if added | Initial Document Collection |
| `AHolder CMS.pdf` | CMS/Medicare-style form. Scanned. | `client/authorizations.md`, possible `liens/medicare.md` evidence if applicable | Initial Document Collection, Lien Identification |
| `AHolder DL passport card.pdf` | Client ID / passport card. | `client/identification.md` if added, otherwise `documents/shadows/client/client-id.md` | Case Setup |

### Accident / Investigation

| Source file | What it is | Canonical FirmVault destination | Workflows |
| --- | --- | --- | --- |
| `KY72348406.pdf` | Kentucky Uniform Police Traffic Collision Report. Extracted master file number `72348406`; LMPD agency; date/time 2019-05-04 18:07; narrative and unit facts. | `accident/police-report.md`, `documents/shadows/accident/police-report.md`, `accident/accident.md`, `accident/liability.md` | Accident Report, BI/PIP/UM-UIM setup |
| `Ltr from LMPD RE ORR.pdf` | Letter from LMPD regarding open-records request. Scanned or low text. | `documents/shadows/accident/lmpd-open-records-response.md`, `accident/police-report.md` evidence | Accident Report |
| `53789 fill-in.pdf` | Indiana BMV certified-records request form. May be unrelated or used for out-of-state vehicle/driver record. | `documents/generated/accident/bmv-records-request.md` if relevant | Accident Report, Investigation |
| `510 Village West P19175965_Redacted.pdf` | Redacted document tied to `P19175965`; text not extracted. Relevance uncertain. | `documents/shadows/accident/510-village-west-redacted.md` if confirmed accident evidence | Accident Investigation |
| `510 Village West Dr. Intro. P19175965.wav`, `510 Village West Dr. Intro. P19175965 (1).wav`, `Redacted 510 Village West Dr. Phone. P19175965.wav` | Audio recordings, likely investigator/phone evidence. | raw-file reference plus `documents/shadows/accident/audio-<slug>.md` transcript once transcribed | Accident Investigation, Communications |
| `Ambers-Redacted.mp4` | Video file, likely officer/bodycam or accident evidence. | raw-file reference plus `documents/shadows/accident/video-ambers-redacted.md` after review | Accident Investigation |
| `asdf.jpg` | Image file. Relevance unknown. | `documents/shadows/accident/image-asdf.md` only if confirmed relevant | Accident Investigation |

### Insurance: BI / Progressive

| Source file | What it is | Canonical FirmVault destination | Workflows |
| --- | --- | --- | --- |
| `BI LOR.doc`, `BI LOR.pdf`, `INSREP1.doc` | BI letter of representation to Progressive; claim `194828898`; insured Aletha Bault. `INSREP1.doc` appears duplicate of BI LOR. | `insurance/bi-progressive.md`, `documents/generated/insurance/bi-progressive-lor.md`, `documents/sent/insurance/bi-progressive-lor-sent.md` | BI Claim Setup |
| `BLANKINS.doc` | Later blank/placeholder correspondence to Progressive adjuster Nathan Jones, claim `194828898`. | `documents/generated/insurance/bi-progressive-correspondence.md` | BI Claim Setup, Negotiation |
| `Aesha Holder Demand.doc`, `Aesha Holder Demand.pdf` | Initial demand to Progressive. Includes template error naming another client in body. | `demand/demand-letter.md`, `documents/generated/demand/progressive-demand-initial.md` | Demand, BI Negotiation |
| `Aesha Holder Demand updated 9.23.19.doc`, `Aesha Holder Demand updated 9.23.19.pdf` | Updated demand with more damages. Same template issue. | `demand/demand-letter.md`, `demand/damages-summary.md`, `documents/generated/demand/progressive-demand-updated.md` | Demand, BI Negotiation |
| `Offer letter.pdf` | BI offer or settlement offer correspondence. Scanned/low text. | `negotiation/offers.md`, `documents/shadows/insurance/progressive-offer-letter.md` | Negotiation |
| `Aesha Holder BI release.pdf`, `Aesha Holder signed release.pdf` | BI release / signed release. Scanned. | `settlement/release.md`, `documents/received/settlement/bi-release-signed.md` | Settlement |

### Insurance: KAC / Travelers Assigned Claims / PIP

| Source file | What it is | Canonical FirmVault destination | Workflows |
| --- | --- | --- | --- |
| `LoR to KAC.doc` | Letter of representation to Kentucky Automobile Assigned Claims Bureau. States passenger, no vehicle/household insurance, asks KAC to cover medical expenses. | `insurance/pip-travelers-kac.md`, `documents/generated/insurance/pip-kac-lor.md` | PIP Claim Setup |
| `AHolder PIP app.pdf`, `Completed PIP app.pdf` | PIP application / assigned-claims application. Scanned. | `insurance/pip-travelers-kac.md`, `documents/shadows/insurance/pip-kac-application.md` | PIP Claim Setup |
| `KAC ack letter with supporting docs.pdf` | KAC/Travelers acknowledgment with supporting docs. Scanned. | `insurance/pip-travelers-kac.md`, `documents/received/insurance/kac-acknowledgment.md` | PIP Claim Setup |
| `KACPDOCS.pdf` | KAC PIP documents. Low text. | `insurance/pip-travelers-kac.md`, `documents/shadows/insurance/kac-pip-docs.md` | PIP Claim Setup |
| `Aesha Holder KAC documents Travelers.pdf` | Travelers/KAC document packet. Scanned. | `insurance/pip-travelers-kac.md`, `documents/shadows/insurance/travelers-kac-documents.md` | PIP Claim Setup, PIP Payment Tracking |
| `KAC Exhaust ltr.pdf` | PIP exhaustion letter. Low text but filename is strong evidence. | `insurance/pip-travelers-kac.md`, `documents/received/insurance/kac-pip-exhaustion-letter.md` | PIP Exhaustion |
| `BLANKINC_v2.doc` | Later correspondence to Travelers/KAC adjuster Krystle Compton, policy/claim `FBZ7757-002`. | `insurance/pip-travelers-kac.md`, `documents/generated/insurance/kac-travelers-correspondence.md` | PIP Claim Setup |
| `Billing Summary 9.5.19.xls` through `Billing Summary 11.11.19.xls` | Running medical billing/PIP payment summaries. Show total billed and PIP payments over time, including paid-by-PIP totals and outstanding balances. | `insurance/pip-travelers-kac.md`, provider `records-bills.md`, `demand/damages-summary.md` | PIP Payment Tracking, Demand Readiness, Settlement |

### Insurance: State Farm / Possible PIP-UM-UIM

| Source file | What it is | Canonical FirmVault destination | Workflows |
| --- | --- | --- | --- |
| `State Farm LOR.doc`, `State Farm LOR.pdf` | Letter to State Farm adjuster Brianna Okoro, claim `149427S59`; requests PIP/wage loss application and preserves UM/UIM rights. | `insurance/pip-state-farm.md`, `insurance/um-state-farm.md`, `insurance/uim-state-farm.md`, generated/sent LOR shadows | State Farm Coverage, UM/UIM Preservation |
| `INSREPCL1.doc` | Similar State Farm correspondence but appears to reverse client/insured fields. | same State Farm ledgers with data-quality warning | State Farm Coverage |
| `BLANKINC.doc` | Later correspondence to State Farm adjuster Chuck Hubbard, claim `149427S59`. | `documents/generated/insurance/state-farm-correspondence.md` | State Farm Coverage |
| `STate Farm denial letter.pdf`, `State Farm denial.pdf` | State Farm denial documents. Low text. | `insurance/pip-state-farm.md`, `insurance/um-state-farm.md`, `insurance/uim-state-farm.md`, `documents/received/insurance/state-farm-denial.md` | Coverage Denial / Not Applicable |
| `A Holder SF signed release.pdf` | Signed State Farm release. Scanned. | `settlement/release.md`, `documents/received/settlement/state-farm-release-signed.md` | Settlement, State Farm Coverage Closure |

### Medical Requests, Records, Bills

| Source file(s) | Provider / type | Canonical FirmVault destination | Workflows |
| --- | --- | --- | --- |
| `Jewish Hospital Request.doc/pdf`, `Jewish Hospital Billing Request.doc`, `REQMED kentucky One Health.doc` | Jewish/KentuckyOne records and billing requests | `medical-providers/jewish-hospital/requests/`, `medical-providers/kentuckyone-health/requests/` | Request Records/Bills |
| `Jewish records pt1.pdf`, `Jewish records pt2.pdf`, `8.28.19 Jewish ER Records.pdf`, `Jewish ER bill.pdf` | Jewish ER/hospital records and bill | `medical-providers/jewish-hospital/documents/records.md`, `documents/bills.md`, `chronology.md` | Receive Records/Bills, Chronology |
| `REQMED Physicians in Emergency Medicine.doc`, `Physicians in Emergency Medicine bill DOS 5.4.19 and 8.28.19.pdf`, `Physicians in Emergency Medicine bill unrelated.pdf` | Emergency physician request and bills | `medical-providers/physicians-in-emergency-medicine/` | Request/Receive Records/Bills, Bill Review |
| `North Dixie Request.doc/pdf`, `North Dixie records and bill.pdf` | North Dixie records/bills | `medical-providers/north-dixie-medical-center/` | Request/Receive Records/Bills, Chronology |
| `Leatherman Request.doc/pdf`, `Leatherman Request w auth.pdf`, `Norton Leatherman records.pdf`, `Norton Priors.pdf`, `Norton Physician Services Bill DOS 8.13.19.pdf`, `Aesha Holder Norton new pt evaluation.pdf` | Norton Leatherman/Norton provider records/bills | `medical-providers/norton-leatherman-spine/` | Request/Receive Records/Bills, Chronology |
| `09.09.19 NPE.pdf`, `09.12.19 Bilateral L5-S1 TESI..pdf`, `9.12.19 INJECTION NOTES.pdf`, `9.9.19 C&L-Spine X-Ray Report.pdf`, `Itemization.pdf` | Aptiva/spine/pain evaluation, procedure, imaging, itemization | `medical-providers/aptiva-health/` | Treatment Monitoring, Chronology, Bills |
| `Foundation Radiology Request.doc/pdf`, `Foundation Radiology bill.pdf`, `7.13.19 L spine MRI.pdf`, `Lumbar MRI.pdf` | Imaging request, bill, MRI reports | `medical-providers/foundation-radiology/` | Request/Receive Records/Bills, Chronology |
| `MEtro Pain records.pdf`, `Metro Bill.pdf` | Metro Pain records and bill | `medical-providers/metro-pain-relief-center/` | Receive Records/Bills |
| `KORT Request.doc`, `AHolder PT order.pdf`, `AHolder PT order (1).pdf`, `AHolder PT order (2).pdf` | KORT request and PT orders | `medical-providers/kort-physical-therapy/` | Provider Setup, Request Records/Bills |
| `Aluvalife Rx Request.doc`, `Aluvalife Rx Request (1).doc`, `Aluvalife RX bill.pdf`, `Aluvalife Rx LOP.pdf` | Pharmacy request, bill, LOP | `medical-providers/aluvalife-rx/`, possible `liens/aluvalife-rx.md` | Request/Receive Bills, Lien Identification |
| `Aesha Holder Itemized stmt.pdf`, `Aesha Holder update itemized stat for dos 08 08 19.pdf`, `Aesha Holder note for 08 08 19.pdf`, `Aesha Holder Medical Records.pdf` | West Louisville Accident & Injury records and bills | `medical-providers/west-louisville-accident-and-injury/` | Receive Records/Bills, Chronology, Demand |

### Liens, Subrogation, Funding, Expenses

| Source file | What it is | Canonical FirmVault destination | Workflows |
| --- | --- | --- | --- |
| `First Lien Letter.pdf` | Letter to Conduent/Passport Medicaid requesting lien itemization. | `liens/conduent-passport-medicaid.md`, `documents/sent/liens/conduent-first-lien-letter.md` | Lien Opening |
| `Conduent lien request 12.28.19.doc/pdf` | Follow-up/final lien request to Conduent/Passport. | `liens/conduent-passport-medicaid.md`, `documents/sent/liens/conduent-final-lien-request.md` | Final Lien Amount Request |
| `Conduent lien with ledger.pdf` | Lien ledger/evidence. Low text. | `liens/conduent-passport-medicaid.md`, `documents/received/liens/conduent-ledger.md` | Lien Amount Received |
| `Conduent letter 1.16.20.pdf`, `Conduent letter 3.15.21.pdf` | Conduent correspondence. Low text. | `liens/conduent-passport-medicaid.md` | Lien Follow-Up / Resolution |
| `Barrister loan agreement.pdf`, `Barrister Capital loan agreement 10.10.19.pdf` | Litigation funding / loan agreements. | `liens/barrister-capital-group.md` or separate funding ledger if added | Lien/Funding Resolution |
| `PROTECT1.doc` | Provider protection/lien letter to Charles Bennett / West Louisville Accident & Injury. | `liens/west-louisville-accident-and-injury.md` | Provider Lien Opening |
| `Aluvalife Rx LOP.pdf` | Pharmacy letter of protection. | `liens/aluvalife-rx.md` | Provider Lien Opening |
| `LawsuitExpenseSummary.pdf` | Case expense summary, one CasePacer/document-management fee shown. | settlement/trust ledger or future `expenses/expenses.md` | Settlement Distribution |
| `INVOICE.pdf` | Invoice. Needs review to identify payee/purpose. | settlement/trust ledger or future `expenses/expenses.md` | Settlement Distribution |

### Demand, Negotiation, Settlement

| Source file | What it is | Canonical FirmVault destination | Workflows |
| --- | --- | --- | --- |
| `Aesha Holder Demand.doc/pdf` | Initial demand letter and package summary. | `demand/demand-letter.md`, `documents/generated/demand/initial-demand.md` | Draft Demand, Send Demand |
| `Aesha Holder Demand updated 9.23.19.doc/pdf` | Updated demand letter with expanded damages. | `demand/demand-letter.md`, `demand/damages-summary.md` | Draft Demand, Send Demand |
| `Billing Summary *.xls` | Damages and payment summaries over time. | `demand/damages-summary.md`, `settlement/distribution.md` | Demand Readiness, Settlement |
| `Offer letter.pdf` | Offer correspondence. | `negotiation/offers.md` | Track Offers |
| `SETTLEMENT.doc` | Settlement authorization/distribution letter. Extracted settlement $20,000; attorney fee; lien/subrogation and medical debt breakdown. | `settlement/settlement.md`, `settlement/authorization.md`, `settlement/distribution.md` | Settlement Processing |
| `A Holder stlmn docs, ID, Check.pdf`, `A Holder stlmn docs, ID, Check (1).pdf` | Settlement packet, ID, check duplicates. Scanned. | `settlement/trust.md`, `settlement/distribution.md`, `documents/received/settlement/` | Settlement Processing, Final Distribution |
| `Aesha Holder BI release.pdf`, `Aesha Holder signed release.pdf`, `A Holder SF signed release.pdf` | Signed releases. Scanned. | `settlement/release.md`, `documents/received/settlement/` | Settlement Processing |
| `Itemization.pdf` | Medical/provider itemization. | provider bills and `demand/damages-summary.md` | Demand, Settlement |

### Legacy Exports, Templates, and Miscellaneous

| Source file | What it is | Canonical FirmVault destination | Workflows |
| --- | --- | --- | --- |
| `Holder, Aesha (Aesha Holder MVA 5_4_19)_activity_log_1.pdf`, `_activity_log_2.pdf`, `_activity_log_3.pdf` | Legacy activity log exports. | `activity/legacy-import-*.md` summaries, not individual new workflow activity unless parsed | Legacy Import |
| `Holder, Aesha (Aesha Holder MVA 5_4_19)_contacts.pdf` | Legacy contacts export. Includes providers, insurers, lien holders, adjusters. | `contacts/`, provider/contact stubs | Case Setup, Provider/Insurance/Lien Setup |
| `Holder, Aesha (Aesha Holder MVA 5_4_19)_emails.pdf` | Legacy email export. | `documents/shadows/communications/legacy-emails.md` if path added, plus activity summaries | Legacy Import |
| `CLIENTCN.doc` | Client contact/notification template or generated client letter. Needs content review. | `documents/generated/client/` or `activity/` depending use | Client Communications |
| `RETAINTX.doc` | Retention/opening letter to client; includes instruction to route contacts through firm and treatment-monitoring expectations. | `documents/generated/client/retention-letter.md`, `client/check-ins.md` evidence | Case Setup, Client Check-In |
| `EXPROCS.doc` | Client explanation of process letter. | `documents/generated/client/case-process-letter.md` | Client Communications |
| `BLANKINC.doc`, `BLANKINC_v2.doc`, `BLANKINS.doc` | Blank or partial insurance correspondence templates populated with case facts. | Generated correspondence shadows under `documents/generated/insurance/` | Insurance Follow-Up |
| `REQMED1.doc`, `REQMED1_v2.doc`, `REQMED1_v3.doc`, `REQMED kentucky One Health.doc`, `REQMED Physicians in Emergency Medicine.doc` | Request-letter variants for specific providers. | provider `requests/` | Request Records/Bills |
| `A Holder SF signed release.pdf`, `Aesha Holder signed release.pdf`, `Aesha Holder BI release.pdf` | Scanned signed releases; exact carrier should be confirmed from image/OCR. | `settlement/release.md`, `documents/received/settlement/` | Settlement |

## Suggested Test Ladder States From This Fixture

The Aesha Holder folder can support a full realistic workflow ladder:

| Test state | Seed documents | Purpose |
| --- | --- | --- |
| `test-ladder-007-accident-report-found` | `KY72348406.pdf` plus Phase 0 complete case | Test accident-report found/analyzed path, not the no-report path. |
| `test-ladder-008-insurance-claims-opened` | BI LOR, State Farm LOR, KAC LOR, PIP app | Test BI, PIP/KAC, and State Farm conditional coverage branches. |
| `test-ladder-009-provider-setup` | contacts export, intake, request letters, auths | Test provider ledger creation and provider-scoped dependencies. |
| `test-ladder-010-records-bills-received` | all provider records/bills and billing summaries | Test receipt processing, bill totals, payer/PIP payments, and chronology. |
| `test-ladder-011-liens-opened` | Conduent docs, provider LOPs, Barrister funding docs | Test lien identification, opening, final amount request, and funding/lien distinction. |
| `test-ladder-012-demand-sent` | demand docs, damages summaries, records/bills | Test demand readiness and demand package generation/review. |
| `test-ladder-013-negotiation-offer` | offer letter and demand docs | Test offer logging and settlement evaluation. |
| `test-ladder-014-settlement-distribution` | settlement doc, releases, checks, liens, expenses | Test settlement statement, lien payoff, trust/distribution, and closing. |

## Workflow Design Lessons

- Accident Report needs two branches: report found/analyzed and no-report/not-applicable. This fixture should be used to test the found/analyzed branch.
- KAC assigned claims should be its own PIP variant. It is not the same as ordinary first-party PIP even though it performs the same medical-benefits function.
- State Farm may need separate PIP, UM, and UIM ledgers with denial/release outcomes.
- This fixture should not be used as a model for clean case layout. It should be used as a messy import fixture that proves the new workflows can normalize old documents into the fixed FirmVault structure.
- Billing summaries are central because they connect provider bills, PIP payments, outstanding balances, demand damages, liens, and settlement distribution.
- Provider records/bills workflows should be provider-scoped. This fixture has enough providers to test multi-provider fan-out after the one-provider path is stable.
- Lien workflows should not materialize downstream tasks until a lien or funding interest actually exists. This fixture has Medicaid/Passport, provider LOP, and litigation funding examples.
- Settlement workflows must read liens, expenses, releases, offer/settlement authority, and trust/distribution documents together.

## Raw Source File Index

This index is the completeness check against the source folder. Each source item is accounted for above either individually or as part of a grouped duplicate/template family.

| Source file | Manifest bucket |
| --- | --- |
| `09.09.19 NPE.pdf` | Aptiva Health medical records |
| `09.12.19  Bilateral L5-S1 TESI..pdf` | Aptiva Health procedure records |
| `510 Village West Dr. Intro. P19175965 (1).wav` | Accident investigation audio duplicate |
| `510 Village West Dr. Intro. P19175965.wav` | Accident investigation audio |
| `510 Village West P19175965_Redacted.pdf` | Accident investigation document |
| `53789 fill-in.pdf` | Accident investigation / record request form |
| `7.13.19 L spine MRI.pdf` | Foundation Radiology / imaging |
| `8.28.19 Jewish ER Records.pdf` | Jewish Hospital records |
| `9.12.19 INJECTION NOTES.pdf` | Aptiva Health procedure records |
| `9.9.19 C&L-Spine X-Ray Report.pdf` | Aptiva Health imaging |
| `A Holder SF signed release.pdf` | State Farm / settlement release |
| `A Holder stlmn docs, ID, Check (1).pdf` | Settlement packet duplicate |
| `A Holder stlmn docs, ID, Check.pdf` | Settlement packet |
| `AHolder CMS.pdf` | Client authority / lien screening |
| `AHolder DL passport card.pdf` | Client identification |
| `AHolder KY1 ROI 10.22.19.pdf` | KentuckyOne authorization duplicate/update |
| `AHolder KY1 ROI.pdf` | KentuckyOne authorization |
| `AHolder PIP app.pdf` | KAC / PIP application |
| `AHolder PT order (1).pdf` | KORT / PT order duplicate |
| `AHolder PT order (2).pdf` | KORT / PT order duplicate |
| `AHolder PT order.pdf` | KORT / PT order |
| `AHolder initial doc.pdf` | Intake / opening packet |
| `AHolder med auth Foundation Radiology.pdf` | Provider-specific authorization |
| `AHolder med auth KORT.pdf` | Provider-specific authorization |
| `AHolder med auth Norton Leatherman.pdf` | Provider-specific authorization |
| `AHolder med auth SE EM PHY (1).pdf` | Provider-specific authorization duplicate |
| `AHolder med auth SE EM PHY.pdf` | Provider-specific authorization |
| `AHolder med auth.pdf` | General medical authorization |
| `AHolder non soli.pdf` | Client authority / non-solicitation |
| `Aesha Holder BI release.pdf` | BI / settlement release |
| `Aesha Holder Demand updated 9.23.19.doc` | Updated demand source |
| `Aesha Holder Demand updated 9.23.19.pdf` | Updated demand PDF |
| `Aesha Holder Demand.doc` | Initial demand source |
| `Aesha Holder Demand.pdf` | Initial demand PDF |
| `Aesha Holder Itemized stmt.pdf` | West Louisville bill/itemization |
| `Aesha Holder KAC documents Travelers.pdf` | KAC / Travelers PIP documents |
| `Aesha Holder Medical Records.pdf` | West Louisville medical records |
| `Aesha Holder Norton new pt evaluation.pdf` | Norton Leatherman records |
| `Aesha Holder note for 08 08 19.pdf` | West Louisville treatment note |
| `Aesha Holder signed release.pdf` | BI / settlement release |
| `Aesha Holder update itemized stat for dos 08 08 19.pdf` | West Louisville updated itemization |
| `Aluvalife RX bill.pdf` | Aluvalife bill |
| `Aluvalife Rx LOP.pdf` | Aluvalife lien / LOP |
| `Aluvalife Rx Request (1).doc` | Aluvalife request duplicate |
| `Aluvalife Rx Request.doc` | Aluvalife request |
| `Ambers-Redacted.mp4` | Accident investigation video |
| `BI LOR.doc` | Progressive BI LOR source |
| `BI LOR.pdf` | Progressive BI LOR PDF |
| `BLANKINC.doc` | State Farm correspondence template/output |
| `BLANKINC_v2.doc` | KAC / Travelers correspondence template/output |
| `BLANKINS.doc` | Progressive correspondence template/output |
| `Barrister Capital loan agreement 10.10.19.pdf` | Litigation funding / lien |
| `Barrister loan agreement.pdf` | Litigation funding / lien |
| `Billing Summary 10.11.19.xls` | Medical billing / PIP ledger |
| `Billing Summary 10.29.19.xls` | Medical billing / PIP ledger |
| `Billing Summary 11.11.19.xls` | Medical billing / PIP ledger |
| `Billing Summary 9.23.19.xls` | Medical billing / PIP ledger |
| `Billing Summary 9.5.19.xls` | Medical billing / PIP ledger |
| `CLIENTCN.doc` | Client communication |
| `Completed PIP app.pdf` | Completed KAC / PIP application |
| `Conduent letter 1.16.20.pdf` | Conduent lien correspondence |
| `Conduent letter 3.15.21.pdf` | Conduent lien correspondence |
| `Conduent lien request 12.28.19.doc` | Conduent final lien request source |
| `Conduent lien request 12.28.19.pdf` | Conduent final lien request PDF |
| `Conduent lien with ledger.pdf` | Conduent lien ledger |
| `Contract.pdf` | Signed fee agreement |
| `EXPROCS.doc` | Client process letter |
| `First Lien Letter.pdf` | Conduent first lien letter |
| `Foundation Radiology Request.doc` | Foundation Radiology request source |
| `Foundation Radiology Request.pdf` | Foundation Radiology request PDF |
| `Foundation Radiology bill.pdf` | Foundation Radiology bill |
| `Holder, Aesha (Aesha Holder MVA 5_4_19)_activity_log_1.pdf` | Legacy activity export |
| `Holder, Aesha (Aesha Holder MVA 5_4_19)_activity_log_2.pdf` | Legacy activity export |
| `Holder, Aesha (Aesha Holder MVA 5_4_19)_activity_log_3.pdf` | Legacy activity export |
| `Holder, Aesha (Aesha Holder MVA 5_4_19)_contacts.pdf` | Legacy contacts export |
| `Holder, Aesha (Aesha Holder MVA 5_4_19)_emails.pdf` | Legacy email export |
| `INSREP1.doc` | Progressive BI LOR variant |
| `INSREPCL1.doc` | State Farm correspondence variant with data-quality warning |
| `INVOICE.pdf` | Expense / invoice |
| `Itemization.pdf` | Medical itemization |
| `Jewish ER bill.pdf` | Jewish Hospital bill |
| `Jewish Hospital Billing Request.doc` | Jewish billing request |
| `Jewish Hospital Request.doc` | Jewish records request source |
| `Jewish Hospital Request.pdf` | Jewish records request PDF |
| `Jewish records pt1.pdf` | Jewish records |
| `Jewish records pt2.pdf` | Jewish records |
| `KAC Exhaust ltr.pdf` | KAC / PIP exhaustion letter |
| `KAC ack letter with supporting docs.pdf` | KAC acknowledgment |
| `KACPDOCS.pdf` | KAC PIP documents |
| `KORT Request.doc` | KORT request |
| `KY72348406.pdf` | Police collision report |
| `LawsuitExpenseSummary.pdf` | Case expense summary |
| `Leatherman Request w auth.pdf` | Norton Leatherman request with auth |
| `Leatherman Request.doc` | Norton Leatherman request source |
| `Leatherman Request.pdf` | Norton Leatherman request PDF |
| `LoR to KAC.doc` | KAC letter of representation |
| `Ltr from LMPD RE ORR.pdf` | LMPD open-records response |
| `Lumbar MRI.pdf` | Foundation Radiology / imaging |
| `MEtro Pain records.pdf` | Metro Pain records |
| `Med Auth Kentucky One Health.pdf` | KentuckyOne authorization |
| `Med Auth Physicians in Emergency Medicine.pdf` | Emergency physicians authorization |
| `MedAuth - Conduent.pdf` | Conduent authorization |
| `Metro Bill.pdf` | Metro Pain bill |
| `North Dixie Request.doc` | North Dixie request source |
| `North Dixie Request.pdf` | North Dixie request PDF |
| `North Dixie records and bill.pdf` | North Dixie records and bill |
| `Norton Leatherman records.pdf` | Norton Leatherman records |
| `Norton Physician Services Bill DOS 8.13.19.pdf` | Norton Physician Services bill |
| `Norton Priors.pdf` | Norton prior records |
| `Offer letter.pdf` | Offer / negotiation correspondence |
| `PROTECT1.doc` | Provider protection letter |
| `Physicians in Emergency Medicine bill DOS 5.4.19 and 8.28.19.pdf` | Emergency physicians bill |
| `Physicians in Emergency Medicine bill unrelated.pdf` | Emergency physicians unrelated bill |
| `REQMED Physicians in Emergency Medicine.doc` | Emergency physicians request |
| `REQMED kentucky One Health.doc` | KentuckyOne request |
| `REQMED1.doc` | Generic request variant |
| `REQMED1_v2.doc` | Generic request variant |
| `REQMED1_v3.doc` | Generic request variant |
| `RETAINTX.doc` | Client retention/opening letter |
| `Redacted 510 Village West Dr. Phone. P19175965.wav` | Accident investigation audio |
| `SETTLEMENT.doc` | Settlement / distribution source |
| `STate Farm denial letter.pdf` | State Farm denial |
| `State Farm LOR.doc` | State Farm LOR source |
| `State Farm LOR.pdf` | State Farm LOR PDF |
| `State Farm denial.pdf` | State Farm denial |
| `asdf.jpg` | Image, relevance unknown |
