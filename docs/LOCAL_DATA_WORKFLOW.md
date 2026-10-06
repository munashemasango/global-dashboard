# Local production and data refresh workflow

## Start the production dashboard

Use PowerShell from the project root. The production command serves the static `dist/` build on loopback only; it is not exposed to the local network.

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run start:local
```

Open **http://127.0.0.1:4173** in a local browser. Keep the PowerShell window running while using the dashboard; press **Ctrl+C** to stop it. `start:local` uses port 4173 with strict port selection. If it reports that the port is already in use, stop the existing preview process or use the documented generic preview command with a different explicit local port.

If the generated dataset does not exist yet, prepare the ETL environment, fetch data, and rebuild before starting the production preview:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pipeline.etl
npm.cmd run build
npm.cmd run start:local
```

The browser loads the JSON and packaged country boundaries from the same local Vite production server. Normal dashboard use does not call the WDI API.

## Data/schema layout

- `pipeline/etl.py` — WDI fetch, cleaning, scoring, schema validation, and atomic JSON output.
- `pipeline/global_vitality.schema.json` — versioned JSON Schema contract for the exported data.
- `pipeline/test_etl.py` — network-free checks, including an explicit 2026 year-range case.
- `src/types.ts` — matching TypeScript types used by the dashboard.
- `public/data/global_vitality_data.json` — generated data copied into `dist/data/` at build time. It is ignored by Git; the ETL source and schema remain tracked.

Schema-compatible refreshes change only the generated JSON, not the frontend. A breaking field or type change requires a schema version bump and coordinated updates to the Python schema, `src/types.ts`, and dashboard readers.

## Add 2026 after WDI observations are released

The committed ETL default remains 2000–2025. Do not advance the end year just because the calendar has changed: WDI series publish asynchronously, and forward-filling into 2026 before data is published would make an empty future year look observed. Check the World Bank indicator pages/API first; individual indicators may publish at different times.

When ready, refresh the whole requested 2000–2026 range so every year's min-max scores are normalized consistently from the same current WDI extract:

```powershell
Copy-Item public/data/global_vitality_data.json .\pipeline\global_vitality_data.backup.json
.\.venv\Scripts\python.exe -m pipeline.etl --start-year 2000 --end-year 2026
```

The ETL retrieves each configured indicator for the selected range, uses the same schema version, records observed/interpolated/forward-filled/missing provenance, validates the full result against `pipeline/global_vitality.schema.json`, and replaces the output only after the new file validates and is fully written. The additional timeline year is driven by `metadata.endYear`; no frontend code edit should be needed.

Run checks and rebuild the production static site:

```powershell
.\.venv\Scripts\python.exe -m unittest pipeline.test_etl
.\.venv\Scripts\python.exe -m pipeline.etl --start-year 2000 --end-year 2026 --output .\pipeline\candidate_2026.json
```

The candidate command is an optional independent dry-run for a real API refresh; inspect its `metadata.endYear`, country-year coverage, and observation statuses before replacing production data. For a normal refresh, the first ETL command already writes the validated target file.

After the production refresh, verify the schema/range and rebuild:

```powershell
.\.venv\Scripts\python.exe -c "import json; d=json.load(open('public/data/global_vitality_data.json', encoding='utf-8')); assert d['metadata']['schemaVersion'] == '1.0.0'; assert d['metadata']['endYear'] == 2026; assert all('2026' in c['years'] for c in d['countries']); print(len(d['countries']), 'countries; end year', d['metadata']['endYear'])"
npm.cmd run build
npm.cmd run start:local
```

Confirm the browser timeline reaches 2026 and inspect `CARRY`/`INT` labels and coverage in country profiles. Those are important: an NVS value may exist even if a particular 2026 indicator is carried forward from an older observation.

If the refresh is not accepted, restore the saved JSON and rebuild:

```powershell
Copy-Item -Force .\pipeline\global_vitality_data.backup.json public/data/global_vitality_data.json
npm.cmd run build
```

Remove the backup and any candidate files after sign-off; generated datasets and backups can be large, and the generated JSON is intentionally excluded from Git.
