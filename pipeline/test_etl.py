"""Focused, network-free tests for the scoring and missing-data transformations."""

import unittest
import json
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import requests
from jsonschema import validate

from pipeline.etl import (
    INDICATORS,
    build_dataset,
    clean_indicator,
    fetch_indicator,
    indicator_provenance,
    min_max_scale,
    parse_args,
)


class CleanIndicatorTests(unittest.TestCase):
    def test_interpolates_internal_gap_and_forward_fills_trailing_gaps(self):
        frame = pd.DataFrame(
            [
                {"id": "AAA", "year": 2000, "value": 10},
                {"id": "AAA", "year": 2002, "value": 30},
            ]
        )
        values, imputed = clean_indicator(frame, ["AAA"], 2000, 2004)
        self.assertEqual(values.loc[("AAA", 2001), "value"], 20)
        self.assertEqual(values.loc[("AAA", 2004), "value"], 30)
        self.assertTrue(imputed.loc[("AAA", 2001), "imputed"])
        self.assertTrue(imputed.loc[("AAA", 2004), "imputed"])

    def test_leading_gap_stays_missing(self):
        frame = pd.DataFrame([{"id": "AAA", "year": 2002, "value": 30}])
        values, imputed = clean_indicator(frame, ["AAA"], 2000, 2002)
        self.assertTrue(pd.isna(values.loc[("AAA", 2000), "value"]))
        self.assertFalse(imputed.loc[("AAA", 2000), "imputed"])

    def test_provenance_reports_interpolation_and_forward_fill_source_years(self):
        frame = pd.DataFrame(
            [
                {"id": "AAA", "year": 2000, "value": 10},
                {"id": "AAA", "year": 2002, "value": 30},
            ]
        )
        values, _ = clean_indicator(frame, ["AAA"], 2000, 2004)
        provenance = indicator_provenance(frame, values, ["AAA"], 2000, 2004)
        self.assertEqual(provenance.loc[("AAA", 2000), "status"], "observed")
        self.assertEqual(provenance.loc[("AAA", 2001), "status"], "interpolated")
        self.assertEqual(provenance.loc[("AAA", 2001), "sourceYears"], [2000, 2002])
        self.assertEqual(provenance.loc[("AAA", 2004), "status"], "forwardFilled")
        self.assertEqual(provenance.loc[("AAA", 2004), "sourceYears"], [2002])


class ScaleTests(unittest.TestCase):
    def test_scales_and_inverts_lower_is_better_values(self):
        values = pd.Series([0.0, 5.0, 10.0])
        self.assertEqual(min_max_scale(values).tolist(), [0.0, 50.0, 100.0])
        self.assertEqual(
            min_max_scale(values, higher_is_better=False).tolist(),
            [100.0, 50.0, 0.0],
        )

    def test_constant_population_scores_neutrally(self):
        self.assertEqual(min_max_scale(pd.Series([4.0, 4.0])).tolist(), [50.0, 50.0])


class ApiParsingTests(unittest.TestCase):
    def test_uses_country_iso3_field_not_the_iso2_country_id(self):
        payload = [
            {"pages": 1},
            [
                {
                    "country": {"id": "US", "value": "United States"},
                    "countryiso3code": "USA",
                    "date": "2025",
                    "value": 123.0,
                }
            ],
        ]
        with patch("pipeline.etl.fetch_json", return_value=payload):
            result = fetch_indicator(requests.Session(), "NY.GDP.PCAP.PP.CD", 2025, 2025)
        self.assertEqual(result.to_dict("records"), [{"id": "USA", "year": 2025, "value": 123.0}])

    def test_requested_2026_year_is_retained(self):
        payload = [
            {"pages": 1},
            [
                {
                    "country": {"id": "US", "value": "United States"},
                    "countryiso3code": "USA",
                    "date": "2026",
                    "value": 456.0,
                }
            ],
        ]
        with patch("pipeline.etl.fetch_json", return_value=payload):
            result = fetch_indicator(requests.Session(), "NY.GDP.PCAP.PP.CD", 2026, 2026)
        self.assertEqual(result.to_dict("records"), [{"id": "USA", "year": 2026, "value": 456.0}])

    def test_cli_can_request_2026_without_changing_default_year_range(self):
        current = parse_args([])
        future = parse_args(["--start-year", "2000", "--end-year", "2026"])
        self.assertEqual((current.start_year, current.end_year), (2000, 2025))
        self.assertEqual((future.start_year, future.end_year), (2000, 2026))


class DatasetTests(unittest.TestCase):
    def test_builds_nvs_and_connectivity_without_adding_a_fifth_pillar(self):
        countries = {
            "AAA": {
                "id": "AAA",
                "numericId": "001",
                "name": "Alpha",
                "region": "Test",
                "incomeLevel": "Test",
                "capitalCity": "A",
            },
            "BBB": {
                "id": "BBB",
                "numericId": "002",
                "name": "Beta",
                "region": "Test",
                "incomeLevel": "Test",
                "capitalCity": "B",
            },
        }
        raw = {
            key: pd.DataFrame(
                [
                    {"id": "AAA", "year": 2000, "value": 10},
                    {"id": "BBB", "year": 2000, "value": 20},
                ]
            )
            for key in INDICATORS
        }
        data = build_dataset(countries, raw, 2000, 2000)
        alpha = data["countries"][0]["years"]["2000"]
        self.assertIn("connectivity", alpha["scores"])
        self.assertIn("nvs", alpha["scores"])
        self.assertEqual(alpha["completeness"]["pillars"], 4)
        self.assertEqual(alpha["scores"]["connectivity"], 0)
        self.assertEqual(alpha["scores"]["nvs"], 25)
        self.assertEqual(alpha["completeness"]["indicatorCoverage"], 100)
        self.assertEqual(data["metadata"]["countryCount"], 2)
        self.assertEqual(data["metadata"]["schemaVersion"], "1.0.0")
        schema = json.loads((Path(__file__).parent / "global_vitality.schema.json").read_text(encoding="utf-8"))
        validate(instance=data, schema=schema)


if __name__ == "__main__":
    unittest.main()
