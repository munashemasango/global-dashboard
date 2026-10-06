# Global Vitality Terminal

An interactive country-level dashboard for exploring national vitality indicators from the World Bank's World Development Indicators (WDI). Built with React, TypeScript, Vite, Tailwind CSS, D3 geographic projections, and Recharts; the Python ETL creates a static JSON dataset for the browser.

> This is an exploratory proxy index, not an official World Bank or UN measure. See [Methodology and limitations](#methodology-and-limitations) before interpreting scores.

## What it does

- Maps country scores for 2000–2025, with index layers for NVS, EPI, HDI, IRI, ESI, and Connectivity & Technology.
- Opens a selected country's profile with pillar radar, historical trend, source indicators, and observation/imputation coverage.
- Offers a year scrubber, playback, and side-by-side year comparison.
- Uses a packaged Natural Earth country-boundary dataset; a map tile service or API key is not required.
- Builds to a static frontend. The browser reads a generated JSON file and does not query the WDI API at runtime.

## Requirements

- Node.js 20 or later and npm
- Python 3.10 or later
- Internet access for the initial WDI data download

## Quick start: Windows PowerShell

Run these commands from the project root. Generating the dataset is required for real country scores; the dashboard otherwise displays a helpful data-missing message.

```powershell
# Create a Python environment and install the ETL dependencies
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# Download WDI data, transform it, validate it against the JSON Schema
.\.venv\Scripts\python.exe -m pipeline.etl

# Install frontend dependencies and make a production build
npm.cmd install
npm.cmd run build

# Serve the production build on this computer
npm.cmd run start:local
```

Open **http://127.0.0.1:4173** in a browser. Keep the terminal open while using the app; press **Ctrl+C** to stop the server. The server binds only to the local machine and uses strict port selection. If port 4173 is already in use, stop the other process or use `npm.cmd run preview -- --host 127.0.0.1 --port 4174 --strictPort`.

On Windows, use `npm.cmd` if PowerShell blocks the `npm.ps1` script due to its execution policy.

## Quick start: macOS and Linux

```bash
# Create a Python environment and install the ETL dependencies
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt

# Download and validate the dataset
.venv/bin/python -m pipeline.etl

# Install frontend dependencies, build, and launch the production app
npm install
npm run build
npm run start:local
```

Open **http://127.0.0.1:4173**. Keep the terminal open while using the app; stop the server with **Ctrl+C**.

## Development mode

After generating the dataset and installing frontend dependencies as above:

```bash
npm run dev
```

Open the local URL printed by Vite (normally **http://localhost:5173**). Development mode provides hot reload; `npm run start:local` serves the optimized production build.

## Data pipeline

The ETL fetches eight WDI indicators for all available countries and territories and writes:

```text
public/data/global_vitality_data.json
```

The output is intentionally excluded from Git because it is generated and can be several megabytes. Every checkout that needs data must run the ETL before building. The ETL retries transient request failures, checks the generated data against the committed schema, and writes the output atomically after validation succeeds.

The usual command generates 2000–2025. To choose a different output path or year range:

```bash
python -m pipeline.etl --output ./my-data/global_vitality_data.json --start-year 2000 --end-year 2025
```

Use the environment's Python executable (`.\.venv\Scripts\python.exe` in PowerShell or `.venv/bin/python` on macOS/Linux) instead of `python` if the environment is not activated.

### Add a future year

To add 2026, first confirm that the WDI series have published usable 2026 observations; release timing varies by indicator. Then refresh the full range so annual normalization uses the same extract:

```bash
python -m pipeline.etl --start-year 2000 --end-year 2026
npm run build
```

The timeline reads its year limits from the dataset metadata. Review country profile coverage and `CARRY`/`INT` markers: scores may use carried-forward or interpolated observations when a new annual value is not yet available. See [docs/LOCAL_DATA_WORKFLOW.md](./docs/LOCAL_DATA_WORKFLOW.md) for backup, review, rollback, and production refresh steps.

### Dataset contract

- [pipeline/global_vitality.schema.json](./pipeline/global_vitality.schema.json) — versioned JSON Schema (`1.0.0`) validated by the ETL.
- [src/types.ts](./src/types.ts) — TypeScript types for the browser's data contract.
- [pipeline/etl.py](./pipeline/etl.py) — WDI fetching, transformation, scoring, provenance, and export.

Treat schema changes as coordinated changes: bump the schema version for breaking changes, update the schema and TypeScript types, and update the UI and tests that consume changed fields.

## Tests and production build

Run the network-free ETL tests:

```bash
python -m unittest pipeline.test_etl
```

Build and run the static production version:

```bash
npm run build
npm run start:local
```

The build output is in `dist/`. For deployment, run the ETL and build first, then publish `dist/` to a static host configured to serve the application from the site root and provide an SPA fallback. The local preview server is for local use, not a public production web server.

## Methodology and limitations

| Index | Inputs |
| --- | --- |
| Economic Prosperity (EPI) | GDP per capita, PPP (`NY.GDP.PCAP.PP.CD`); unemployment (`SL.UEM.TOTL.ZS`) |
| Human Development (HDI) | Life expectancy (`SP.DYN.LE00.IN`); adult literacy (`SE.ADT.LITR.ZS`) |
| Infrastructure Readiness (IRI) | Electricity access (`EG.ELC.ACCS.ZS`); internet use (`IT.NET.USER.ZS`) |
| Environmental Sustainability (ESI) | Forest area (`AG.LND.FRST.ZS`); CO₂-equivalent per capita (`EN.GHG.CO2.PC.CE.AR5`) |

Each indicator is min-max scaled across available countries **within each year** to 0–100. A constant-valued year is assigned 50. Indicators are equally weighted within a pillar; the four available pillar scores are equally weighted in NVS. Higher unemployment and CO₂ are treated as worse. Connectivity & Technology is a separate internet-use map layer, not a fifth NVS pillar.

Interior gaps are linearly interpolated; trailing gaps are carried forward. Leading gaps and indicators with no observations stay missing. The dataset includes observation status and source years; country profiles show carry/interpolation labels and coverage. A score may therefore exist even if one or more source values are missing or imputed.

Interpret the results with care:

- Scores compare countries against the countries available **in that same year**. They are not an absolute measure of progress over time.
- GDP per capita uses current PPP dollars, so inflation, methodology changes, and revisions affect the time series.
- Forest-area share is a limited environmental proxy; it does not measure biodiversity or ecosystem quality.
- WDI completeness varies across countries, indicators, and years.
- The requested electricity code `EG.ELC.AC.ZS` is not valid in the WDI API; the ETL uses `EG.ELC.ACCS.ZS` for access to electricity.
- The requested `EN.ATM.CO2E.PC` series is archived in WDI. The ETL uses maintained series `EN.GHG.CO2.PC.CE.AR5` (CO₂-equivalent per capita, excluding LULUCF), which is not identical to the archived measure.
- The packaged 1:50m Natural Earth map matches 213 of the 217 WDI records. Channel Islands, Gibraltar, Tuvalu, and Kosovo have no matching feature in this boundary dataset.

## Project structure

```text
.
├── docs/
│   └── LOCAL_DATA_WORKFLOW.md
├── pipeline/
│   ├── etl.py
│   ├── global_vitality.schema.json
│   └── test_etl.py
├── public/
│   └── data/                         # Generated dataset is git-ignored
├── src/
│   ├── components/
│   ├── lib/
│   ├── App.tsx
│   ├── main.tsx
│   └── types.ts
├── package.json
└── requirements.txt
```

## Troubleshooting

- **No country data:** Run `python -m pipeline.etl`, then rebuild with `npm run build`.
- **WDI/API request fails:** Check internet access and retry. The source is the public [World Bank Indicators API](https://api.worldbank.org/v2/).
- **Port 4173 is busy:** Stop the other local preview, or launch `npm run preview -- --host 127.0.0.1 --port 4174 --strictPort` after building.
- **Python package/import errors:** Confirm dependencies were installed using the same Python environment used to run `pipeline.etl`.
- **Browser shows old data after a refresh:** Re-run the production build and reload the page; the build copies the JSON from `public/data/` into `dist/data/`.
