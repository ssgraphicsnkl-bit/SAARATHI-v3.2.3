# SAARATHI 3.2.3 — Stability build (not verified on Windows hardware)

- Remains based on v3.1.3 app code path + v2.2.6 white splash; keeps bulk import, UI/date filters and SAARATHI dialogs.
- Permission now preserves Present status and is counted as a separate annotation; legacy Permission data remains readable and reportable.
- Attendance history adds custom From/To date range and provisional payroll estimate when monthly salary/payable-day inputs are explicitly set by owner.
- Fixes package version to 3.2.3.
- Restore rollback on SQLite/local save failure; bulk import rolls back sequence on failure.
- Regression tests executed in GitHub Actions before installer build.

IMPORTANT: A Windows installation/restart and SQLite round-trip must be verified by the user after building. This is not a completed production audit.
