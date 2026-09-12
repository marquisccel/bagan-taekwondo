# Intake report — DATA_KOLEKTIF_FESTIVAL_PRESTASI - query_kolektif.csv

Report fingerprint `sha256:bf0640d2a208958c8f3642ab896f33e273ac9f6d169e01e55632bd4acd4b9f6f` · source `sha256:5b7539410cd7663c568113ba3a67d8bbace12fe123bed4a13d7b647254015cce` · snapshot `sha256:8a9569965fa506e8749a21b9a7e07b3a40db5f89a9246c4a1d918ff5e8318433`

## Pipeline

3154 rows → 3121 persons → 3115 entries (28 entry groups, 0 unresolved rows) → 238 categories; 49 entries blocked.

| Categories by stream       | n   |
| -------------------------- | --- |
| PRESTASI:FREESTYLE_POOMSAE | 9   |
| PRESTASI:KYORUGI           | 71  |
| PRESTASI:POOMSAE           | 17  |
| SEMI_PRESTASI:KYORUGI      | 105 |
| SEMI_PRESTASI:POOMSAE      | 36  |

| Entry groups (source/status/confidence) | n   |
| --------------------------------------- | --- |
| HEURISTIC/PROPOSED/HIGH                 | 28  |

| Blocked entries by stream  | n   |
| -------------------------- | --- |
| PRESTASI:FREESTYLE_POOMSAE | 3   |
| PRESTASI:POOMSAE           | 25  |
| SEMI_PRESTASI:KYORUGI      | 17  |
| SEMI_PRESTASI:POOMSAE      | 4   |

| Blocking reason              | entries |
| ---------------------------- | ------- |
| ENTRY_GROUP_UNCONFIRMED      | 28      |
| HEIGHT_MISSING               | 8       |
| HEIGHT_OUT_OF_RANGE          | 1       |
| HEIGHT_WEIGHT_LIKELY_SWAPPED | 11      |
| WEIGHT_MISSING               | 7       |

## Issues

| Issue                            | count |
| -------------------------------- | ----- |
| AGE_DIVISION_PLAY_UP             | 64    |
| ATHLETE_ATTRIBUTE_CONFLICT       | 1     |
| ATHLETE_MULTIPLE_CONTINGENTS     | 11    |
| BMI_IMPLAUSIBLE                  | 3     |
| CLASS_FORMAT_NORMALIZED          | 145   |
| DOB_POSSIBLE_PLACEHOLDER         | 14    |
| ENTRY_GROUP_UNCONFIRMED          | 28    |
| HEIGHT_MISSING                   | 9     |
| HEIGHT_OUT_OF_RANGE              | 1     |
| HEIGHT_WEIGHT_LIKELY_SWAPPED     | 12    |
| NIK_BIRTHDATE_MISMATCH           | 214   |
| NIK_BIRTHDATE_MISMATCH:DAY_MONTH | 155   |
| NIK_BIRTHDATE_MISMATCH:YEAR      | 59    |
| NIK_GENDER_MISMATCH              | 22    |
| NIK_INVALID_FORMAT               | 56    |
| NIK_NORMALIZED                   | 6     |
| WEIGHT_CLASS_MISMATCH            | 252   |
| WEIGHT_MISSING                   | 9     |
| WEIGHT_OUT_OF_RANGE              | 1     |

| Severity (all subjects) | count |
| ----------------------- | ----- |
| ERROR                   | 56    |
| INFO                    | 181   |
| WARNING                 | 611   |

## Field outcomes (RAW → NORMALIZED)

| field:outcome         | rows |
| --------------------- | ---- |
| belt:MAPPED           | 3154 |
| birthDate:UNCHANGED   | 3154 |
| class:MAPPED          | 700  |
| class:NORMALIZED      | 145  |
| class:UNCHANGED       | 2309 |
| classification:MAPPED | 3154 |
| division:MAPPED       | 3154 |
| gender:MAPPED         | 3154 |
| height:INVALID        | 9    |
| height:UNCHANGED      | 3145 |
| name:NORMALIZED       | 16   |
| name:UNCHANGED        | 3138 |
| nik:NORMALIZED        | 6    |
| nik:UNCHANGED         | 3148 |
| weight:INVALID        | 9    |
| weight:UNCHANGED      | 3145 |

