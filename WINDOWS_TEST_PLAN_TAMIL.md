# SAARATHI v3.2.3 — Windows Installation Acceptance Checklist

**Before installation:** Open the last working app; take Download Full JSON Backup and SQLite Backup; keep copies outside SAARATHI's installation and user-data folders. Do not uninstall the existing app and do not delete AppData.

## Must pass on Windows before daily production use

1. Installer completes and SAARATHI opens with no missing-module popup.
2. White v2.2.6 horse/chariot intro appears (about 2.8 seconds), app opens normally.
3. Existing owner account PIN can log in; existing company, products and invoices show unchanged.
4. Save and reopen app — prior invoices and stock remain identical.
5. Create a small TEST invoice, close, reopen, and verify invoice number, customer, payment, stock.
6. Bulk Import: test a small CSV and XLSX; inspect Preview; Confirm and verify item count; do not import duplicates.
7. Staff Attendance: Present, Half Day AM/PM, Permission 14:00–16:00 (2 hr); verify Present + Permission in History.
8. Staff Attendance History: filter one staff, Today/Week/Month/All/Custom dates; check CSV export matches filtered records.
9. Edit Staff: optional Monthly Salary and Payable Days; verify payroll preview is labelled provisional and does not alter accounting or invoices.
10. Verify Save prompts use SAARATHI-themed popups; Cancel must not delete or overwrite data.
11. JSON Export: download and verify a nonempty JSON file; Native SQLite Backup: check backup path and Images folder.
12. Restore test: perform on a **separate copied profile/device** only; do not restore over live production data for this smoke test.
13. Windows app close/restart twice; verify no new crash and no lost records.

## Known boundaries
- GitHub Actions green build confirms compilation/packaging, not all app runtime behavior.
- No cloud sync/backup included in this version.
- Payroll Preview is not finalized payslip or automatic legal deduction calculator.
- Browser HTML preview uses localStorage, whereas Windows installer uses SQLite; data may differ.
- Do not remove the existing v3.1.3 installer or backups until all checks pass.
