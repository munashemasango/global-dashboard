"""Fetch World Bank WDI data and build the dashboard's static JSON dataset."""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import pycountry
import requests
from jsonschema import ValidationError, validate
from requests import Response

START_YEAR = 2000
END_YEAR = 2025
BASE_URL = "https://api.worldbank.org/v2"
PIPELINE_DIR = Path(__file__).parent
DEFAULT_OUTPUT = PIPELINE_DIR.parent / "public" / "data" / "global_vitality_data.json"
SCHEMA_PATH = PIPELINE_DIR / "global_vitality.schema.json"
PER_PAGE = 20_000
MAX_RETRIES = 4
REQUEST_TIMEOUT = (10, 60)

INDICATORS: dict[str, dict[str, str]] = {
    "gdpPerCapitaPpp": {
        "code": "NY.GDP.PCAP.PP.CD",
        "name": "GDP per capita, PPP (current international $)",
        "pillar": "economic",
        "direction": "higher",
        "unit": "current international $",
    },
    "unemployment": {
        "code": "SL.UEM.TOTL.ZS",
        "name": "Unemployment, total (% of total labor force)",
        "pillar": "economic",
        "direction": "lower",
        "unit": "%",
    },
    "lifeExpectancy": {
        "code": "SP.DYN.LE00.IN",
        "name": "Life expectancy at birth, total (years)",
        "pillar": "humanDevelopment",
        "direction": "higher",
        "unit": "years",
    },
    "literacyRate": {
        "code": "SE.ADT.LITR.ZS",
        "name": "Literacy rate, adult total (% of people ages 15 and above)",
        "pillar": "humanDevelopment",
        "direction": "higher",
        "unit": "%",
    },
    "electricityAccess": {
        "code": "EG.ELC.ACCS.ZS",
        "name": "Access to electricity (% of population)",
        "pillar": "infrastructure",
        "direction": "higher",
        "unit": "%",
    },
    "internetUsers": {
        "code": "IT.NET.USER.ZS",
        "name": "Individuals using the Internet (% of population)",
        "pillar": "infrastructure",
        "direction": "higher",
        "unit": "%",
    },
    "forestArea": {
        "code": "AG.LND.FRST.ZS",
        "name": "Forest area (% of land area)",
        "pillar": "environment",
        "direction": "higher",
        "unit": "%",
    },
    "co2PerCapita": {
        "code": "EN.GHG.CO2.PC.CE.AR5",
        "name": "Carbon dioxide emissions excluding LULUCF per capita (t CO2e/capita)",
        "pillar": "environment",
        "direction": "lower",
        "unit": "t CO2e per capita",
    },
}

PILLARS = {
    "economic": ["gdpPerCapitaPpp", "unemployment"],
    "humanDevelopment": ["lifeExpectancy", "literacyRate"],
    "infrastructure": ["electricityAccess", "internetUsers"],
    "environment": ["forestArea", "co2PerCapita"],
}

LOGGER = logging.getLogger("global_vitality_etl")


class WorldBankApiError(RuntimeError):
    """Raised when the World Bank API returns an invalid or unsuccessful response."""


def fetch_json(
    session: requests.Session,
    url: str,
    params: dict[str, str | int],
) -> Any:
    """Request JSON with bounded retries for transient API/network failures."""
    for attempt in range(MAX_RETRIES):
        try:
            response: Response = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == MAX_RETRIES - 1:
                    response.raise_for_status()
                wait = min(2**attempt, 16)
                LOGGER.warning(
                    "World Bank API returned HTTP %s; retrying in %s seconds",
                    response.status_code,
                    wait,
                )
                time.sleep(wait)
                continue
            response.raise_for_status()
            try:
                payload = response.json()
            except requests.exceptions.JSONDecodeError as exc:
                raise WorldBankApiError(f"World Bank API returned invalid JSON for {url}") from exc
            if isinstance(payload, list) and payload and isinstance(payload[0], dict):
                if "message" in payload[0]:
                    message = payload[0]["message"]
                    raise WorldBankApiError(f"World Bank API error: {message}")
            return payload
        except requests.RequestException:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = min(2**attempt, 16)
            LOGGER.warning("World Bank API request failed; retrying in %s seconds", wait)
            time.sleep(wait)
    raise WorldBankApiError(f"World Bank API request exhausted retries: {url}")


