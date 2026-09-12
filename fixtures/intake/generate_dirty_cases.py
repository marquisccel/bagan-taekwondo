"""Generates fixtures/intake/dirty-cases.csv — one synthetic row per data defect found in 2026.

Every person here is invented. NIK values are built to be consistent with gender and birth date
unless a case deliberately breaks that. Expected results live in dirty-cases.expected.json and are
written by hand from docs/PHASE2_PLAN.md, not generated from either implementation.

Usage: python fixtures/intake/generate_dirty_cases.py
"""

from __future__ import annotations

import csv
from pathlib import Path

OUT = Path(__file__).with_name("dirty-cases.csv")
COLUMNS = ["id_athlete", "nama_tim", "nik", "namalengkap", "jeniskelamin", "tanggallahir", "tinggibadan",
           "beratbadan", "sabuk", "klasifikasi", "divisi", "class", "tim_kontingen"]
M, F = "Laki-laki", "Perempuan"
KSP, KP, PSP, PP = "KYORUGI SEMI PRESTASI", "KYORUGI PRESTASI", "POOMSAE SEMI PRESTASI", "POOMSAE PRESTASI"
G9, G8, G7, G6, G3, G2 = ("GEUP 9 - KUNING", "GEUP 8 - KUNING STRIP HIJAU", "GEUP 7 - HIJAU",
                          "GEUP 6 - HIJAU STRIP BIRU", "GEUP 3 - MERAH", "GEUP 2 - MERAH STRIP 1")
UNICODE_MINUS = chr(0x2212)


def nik(dob: str, female: bool, seq: int, *, dd: int | None = None, mm: int | None = None, yy: int | None = None) -> str:
    y, m, d = dob.split("-")
    day = int(d) if dd is None else dd
    return f"357801{day + (40 if female and dd is None else 0):02d}{(int(m) if mm is None else mm):02d}{(int(y) % 100 if yy is None else yy):02d}{seq:04d}"


def row(i: str, name: str, g: str, dob: str, tb: str, bb: str, belt: str, klas: str, div: str, cls: str,
        cont: str = "Kota Uji 1", *, nik_value: str | None = None, nama_tim: str | None = None, seq: int = 0) -> dict:
    return {
        "id_athlete": i, "nama_tim": nama_tim if nama_tim is not None else cont,
        "nik": nik_value if nik_value is not None else nik(dob, g == F, seq),
        "namalengkap": name, "jeniskelamin": g, "tanggallahir": dob, "tinggibadan": tb, "beratbadan": bb,
        "sabuk": belt, "klasifikasi": klas, "divisi": div, "class": cls, "tim_kontingen": cont,
    }


