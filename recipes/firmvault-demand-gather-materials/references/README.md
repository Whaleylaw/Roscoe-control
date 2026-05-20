# Demand Readiness Reference

This recipe is the first Wave 5 demand workflow node. It turns completed records, bills, and chronology work into a demand-readiness ledger.

Expected canonical write target:

- `demand/readiness.md`

Expected evidence sources:

- `medical-providers/<provider>/records-bills.md`
- `medical-providers/<provider>/documents/bills.md`
- `medical-providers/<provider>/documents/records.md`
- `medical-providers/<provider>/chronology.md`
- `insurance/*.md`
- `liens/*.md`
- `accident/*.md`

The output should answer whether the file is ready for a later Draft Demand workflow and, if not, exactly what is blocking it.

Lien facts are internal readiness facts. The readiness summary may identify whether final-lien work has started or should be started, but lien holder names, lien balances, payor issues, and lien uncertainty do not belong in demand-letter content.
