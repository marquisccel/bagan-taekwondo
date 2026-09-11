"""Generates fixtures/rulesets/piala-gubernur-2026.provisional.json.

Inputs: the Phase 0 evidence file (data/private/facts-2026.json, produced by
tools/source-analysis/analyze.py) for the observed weight-class tables, plus the committee's
provisional answers of 2026-09-11 (Q1-Q5). Every value carries provenance.

Usage: python fixtures/rulesets/generate_2026_provisional.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FACTS = ROOT / "data" / "private" / "facts-2026.json"
OUT = ROOT / "fixtures" / "rulesets" / "piala-gubernur-2026.provisional.json"

STREAM = {"KYORUGI PRESTASI": "PRESTASI", "KYORUGI SEMI PRESTASI": "SEMI_PRESTASI"}
DIV = {
    "PRA CADET A": "PRA_CADET_A",
    "PRA CADET B": "PRA_CADET_B",
    "PRA CADET C": "PRA_CADET_C",
    "PRA CADET": "PRA_CADET",
    "CADET": "CADET",
    "JUNIOR": "JUNIOR",
    "SENIOR": "SENIOR",
}
GEN = {"Laki-laki": "MALE", "Perempuan": "FEMALE"}


def ev(note: str | None = None) -> dict:
    return {"source": "EVIDENCE_2026", "note": note} if note else {"source": "EVIDENCE_2026"}


def stk(note: str) -> dict:
    return {"source": "STAKEHOLDER", "note": note}


def eng(note: str) -> dict:
    return {"source": "ENGINEERING_DEFAULT", "note": note}


def weight_tables(facts: dict) -> list[dict]:
    out = []
    for key, classes in sorted(facts["csv"]["weight_class_tables_observed"].items()):
        klas, div, gender = (x.strip() for x in key.split("|"))
        rows, prev = [], None
        for c in classes:
            kg = int(re.sub(r"\D", "", c))
            if "+" in c:
                rows.append({"code": f"+{kg}", "lowerExclusiveG": kg * 1000, "upperInclusiveG": None})
            else:
                rows.append({"code": f"-{kg}", "lowerExclusiveG": prev, "upperInclusiveG": kg * 1000})
                prev = kg * 1000
        out.append({
            "stream": STREAM[klas],
            "ageDivisionCode": DIV[div],
            "gender": GEN[gender],
            "completeness": "OBSERVED_SUBSET",
            "classes": rows,
            "provenance": ev(
                "Only classes that received registrations in 2026; a lower bound may be wrong where an "
                "intermediate class had no registrants. Replace with the official table."
            ),
        })
    return out


def tolerance(dim: str, active: bool, ideal: int, prov: dict) -> dict:
    return {
        "dimension": dim,
        "ageDivisionCode": None,
        "active": active,
        "ideal": ideal,
        "idealProvenance": prov,
        "max": {"status": "UNSET"},
        "linearWeightPermille": 1000,
        "overflowWeightPermille": 4000,
    }


def pool_policies() -> list[dict]:
    common = {
        "poolMin": 2,
        "poolTarget": 4,
        "poolMax": 4,
        "sizePenaltyFp": {"1": 40000, "2": 10000, "3": 2500, "4": 0},
        "sizePenaltyProvenance": eng("Pool-size penalties are placeholders; calibrated in Phase 3."),
        "tiers": {
            "tier1SlackFp": 500,
            "forbidIdealRegression": True,
            "contingentWeightPermille": 1000,
            "bracketWeightPermille": 1000,
            "provenance": eng("Tier weights and slack are placeholders; calibrated in Phase 3 with the draw simulator."),
        },
        "singleton": {
            "policy": "WALKOVER_WITH_SUGGESTIONS",
            "provenance": stk("Q4 (2026-09-11): singleton = walkover plus merge suggestions; never an automatic merge."),
        },
        "measurementSource": "REGISTERED_DATA",
        "contingentKey": "EXACT",
        "localSearchBudgetPerEntry": 200,
    }
    kyorugi = {
        "code": "KYORUGI_SEMI_POOL",
        **common,
        "belt": {"policy": "SOFT", "schemeCode": None, "provenance": stk("Q3 (2026-09-11): Kyorugi semi prestasi belt = SOFT (2026 evidence).")},
        "tolerances": [
            tolerance("WEIGHT", True, 5000, stk("Q2: ideal weight range 5 kg.")),
            tolerance("HEIGHT", True, 50, stk("Q2: ideal height range 5 cm.")),
            tolerance("BELT", True, 2, eng(
                "Ideal belt-rank spread not specified by the committee; 2 ranks chosen for cost normalization "
                "(86% of 2026 committee pools). Calibrate.")),
        ],
    }
    poomsae = {
        "code": "POOMSAE_SEMI_POOL",
        **common,
        "belt": {"policy": "DISABLED", "schemeCode": None, "provenance": stk("Q5: belt separation is enforced by the MOVEMENT partition dimension.")},
        "tolerances": [
            tolerance("WEIGHT", False, 5000, stk("Q5: weight disabled by default for poomsae semi prestasi (2026 evidence); configurable.")),
            tolerance("HEIGHT", True, 50, stk("Q2: ideal height range 5 cm.")),
            tolerance("BELT", False, 1, eng("Inactive: the movement partition already limits belt spread.")),
        ],
    }
    return [kyorugi, poomsae]


def template(code, stream, disc, fmt, mode, dims, draw, prov, pol=None, mv=None, bye=None, bronze=None) -> dict:
    return {
        "code": code, "stream": stream, "discipline": disc, "format": fmt, "genderMode": mode,
        "dimensions": dims, "drawFormat": draw, "poolPolicyCode": pol, "movementMapCode": mv,
        "byePolicy": bye, "bronzeMedals": bronze, "provenance": prov,
    }


def templates() -> list[dict]:
    k = ["STREAM", "DISCIPLINE", "AGE_DIVISION", "GENDER", "WEIGHT_CLASS"]
    p = ["STREAM", "DISCIPLINE", "AGE_DIVISION", "GENDER", "FORMAT"]
    semi_medals = {"source": "TBD", "note": "Q1: each semi prestasi pool is an independent competition unit. The medal structure per pool (bronze count) is not decided."}
    return [
        template("KYORUGI_PRESTASI", "PRESTASI", "KYORUGI", "INDIVIDUAL", "BY_ENTRY", k, "SINGLE_ELIMINATION", ev("Tomato brackets; medal block 1./2./3./3."), bye="SEED_PRIORITY", bronze=2),
        template("KYORUGI_SEMI_PRESTASI", "SEMI_PRESTASI", "KYORUGI", "INDIVIDUAL", "BY_ENTRY", k, "POOLED_SINGLE_ELIMINATION", semi_medals, pol="KYORUGI_SEMI_POOL", bye="CONTINGENT_AWARE", bronze=2),
        template("POOMSAE_PRESTASI_INDIVIDUAL", "PRESTASI", "POOMSAE", "INDIVIDUAL", "BY_ENTRY", p, "SINGLE_ELIMINATION", ev("Tomato brackets."), bye="SEED_PRIORITY", bronze=2),
        template("POOMSAE_PRESTASI_PAIR", "PRESTASI", "POOMSAE", "PAIR", "MIXED", p, "SINGLE_ELIMINATION", ev("Pairs are one male + one female (F-04)."), bye="SEED_PRIORITY", bronze=2),
        template("POOMSAE_PRESTASI_TEAM", "PRESTASI", "POOMSAE", "TEAM", "BY_ENTRY", p, "SINGLE_ELIMINATION", ev("Teams are three members of one gender (R-11)."), bye="SEED_PRIORITY", bronze=2),
        template("POOMSAE_SEMI_PRESTASI", "SEMI_PRESTASI", "POOMSAE", "INDIVIDUAL", "BY_ENTRY", p + ["MOVEMENT"], "POOLED_SINGLE_ELIMINATION", semi_medals, pol="POOMSAE_SEMI_POOL", mv="POOMSAE_SEMI_MOVEMENT", bye="CONTINGENT_AWARE", bronze=2),
        template("FREESTYLE_INDIVIDUAL", "PRESTASI", "FREESTYLE_POOMSAE", "INDIVIDUAL", "BY_ENTRY", p, "PERFORMANCE_ORDER", ev(
            "Freestyle is a performance-order list. Mapping FREESTYLE to the PRESTASI stream is an assumption (the source has no stream).")),
        template("FREESTYLE_PAIR", "PRESTASI", "FREESTYLE_POOMSAE", "PAIR", "MIXED", p, "PERFORMANCE_ORDER", ev("Freestyle pair is mixed-gender in the 2026 data.")),
    ]


def age_divisions() -> list[dict]:
    rows = [
        ("PRA_CADET_A", "Pra Cadet A", ["SEMI_PRESTASI"], 2020, 2021, 1),
        ("PRA_CADET_B", "Pra Cadet B", ["SEMI_PRESTASI"], 2018, 2019, 2),
        ("PRA_CADET_C", "Pra Cadet C", ["SEMI_PRESTASI"], 2015, 2017, 3),
        ("PRA_CADET", "Pra Cadet", ["PRESTASI"], 2015, 2017, 3),
        ("CADET", "Cadet", ["PRESTASI", "SEMI_PRESTASI"], 2012, 2014, 4),
        ("JUNIOR", "Junior", ["PRESTASI", "SEMI_PRESTASI"], 2009, 2011, 5),
        ("SENIOR", "Senior", ["PRESTASI", "SEMI_PRESTASI"], 1900, 2008, 6),
    ]
    out = []
    for code, label, streams, lo, hi, order in rows:
        note = (
            "F-26/F-27. No upper age limit observed for Senior (oldest registrant born 1997); 1900 = no limit until the committee decides."
            if code == "SENIOR"
            else "F-26 birth-year band; play-up tolerated in 2026 (F-27)."
        )
        out.append({
            "code": code, "label": label, "streams": streams, "minBirthYear": lo, "maxBirthYear": hi,
            "order": order, "playUp": "ALLOW_ONE_DIVISION_WITH_WARNING", "provenance": ev(note),
        })
    return out


BELTS = [
    ("GEUP_9", "GEUP 9 - KUNING", "Geup 9 (kuning)"),
    ("GEUP_8", "GEUP 8 - KUNING STRIP HIJAU", "Geup 8 (kuning strip hijau)"),
    ("GEUP_7", "GEUP 7 - HIJAU", "Geup 7 (hijau)"),
    ("GEUP_6", "GEUP 6 - HIJAU STRIP BIRU", "Geup 6 (hijau strip biru)"),
    ("GEUP_5", "GEUP 5 - BIRU", "Geup 5 (biru)"),
    ("GEUP_4", "GEUP 4 - BIRU STRIP MERAH", "Geup 4 (biru strip merah)"),
    ("GEUP_3", "GEUP 3 - MERAH", "Geup 3 (merah)"),
    ("GEUP_2", "GEUP 2 - MERAH STRIP 1", "Geup 2 (merah strip 1)"),
    ("GEUP_1", "GEUP 1 - MERAH STRIP 2", "Geup 1 (merah strip 2)"),
    ("DAN_1", "HITAM - DAN 1", "Dan 1 (hitam)"),
    ("DAN_2", "HITAM - DAN 2", "Dan 2 (hitam)"),
    ("DAN_3", "HITAM - DAN 3", "Dan 3 (hitam)"),
]


def main() -> None:
    facts = json.loads(FACTS.read_text(encoding="utf-8"))
    rule_set = {
        "schemaVersion": 1,
        "code": "PIALA_GUBERNUR_2026_PROVISIONAL",
        "name": "Piala Gubernur Jawa Timur Antar Pelajar 2026 - provisional rule set",
        "status": "DRAFT",
        "tournament": {
            "code": "PIALA_GUBERNUR_JATIM_2026",
            "name": "Piala Gubernur Jawa Timur Antar Pelajar 2026",
            "eventStart": "2026-08-27",
            "eventEnd": "2026-08-30",
            "timezone": "Asia/Jakarta",
        },
        "age": {"policy": "BIRTH_YEAR", "referenceYear": 2026, "cutoffDate": None, "provenance": ev("F-26: divisions follow birth-year bands.")},
        "ageDivisions": age_divisions(),
        "belts": [{"code": c, "rank": i + 1, "label": lab, "sourceLabels": [src]} for i, (c, src, lab) in enumerate(BELTS)],
        "beltBandSchemes": [{
            "code": "POOMSAE_MOVEMENT_BANDS",
            "purpose": "MOVEMENT",
            "bands": [
                {"code": "T1", "label": "Geup 9-8", "beltCodes": ["GEUP_9", "GEUP_8"]},
                {"code": "T3", "label": "Geup 7-6", "beltCodes": ["GEUP_7", "GEUP_6"]},
                {"code": "T5", "label": "Geup 5-4", "beltCodes": ["GEUP_5", "GEUP_4"]},
                {"code": "T6", "label": "Geup 3", "beltCodes": ["GEUP_3"]},
            ],
            "provenance": stk("Q5: configurable belt-to-movement map; values from F-33 (533 entries, zero exceptions)."),
        }],
        "movementMaps": [{
            "code": "POOMSAE_SEMI_MOVEMENT",
            "schemeCode": "POOMSAE_MOVEMENT_BANDS",
            "entries": [
                {"bandCode": "T1", "movement": "Taegeuk 1"},
                {"bandCode": "T3", "movement": "Taegeuk 3"},
                {"bandCode": "T5", "movement": "Taegeuk 5"},
                {"bandCode": "T6", "movement": "Taegeuk 6"},
            ],
            "provenance": stk("Q5 / F-33."),
        }],
        "weightClassTables": weight_tables(facts),
        "composition": [
            {"format": "INDIVIDUAL", "size": 1, "genders": None},
            {"format": "PAIR", "size": 2, "genders": ["FEMALE", "MALE"]},
            {"format": "TEAM", "size": 3, "genders": None},
        ],
        "plausibility": {
            "heightMm": {"min": 900, "max": 2100},
            "weightG": {"min": 12000, "max": 130000},
            "bmiTenths": {"min": 110, "max": 400},
            "provenance": eng("Plausibility screens catch data-entry errors; they are not eligibility rules."),
        },
        "poolPolicies": pool_policies(),
        "categoryTemplates": templates(),
        "sourceVocabulary": {
            "klasifikasi": {
                "KYORUGI PRESTASI": {"stream": "PRESTASI", "discipline": "KYORUGI"},
                "KYORUGI SEMI PRESTASI": {"stream": "SEMI_PRESTASI", "discipline": "KYORUGI"},
                "POOMSAE PRESTASI": {"stream": "PRESTASI", "discipline": "POOMSAE"},
                "POOMSAE SEMI PRESTASI": {"stream": "SEMI_PRESTASI", "discipline": "POOMSAE"},
                "FREESTYLE": {"stream": "PRESTASI", "discipline": "FREESTYLE_POOMSAE"},
            },
            "divisi": DIV,
            "gender": GEN,
            "format": {"INDIVIDUAL": "INDIVIDUAL", "PAIR": "PAIR", "TEAM": "TEAM"},
        },
        "notes": [
            "Provisional rule set derived from docs/SOURCE_ANALYSIS.md and the committee answers of 2026-09-11 (Q1-Q5).",
            "Maximum tolerances are intentionally UNSET: simulations and candidate draws are allowed, LOCK is refused (ADR-0007).",
            "Weight-class tables are observed subsets, not the official tables.",
        ],
    }
    OUT.write_text(json.dumps(rule_set, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(rule_set['weightClassTables'])} weight tables, {len(rule_set['categoryTemplates'])} templates")


if __name__ == "__main__":
    main()
