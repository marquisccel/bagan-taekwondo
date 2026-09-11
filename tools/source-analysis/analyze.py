"""Reproducible source analysis for the Taekwondo draw system (Phase 0).

Reads the registration CSV and the ZIP of tournament PDFs, never modifies them,
and emits every metric cited in docs/SOURCE_ANALYSIS.md as JSON.

Usage:
    python analyze.py --csv <registration.csv> --zip <brackets.zip> --out facts.json

Requires: Python 3.11+, pymupdf (pip install pymupdf).
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import hashlib
import json
import re
import statistics
import tempfile
import zipfile
from pathlib import Path

import pymupdf

BELT_RANK = {
    "GEUP 9 - KUNING": 9,
    "GEUP 8 - KUNING STRIP HIJAU": 8,
    "GEUP 7 - HIJAU": 7,
    "GEUP 6 - HIJAU STRIP BIRU": 6,
    "GEUP 5 - BIRU": 5,
    "GEUP 4 - BIRU STRIP MERAH": 4,
    "GEUP 3 - MERAH": 3,
    "GEUP 2 - MERAH STRIP 1": 2,
    "GEUP 1 - MERAH STRIP 2": 1,
    "HITAM - DAN 1": -1,
    "HITAM - DAN 2": -2,
    "HITAM - DAN 3": -3,
}
# Observed birth-year bands for a 2026 event (see SOURCE_ANALYSIS F-07).
BIRTH_YEAR_BAND = {
    "PRA CADET A": (2020, 2021),
    "PRA CADET B": (2018, 2019),
    "PRA CADET C": (2015, 2017),
    "PRA CADET": (2015, 2017),
    "CADET": (2012, 2014),
    "JUNIOR": (2009, 2011),
    "SENIOR": (1900, 2008),
}
PLAUSIBLE_HEIGHT_CM = (90.0, 210.0)
PLAUSIBLE_WEIGHT_KG = (12.0, 130.0)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def pct(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 1) if whole else 0.0


def class_limit(code: str) -> tuple[str, int]:
    m = re.fullmatch(r"(=?\+|-)(\d+)", code)
    if not m:
        raise ValueError(f"unknown class code {code!r}")
    return ("+" if "+" in m.group(1) else "-", int(m.group(2)))


def analyze_csv(rows: list[dict[str, str]]) -> dict:
    C = collections.Counter
    facts: dict = {"row_count": len(rows), "columns": list(rows[0].keys())}

    facts["duplicate_id_athlete"] = sum(1 for v in C(r["id_athlete"] for r in rows).values() if v > 1)
    facts["nama_tim_differs_from_tim_kontingen"] = sum(1 for r in rows if r["nama_tim"] != r["tim_kontingen"])
    facts["klasifikasi"] = dict(C(r["klasifikasi"] for r in rows))
    facts["divisi"] = dict(C(r["divisi"] for r in rows))
    facts["gender"] = dict(C(r["jeniskelamin"] for r in rows))
    facts["belt"] = dict(C(r["sabuk"] for r in rows))
    facts["belt_by_klasifikasi"] = {
        k: dict(C(r["sabuk"] for r in rows if r["klasifikasi"] == k)) for k in facts["klasifikasi"]
    }
    facts["class_format_equals_plus"] = sum(1 for r in rows if r["class"].startswith("=+"))

    # Physical measurements
    anomalies = collections.defaultdict(list)
    for r in rows:
        h, w = float(r["tinggibadan"]), float(r["beratbadan"])
        rid = r["id_athlete"]
        if h == 0:
            anomalies["HEIGHT_ZERO"].append(rid)
        if w == 0:
            anomalies["WEIGHT_ZERO"].append(rid)
        if 0 < h < 100 and w > 100:
            anomalies["HEIGHT_WEIGHT_LIKELY_SWAPPED"].append(rid)
        elif h > 0 and not PLAUSIBLE_HEIGHT_CM[0] <= h <= PLAUSIBLE_HEIGHT_CM[1]:
            anomalies["HEIGHT_OUT_OF_RANGE"].append(rid)
        elif w > 0 and not PLAUSIBLE_WEIGHT_KG[0] <= w <= PLAUSIBLE_WEIGHT_KG[1]:
            anomalies["WEIGHT_OUT_OF_RANGE"].append(rid)
    facts["physical_anomalies"] = {k: {"count": len(v), "ids": v} for k, v in anomalies.items()}

    # NIK
    nik = C()
    nik_examples = collections.defaultdict(list)
    for r in rows:
        n = r["nik"]
        if n.endswith("."):
            nik["TRAILING_DOT"] += 1
            n = n[:-1]
        if not re.fullmatch(r"\d{16}", n):
            nik[f"INVALID_LENGTH_{len(n)}"] += 1
            continue
        dd, mm, yy = int(n[6:8]), int(n[8:10]), int(n[10:12])
        nik_gender = "Perempuan" if dd > 40 else "Laki-laki"
        day = dd - 40 if dd > 40 else dd
        y, m, d = r["tanggallahir"].split("-")
        if nik_gender != r["jeniskelamin"]:
            nik["NIK_GENDER_MISMATCH"] += 1
            nik_examples["NIK_GENDER_MISMATCH"].append(r["id_athlete"])
        if yy != int(y[2:]):
            nik["NIK_BIRTH_YEAR_MISMATCH"] += 1
            nik_examples["NIK_BIRTH_YEAR_MISMATCH"].append(r["id_athlete"])
        elif (day, mm) != (int(d), int(m)):
            nik["NIK_BIRTH_DAY_MONTH_MISMATCH"] += 1
    facts["nik"] = dict(nik)
    facts["nik_examples"] = {k: v[:25] for k, v in nik_examples.items()}
    facts["dob_placeholder_jan_1"] = sum(1 for r in rows if r["tanggallahir"][5:] == "01-01")

    # Same person, multiple rows
    by_nik = collections.defaultdict(list)
    for r in rows:
        by_nik[r["nik"].rstrip(".")].append(r)
    multi = {k: v for k, v in by_nik.items() if len(v) > 1}
    facts["persons_with_multiple_rows"] = len(multi)
    facts["rows_belonging_to_multi_row_persons"] = sum(len(v) for v in multi.values())
    facts["multi_row_persons_all_same_name_and_dob"] = all(
        len({x["namalengkap"].strip().lower() for x in v}) == 1 and len({x["tanggallahir"] for x in v}) == 1
        for v in multi.values()
    )
    facts["persons_under_multiple_contingents"] = sum(
        1 for v in multi.values() if len({x["tim_kontingen"] for x in v}) > 1
    )

    # Age bands
    off = [r for r in rows if not BIRTH_YEAR_BAND[r["divisi"]][0] <= int(r["tanggallahir"][:4]) <= BIRTH_YEAR_BAND[r["divisi"]][1]]
    facts["age_outside_birth_year_band"] = len(off)
    facts["age_play_up"] = sum(1 for r in off if int(r["tanggallahir"][:4]) > BIRTH_YEAR_BAND[r["divisi"]][1])
    facts["age_play_down"] = len(off) - facts["age_play_up"]

    # Weight versus declared class (kyorugi only)
    kyo = [r for r in rows if r["klasifikasi"].startswith("KYORUGI")]
    tables = collections.defaultdict(set)
    for r in kyo:
        tables[(r["klasifikasi"], r["divisi"], r["jeniskelamin"])].add(r["class"])
    facts["weight_class_tables_observed"] = {
        " | ".join(k): sorted(v, key=lambda c: (class_limit(c)[0] == "+", class_limit(c)[1])) for k, v in tables.items()
    }
    fit = C()
    for r in kyo:
        w = float(r["beratbadan"])
        if w == 0 or r["id_athlete"] in anomalies["HEIGHT_WEIGHT_LIKELY_SWAPPED"]:
            continue
        sign, v = class_limit(r["class"])
        minus = [class_limit(c)[1] for c in tables[(r["klasifikasi"], r["divisi"], r["jeniskelamin"])] if class_limit(c)[0] == "-"]
        lo, hi = (v, 10_000) if sign == "+" else (max([m for m in minus if m < v], default=0), v)
        fit["FITS" if lo < w <= hi else ("OVER_CLASS" if w > hi else "UNDER_CLASS")] += 1
    facts["registered_weight_vs_declared_class"] = dict(fit)

    # Category sizes
    def cat_key(r: dict[str, str]) -> tuple:
        return (r["klasifikasi"], r["divisi"], r["jeniskelamin"], r["class"])

    sizes = {}
    for k in facts["klasifikasi"]:
        cs = C(cat_key(r) for r in rows if r["klasifikasi"] == k)
        v = sorted(cs.values())
        sizes[k] = {"groups": len(cs), "min": v[0], "median": statistics.median(v), "max": v[-1], "singletons": v.count(1)}
    facts["raw_group_sizes"] = sizes

    # Contingents
    cont = C(r["tim_kontingen"] for r in rows)
    base = collections.defaultdict(int)
    for c in cont:
        base[re.sub(r"\s+\d+$", "", c.strip())] += 1
    facts["contingent_strings"] = len(cont)
    facts["contingent_base_names"] = len(base)
    facts["contingent_top"] = cont.most_common(5)

    # Pair / team reconstruction
    groups = collections.defaultdict(list)
    for r in rows:
        if r["class"] in ("PAIR", "TEAM"):
            groups[(r["klasifikasi"], r["divisi"], r["class"], r["tim_kontingen"])].append(r)
    recon = C()
    for k, v in groups.items():
        males = sum(1 for r in v if r["jeniskelamin"] == "Laki-laki")
        females = len(v) - males
        if k[2] == "PAIR":
            recon["PAIR_UNAMBIGUOUS" if (males, females) == (1, 1) else "PAIR_AMBIGUOUS"] += 1
        else:
            for n in (males, females):
                if n:
                    recon["TEAM_UNAMBIGUOUS" if n == 3 else "TEAM_AMBIGUOUS"] += 1
    facts["pair_team_reconstruction"] = dict(recon)
    return facts


def reconstruct_semi_pools(pdf_dir: Path, rows_by_id: dict[str, dict[str, str]]) -> tuple[list[dict], list[dict]]:
    """Rebuild the committee's semi-prestasi pools from row geometry in the PDFs."""
    pools: list[dict] = []
    printed: list[dict] = []
    files = [
        p for p in sorted(pdf_dir.rglob("*.pdf"))
        if "SEMI" in p.name.upper() or re.search(r"DAY [34] - ARENA [C-G]\.pdf$", p.name)
    ]
    for f in files:
        doc = pymupdf.open(f)
        for pno, page in enumerate(doc):
            width = page.rect.width
            athletes, numbers = [], []
            lines = collections.defaultdict(list)
            for x0, y0, x1, y1, word, *_ in page.get_text("words"):
                yc = (y0 + y1) / 2
                lines[round(yc / 3)].append((x0, word))
                if x0 < width * 0.12 and word in rows_by_id:
                    athletes.append((yc, word))
                elif x0 > width * 0.75 and re.fullmatch(r"\d{1,3}", word):
                    numbers.append((yc, int(word)))
            for words in lines.values():
                words.sort()
                if words and words[0][0] < width * 0.12 and words[0][1] in rows_by_id:
                    printed.append({"file": f.name, "id": words[0][1], "text": " ".join(w for _, w in words)})
            athletes.sort()
            if not athletes:
                continue
            pitch = min((b[0] - a[0] for a, b in zip(athletes, athletes[1:])), default=0)
            blocks = [[athletes[0]]]
            for a, b in zip(athletes, athletes[1:]):
                (blocks.append([b]) if b[0] - a[0] > pitch * 1.4 else blocks[-1].append(b))
            for blk in blocks:
                lo, hi = blk[0][0] - pitch * 0.6, blk[-1][0] + pitch * 0.6
                pools.append({
                    "file": f.name,
                    "page": pno + 1,
                    "ids": [i for _, i in blk],
                    "match_numbers": sorted(n for y, n in numbers if lo <= y <= hi),
                })
    return pools, printed