def fetch_countries(session: requests.Session) -> dict[str, dict[str, Any]]:
    """Fetch country metadata and exclude World Bank regional aggregates."""
    payload = fetch_json(
        session,
        f"{BASE_URL}/country",
        {"format": "json", "per_page": 400},
    )
    if not isinstance(payload, list) or len(payload) < 2 or not isinstance(payload[1], list):
        raise WorldBankApiError("Country metadata response had an unexpected shape")

    countries: dict[str, dict[str, Any]] = {}
    for item in payload[1]:
        if not isinstance(item, dict):
            continue
        iso3 = item.get("id")
        region = item.get("region", {})
        if not iso3 or region.get("id") == "NA":
            continue

        numeric_code = None
        try:
            country = pycountry.countries.get(alpha_3=iso3)
            if country:
                numeric_code = str(country.numeric)
        except (KeyError, TypeError):
            LOGGER.debug("No ISO numeric code found for %s", iso3)

        countries[iso3] = {
            "id": iso3,
            "numericId": numeric_code,
            "name": item.get("name", iso3),
            "region": region.get("value"),
            "incomeLevel": item.get("incomeLevel", {}).get("value"),
            "capitalCity": item.get("capitalCity"),
        }
    if not countries:
        raise WorldBankApiError("Country metadata response contained no countries")
    return countries


def fetch_indicator(
    session: requests.Session,
    indicator_code: str,
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
) -> pd.DataFrame:
    """Fetch every page of one indicator for all countries and requested years."""
    url = f"{BASE_URL}/country/all/indicator/{indicator_code}"
    params: dict[str, str | int] = {
        "date": f"{start_year}:{end_year}",
        "format": "json",
        "per_page": PER_PAGE,
        "page": 1,
    }
    first = fetch_json(session, url, params)
    if not isinstance(first, list) or len(first) < 2 or not isinstance(first[0], dict):
        raise WorldBankApiError(f"Unexpected response for indicator {indicator_code}")

    metadata = first[0]
    pages = int(metadata.get("pages", 1))
    entries: list[dict[str, Any]] = list(first[1] or [])
    for page in range(2, pages + 1):
        params["page"] = page
        payload = fetch_json(session, url, params)
        if not isinstance(payload, list) or len(payload) < 2 or not isinstance(payload[1], list):
            raise WorldBankApiError(
                f"Unexpected page {page} response for indicator {indicator_code}"
            )
        entries.extend(payload[1])

    rows = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        iso3 = entry.get("countryiso3code")
        try:
            year = int(entry["date"])
        except (KeyError, TypeError, ValueError):
            continue
        if iso3 and start_year <= year <= end_year:
            rows.append({"id": iso3, "year": year, "value": entry.get("value")})
    return pd.DataFrame(rows, columns=["id", "year", "value"])