def cases() -> list[dict]:
    multi = nik("2012-07-07", False, 9016)
    conflict = nik("2013-08-08", True, 9018)
    return [
        row("REG001", "REG CASE HEIGHT 734", M, "2013-05-10", "734.00", "40.00", G9, KSP, "CADET", "-41", seq=1),
        row("REG002", "REG CASE WEIGHT 420", F, "2013-06-11", "150.00", "420.00", G9, PSP, "CADET", "INDIVIDUAL", seq=2),
        row("REG003", "REG CASE SWAP A", M, "2010-03-15", "45.00", "160.00", G7, KSP, "JUNIOR", "-45", seq=3),
        row("REG004", "REG CASE SWAP B", F, "2018-08-28", "23.00", "122.00", G8, KSP, "PRA CADET B", "-24", seq=4),
        row("REG005", "REG CASE ZERO PRESTASI", M, "2012-10-12", "0.00", "0.00", G3, KP, "CADET", "-45", seq=5),
        row("REG006", "REG CASE ZERO HEIGHT SEMI", M, "2012-11-03", "0.00", "44.00", G6, KSP, "CADET", "-45", seq=6),
        row("REG007", "REG CASE NIK DOT", M, "2013-01-20", "155.00", "47.00", G9, KSP, "CADET", "-49",
            nik_value=nik("2013-01-20", False, 7) + "."),
        row("REG008", "REG CASE NIK GENDER", F, "2013-04-09", "150.00", "43.00", G9, KSP, "CADET", "-44",
            nik_value=nik("2013-04-09", False, 8)),
        row("REG009", "REG CASE NIK YEAR", M, "2012-09-30", "158.00", "48.00", G9, KSP, "CADET", "-49",
            nik_value=nik("2012-09-30", False, 9, yy=14)),
        row("REG010", "REG CASE NIK DAY MONTH", M, "2012-09-30", "160.00", "49.00", G9, KSP, "CADET", "-49",
            nik_value=nik("2012-09-30", False, 10, mm=10)),
        row("REG011", "REG CASE PLAY UP", M, "2015-02-14", "140.00", "36.00", G9, KSP, "CADET", "-37", seq=11),
        row("REG012", "REG CASE PLAY DOWN", M, "2008-05-05", "170.00", "54.00", G7, KSP, "JUNIOR", "-55", seq=12),
        row("REG013", "REG CASE FORMULA PLUS", F, "2016-03-03", "150.00", "56.00", G9, KSP, "PRA CADET C", "=+53", seq=13),
        row("REG014", "REG CASE BARE CLASS", F, "2016-04-04", "148.00", "52.00", G9, KSP, "PRA CADET C", "53", seq=14),
        row("REG015", "REG CASE SUFFIX PLUS", F, "2016-05-05", "152.00", "57.00", G9, KSP, "PRA CADET C", "53+", seq=15),
        row("REG016", "REG PERSON MULTI", M, "2012-07-07", "160.00", "48.00", G3, KP, "CADET", "-49", "Kota Uji 1", nik_value=multi),
        row("REG017", "REG PERSON MULTI", M, "2012-07-07", "160.00", "48.00", G3, PP, "CADET", "INDIVIDUAL", "Kota Uji 2", nik_value=multi),
        row("REG018", "REG PERSON BELT", F, "2013-08-08", "150.00", "40.00", G7, PSP, "CADET", "INDIVIDUAL", nik_value=conflict),
        row("REG019", "REG PERSON BELT", F, "2013-08-08", "150.00", "40.00", G6, PP, "CADET", "INDIVIDUAL", nik_value=conflict),
        row("REG020", "REG PAIR MALE", M, "2010-02-02", "160.00", "50.00", G3, PP, "JUNIOR", "PAIR", "Kota Uji 3", seq=20),
        row("REG021", "REG PAIR FEMALE", F, "2010-03-03", "158.00", "48.00", G3, PP, "JUNIOR", "PAIR", "Kota Uji 3", seq=21),
        row("REG022", "REG AMBIG MALE A", M, "2010-04-04", "160.00", "50.00", G3, PP, "JUNIOR", "PAIR", "Kota Uji 4", seq=22),
        row("REG023", "REG AMBIG MALE B", M, "2010-05-05", "162.00", "52.00", G3, PP, "JUNIOR", "PAIR", "Kota Uji 4", seq=23),
        row("REG024", "REG AMBIG FEMALE A", F, "2010-06-06", "156.00", "47.00", G3, PP, "JUNIOR", "PAIR", "Kota Uji 4", seq=24),
        row("REG025", "REG AMBIG FEMALE B", F, "2010-07-07", "157.00", "48.00", G3, PP, "JUNIOR", "PAIR", "Kota Uji 4", seq=25),
        row("REG026", "REG TEAM ONE", F, "2013-02-12", "150.00", "40.00", G3, PP, "CADET", "TEAM", "Kota Uji 5", seq=26),
        row("REG027", "REG TEAM TWO", F, "2013-03-13", "151.00", "41.00", G3, PP, "CADET", "TEAM", "Kota Uji 5", seq=27),
        row("REG028", "  reg   case  lowercase ", M, "2013-09-09", "150.00", "43.00", G9, KSP, "CADET", "-45", seq=28),
        row("REG029", "REG CASE INVALID DATE", M, "2012-02-30", "150.00", "44.00", G9, KSP, "CADET", "-45",
            nik_value=nik("2012-02-28", False, 29, dd=30)),
        row("REG030", "REG CASE UNKNOWN BELT", M, "2013-10-10", "150.00", "44.00", "GEUP 10 - PUTIH", KSP, "CADET", "-45", seq=30),
        row("REG031", "REG CASE COMMA DECIMAL", M, "2013-11-11", "150,5", "44.00", G9, KSP, "CADET", "-45", seq=31),
        row("REG032", "REG CASE BMI", F, "2014-05-06", "128.00", "16.00", G7, KP, "CADET", "-29", seq=32),
        row("REG033", "REG CASE CLASS MISMATCH", M, "2013-12-12", "155.00", "45.00", G9, KSP, "CADET", "-41", seq=33),
        row("REG034", "REG CASE DUP ID A", M, "2013-02-03", "150.00", "44.00", G9, KSP, "CADET", "-45", seq=34),
        row("REG034", "REG CASE DUP ID B", M, "2013-02-04", "150.00", "44.00", G9, KSP, "CADET", "-45", seq=35),
        row("REG036", "REG CASE DIVISION STREAM", M, "2020-03-03", "115.00", "18.00", G9, KP, "PRA CADET A", "-18", seq=36),
        row("REG037", "REG CASE UNKNOWN CLASSIFICATION", M, "2013-03-04", "150.00", "44.00", G9, "KYORUGI FESTIVAL", "CADET", "-45", seq=37),
        row("REG038", "REG CASE UNKNOWN GENDER", "L", "2013-03-05", "150.00", "44.00", G9, KSP, "CADET", "-45", seq=38),
        row("REG039", "REG CASE BAD WEIGHT", M, "2013-02-02", "150.00", "abc", G9, KSP, "CADET", "-45", seq=39),
        row("REG040", "REG CASE NO MOVEMENT", M, "2013-06-06", "150.00", "40.00", G2, PSP, "CADET", "INDIVIDUAL", seq=40),
        row("REG041", "REG CASE CONTINGENT FIELDS", M, "2013-07-17", "150.00", "44.00", G9, KSP, "CADET", "-45", nama_tim="Kota Uji 9", seq=41),
        row("REG042", "REG CASE JAN FIRST", M, "2012-01-01", "150.00", "44.00", G9, KSP, "CADET", "-45", seq=42),
        row("REG043", "REG CASE UNICODE MINUS", M, "2013-03-03", "150.00", "44.00", G9, KSP, "CADET", f"{UNICODE_MINUS}45", seq=43),
        row("REG044", "REG CASE FORMULA MINUS", M, "2013-04-04", "150.00", "44.00", G9, KSP, "CADET", "=-45", seq=44),
    ]


def main() -> None:
    with OUT.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(cases())
    print(f"wrote {OUT.name}: {len(cases())} rows")


if __name__ == "__main__":
    main()
