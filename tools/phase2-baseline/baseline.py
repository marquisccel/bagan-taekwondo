"""Phase 2 independent baseline (oracle O2).

Implements docs/PHASE2_PLAN.md §3-§8 in Python, sharing no code with packages/intake. The
TypeScript pipeline (O3) must agree with this output and with ACCEPTANCE_CRITERIA §5 (O1).

Inputs:  registration CSV, rule-set JSON (the rule set is data, not code).
Outputs: --counts  aggregate counts (no personal data; committed)
         --detail  per-row issue sets and per-entry members/category (personal ids; keep private)

Usage:
  python tools/phase2-baseline/baseline.py --csv <csv> --rules <json> \
      --counts fixtures/baselines/phase2-2026-counts.json --detail data/private/phase2-2026-detail.json
"""

from __future__ import annotations

import argparse
import calendar
import csv
import json
import re
from collections import Counter, defaultdict
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path


def key_norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip()).upper()


def ws_norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip())


def parse_decimal(raw: str, scale: int) -> tuple[int | None, str]:
    """Returns (integer value in 10^-scale units or None, outcome)."""
    t = raw.strip().replace(",", ".")
    if t == "":
        return None, "MISSING"
    if not re.fullmatch(r"\d+(\.\d+)?", t):
        return None, "INVALID"
    d = Decimal(t)
    q = (d * (Decimal(10) ** scale)).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    exact = d * (Decimal(10) ** scale) == q
    if q == 0:
        return None, "MISSING"
    return int(q), ("UNCHANGED" if exact else "ROUNDED")


def parse_class(raw: str) -> tuple[str | None, str]:
    """Kyorugi weight-class code -> (canonical, outcome)."""
    t = raw.strip().replace("−", "-")  # Unicode minus sign
    if re.fullmatch(r"[-+]\d+", t):
        return t, ("UNCHANGED" if t == raw else "NORMALIZED")
    m = re.fullmatch(r"=([-+])(\d+)", t) or re.fullmatch(r"(\d+)(\+)", t)
    if m:
        if t.endswith("+") and not t.startswith("="):
            return "+" + m.group(1), "NORMALIZED"
        return m.group(1) + m.group(2), "NORMALIZED"
    if re.fullmatch(r"\d+", t):
        return None, "AMBIGUOUS"
    return None, "UNKNOWN"


