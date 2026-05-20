# References

Primary FirmVault sources:

- `skills.tools.workflows/workflows/phase_1_file_setup/workflows/medical_provider_setup/workflow.md`
- `skills.tools.workflows/DATA_CONTRACT.md`
- `docs/law-firm-native-case-operating-record.md`

Important v1 scope decision:

- The original workflow auto-sent records requests for completed providers.
- Mission Control v1 separates provider setup from records/bills request workflows.
- This recipe creates the provider case state that later provider-scoped records/bills workflows depend on.
