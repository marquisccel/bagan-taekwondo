# Private data

`data/private/` holds real tournament data: names, NIK and birth dates of minors. It is
**git-ignored and must never be committed** (ADR-0014, UU PDP).

Golden tests and the draw simulator read the 2026 registration export from this folder. They
verify its SHA-256 against `fixtures/datasets/manifest.json` before use, so a modified or
different file is detected instead of silently producing different results.

| File | Expected SHA-256 | Source |
|---|---|---|
| `DATA_KOLEKTIF_FESTIVAL_PRESTASI - query_kolektif.csv` | `5b7539410cd7663c568113ba3a67d8bbace12fe123bed4a13d7b647254015cce` | Registration export, Piala Gubernur Jatim 2026 (3,154 rows) |
| `facts-2026.json` | regenerated | `python tools/source-analysis/analyze.py --csv <csv> --zip <zip> --out data/private/facts-2026.json` |

If the file is absent, golden tests are skipped with an explicit notice; they never pass silently.