def valid_date(s: str) -> tuple[int, int, int] | None:
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s.strip())
    if not m:
        return None
    y, mo, d = (int(x) for x in m.groups())
    if not 1 <= mo <= 12 or not 1 <= d <= calendar.monthrange(y, mo)[1]:
        return None
    return y, mo, d


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--counts", required=True)
    ap.add_argument("--detail", required=True)
    a = ap.parse_args()

    rs = json.loads(Path(a.rules).read_text(encoding="utf-8"))
    with open(a.csv, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    vocab = rs["sourceVocabulary"]
    klas_v = {key_norm(k): v for k, v in vocab["klasifikasi"].items()}
    div_v = {key_norm(k): v for k, v in vocab["divisi"].items()}
    gen_v = {key_norm(k): v for k, v in vocab["gender"].items()}
    fmt_v = {key_norm(k): v for k, v in vocab["format"].items()}
    belt_v = {key_norm(lbl): b["code"] for b in rs["belts"] for lbl in b["sourceLabels"]}
    divisions = {d["code"]: d for d in rs["ageDivisions"]}
    ref_year = rs["age"]["referenceYear"]
    pl = rs["plausibility"]
    hmin, hmax = pl["heightMm"]["min"], pl["heightMm"]["max"]
    wmin, wmax = pl["weightG"]["min"], pl["weightG"]["max"]
    bmin, bmax = pl["bmiTenths"]["min"], pl["bmiTenths"]["max"]
    tables = {(t["stream"], t["ageDivisionCode"], t["gender"]): t for t in rs["weightClassTables"]}
    templates = {(t["stream"], t["discipline"], t["format"]): t for t in rs["categoryTemplates"]}
    policies = {p["code"]: p for p in rs["poolPolicies"]}
    maps = {m["code"]: m for m in rs["movementMaps"]}
    schemes = {s["code"]: s for s in rs["beltBandSchemes"]}
    compositions = {c["format"]: c for c in rs["composition"]}
    del ref_year  # BIRTH_YEAR policy uses the division bands directly

    def uses(template: dict | None, field: str) -> bool:
        if template is None:
            return False
        if field == "BELT":
            if "MOVEMENT" in template["dimensions"]:
                return True
        pol = policies.get(template["poolPolicyCode"] or "")
        if pol is None:
            return False
        if field == "BELT":
            return pol["belt"]["policy"] in ("HARD", "SOFT")
        return any(t["dimension"] == field and t["active"] and t["ageDivisionCode"] is None for t in pol["tolerances"])

    field_outcomes: Counter = Counter()
    row_issues: dict[str, list[tuple[str, str]]] = {}  # id -> [(code, severity)]
    norm: dict[str, dict] = {}

    seen_ids: Counter = Counter(r["id_athlete"].strip() for r in rows)

    for idx, r in enumerate(rows):
        raw_id = r["id_athlete"].strip()
        # unique source id, else disambiguated by row number (header is row 1)
        rid = raw_id if raw_id != "" and seen_ids[raw_id] == 1 else (f"ROWNUM:{idx + 2}" if raw_id == "" else f"{raw_id}@{idx + 2}")
        iss: list[tuple[str, str | None]] = []  # severity None = decided by usage later
        n: dict = {"id": rid}
        if raw_id == "" or seen_ids[raw_id] > 1:
            iss.append(("DUPLICATE_SOURCE_ID", "ERROR"))

        name = ws_norm(r["namalengkap"])
        n["name"] = name
        field_outcomes["name:" + ("INVALID" if name == "" else ("UNCHANGED" if name == r["namalengkap"] else "NORMALIZED"))] += 1
        if name == "":
            iss.append(("NAME_MISSING", "ERROR"))

        g = gen_v.get(key_norm(r["jeniskelamin"]))
        n["gender"] = g
        field_outcomes["gender:" + ("MAPPED" if g else "INVALID")] += 1
        if g is None:
            iss.append(("UNKNOWN_GENDER", "ERROR"))

        dob = valid_date(r["tanggallahir"])
        n["dob"] = dob
        field_outcomes["birthDate:" + ("INVALID" if dob is None else ("UNCHANGED" if r["tanggallahir"].strip() == r["tanggallahir"] else "NORMALIZED"))] += 1
        if dob is None:
            iss.append(("INVALID_DATE", "ERROR"))
        elif (dob[1], dob[2]) == (1, 1):
            iss.append(("DOB_POSSIBLE_PLACEHOLDER", "INFO"))

        h, ho = parse_decimal(r["tinggibadan"], 1)
        w, wo = parse_decimal(r["beratbadan"], 3)
        n["h"], n["w"] = h, w
        field_outcomes["height:" + {"UNCHANGED": "UNCHANGED", "ROUNDED": "NORMALIZED", "MISSING": "INVALID", "INVALID": "INVALID"}[ho]] += 1
        field_outcomes["weight:" + {"UNCHANGED": "UNCHANGED", "ROUNDED": "NORMALIZED", "MISSING": "INVALID", "INVALID": "INVALID"}[wo]] += 1

        belt = belt_v.get(key_norm(r["sabuk"]))
        n["belt"] = belt
        field_outcomes["belt:" + ("MAPPED" if belt else "INVALID")] += 1
        if belt is None:
            iss.append(("UNKNOWN_BELT", "ERROR"))

        kv = klas_v.get(key_norm(r["klasifikasi"]))
        n["stream"] = kv["stream"] if kv else None
        n["discipline"] = kv["discipline"] if kv else None
        field_outcomes["classification:" + ("MAPPED" if kv else "INVALID")] += 1
        if kv is None:
            iss.append(("UNKNOWN_CLASSIFICATION", "ERROR"))

        dcode = div_v.get(key_norm(r["divisi"]))
        if dcode is not None and kv is not None and kv["stream"] not in divisions[dcode]["streams"]:
            dcode = None
        n["division"] = dcode
        field_outcomes["division:" + ("MAPPED" if dcode else "INVALID")] += 1
        if dcode is None:
            iss.append(("UNKNOWN_DIVISION", "ERROR"))

        fmt = fmt_v.get(key_norm(r["class"]))
        wclass = None
        if fmt is not None:
            field_outcomes["class:MAPPED"] += 1
            n["format"] = fmt
        else:
            n["format"] = "INDIVIDUAL"
            wclass, co = parse_class(r["class"])
            if co == "UNCHANGED":
                field_outcomes["class:UNCHANGED"] += 1
            elif co == "NORMALIZED":
                field_outcomes["class:NORMALIZED"] += 1
                iss.append(("CLASS_FORMAT_NORMALIZED", "INFO"))
            elif co == "AMBIGUOUS":
                field_outcomes["class:INVALID"] += 1
                iss.append(("AMBIGUOUS_WEIGHT_CLASS", "ERROR"))
            else:
                field_outcomes["class:INVALID"] += 1
                iss.append(("UNKNOWN_CLASS", "ERROR"))
            if wclass is not None and not (n["discipline"] == "KYORUGI" and g and dcode and any(
                c["code"] == wclass for c in tables.get((n["stream"], dcode, g), {"classes": []})["classes"])):
                iss.append(("UNKNOWN_CLASS", "ERROR"))
                wclass = None
        n["class"] = wclass

        nik_raw = r["nik"]
        nik = re.sub(r"[\s.,;:]+$", "", nik_raw.strip())
        n["nik"] = nik
        if nik != nik_raw:
            field_outcomes["nik:NORMALIZED"] += 1
            iss.append(("NIK_NORMALIZED", "INFO"))
        else:
            field_outcomes["nik:UNCHANGED"] += 1
        if nik == "":
            iss.append(("NIK_MISSING", "WARNING"))
        elif not re.fullmatch(r"\d{16}", nik):
            iss.append(("NIK_INVALID_FORMAT", "WARNING"))
        else:
            dd, mm, yy = int(nik[6:8]), int(nik[8:10]), int(nik[10:12])
            nik_gender = "FEMALE" if dd > 40 else "MALE"
            day = dd - 40 if dd > 40 else dd
            if g is not None and nik_gender != g:
                iss.append(("NIK_GENDER_MISMATCH", "WARNING"))
            if dob is not None:
                if yy != dob[0] % 100:
                    iss.append(("NIK_BIRTHDATE_MISMATCH:YEAR", "WARNING"))
                elif (day, mm) != (dob[2], dob[1]):
                    iss.append(("NIK_BIRTHDATE_MISMATCH:DAY_MONTH", "WARNING"))

        cont = ws_norm(r["tim_kontingen"])
        n["contingent"] = cont
        if ws_norm(r["nama_tim"]) != cont:
            iss.append(("CONTINGENT_FIELDS_DIFFER", "WARNING"))

        # Physical checks (severity by usage, decided below)
        swapped = False
        if ho == "MISSING":
            iss.append(("HEIGHT_MISSING", None))
        elif ho == "INVALID":
            iss.append(("INVALID_NUMBER:HEIGHT", None))
        if wo == "MISSING":
            iss.append(("WEIGHT_MISSING", None))
        elif wo == "INVALID":
            iss.append(("INVALID_NUMBER:WEIGHT", None))
        h_ok = h is not None and hmin <= h <= hmax
        w_ok = w is not None and wmin <= w <= wmax
        if h is not None and w is not None and (not h_ok or not w_ok):
            if hmin * 100 <= w <= hmax * 100 and wmin <= h * 100 <= wmax:
                swapped = True
                iss.append(("HEIGHT_WEIGHT_LIKELY_SWAPPED", None))
        if not swapped:
            if h is not None and not h_ok:
                iss.append(("HEIGHT_OUT_OF_RANGE", None))
            if w is not None and not w_ok:
                iss.append(("WEIGHT_OUT_OF_RANGE", None))
        if h_ok and w_ok:
            assert h is not None and w is not None
            if w * 10000 < bmin * h * h or w * 10000 > bmax * h * h:
                iss.append(("BMI_IMPLAUSIBLE", "WARNING"))
        n["h_usable"] = h_ok and not swapped
        n["w_usable"] = w_ok and not swapped

        # Weight class mismatch
        if n["discipline"] == "KYORUGI" and wclass is not None and n["w_usable"]:
            t = tables[(n["stream"], dcode, g)]
            c = next(c for c in t["classes"] if c["code"] == wclass)
            lo, hi = c["lowerExclusiveG"], c["upperInclusiveG"]
            if (lo is not None and w <= lo) or (hi is not None and w > hi):
                iss.append(("WEIGHT_CLASS_MISMATCH", "WARNING"))

        # Age
        if dob is not None and dcode is not None and n["stream"] is not None:
            d = divisions[dcode]
            y = dob[0]
            if y > d["maxBirthYear"] or y < d["minBirthYear"]:
                same_stream = [x for x in rs["ageDivisions"] if n["stream"] in x["streams"] and x["minBirthYear"] <= y <= x["maxBirthYear"]]
                if y > d["maxBirthYear"] and len(same_stream) == 1 and d["order"] - same_stream[0]["order"] == 1 \
                        and d["playUp"] in ("ALLOW_WITH_WARNING", "ALLOW_ONE_DIVISION_WITH_WARNING"):
                    iss.append(("AGE_DIVISION_PLAY_UP", "WARNING"))
                else:
                    iss.append(("AGE_DIVISION_CONFLICT", "ERROR"))

        template = templates.get((n["stream"], n["discipline"], n["format"])) if n["stream"] else None
        n["template"] = template["code"] if template else None
        resolved = []
        for code, sev in iss:
            if sev is None:
                field = {"HEIGHT_MISSING": ["HEIGHT"], "WEIGHT_MISSING": ["WEIGHT"], "INVALID_NUMBER:HEIGHT": ["HEIGHT"], "INVALID_NUMBER:WEIGHT": ["WEIGHT"], "HEIGHT_OUT_OF_RANGE": ["HEIGHT"],
                         "WEIGHT_OUT_OF_RANGE": ["WEIGHT"], "HEIGHT_WEIGHT_LIKELY_SWAPPED": ["HEIGHT", "WEIGHT"]}[code]
                sev = "ERROR" if any(uses(template, f) for f in field) else "INFO"
            resolved.append((code, sev))
        row_issues[rid] = resolved
        norm[rid] = n

    # Persons
    persons: dict[str, list[str]] = defaultdict(list)
    for rid, n in norm.items():
        persons[n["nik"] if n["nik"] else f"ROW:{rid}"].append(rid)
    person_conflicts: dict[str, list[str]] = {}
    multi_contingent = 0
    for pk, rids in persons.items():
        ns = [norm[x] for x in rids]
        fields = []
        if len({n["name"].lower() for n in ns}) > 1:
            fields.append("FULL_NAME")
        if len({n["gender"] for n in ns}) > 1:
            fields.append("GENDER")
        if len({n["dob"] for n in ns}) > 1:
            fields.append("BIRTH_DATE")
        if len({n["h"] for n in ns}) > 1:
            fields.append("HEIGHT")
        if len({n["w"] for n in ns}) > 1:
            fields.append("WEIGHT")
        if len({n["belt"] for n in ns}) > 1:
            fields.append("BELT")
        if fields:
            person_conflicts[pk] = fields
        if len({n["contingent"] for n in ns}) > 1:
            multi_contingent += 1
    by_name_dob: dict = defaultdict(set)
    for pk, rids in persons.items():
        n = norm[rids[0]]
        by_name_dob[(n["name"].lower(), n["dob"])].add(pk)
    dup_pairs = sum(len(v) * (len(v) - 1) // 2 for v in by_name_dob.values() if len(v) > 1)
    person_of = {rid: pk for pk, rids in persons.items() for rid in rids}

    # Entries
    entries: list[dict] = []
    unresolved: list[str] = []
    groups: dict = defaultdict(list)
    for rid, n in norm.items():
        if n["format"] == "INDIVIDUAL":
            entries.append({"ref": rid, "members": [rid], "group": None})
        elif n["format"] == "PAIR":
            groups[("PAIR", n["stream"], n["discipline"], n["division"], n["contingent"])].append(rid)
        else:
            groups[("TEAM", n["stream"], n["discipline"], n["division"], n["contingent"], n["gender"])].append(rid)
    for gk, rids in sorted(groups.items(), key=lambda kv: str(kv[0])):
        comp = compositions[gk[0]]
        ns = [norm[x] for x in rids]
        if gk[0] == "PAIR":
            males = sum(1 for n in ns if n["gender"] == "MALE")
            females = sum(1 for n in ns if n["gender"] == "FEMALE")
            ok, ambiguous = (males, females) == (1, 1), males == females and males > 1
        else:
            ok, ambiguous = len(ns) == comp["size"], len(ns) % comp["size"] == 0 and len(ns) > comp["size"]
        if ok:
            entries.append({"ref": "G:" + "+".join(sorted(rids)), "members": sorted(rids), "group": "HEURISTIC/PROPOSED/HIGH"})
        else:
            code = "ENTRY_GROUP_AMBIGUOUS" if ambiguous else "ENTRY_GROUP_INCOMPLETE"
            for x in rids:
                row_issues[x].append((code, "ERROR"))
                unresolved.append(x)

    # Categories, entry issues, eligibility
    categories: Counter = Counter()
    category_stream: dict = {}
    entry_detail = {}
    blocked_total = 0
    blocked_by_stream: Counter = Counter()
    entry_issue_counts: Counter = Counter()
    for e in entries:
        ns = [norm[x] for x in e["members"]]
        n0 = ns[0]
        template = next((t for t in rs["categoryTemplates"] if t["code"] == n0["template"]), None)
        gaps: list[str] = []
        key = None
        if template is None:
            gaps.append("NO_CATEGORY_TEMPLATE")
        else:
            parts = [template["code"]]
            for dim in template["dimensions"]:
                if dim == "STREAM":
                    v = n0["stream"]
                elif dim == "DISCIPLINE":
                    v = n0["discipline"]
                elif dim == "FORMAT":
                    v = n0["format"]
                elif dim == "AGE_DIVISION":
                    v = n0["division"]
                elif dim == "GENDER":
                    genders = {n["gender"] for n in ns}
                    v = "MIXED" if template["genderMode"] == "MIXED" else (genders.pop() if len(genders) == 1 else None)
                elif dim == "WEIGHT_CLASS":
                    v = n0["class"]
                    if v is None and not any(c in ("UNKNOWN_CLASS", "AMBIGUOUS_WEIGHT_CLASS") for c, _ in row_issues[n0["id"]]):
                        gaps.append("UNKNOWN_CLASS")
                elif dim == "MOVEMENT":
                    mp = maps[template["movementMapCode"]]
                    scheme = schemes[mp["schemeCode"]]
                    # Every member must resolve to the same movement; the first member decides nothing.
                    moves = set()
                    for n in ns:
                        band = next((b["code"] for b in scheme["bands"] if n["belt"] in b["beltCodes"]), None)
                        moves.add(next((x["movement"] for x in mp["entries"] if x["bandCode"] == band), None))
                    v = moves.pop() if len(moves) == 1 else None
                    if v is None:
                        gaps.append("MOVEMENT_UNRESOLVED")
                else:
                    raise AssertionError(dim)
                parts.append(f"{dim}={v}")
            if not gaps and all(p.split("=", 1)[-1] != "None" for p in parts[1:]):
                key = "|".join(parts)
        e_issues = list(gaps)
        if e["group"] is not None:
            e_issues.append("ENTRY_GROUP_UNCONFIRMED")
        for c in e_issues:
            entry_issue_counts[c] += 1
        # person conflicts relevant to this entry
        conflict_error = False
        for x in e["members"]:
            fields = person_conflicts.get(person_of[x], [])
            usage = {"HEIGHT": "HEIGHT", "WEIGHT": "WEIGHT", "BELT": "BELT"}
            if any(uses(template, usage[f]) for f in fields if f in usage) or any(f in ("GENDER", "BIRTH_DATE", "FULL_NAME") for f in fields):
                conflict_error = True
        member_error = any(sev == "ERROR" for x in e["members"] for _, sev in row_issues[x])
        blocked = member_error or conflict_error or bool(e_issues) or key is None
        if key is not None:
            categories[key] += 1
            category_stream[key] = n0["stream"] + ":" + n0["discipline"]
        if blocked:
            blocked_total += 1
            blocked_by_stream[f"{n0['stream'] or '?'}:{n0['discipline'] or '?'}"] += 1
        entry_detail[e["ref"]] = {"members": e["members"], "category": key, "eligibility": "BLOCKED" if blocked else "READY"}

    issue_counts: Counter = Counter()
    severity_counts: Counter = Counter()
    for rid, lst in row_issues.items():
        for code, sev in lst:
            issue_counts[code.split(":")[0]] += 1
            if ":" in code:
                issue_counts[code] += 1
            severity_counts[f"{code.split(':')[0]}:{sev}"] += 1
    issue_counts["ATHLETE_ATTRIBUTE_CONFLICT"] = len(person_conflicts)
    issue_counts["ATHLETE_MULTIPLE_CONTINGENTS"] = multi_contingent
    issue_counts["POSSIBLE_DUPLICATE_PERSON"] = dup_pairs
    for c, k in entry_issue_counts.items():
        issue_counts[c] += k

    per_stream: Counter = Counter(category_stream[k] for k in categories)
    counts = {
        "schemaVersion": 1,
        "oracle": "O2_PYTHON_BASELINE",
        "rows": len(rows),
        "persons": len(persons),
        "entries": len(entries),
        "entryGroups": sum(1 for e in entries if e["group"] is not None),
        "entryGroupsByProvenance": dict(Counter(e["group"] for e in entries if e["group"] is not None)),
        "unresolvedRows": len(unresolved),
        "categories": len(categories),
        "categoriesByStream": dict(sorted(per_stream.items())),
        "blockedEntries": blocked_total,
        "blockedEntriesByStream": dict(sorted(blocked_by_stream.items())),
        "issueCounts": dict(sorted(issue_counts.items())),
        "issueSeverityCounts": dict(sorted(severity_counts.items())),
        "fieldOutcomes": dict(sorted(field_outcomes.items())),
    }
    Path(a.counts).parent.mkdir(parents=True, exist_ok=True)
    Path(a.counts).write_text(json.dumps(counts, indent=2) + "\n", encoding="utf-8")
    detail = {
        "rows": {rid: sorted(f"{c}:{s}" for c, s in lst) for rid, lst in row_issues.items()},
        "entries": entry_detail,
        "categories": dict(sorted(categories.items())),
    }
    Path(a.detail).parent.mkdir(parents=True, exist_ok=True)
    Path(a.detail).write_text(json.dumps(detail, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({k: counts[k] for k in ("rows", "persons", "entries", "entryGroups", "unresolvedRows", "categories", "blockedEntries")}))
    print(json.dumps(counts["categoriesByStream"]))
    print(json.dumps(counts["blockedEntriesByStream"]))
    print(json.dumps(counts["issueCounts"]))


if __name__ == "__main__":
    main()