def evaluate_committee_pools(pools: list[dict], printed: list[dict], rows_by_id: dict[str, dict[str, str]]) -> dict:
    C = collections.Counter
    out: dict = {}
    placed = [i for p in pools for i in p["ids"]]
    out["pools"] = len(pools)
    out["entries_placed"] = len(placed)
    out["entries_placed_unique"] = len(set(placed))
    out["pool_size_distribution"] = dict(sorted(C(len(p["ids"]) for p in pools).items()))

    def key(r: dict[str, str]) -> tuple:
        return (r["klasifikasi"], r["divisi"], r["jeniskelamin"], r["class"])

    mixed = [p for p in pools if len({key(rows_by_id[i]) for i in p["ids"]}) > 1]
    out["pools_crossing_category"] = [
        {"file": p["file"], "page": p["page"], "members": [" ".join(key(rows_by_id[i])[1:]) for i in p["ids"]]} for p in mixed
    ]

    # Category size -> pool size multiset
    by_cat = collections.defaultdict(list)
    for p in pools:
        ks = {key(rows_by_id[i]) for i in p["ids"]}
        if len(ks) == 1:
            by_cat[ks.pop()].append(len(p["ids"]))
    split = collections.defaultdict(C)
    for sz in by_cat.values():
        split[sum(sz)][",".join(map(str, sorted(sz, reverse=True)))] += 1
    out["category_size_to_pool_sizes"] = {m: dict(v) for m, v in sorted(split.items()) if m <= 16}

    def clean(r: dict[str, str]) -> bool:
        h, w = float(r["tinggibadan"]), float(r["beratbadan"])
        return 100 <= h <= 200 and 10 <= w <= 120

    movement = {9: 1, 8: 1, 7: 3, 6: 3, 5: 5, 4: 5, 3: 6}
    for ev in ("KYORUGI SEMI PRESTASI", "POOMSAE SEMI PRESTASI"):
        P = [p for p in pools if rows_by_id[p["ids"][0]]["klasifikasi"] == ev and len(p["ids"]) >= 2]
        Pc = [p for p in P if all(clean(rows_by_id[i]) for i in p["ids"])]

        def spread(p: dict, col: str) -> float:
            vals = [float(rows_by_id[i][col]) for i in p["ids"]]
            return max(vals) - min(vals)

        tb = [spread(p, "tinggibadan") for p in Pc]
        bb = [spread(p, "beratbadan") for p in Pc]
        belt = [max(BELT_RANK[rows_by_id[i]["sabuk"]] for i in p["ids"]) - min(BELT_RANK[rows_by_id[i]["sabuk"]] for i in p["ids"]) for p in P]
        bands = [len({movement[BELT_RANK[rows_by_id[i]["sabuk"]]] for i in p["ids"]}) for p in P]
        r1_total = r1_same = 0
        for p in P:
            ids = p["ids"]
            for a, b in ([(0, 1), (2, 3)] if len(ids) == 4 else [(0, 1)]):
                r1_total += 1
                r1_same += rows_by_id[ids[a]]["tim_kontingen"] == rows_by_id[ids[b]]["tim_kontingen"]
        q = statistics.quantiles
        out[ev] = {
            "pools_size_ge_2": len(P),
            "pools_without_dirty_rows": len(Pc),
            "height_range_cm": {"median": statistics.median(tb), "p90": round(q(tb, n=10)[8], 1), "max": max(tb), "pct_within_5": pct(sum(x <= 5 for x in tb), len(tb)), "pct_within_10": pct(sum(x <= 10 for x in tb), len(tb))},
            "weight_range_kg": {"median": statistics.median(bb), "p90": round(q(bb, n=10)[8], 1), "max": max(bb), "pct_within_3": pct(sum(x <= 3 for x in bb), len(bb)), "pct_within_5": pct(sum(x <= 5 for x in bb), len(bb))},
            "belt_rank_range_distribution": dict(sorted(C(belt).items())),
            "pools_crossing_movement_band": sum(1 for b in bands if b > 1),
            "single_contingent_pools": sum(1 for p in P if len({rows_by_id[i]["tim_kontingen"] for i in p["ids"]}) == 1),
            "round1_pairs_total": r1_total,
            "round1_pairs_same_contingent": r1_same,
            "round1_same_contingent_pct": pct(r1_same, r1_total),
        }

    # Printed attributes versus CSV
    belt_to_movement = collections.defaultdict(C)
    gender_mismatch = []
    for pr in printed:
        r = rows_by_id[pr["id"]]
        g = "Perempuan" if "Perempuan" in pr["text"] else "Laki-laki"
        if g != r["jeniskelamin"]:
            gender_mismatch.append({"id": pr["id"], "csv": r["jeniskelamin"], "pdf": g})
        m = re.search(r"Taegeuk\s*\d+", pr["text"])
        if r["klasifikasi"].startswith("POOMSAE") and m:
            belt_to_movement[r["sabuk"]][m.group(0)] += 1
    out["printed_gender_differs_from_csv"] = gender_mismatch
    out["poomsae_semi_belt_to_movement"] = {k: dict(v) for k, v in belt_to_movement.items()}
    out["printed_over_class_lost_plus_sign"] = sum(
        1 for pr in printed if rows_by_id[pr["id"]]["class"].startswith("=+") and rows_by_id[pr["id"]]["class"] not in pr["text"]
    )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, type=Path)
    ap.add_argument("--zip", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    with args.csv.open(encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    rows_by_id = {r["id_athlete"]: r for r in rows}

    facts = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "sources": {"csv_sha256": sha256(args.csv), "zip_sha256": sha256(args.zip)},
        "csv": analyze_csv(rows),
    }
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(args.zip) as z:
            z.extractall(tmp)
            facts["sources"]["pdf_files"] = sorted(n for n in z.namelist() if n.lower().endswith(".pdf"))
        pools, printed = reconstruct_semi_pools(Path(tmp), rows_by_id)
        facts["committee_semi_draw"] = evaluate_committee_pools(pools, printed, rows_by_id)

    args.out.write_text(json.dumps(facts, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