def clean_indicator(
    frame: pd.DataFrame,
    country_ids: list[str],
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Create a complete country/year grid and impute gaps without hiding provenance."""
    years = list(range(start_year, end_year + 1))
    index = pd.MultiIndex.from_product([country_ids, years], names=["id", "year"])
    if frame.empty:
        values = pd.DataFrame(index=index, columns=["value"], dtype=float)
    else:
        normalized = frame.copy()
        normalized["value"] = pd.to_numeric(normalized["value"], errors="coerce")
        values = (
            normalized.drop_duplicates(["id", "year"], keep="last")
            .set_index(["id", "year"])[["value"]]
            .reindex(index)
        )
    observed = values["value"].notna()
    cleaned = values.groupby(level="id", sort=False)["value"].transform(
        lambda series: series.interpolate(method="linear", limit_area="inside").ffill()
    )
    # No leading back-fill: a country with no historical baseline remains unscored.
    imputed = (~observed) & cleaned.notna()
    return cleaned.astype(float).to_frame("value"), imputed.to_frame("imputed")


def min_max_scale(values: pd.Series, higher_is_better: bool = True) -> pd.Series:
    """Scale one year's country observations to 0-100, respecting indicator direction."""
    numeric = pd.to_numeric(values, errors="coerce")
    result = pd.Series(float("nan"), index=numeric.index, dtype=float)
    valid = numeric.dropna()
    if valid.empty:
        return result
    low, high = float(valid.min()), float(valid.max())
    if math.isclose(low, high):
        result.loc[valid.index] = 50.0
    else:
        scaled = (valid - low) / (high - low) * 100
        result.loc[valid.index] = scaled if higher_is_better else 100 - scaled
    return result


def indicator_provenance(
    frame: pd.DataFrame,
    cleaned: pd.DataFrame,
    country_ids: list[str],
    start_year: int,
    end_year: int,
) -> pd.DataFrame:
    """Describe whether each value is observed, interpolated, carried, or missing."""
    index = pd.MultiIndex.from_product(
        [country_ids, range(start_year, end_year + 1)],
        names=["id", "year"],
    )
    if frame.empty:
        raw_values = pd.Series(float("nan"), index=index, dtype=float)
    else:
        normalized = frame.copy()
        normalized["value"] = pd.to_numeric(normalized["value"], errors="coerce")
        raw_values = (
            normalized.drop_duplicates(["id", "year"], keep="last")
            .set_index(["id", "year"])["value"]
            .reindex(index)
        )

    statuses: list[str] = []
    source_years: list[list[int]] = []
    for country_id in country_ids:
        observed_years = sorted(
            int(year)
            for year, value in raw_values.loc[country_id].items()
            if pd.notna(value)
        )
        for year in range(start_year, end_year + 1):
            value = raw_values.at[(country_id, year)]
            if pd.notna(value):
                statuses.append("observed")
                source_years.append([year])
            elif pd.isna(cleaned.at[(country_id, year), "value"]):
                statuses.append("missing")
                source_years.append([])
            else:
                previous = [observed for observed in observed_years if observed < year]
                following = [observed for observed in observed_years if observed > year]
                if previous and following:
                    statuses.append("interpolated")
                    source_years.append([previous[-1], following[0]])
                elif previous:
                    statuses.append("forwardFilled")
                    source_years.append([previous[-1]])
                else:
                    statuses.append("missing")
                    source_years.append([])
    return pd.DataFrame(
        {"status": statuses, "sourceYears": source_years},
        index=index,
    )


def rounded(value: Any, digits: int = 2) -> float | None:
    """Serialize finite numbers as plain floats and missing values as JSON null."""
    if value is None or pd.isna(value):
        return None
    number = float(value)
    return round(number, digits) if math.isfinite(number) else None


def build_dataset(
    countries: dict[str, dict[str, Any]],
    raw_indicators: dict[str, pd.DataFrame],
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
) -> dict[str, Any]:
    """Clean observations, calculate annual indicator/pillar scores, and shape JSON."""
    country_ids = sorted(countries)
    years = list(range(start_year, end_year + 1))
    cleaned: dict[str, pd.DataFrame] = {}
    imputed: dict[str, pd.DataFrame] = {}
    provenance: dict[str, pd.DataFrame] = {}
    scores: dict[str, pd.Series] = {}

    for key, specification in INDICATORS.items():
        raw_frame = raw_indicators.get(key, pd.DataFrame(columns=["id", "year", "value"]))
        values, flags = clean_indicator(
            raw_frame,
            country_ids,
            start_year,
            end_year,
        )
        cleaned[key] = values
        imputed[key] = flags
        provenance[key] = indicator_provenance(
            raw_frame,
            values,
            country_ids,
            start_year,
            end_year,
        )
        higher_is_better = specification["direction"] == "higher"
        score_series = pd.Series(float("nan"), index=values.index, dtype=float)
        for year in years:
            year_index = values.index.get_level_values("year") == year
            score_series.loc[year_index] = min_max_scale(
                values.loc[year_index, "value"], higher_is_better
            )
        scores[key] = score_series

    pillar_scores: dict[str, pd.Series] = {}
    for pillar, indicator_keys in PILLARS.items():
        matrix = pd.concat([scores[key].rename(key) for key in indicator_keys], axis=1)
        pillar_scores[pillar] = matrix.mean(axis=1, skipna=True).where(matrix.notna().any(axis=1))

    all_pillars = pd.concat(
        [pillar_scores[key].rename(key) for key in PILLARS],
        axis=1,
    )
    nvs = all_pillars.mean(axis=1, skipna=True).where(all_pillars.notna().any(axis=1))

    output_countries = []
    for iso3, metadata in countries.items():
        years_payload: dict[str, Any] = {}
        for year in years:
            index = (iso3, year)
            raw = {
                key: rounded(cleaned[key].at[index, "value"])
                for key in INDICATORS
            }
            imputed_keys = [
                key for key in INDICATORS if bool(imputed[key].at[index, "imputed"])
            ]
            statuses = {
                key: provenance[key].at[index, "status"] for key in INDICATORS
            }
            source_years = {
                key: provenance[key].at[index, "sourceYears"] for key in INDICATORS
            }
            pillar_values = {
                pillar: rounded(series.at[index]) for pillar, series in pillar_scores.items()
            }
            connectivity_score = rounded(scores["internetUsers"].at[index])
            all_scores = {
                **pillar_values,
                "connectivity": connectivity_score,
                "nvs": rounded(nvs.at[index]),
            }
            years_payload[str(year)] = {
                "values": raw,
                "imputed": imputed_keys,
                "status": statuses,
                "sourceYears": source_years,
                "scores": all_scores,
                "completeness": {
                    "indicators": sum(value is not None for value in raw.values()),
                    "indicatorCoverage": rounded(
                        sum(value is not None for value in raw.values())
                        / len(INDICATORS)
                        * 100
                    ),
                    "pillars": sum(value is not None for value in pillar_values.values()),
                    "nvs": rounded(all_pillars.loc[index].notna().sum() / len(PILLARS) * 100),
                },
            }
        output_countries.append({**metadata, "years": years_payload})

    return {
        "metadata": {
            "title": "Global National Vitality Dashboard",
            "schemaVersion": "1.0.0",
            "source": "World Bank World Development Indicators API",
            "sourceUrl": "https://api.worldbank.org/v2/",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "startYear": start_year,
            "endYear": end_year,
            "normalization": "Min-max across countries independently for each indicator and year.",
            "missingData": (
                "Interior gaps are linearly interpolated; trailing gaps are forward-filled. "
                "Leading gaps and indicators with no observations remain null. Imputed keys "
                "are listed in each country-year record."
            ),
            "scoring": (
                "Four pillars have equal weight in NVS; indicators have equal weight within "
                "their pillar. Unemployment and CO2 are lower-is-better. NVS is the mean of "
                "available pillar scores and completeness reports pillar coverage."
            ),
            "indicators": {
                key: {
                    "code": specification["code"],
                    "name": specification["name"],
                    "pillar": specification["pillar"],
                    "direction": specification["direction"],
                    "unit": specification["unit"],
                }
                for key, specification in INDICATORS.items()
            },
            "pillarLabels": {
                "economic": "Economic Prosperity Index",
                "humanDevelopment": "Human Development Index",
                "infrastructure": "Infrastructure Readiness Index",
                "environment": "Environmental Sustainability Index",
                "connectivity": "Connectivity & Technology Index",
                "nvs": "National Vitality Score",
            },
            "countryCount": len(output_countries),
        },
        "countries": output_countries,
    }


def run_etl(
    output: Path = DEFAULT_OUTPUT,
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
) -> Path:
    """Fetch WDI data for the requested period and atomically write the output file."""
    if start_year < 1 or end_year > 9999 or start_year > end_year:
        raise ValueError("Year range must satisfy 1 <= start year <= end year <= 9999")

    session = requests.Session()
    session.headers.update(
        {"User-Agent": "GlobalVitalityDashboard/1.0 (World Bank WDI public-data ETL)"}
    )
    countries = fetch_countries(session)
    raw_indicators = {}
    for key, specification in INDICATORS.items():
        LOGGER.info("Fetching %s (%s)", key, specification["code"])
        raw_indicators[key] = fetch_indicator(
            session,
            specification["code"],
            start_year,
            end_year,
        )
    dataset = build_dataset(countries, raw_indicators, start_year, end_year)
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validate(instance=dataset, schema=schema)

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    try:
        temporary.write_text(
            json.dumps(dataset, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
            encoding="utf-8",
        )
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()
    LOGGER.info("Wrote %s countries to %s", len(countries), output)
    return output


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output JSON path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--start-year",
        type=int,
        default=START_YEAR,
        help=f"First observation year (default: {START_YEAR})",
    )
    parser.add_argument(
        "--end-year",
        type=int,
        default=END_YEAR,
        help=f"Last observation year, for example 2026 when published (default: {END_YEAR})",
    )
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    try:
        run_etl(args.output, args.start_year, args.end_year)
    except (WorldBankApiError, requests.RequestException, OSError, ValidationError) as exc:
        LOGGER.error("ETL failed: %s", exc)
        return 1
    except ValueError as exc:
        LOGGER.error("Invalid ETL configuration: %s", exc)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
