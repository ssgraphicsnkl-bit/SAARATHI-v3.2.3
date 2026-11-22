# SAARATHI v3.2.3 — Stability

Windows Build: upload all extracted files (including `.github/workflows/windows.yml` and `assets`), Actions > Build SAARATHI Windows EXE > Run workflow. First export a JSON backup from your existing app and keep a copy outside the installed app folder.

- No cloud connectivity has been added. SQLite remains primary; local SQLite + Images recovery and JSON export are retained.
- Attendance Permission = Present + separately recorded permission hours/time. Previously stored `Permission` records are still counted as present (legacy).
- Staff Attendance > History > Custom Range for From/To filtering without Apply button.
- Staff Edit can set monthly salary and payable days, but the Payroll Estimate is **provisional**, not an approved payroll transaction or a payroll liability. It only counts explicitly recorded paid-day units. It does not infer missing days as absent; holidays, paid leave, advances, overtime and statutory deductions remain manual.
- Backup Restore is destructive after explicit confirmation; protect source data with a separate JSON and SQLite backup.
- Verify on Windows: installer starts; login works; all old bills visible; create a test transaction; app restart; Bulk CSV/XLSX; Attendance permission; backup restore on a COPY of data only.

Caveat: This environment cannot run/install the Windows NSIS executable. Tests verify code paths but cannot guarantee Windows runtime compatibility.
