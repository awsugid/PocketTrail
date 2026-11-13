# Financial test fixtures

Only synthetic data belongs here. Actual bank statements, extracted text,
parsed JSON, invoices, account identifiers, and screenshots of private records
must remain in Git-ignored local storage.

Statement-layout fixtures are synthetic and live in `tests/parser.test.ts`.
Local browser acceptance checks must use synthetic organizations and users,
never screenshots of imported real community data.
