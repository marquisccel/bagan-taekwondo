"""Exports the committee-2026 quality baseline (aggregates only, no personal data).

Input:  data/private/facts-2026.json   (produced by analyze.py; contains registration ids, stays private)
Output: fixtures/baselines/committee-2026.json  (committed; aggregate metrics only)

The baseline is a historical QUALITY BENCHMARK, not a definition of correctness
(docs/ACCEPTANCE_CRITERIA.md, ADR-0012).
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FACTS = ROOT / "data" / "private" / "facts-2026.json"
OUT = ROOT / "fixtures" / "baselines" / "committee-2026.json"


def metric(value, direction: str, unit: str, note: str | None = None) -> dict:
    m = {"value": value, "direction": direction, "unit": unit}
    if note:
        m["note"] = note
    return m


def event_metrics(e: dict) -> dict:
    h, w = e["height_range_cm"], e["weight_range_kg"]
    return {
        "poolsSizeAtLeast2": metric(e["pools_size_ge_2"], "INFO", "pools"),
        "poolsWithoutDirtyRows": metric(e["pools_without_dirty_rows"], "INFO", "pools"),
        "heightRangeMedianCm": metric(h["median"], "LOWER_IS_BETTER", "cm"),
        "heightRangeP90Cm": metric(h["p90"], "LOWER_IS_BETTER", "cm"),
        "heightRangeMaxCm": metric(h["max"], "LOWER_IS_BETTER", "cm"),
        "pctPoolsHeightWithin5cm": metric(h["pct_within_5"], "HIGHER_IS_BETTER", "%"),
        "pctPoolsHeightWithin10cm": metric(h["pct_within_10"], "HIGHER_IS_BETTER", "%"),
        "weightRangeMedianKg": metric(w["median"], "LOWER_IS_BETTER", "kg"),
        "weightRangeP90Kg": metric(w["p90"], "LOWER_IS_BETTER", "kg"),
        "pctPoolsWeightWithin3kg": metric(w["pct_within_3"], "HIGHER_IS_BETTER", "%"),
        "pctPoolsWeightWithin5kg": metric(w["pct_within_5"], "HIGHER_IS_BETTER", "%"),
        "poolsCrossingMovementBand": metric(e["pools_crossing_movement_band"], "LOWER_IS_BETTER", "pools"),
        "singleContingentPools": metric(e["single_contingent_pools"], "LOWER_IS_BETTER", "pools"),
        "round1SameContingentPct": metric(e["round1_same_contingent_pct"], "LOWER_IS_BETTER", "%"),
    }


def main() -> None:
    facts = json.loads(FACTS.read_text(encoding="utf-8"))
    semi = facts["committee_semi_draw"]
    baseline = {
        "schemaVersion": 1,
        "code": "COMMITTEE_2026",
        "kind": "HISTORICAL_QUALITY_BENCHMARK",
        "notCorrectness": "These values describe what the 2026 committee achieved by hand. They are a benchmark for "
        "quality, never ground truth. Correctness is defined by the safety invariants (ACCEPTANCE_CRITERIA.md §2).",
        "provenance": {
            "csvSha256": facts["sources"]["csv_sha256"],
            "zipSha256": facts["sources"]["zip_sha256"],
            "script": "tools/source-analysis/analyze.py + export_baseline.py",
            "method": "Pools reconstructed from PDF row geometry and joined to the registration CSV by id. "
            "Dirty-measurement pools are excluded from physical metrics (SOURCE_ANALYSIS §1.1, F-34).",
            "uncertainty": "About 1% at the margins: the CSV is an earlier snapshot than the printed draw.",
        },
        "semiPrestasi": {
            "entriesPlaced": semi["entries_placed"],
            "pools": semi["pools"],
            "poolSizeDistribution": {k: v for k, v in semi["pool_size_distribution"].items()},
            "singletonPools": metric(semi["pool_size_distribution"].get("1", 0), "LOWER_IS_BETTER", "pools"),
            "poolsCrossingCategory": metric(len(semi["pools_crossing_category"]), "INFO", "pools",
                                            "Committee exceptions (adjacent-class and one cross-gender merge); the engine never merges automatically."),
            "kyorugi": event_metrics(semi["KYORUGI SEMI PRESTASI"]),
            "poomsae": event_metrics(semi["POOMSAE SEMI PRESTASI"]),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(baseline, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