| Class raw | normalized |
| --------- | ---------- |
| =+45      | +45        |
| =+53      | +53        |
| =+59      | +59        |
| =+65      | +65        |
| =+68      | +68        |
| =+73      | +73        |
| =+78      | +78        |
| =+87      | +87        |

| Suggestion rule (never applied) | count |
| ------------------------------- | ----- |
| SWAP_HEIGHT_WEIGHT              | 12    |

## Rule provenance usage

| provenance:rule                                    | uses |
| -------------------------------------------------- | ---- |
| ENGINEERING_DEFAULT:CONTINGENT_AS_GIVEN            | 3154 |
| ENGINEERING_DEFAULT:HEIGHT_CM_TO_MM                | 3145 |
| ENGINEERING_DEFAULT:HEIGHT_CM_TO_MM_MISSING        | 18   |
| ENGINEERING_DEFAULT:ISO_DATE                       | 3168 |
| ENGINEERING_DEFAULT:NAME_AS_GIVEN                  | 3138 |
| ENGINEERING_DEFAULT:NAME_WHITESPACE                | 16   |
| ENGINEERING_DEFAULT:NIK_16_DIGITS                  | 56   |
| ENGINEERING_DEFAULT:NIK_AS_GIVEN                   | 3148 |
| ENGINEERING_DEFAULT:NIK_ENCODED_DDMMYY             | 236  |
| ENGINEERING_DEFAULT:NIK_TRAILING_PUNCTUATION       | 12   |
| ENGINEERING_DEFAULT:PERSON_ATTRIBUTES_AGREE        | 1    |
| ENGINEERING_DEFAULT:PLAUSIBILITY                   | 17   |
| ENGINEERING_DEFAULT:SOURCE_ID                      | 3154 |
| ENGINEERING_DEFAULT:WEIGHT_CLASS_FORMAT            | 2599 |
| ENGINEERING_DEFAULT:WEIGHT_KG_TO_G                 | 3145 |
| ENGINEERING_DEFAULT:WEIGHT_KG_TO_G_MISSING         | 18   |
| EVIDENCE_2026:AGE_BIRTH_YEAR_BAND                  | 64   |
| EVIDENCE_2026:BELT_SOURCE_LABEL                    | 3154 |
| EVIDENCE_2026:CONTINGENT_PER_ENTRY                 | 11   |
| EVIDENCE_2026:SAME_CONTINGENT_CATEGORY_COMPOSITION | 28   |
| EVIDENCE_2026:VOCAB_CLASSIFICATION                 | 3154 |
| EVIDENCE_2026:VOCAB_DIVISION                       | 3154 |
| EVIDENCE_2026:VOCAB_FORMAT                         | 700  |
| EVIDENCE_2026:VOCAB_GENDER                         | 3154 |
| EVIDENCE_2026:WEIGHT_CLASS_TABLE                   | 252  |

## Differential

Aggregate vs Python baseline (O2): **0 differences**.
Row/entry detail vs Python baseline: 3154 rows and 3115 entries compared — **0 row and 0 entry differences**.

## Engine stages 1–4

Engine 0.1.0: UNSAFE (CATEGORY_BLOCKED, ENGINE_STAGE_NOT_IMPLEMENTED). Readiness policy for withheld entries: BLOCK_CATEGORY (ENGINEERING_DEFAULT). Singleton categories (1 eligible entry, decided at pooling by poolPolicies.singleton): 24.

| Metric                 | value |
| ---------------------- | ----- |
| entries                | 3115  |
| entriesMalformed       | 0     |
| entriesEligible        | 3066  |
| entriesWithheld        | 49    |
| intakeDisagreements    | 0     |
| categoryKeyMismatches  | 0     |
| categoryKeysUnverified | 0     |
| categories             | 238   |
| categoriesReady        | 207   |
| categoriesBlocked      | 31    |

| Template                    | ready | blocked |
| --------------------------- | ----- | ------- |
| FREESTYLE_INDIVIDUAL        | 6     | 0       |
| FREESTYLE_PAIR              | 0     | 3       |
| KYORUGI_PRESTASI            | 71    | 0       |
| KYORUGI_SEMI_PRESTASI       | 90    | 15      |
| POOMSAE_PRESTASI_INDIVIDUAL | 8     | 0       |
| POOMSAE_PRESTASI_PAIR       | 0     | 4       |
| POOMSAE_PRESTASI_TEAM       | 0     | 5       |
| POOMSAE_SEMI_PRESTASI       | 32    | 4       |
