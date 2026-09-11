# PRD — Sistem Pembuatan Bagan Pertandingan Taekwondo

**Nama produk (kerja):** BaganTKD — Tournament Draw & Bracket Engine
**Versi dokumen:** 1.0 (Draft matang untuk review)
**Tanggal:** 9 September 2026
**Penulis:** Ega Yurcel Satriaji
**Status:** Draft for approval
**Referensi data:** `DATA_KOLEKTIF_FESTIVAL_PRESTASI - query_kolektif.csv` (3.153 atlet), `BAGAN PERTANDINGAN PIALA GUBERNUR ANTAR PELAJAR 2026` (23 PDF hasil, 4 hari, 7 arena)

---

## 1. Ringkasan Eksekutif

Pembuatan bagan (draw) pertandingan taekwondo saat ini dikerjakan manual di spreadsheet. Untuk satu event skala provinsi dengan ~3.000 peserta, proses ini memakan waktu berhari-hari, rawan salah, sulit diaudit, dan hampir mustahil diulang ketika ada perubahan data menit-menit terakhir (peserta batal, gagal timbang, protes kontingen).

BaganTKD adalah sistem yang mengubah proses tersebut menjadi:

1. **Import** data peserta (CSV/Excel dari sistem pendaftaran).
2. **Konfigurasi** aturan turnamen (kelas umur, kelas berat, toleransi TB/BB, banding sabuk, jumlah arena).
3. **Generate** pool dan bagan secara otomatis, deterministik, dan dapat dijelaskan (explainable).
4. **Koreksi** hasil lewat editor drag-and-drop dengan validasi real-time dan audit trail.
5. **Publikasi** dalam bentuk PDF bagan, daftar partai, scoresheet, dan jadwal arena.

Target utama: **waktu pembuatan draw untuk 5.000 peserta turun dari hitungan hari menjadi di bawah 1 jam**, dengan kualitas draw yang setara atau lebih baik daripada hasil manual, dan setiap keputusan penempatan dapat dipertanggungjawabkan ke kontingen.

---

## 2. Latar Belakang & Pernyataan Masalah

### 2.1 Kondisi saat ini

Berdasarkan artefak turnamen Piala Gubernur Jawa Timur Antar Pelajar 2026:

| Aspek                               | Kondisi sekarang                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Divisi prestasi (Kyorugi & Poomsae) | Digenerate oleh perangkat lunak pihak ketiga (TKD Tomato, lisensi 2015). Format bracket standar, penomoran partai per arena (A01, V01, …), dua medali perunggu. |
| Divisi **semi prestasi**            | **Dibuat manual di spreadsheet.** Ini adalah bottleneck utama.                                                                                                  |
| Freestyle Poomsae                   | Hanya daftar urutan penampilan, bukan bagan.                                                                                                                    |
| Perubahan/komplain                  | Edit manual di spreadsheet, tanpa versioning, tanpa validasi ulang.                                                                                             |
| Distribusi                          | Ekspor PDF manual per arena per hari.                                                                                                                           |

### 2.2 Mengapa semi prestasi mahal secara manual

Semi prestasi tidak cukup dibagi berdasarkan kelas berat saja. Satu kelas resmi masih harus dipecah lagi menjadi beberapa bagan berdasarkan kesetaraan sabuk, tinggi badan, dan berat badan — inilah pekerjaan yang dilakukan tangan.

Bukti dari data aktual (1.863 atlet Kyorugi Semi Prestasi):

- Terbentuk **105 grup kelas** (gender × divisi umur × kelas berat).
- Ukuran grup: minimum 1, median 15, **maksimum 86**.
- Grup terbesar — `Laki-laki / PRA CADET C / -30` dengan 86 atlet — memiliki:
  - rentang tinggi badan **120–154 cm** (span 34 cm, jauh melewati toleransi 5 cm),
  - **7 tingkat sabuk berbeda** (GEUP 9 s.d. GEUP 3).
- Untuk Poomsae Semi Prestasi: 12 grup, terbesar **135 atlet** dalam satu grup.

Artinya operator manual harus, untuk setiap grup, melakukan sortir multi-kriteria, memotong grup jadi pool-pool yang setara, memastikan tidak ada bagan berisi satu kontingen saja, lalu menyusun bracket berikut bye — dan mengulanginya untuk ratusan grup.

### 2.3 Kendala struktural yang harus diakui sistem

Distribusi kontingen sangat timpang:

| Kontingen            | Jumlah atlet | Porsi |
| -------------------- | ------------ | ----- |
| Kota Surabaya 2      | 848          | 26,9% |
| Kabupaten Sidoarjo 2 | 331          | 10,5% |
| Kota Malang 1        | 175          | 5,5%  |
| 86 kontingen lainnya | 1.799        | 57,1% |

Konsekuensi desain: aturan _"diusahakan setiap bagan ada kontingen lain"_ **tidak dapat diperlakukan sebagai hard constraint**. Pada 29 dari 105 grup semi prestasi, satu kontingen menguasai >50% peserta grup. Sistem harus memperlakukannya sebagai **soft constraint dengan fungsi penalti yang diminimalkan**, lalu melaporkan secara transparan pool mana yang tidak bisa dipenuhi dan mengapa.

---

## 3. Tujuan & Non-Tujuan

### 3.1 Tujuan (Goals)

| Kode | Tujuan                                      | Ukuran keberhasilan                                                                                      |
| ---- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| G1   | Otomasi pembuatan bagan end-to-end          | 5.000 peserta ter-draw penuh < 60 menit termasuk review                                                  |
| G2   | Kualitas draw setara/lebih baik dari manual | ≥95% pool memenuhi toleransi TB/BB; ≥90% pool berisi ≥2 kontingen (jika feasible)                        |
| G3   | Reproducible & auditable                    | Draw yang sama dengan input & seed yang sama menghasilkan output byte-identik; setiap perubahan tercatat |
| G4   | Koreksi cepat saat komplain                 | Perubahan penempatan atlet < 10 detik lewat drag-and-drop, dengan validasi otomatis                      |
| G5   | Dapat dipakai lintas turnamen               | Seluruh aturan (kelas umur, kelas berat, toleransi, banding sabuk) berupa konfigurasi, bukan hard-code   |
| G6   | Siap dipakai di venue                       | Ekspor PDF/print, mode offline, tidak bergantung koneksi stabil                                          |

### 3.2 Non-Tujuan (v1)

- Bukan sistem pendaftaran/registrasi peserta (menerima data dari sistem lain via import).
- Bukan sistem penilaian/scoring elektronik (tidak menggantikan Daedo/KPNP), namun menyediakan API untuk menerima hasil.
- Bukan sistem pembayaran, akomodasi, atau akreditasi.
- Tidak melakukan ranking nasional/seeding points otomatis di v1 (input manual seed diperbolehkan).

---

## 4. Pengguna & Persona

| Persona                               | Peran                                     | Kebutuhan utama                                         |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| **Panitia Teknis / Drawing Officer**  | Menjalankan draw, mengoreksi hasil        | Kontrol penuh, undo/redo, alasan tiap penempatan        |
| **Technical Delegate / Wasit Kepala** | Menyetujui & mengunci bagan               | Approval, lock, versi resmi, laporan kepatuhan aturan   |
| **Admin Turnamen**                    | Setup event, kelas, arena, jadwal         | Template turnamen, konfigurasi ulang cepat              |
| **Manajer Kontingen**                 | Melihat bagan timnya, mengajukan komplain | Akses read-only terfilter, jadwal atlet, kanal komplain |
| **Operator Arena**                    | Menjalankan partai di lapangan            | Daftar partai urut, scoresheet, update pemenang         |
| **Peserta & Penonton**                | Melihat bagan publik                      | Halaman publik read-only, ringan, mobile                |

---

## 5. Model Domain & Glosarium

| Istilah          | Definisi dalam sistem                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tournament**   | Satu penyelenggaraan (mis. Piala Gubernur 2026). Memuat konfigurasi aturan, arena, dan hari lomba.                                                  |
| **Contingent**   | Tim/kontingen pengirim atlet (`tim_kontingen`).                                                                                                     |
| **Athlete**      | Peserta individu; atribut: NIK, nama, gender, tanggal lahir, TB, BB, sabuk, kontingen.                                                              |
| **Entry**        | Pendaftaran satu atlet (atau satu tim/pair) ke satu **Category**. Satu atlet bisa punya banyak entry.                                               |
| **Category**     | Kombinasi resmi: `event × klasifikasi × divisi umur × gender × class`. Contoh: Kyorugi Semi Prestasi / Cadet / Putra / -41.                         |
| **Class**        | Batas kelas: kelas berat (`-41`, `+65`) untuk kyorugi, atau tipe penampilan (`INDIVIDUAL`, `PAIR`, `TEAM`) untuk poomsae.                           |
| **Pool (Bagan)** | Sub-himpunan atlet dalam satu Category yang benar-benar bertanding satu sama lain dalam satu bracket. Satu Category dapat menghasilkan banyak Pool. |
| **Bracket**      | Struktur pertandingan single-elimination untuk satu Pool, ukuran slot 2^k.                                                                          |
| **Slot**         | Posisi di ronde pertama bracket; dapat berisi atlet atau **BYE**.                                                                                   |
| **BYE**          | Slot kosong; lawan otomatis lolos ke ronde berikutnya tanpa bertanding.                                                                             |
| **Dummy**        | Penanda khusus untuk Pool berisi 1 atlet (menang tanpa lawan / walkover).                                                                           |
| **Match**        | Satu partai; punya nomor unik per arena (mis. `A17`), ronde, dua slot sumber.                                                                       |
| **Draw Run**     | Satu eksekusi algoritma; menyimpan input snapshot, parameter, seed acak, dan hasil. Immutable.                                                      |
| **Toleransi**    | Batas selisih TB/BB yang masih dianggap setara dalam satu Pool.                                                                                     |
| **Belt Band**    | Pengelompokan tingkat sabuk yang dianggap setara (mis. GEUP 10–8 = Pemula).                                                                         |

### 5.1 Diagram relasi (ringkas)

```
Tournament 1─n Category 1─n Pool 1─1 Bracket 1─n Match
Tournament 1─n Contingent 1─n Athlete 1─n Entry n─1 Category
DrawRun 1─n Pool          DrawRun n─1 Tournament
Pool 1─n Slot n─0..1 Entry
Arena 1─n Session 1─n Match
```

---

## 6. Ruang Lingkup

### 6.1 In-scope v1 (MVP produksi)

- Import & validasi peserta (CSV/XLSX), pemetaan kolom, deteksi duplikat.
- Konfigurasi kelas umur, kelas berat, toleransi, belt band per turnamen.
- Mesin pembentukan Pool untuk **semi prestasi** (kyorugi & poomsae).
- Mesin bracket + seeding + penempatan bye untuk **semua** divisi.
- Contingent separation (soft constraint) dengan laporan pelanggaran.
- Editor drag-and-drop, validasi real-time, undo/redo, versioning, lock.
- Ekspor PDF bagan per arena/hari, daftar partai, scoresheet, XLSX.
- Role-based access, audit log.

### 6.2 In-scope v2

- Penjadwalan arena otomatis (mat allocation, estimasi durasi, waktu istirahat atlet).
- Live result entry → progresi pemenang otomatis di bracket.
- Halaman publik & tampilan layar venue.
- Workflow komplain formal (pengajuan, review, keputusan, re-draw parsial).

### 6.3 Out of scope

Registrasi, pembayaran, sertifikat, integrasi scoring board vendor, aplikasi mobile native.

---

## 7. Aturan Bisnis (Rulebook)

Bagian ini adalah spesifikasi normatif. Semua nilai adalah **default yang dapat dikonfigurasi** per turnamen, kecuali dinyatakan tetap.

### BR-1 — Kriteria pembagian (hard partition)

Dua atlet **tidak boleh** berada dalam Pool yang sama jika berbeda pada salah satu dari:

| Divisi                    | Kriteria hard                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Kyorugi (prestasi & semi) | event, gender, divisi umur, kelas berat                                                      |
| Poomsae (prestasi & semi) | event, gender, divisi umur, tipe penampilan (INDIVIDUAL/PAIR/TEAM), kategori gerakan poomsae |

### BR-2 — Kriteria pemisah lanjutan untuk **semi prestasi** (soft/tolerable)

Dalam satu Category semi prestasi, Pool dibentuk lebih lanjut mempertimbangkan, berurut prioritas:

1. **Belt band** (default: hard — tidak boleh lintas band; dapat dilonggarkan bila pool terlalu kecil).
2. **Berat badan** — selisih maksimum dalam satu Pool ≤ `tol_bb` (default **5 kg**).
3. **Tinggi badan** — selisih maksimum dalam satu Pool ≤ `tol_tb` (default **5 cm**).
4. **Kontingen** — hindari Pool yang seluruh anggotanya satu kontingen.

`tol_tb` dan `tol_bb` dapat berbeda per divisi umur dan per kelas. Contoh konfigurasi wajar:

| Divisi umur     | tol_tb | tol_bb |
| --------------- | ------ | ------ |
| Pra Cadet A/B/C | 5 cm   | 3 kg   |
| Cadet           | 5 cm   | 5 kg   |
| Junior          | 6 cm   | 5 kg   |
| Senior          | 8 cm   | 5 kg   |

Sistem harus mendukung **dua tingkat toleransi**: `tol` (ideal) dan `tol_max` (batas darurat saat pool tidak feasible). Pelanggaran di antara keduanya diberi tanda peringatan; di atas `tol_max` ditolak dan dieskalasi ke operator.

### BR-3 — Belt band default

| Band   | Sabuk (dari data aktual)                                          |
| ------ | ----------------------------------------------------------------- |
| Pemula | GEUP 10, GEUP 9 (Kuning), GEUP 8 (Kuning strip hijau)             |
| Madya  | GEUP 7 (Hijau), GEUP 6 (Hijau strip biru), GEUP 5 (Biru)          |
| Lanjut | GEUP 4 (Biru strip merah), GEUP 3 (Merah), GEUP 2 (Merah strip 1) |
| Mahir  | GEUP 1 (Merah strip 2), HITAM DAN 1–3                             |

Band dapat diubah, digabung, atau dipecah per turnamen.

### BR-4 — Ukuran Pool

| Parameter        | Default                  | Keterangan                                                |
| ---------------- | ------------------------ | --------------------------------------------------------- |
| `pool_min`       | 3                        | Di bawah ini, coba gabung dengan Pool tetangga            |
| `pool_target`    | 8                        | Ukuran ideal (bracket penuh 3 ronde)                      |
| `pool_max`       | 16                       | Di atas ini, Pool dipecah                                 |
| Prioritas ukuran | 8 > 4 > 6 > 16 > lainnya | Bracket penuh (power of 2) lebih disukai karena tanpa bye |

### BR-5 — Struktur bracket berdasarkan jumlah atlet **n**

Aturan formal (menggeneralisasi contoh yang diberikan pemangku kepentingan):

1. Ukuran bracket `S = 2^ceil(log2(n))`, minimum `S = 2`.
2. Jumlah BYE `= S − n`.
3. Distribusi BYE mengikuti **pembelahan berimbang rekursif**: bracket dibelah dua, atlet dibagi `ceil(n/2)` pada paruh atas dan `floor(n/2)` pada paruh bawah; aturan diterapkan rekursif hingga tersisa slot tunggal.
4. `n = 1` → Pool **Dummy**: atlet menang tanpa lawan (walkover), tetap dicetak di bagan dengan slot lawan bertanda DUMMY, dan dilaporkan ke Technical Delegate untuk keputusan (naik kelas, digabung, atau juara langsung).

Verifikasi terhadap contoh yang diminta:

| n   | S   | BYE | Pembelahan          | Hasil sesuai permintaan                  |
| --- | --- | --- | ------------------- | ---------------------------------------- |
| 1   | 2   | 1   | 1 + 0               | Dummy, langsung juara ✔                  |
| 2   | 2   | 0   | 1 + 1               | 1 partai final ✔                         |
| 3   | 4   | 1   | 2 + 1               | 1 semifinal, 1 orang menunggu di final ✔ |
| 4   | 4   | 0   | 2 + 2               | 2 semifinal + 1 final ✔                  |
| 5   | 8   | 3   | 3 + 2               | paruh 3 dan paruh 2 ✔                    |
| 6   | 8   | 2   | 3 + 3               | paruh 3 dan paruh 3 ✔                    |
| 7   | 8   | 1   | 4 + 3               | paruh 4 dan paruh 3 ✔                    |
| 8   | 8   | 0   | 4 + 4               | paruh 4 dan paruh 4 ✔                    |
| 12  | 16  | 4   | 6 + 6 → (3+3)+(3+3) | konsisten                                |
| 22  | 32  | 10  | 11 + 11             | konsisten                                |

### BR-6 — Contingent separation

- **Hard:** dua atlet dari kontingen yang sama tidak boleh bertemu di ronde pertama, **jika** jumlah kontingen berbeda dalam Pool memungkinkan.
- **Soft:** maksimalkan ronde pertemuan pertama antar-atlet sekontingen. Penalti pasangan sekontingen yang bertemu di ronde `r` dari total `R` ronde: `P = 2^(R − r)` (bertemu makin awal makin mahal).
- **Soft:** setiap Pool diusahakan memuat ≥2 kontingen. Bila tidak mungkin (kontingen dominan), Pool ditandai `SINGLE_CONTINGENT` dan operator diberi opsi menukar atlet dengan Pool tetangga yang masih dalam toleransi.
- Kontingen dengan jumlah atlet besar disebar ke kuadran bracket berbeda terlebih dahulu (largest-first distribution).

### BR-7 — Medali

Default: 1 emas, 1 perak, **2 perunggu** (kedua yang kalah di semifinal), sesuai praktik pada artefak turnamen. Dapat dikonfigurasi menjadi 1 perunggu dengan partai perebutan juara 3.

### BR-8 — Perhitungan umur & kelas

- Divisi umur ditentukan dari `tanggallahir` terhadap **tanggal cut-off** turnamen (konfigurasi; default 31 Desember tahun penyelenggaraan).
- Kelas berat mengikuti tabel kelas per divisi umur; format `-NN` (di bawah) dan `+NN` (di atas). Parser wajib menerima varian penulisan `=+65`, `+65`, `65+`.
- Bila `beratbadan` aktual keluar dari kelas terdaftar melebihi ambang, entry ditandai `WEIGHT_MISMATCH` dan tidak di-draw sebelum diselesaikan operator.

### BR-9 — Penomoran partai

- Nomor partai unik per arena per hari, format `<KodeArena><NomorUrut>` (mis. `A01`, `V12`).
- Urutan penomoran mengikuti urutan pelaksanaan: seluruh ronde 1 lintas pool pada arena tersebut, lalu ronde 2, dan seterusnya (mengikuti pola pada artefak turnamen).

### BR-10 — Status entry

`REGISTERED` → `VERIFIED` (lolos timbang) → `DRAWN` → `WITHDRAWN` / `DQ` / `NO_SHOW`. Hanya entry `VERIFIED` yang masuk draw, kecuali mode "draw sementara" diaktifkan.

---

## 8. Requirement Fungsional

Notasi prioritas: **M** = Must (v1), **S** = Should (v1 bila memungkinkan), **C** = Could (v2).

### FR-1 Import & Validasi Data — M

| ID     | Requirement                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-1.1 | Import CSV/XLSX dengan wizard pemetaan kolom; simpan preset pemetaan per sumber data.                                                            |
| FR-1.2 | Validasi wajib: NIK, nama, gender, tanggal lahir, TB, BB, sabuk, klasifikasi, divisi, class, kontingen.                                          |
| FR-1.3 | Normalisasi otomatis: gender (`Laki-laki`/`L`/`M` → `M`), sabuk (`GEUP 5 - BIRU` → `GEUP_5`), kelas (`=+65` → `+65`), desimal TB/BB.             |
| FR-1.4 | Deteksi duplikat berdasarkan NIK, dan berdasarkan (nama + tanggal lahir) sebagai kandidat lemah.                                                 |
| FR-1.5 | Laporan kualitas data: baris ditolak, nilai di luar rentang wajar (mis. TB < 90 cm atau > 220 cm), umur tidak cocok divisi, kelas tidak dikenal. |
| FR-1.6 | Import bersifat transaksional: gagal sebagian tidak merusak data existing; tersedia dry-run.                                                     |
| FR-1.7 | Import ulang (re-import) melakukan upsert berdasarkan NIK dan menandai perubahan TB/BB/kelas yang berdampak pada draw yang sudah dibuat.         |

### FR-2 Konfigurasi Turnamen — M

| ID     | Requirement                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| FR-2.1 | CRUD turnamen: nama, tanggal, tanggal cut-off umur, lokasi, jumlah & kode arena, jumlah hari.               |
| FR-2.2 | Editor tabel divisi umur (nama, rentang tahun lahir/umur).                                                  |
| FR-2.3 | Editor tabel kelas berat per divisi umur per gender.                                                        |
| FR-2.4 | Editor kategori poomsae (individual/pair/team, kelompok gerakan wajib per divisi).                          |
| FR-2.5 | Editor belt band.                                                                                           |
| FR-2.6 | Editor toleransi `tol_tb`, `tol_bb`, `tol_max_tb`, `tol_max_bb` per divisi umur, dengan override per kelas. |
| FR-2.7 | Editor parameter pool: `pool_min`, `pool_target`, `pool_max`, bobot penalti algoritma.                      |
| FR-2.8 | Template turnamen: simpan seluruh konfigurasi untuk dipakai ulang di event berikutnya.                      |

### FR-3 Klasifikasi Peserta — M

| ID     | Requirement                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------- |
| FR-3.1 | Hitung umur & tetapkan divisi umur otomatis; tampilkan konflik bila berbeda dengan data pendaftaran.                |
| FR-3.2 | Tetapkan kelas berat otomatis dari BB aktual; tampilkan konflik terhadap kelas terdaftar.                           |
| FR-3.3 | Modul timbang ulang (weigh-in): input BB & TB aktual di venue, dengan jejak siapa dan kapan.                        |
| FR-3.4 | Perubahan hasil timbang otomatis menandai Category & Pool terdampak sebagai `STALE` dan menawarkan re-draw parsial. |

### FR-4 Pembentukan Pool (Semi Prestasi) — M

| ID     | Requirement                                                                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-4.1 | Bentuk Pool otomatis sesuai algoritma pada Bab 9, per Category.                                                                                                                          |
| FR-4.2 | Setiap Pool menyimpan **metrik kualitas**: jumlah atlet, rentang TB, rentang BB, daftar band sabuk, jumlah kontingen unik, porsi kontingen terbesar, jumlah pelanggaran soft constraint. |
| FR-4.3 | Setiap Pool menyimpan **alasan pembentukan** (explainability): batas potong yang dipakai dan constraint mana yang mengikat.                                                              |
| FR-4.4 | Pool berukuran < `pool_min` otomatis dicoba digabung dengan Pool tetangga terdekat dalam batas `tol_max`; bila gagal, ditandai untuk keputusan manual.                                   |
| FR-4.5 | Operator dapat mengunci Pool tertentu (`PINNED`) sehingga tidak berubah pada re-draw berikutnya.                                                                                         |
| FR-4.6 | Mode "what-if": jalankan draw dengan parameter berbeda dan bandingkan metrik kualitas berdampingan sebelum memilih.                                                                      |

### FR-5 Generate Bracket & Seeding — M

| ID     | Requirement                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-5.1 | Bangun bracket single-elimination sesuai BR-5 untuk setiap Pool.                                                                                                        |
| FR-5.2 | Tempatkan BYE sesuai pembelahan berimbang rekursif.                                                                                                                     |
| FR-5.3 | Terapkan contingent separation sesuai BR-6.                                                                                                                             |
| FR-5.4 | Dukung seed manual (1..k) untuk divisi prestasi; seed ditempatkan pada posisi standar (seed 1 slot teratas, seed 2 slot terbawah, seed 3/4 di tengah paruh berlawanan). |
| FR-5.5 | Bila tidak ada seed, urutan penempatan ditentukan RNG **berbenih** (seeded) yang disimpan pada Draw Run agar dapat direproduksi.                                        |
| FR-5.6 | Alokasikan nomor partai per arena sesuai BR-9.                                                                                                                          |
| FR-5.7 | Dukung generate ulang selektif: satu Category, satu Pool, atau seluruh turnamen.                                                                                        |

### FR-6 Editor Bagan (Drag & Drop) — M

| ID      | Requirement                                                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-6.1  | Tampilan bracket interaktif; atlet dapat di-drag antar slot dalam satu Pool.                                                                                                     |
| FR-6.2  | Atlet dapat di-drag antar Pool dalam satu Category.                                                                                                                              |
| FR-6.3  | Atlet dapat dipindah antar Category (mis. naik kelas berat) dengan konfirmasi eksplisit.                                                                                         |
| FR-6.4  | Validasi real-time saat drag: highlight hijau (aman), kuning (melanggar soft constraint — tampilkan alasan), merah (melanggar hard constraint — drop ditolak dengan penjelasan). |
| FR-6.5  | Tukar posisi (swap) dua atlet dengan satu aksi.                                                                                                                                  |
| FR-6.6  | Undo/redo minimal 50 langkah; riwayat bertahan selama sesi.                                                                                                                      |
| FR-6.7  | Setiap perubahan tercatat di audit log: siapa, kapan, dari mana ke mana, alasan (wajib bila melanggar soft constraint).                                                          |
| FR-6.8  | Auto-recalculate: nomor partai, jumlah bye, dan metrik kualitas Pool diperbarui otomatis setelah perubahan.                                                                      |
| FR-6.9  | Bagan dapat dikunci (`LOCKED`) oleh Technical Delegate; setelah terkunci hanya dapat diubah dengan membuat **revisi** baru bernomor.                                             |
| FR-6.10 | Performa: drag-drop responsif (< 100 ms feedback) pada Category dengan hingga 200 atlet dan 25 Pool.                                                                             |

### FR-7 Manajemen Perubahan & Komplain — S

| ID     | Requirement                                                                                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-7.1 | Catat komplain terkait bagan: pengaju, Pool/atlet terkait, alasan, lampiran.                                                                                                           |
| FR-7.2 | Status komplain: `OPEN` → `UNDER_REVIEW` → `ACCEPTED`/`REJECTED`, dengan keputusan tertulis.                                                                                           |
| FR-7.3 | Komplain yang diterima dapat langsung memicu aksi editor (pindah atlet / re-draw Pool) yang tertaut ke nomor komplain.                                                                 |
| FR-7.4 | Penanganan WO/DQ/withdraw: atlet ditandai, lawan otomatis lolos, bracket tidak dibangun ulang total.                                                                                   |
| FR-7.5 | Pendaftaran terlambat: sisipkan atlet ke Pool yang masih memenuhi toleransi, atau bentuk Pool baru; hindari mengubah nomor partai yang sudah dicetak (gunakan sub-nomor, mis. `A17A`). |

### FR-8 Penjadwalan Arena — C (v2, dasar di v1)

| ID     | Requirement                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-8.1 | Assign Category/Pool ke arena dan hari (v1: manual, dibantu saran otomatis).                                                                                             |
| FR-8.2 | Estimasi durasi partai per divisi (parameter menit/partai + jeda) dan estimasi waktu selesai arena.                                                                      |
| FR-8.3 | (v2) Penjadwalan otomatis dengan constraint: satu atlet tidak dijadwalkan di dua arena bersamaan; jeda minimum antar partai untuk atlet yang sama; beban arena seimbang. |

### FR-9 Ekspor & Publikasi — M

| ID     | Requirement                                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-9.1 | Ekspor PDF bagan per arena per hari, dengan header turnamen, nama kategori, jumlah peserta, tanggal, dan blok medali. Layout mengikuti standar yang sudah dikenal panitia. |
| FR-9.2 | Ekspor PDF daftar partai (match list) urut nomor.                                                                                                                          |
| FR-9.3 | Ekspor scoresheet per partai.                                                                                                                                              |
| FR-9.4 | Ekspor XLSX: daftar peserta per Pool, rekap kategori, rekap kontingen.                                                                                                     |
| FR-9.5 | Ekspor daftar urutan penampilan untuk Freestyle Poomsae (tanpa bracket).                                                                                                   |
| FR-9.6 | Semua ekspor mencantumkan **nomor revisi bagan dan timestamp** untuk mencegah beredarnya versi usang.                                                                      |
| FR-9.7 | (v2) Halaman publik read-only per turnamen dan per kontingen, ramah mobile.                                                                                                |

### FR-10 Akses, Audit, Keamanan — M

| ID      | Requirement                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| FR-10.1 | Peran: Super Admin, Admin Turnamen, Drawing Officer, Technical Delegate, Operator Arena, Manajer Kontingen (read-only terfilter), Publik. |
| FR-10.2 | Audit log immutable untuk semua aksi yang mengubah draw.                                                                                  |
| FR-10.3 | Draw Run bersifat immutable; perubahan menghasilkan revisi baru dengan diff terhadap revisi sebelumnya.                                   |
| FR-10.4 | Data pribadi (NIK, tanggal lahir) tidak ditampilkan pada ekspor publik dan dibatasi berdasarkan peran.                                    |

---

## 9. Spesifikasi Algoritma

Bagian ini adalah inti teknis produk. Algoritma dirancang **deterministik, dapat dijelaskan, dan cepat**.

### 9.1 Prinsip desain

1. **Deterministik.** Semua keacakan berasal dari satu PRNG berbenih; benih disimpan pada Draw Run. Input + parameter + benih yang sama ⇒ output identik.
2. **Bertingkat (hierarchical).** Masalah dipecah menjadi tahap-tahap yang masing-masing dapat diselesaikan optimal atau mendekati optimal, alih-alih satu masalah optimasi raksasa yang tidak dapat dijelaskan ke pemangku kepentingan.
3. **Dapat dijelaskan.** Setiap keputusan menyimpan alasan yang bisa dibaca manusia ("dipotong di berat 32,0 kg karena selisih ke atlet berikutnya 3,5 kg dan toleransi 5 kg akan terlampaui bila digabung").
4. **Fail-loud.** Constraint yang tidak dapat dipenuhi tidak disembunyikan; dilaporkan sebagai temuan dengan opsi perbaikan.

### 9.2 Tahap 0 — Normalisasi

Untuk setiap entry: hitung `age_division` dari tanggal lahir & cut-off; petakan sabuk → `belt_rank` (integer, GEUP 10 = 1 … DAN 3 = 13) dan `belt_band`; normalisasi kelas; validasi TB/BB. Entry tidak valid dikeluarkan dari draw dan masuk laporan.

### 9.3 Tahap 1 — Partisi keras (hard partition)

Kelompokkan entry berdasarkan kunci:

```
key = (event, klasifikasi, age_division, gender, class[, poomsae_group])
```

Setiap kelompok = satu **Category**. Untuk divisi **prestasi**, Category langsung menjadi satu Pool (lanjut ke Tahap 3). Untuk **semi prestasi**, lanjut ke Tahap 2.

Kompleksitas: O(N).

### 9.4 Tahap 2 — Pembentukan Pool untuk semi prestasi

Diberikan Category `C` berisi `m` atlet. Tujuan: partisi `C` menjadi Pool-Pool yang meminimalkan biaya total.

#### 9.4.1 Formulasi

Partisi ideal dengan constraint diameter (setiap cluster punya rentang TB ≤ `tol_tb` dan BB ≤ `tol_bb`) adalah masalah **constrained clustering** yang NP-hard secara umum. Karena atribut yang mengikat bersifat **ordinal satu dimensi pada tiap sumbu** (berat, tinggi), sistem menggunakan pendekatan **segmentasi kontigu bertingkat dengan pemrograman dinamis (DP)** — optimal terhadap urutan yang diberikan, deterministik, dan berjalan dalam O(m²).

#### 9.4.2 Prosedur

```
POOLS(C):
  1. Bagi C berdasarkan belt_band  → sub-grup B1..Bk        (hard by default)
  2. Untuk setiap Bi:
       a. Urutkan berdasarkan berat badan (tie-break: tinggi, lalu id stabil)
       b. Segmentasi-DP pada sumbu BERAT           → segmen W1..Wp
       c. Untuk setiap Wj:
            - Urutkan berdasarkan tinggi badan
            - Segmentasi-DP pada sumbu TINGGI      → pool kandidat
  3. Perbaikan (repair):
       a. Gabungkan pool berukuran < pool_min dengan tetangga terdekat
          selama masih ≤ tol_max
       b. Pecah pool berukuran > pool_max
       c. Injeksi keragaman kontingen (9.4.5)
  4. Kembalikan pool final + metrik + alasan
```

#### 9.4.3 Fungsi biaya segmentasi

Untuk segmen `s` yang berisi atlet berurutan `i..j`:

```
cost(s) = W_range   * f_range(s)
        + W_size    * f_size(|s|)
        + W_conting * f_contingent(s)

f_range(s)      = max(0, range_bb(s) − tol_bb)² + max(0, range_tb(s) − tol_tb)²
                  (jika range > tol_max → cost = +INF, segmen tidak sah)

f_size(n)       = 0      jika n ∈ {4, 8}        (bracket penuh, tanpa bye)
                = 0.5    jika n ∈ {5,6,7,9..16}
                = 2.0    jika n = 3
                = 8.0    jika n = 2
                = 25.0   jika n = 1             (butuh dummy)
                = +INF   jika n > pool_max

f_contingent(s) = (share_kontingen_terbesar(s) − 1/|kontingen(s)|)² · |s|
                  ; maksimum bila seluruh anggota berasal dari satu kontingen
```

Bobot default: `W_range = 10`, `W_size = 3`, `W_conting = 2`. Semua bobot dapat dikonfigurasi (FR-2.7) sehingga panitia dapat menggeser prioritas antara "kesetaraan fisik" dan "keragaman kontingen".

#### 9.4.4 Rekurens DP

Dengan `A[1..m]` terurut dan `D[j]` = biaya minimum mempartisi `A[1..j]`:

```
D[0] = 0
D[j] = min atas i < j dari ( D[i] + cost(A[i+1..j]) )
```

Backpointer menyimpan titik potong sehingga alasan pemotongan dapat direkonstruksi untuk explainability. Kompleksitas O(m²) waktu, O(m) memori; dengan `m` maksimum 135 pada data aktual, biayanya dapat diabaikan.

#### 9.4.5 Injeksi keragaman kontingen

Setelah segmentasi, untuk setiap Pool `P` yang hanya berisi satu kontingen:

1. Cari Pool tetangga `Q` (segmen bersebelahan) yang memiliki kontingen berbeda.
2. Cari pasangan tukar `(a ∈ P, b ∈ Q)` dengan kontingen berbeda sedemikian sehingga setelah tukar kedua Pool tetap memenuhi `tol_max` dan total biaya turun.
3. Lakukan tukar terbaik; ulangi hingga tidak ada perbaikan atau batas iterasi tercapai.
4. Bila tidak ada pertukaran yang sah, tandai Pool `SINGLE_CONTINGENT` dan cantumkan dalam laporan kualitas.

### 9.5 Tahap 3 — Konstruksi bracket & penempatan BYE

```
BUILD_BRACKET(pool):
  n = |pool|
  if n == 1: return DUMMY_BRACKET(pool)
  S = 2^ceil(log2(n))
  return ASSIGN(0, S, n)

ASSIGN(offset, size, n):
  if size == 1:
      return [ATHLETE] if n == 1 else [BYE]
  half  = size / 2
  upper = ceil(n / 2)
  lower = n - upper
  return ASSIGN(offset, half, upper) ++ ASSIGN(offset + half, half, lower)
```

Prosedur ini menghasilkan tepat pola yang diminta pemangku kepentingan (lihat tabel verifikasi BR-5) dan menjamin BYE tersebar merata sehingga tidak ada paruh bracket yang jauh lebih ringan daripada paruh lainnya.

### 9.6 Tahap 4 — Penempatan atlet (seeding) dengan contingent separation

Diberikan bracket dengan daftar posisi atlet, tentukan pemetaan atlet → posisi yang meminimalkan:

```
Penalty = Σ pasangan (a,b) sekontingen : 2^(R − ronde_pertemuan(a,b))
        + Σ atlet unggulan salah posisi : W_seed
```

Prosedur:

1. **Seed tetap.** Jika ada seed manual, tempatkan lebih dulu pada posisi standar; posisi ini dikunci.
2. **Distribusi largest-first.** Urutkan kontingen berdasarkan jumlah atlet dalam Pool (menurun). Sebar anggotanya secara round-robin ke kuadran/paruh bracket berbeda. Ini menyelesaikan mayoritas kasus dan bersifat deterministik.
3. **Perbaikan lokal.** Jalankan hill-climbing berbasis pertukaran dua posisi, dengan urutan kandidat ditentukan PRNG berbenih, batas iterasi `50 × n`. Terima pertukaran hanya bila `Penalty` turun.
4. **BYE.** BYE ditempatkan pada paruh yang paling padat satu kontingen — memberi keuntungan bye kepada atlet dari kontingen dominan justru mengurangi risiko bentrok internal dini. Untuk divisi prestasi bersistem seed, BYE diberikan kepada seed tertinggi (praktik standar).

Kompleksitas praktis: O(n²) per Pool dengan `n ≤ 16`; dapat diabaikan.

### 9.7 Tahap 5 — Penomoran partai & laporan kualitas

- Nomor partai dialokasikan per arena mengikuti BR-9.
- Sistem menghasilkan **Draw Quality Report**:

| Metrik                                    | Target                                        |
| ----------------------------------------- | --------------------------------------------- |
| % Pool memenuhi `tol_tb` dan `tol_bb`     | ≥ 95%                                         |
| % Pool dengan ≥ 2 kontingen               | ≥ 90% dari Pool yang secara teoritis feasible |
| % pasangan sekontingen bertemu di ronde 1 | ≤ 3%                                          |
| Jumlah Pool berukuran 1 (dummy)           | dilaporkan eksplisit, harus disetujui TD      |
| Jumlah Pool melanggar `tol_max`           | 0 — bila > 0, draw tidak boleh dikunci        |

### 9.8 Anggaran performa

| Tahap                       | Kompleksitas                 | Estimasi 5.000 atlet |
| --------------------------- | ---------------------------- | -------------------- |
| Normalisasi + partisi       | O(N)                         | < 1 s                |
| Segmentasi DP               | Σ O(m²), m = ukuran Category | < 3 s                |
| Bracket + seeding           | Σ O(n²), n ≤ 16              | < 2 s                |
| Penomoran + laporan         | O(N)                         | < 1 s                |
| **Total mesin draw**        |                              | **< 10 s**           |
| Render PDF seluruh turnamen | I/O bound, paralel           | < 3 menit            |

Target SLA: **generate draw penuh untuk 5.000 peserta < 30 detik** (margin 3× terhadap estimasi).

### 9.9 Determinisme & reproducibility

Setiap Draw Run menyimpan: hash snapshot data peserta, versi konfigurasi, seluruh nilai parameter, benih PRNG, dan versi algoritma. Menjalankan ulang dengan tuple yang sama wajib menghasilkan hasil identik. Ini adalah syarat pertanggungjawaban ketika kontingen mempertanyakan keadilan draw.

---

## 10. Pengalaman Pengguna (UX)

### 10.1 Alur utama Drawing Officer

```
1. Buat/pilih turnamen  →  pilih template konfigurasi
2. Import peserta       →  review laporan kualitas data  →  perbaiki
3. Review klasifikasi   →  selesaikan konflik umur/kelas
4. Atur parameter draw  →  (opsional) bandingkan skenario what-if
5. Generate draw        →  review Draw Quality Report
6. Perbaiki manual      →  drag & drop pada Pool bermasalah
7. Ajukan approval      →  Technical Delegate mengunci
8. Ekspor & distribusi  →  PDF per arena/hari
9. Selama turnamen      →  tangani komplain/WO/DQ  →  revisi terkontrol
```

### 10.2 Layar kunci

| Layar                  | Isi                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dashboard turnamen** | Ringkasan peserta, status draw per divisi, temuan terbuka, progress approval                                                                                       |
| **Data peserta**       | Tabel dengan filter (kontingen, divisi, kelas, status), inline edit, indikator konflik                                                                             |
| **Konfigurasi aturan** | Editor tabel kelas, toleransi, belt band, bobot algoritma; preview dampak                                                                                          |
| **Draw workspace**     | Panel kiri: daftar Category dengan badge kualitas. Panel tengah: bracket interaktif. Panel kanan: detail atlet, metrik Pool, alasan penempatan, daftar pelanggaran |
| **Compare scenarios**  | Dua hasil draw berdampingan dengan diff metrik                                                                                                                     |
| **Audit & revisi**     | Timeline perubahan, diff antar revisi, tombol restore                                                                                                              |
| **Ekspor**             | Pilih arena/hari/divisi, preview, unduh                                                                                                                            |

### 10.3 Prinsip interaksi editor

- **Selalu tampilkan konsekuensi sebelum aksi.** Saat atlet di-drag, sistem menampilkan bayangan hasil: rentang TB/BB Pool tujuan setelah perpindahan, dan pelanggaran yang timbul.
- **Tolak pelanggaran keras, izinkan pelanggaran lunak dengan alasan.** Hard constraint tidak dapat dilanggar lewat UI biasa. Soft constraint boleh dilanggar, tetapi wajib mengisi alasan yang tersimpan di audit log.
- **Perubahan bersifat lokal.** Memindahkan satu atlet tidak boleh mengacak ulang seluruh bagan; nomor partai yang sudah dipublikasikan dipertahankan sedapat mungkin.
- **Keyboard-first untuk operator cepat:** cari atlet (`/`), pindah (`M`), tukar (`S`), undo (`Ctrl+Z`).

---

## 11. Requirement Non-Fungsional

| Kategori              | Requirement                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Performa**          | Draw 5.000 peserta < 30 s. UI drag-drop feedback < 100 ms. Load workspace Category < 1 s.                                                            |
| **Skalabilitas**      | Mendukung 10.000 entry per turnamen, 500 Pool, 20 arena, 7 hari. Multi-turnamen paralel.                                                             |
| **Availability**      | 99,5% pada masa turnamen. Mesin draw berjalan sebagai job terisolasi; kegagalan render PDF tidak menjatuhkan aplikasi.                               |
| **Ketahanan venue**   | Mode offline/PWA: bagan yang sudah di-generate dapat dibuka & dicetak tanpa internet. Sinkronisasi saat koneksi kembali. PDF sebagai fallback wajib. |
| **Reliabilitas data** | Semua Draw Run immutable. Backup otomatis harian + snapshot sebelum tiap generate. Point-in-time recovery.                                           |
| **Keamanan**          | Autentikasi (email + password, opsional SSO), RBAC per turnamen, enkripsi at-rest untuk NIK, TLS in-transit, rate limiting.                          |
| **Privasi**           | NIK & tanggal lahir hanya untuk peran berwenang; tidak muncul di ekspor publik. Retensi data mengikuti kebijakan penyelenggara.                      |
| **Auditability**      | Setiap perubahan draw tercatat: aktor, waktu, before/after, alasan. Log tidak dapat diedit.                                                          |
| **Observability**     | Metrik: durasi generate, jumlah pelanggaran per turnamen, error rate ekspor. Log terstruktur. Alert bila generate gagal.                             |
| **Kompatibilitas**    | Browser modern (Chrome/Edge/Firefox/Safari 2 versi terakhir). Cetak A4 & A3 landscape.                                                               |
| **Lokalisasi**        | Bahasa Indonesia (default) & Inggris. Format tanggal & satuan metrik.                                                                                |
| **Aksesibilitas**     | Kontras memadai, navigasi keyboard penuh pada layar operator.                                                                                        |

---

## 12. Arsitektur Teknis (Usulan)

### 12.1 Prinsip

Mesin draw diisolasi sebagai **pustaka murni tanpa efek samping** (pure functions). Konsekuensinya: dapat diuji dengan property-based testing, dapat dijalankan di server (job besar) maupun di browser (preview instan saat operator mengubah parameter), dan hasilnya dijamin sama di kedua tempat.

### 12.2 Stack usulan

| Lapis      | Pilihan                                                                             | Alasan                                                           |
| ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Frontend   | React + TypeScript (Next.js), `dnd-kit` untuk drag & drop, SVG untuk render bracket | Ekosistem matang; SVG memudahkan ekspor & zoom bracket besar     |
| Mesin draw | Paket TypeScript murni (`@bagantkd/engine`), dipakai bersama FE & BE                | Satu sumber kebenaran algoritma; tidak ada perbedaan hasil FE/BE |
| Backend    | NestJS (Node + TypeScript), REST/tRPC                                               | Satu bahasa lintas lapis; mudah dirawat tim kecil                |
| Database   | PostgreSQL 16                                                                       | Relasional, transaksional, `jsonb` untuk konfigurasi & snapshot  |
| Job queue  | Redis + BullMQ                                                                      | Generate draw & render PDF sebagai job async dengan progress     |
| Render PDF | React-PDF (layout terkontrol) atau Puppeteer (reuse komponen bracket)               | Konsistensi tampilan layar dan cetak                             |
| Auth       | Auth.js, atau Keycloak bila butuh SSO organisasi                                    | RBAC standar                                                     |
| Deploy     | Docker Compose (on-prem venue) & container cloud                                    | Turnamen sering membutuhkan instalasi lokal di venue             |

Alternatif yang dipertimbangkan: mesin draw dalam Python (numpy/OR-Tools). Ditolak untuk v1 karena memaksa dua bahasa dan menghalangi preview instan di browser; dapat ditinjau ulang bila kelak dibutuhkan solver ILP untuk penjadwalan arena (v2).

### 12.3 Skema data inti (ringkas)

```sql
tournaments(id, name, start_date, end_date, age_cutoff_date, config_jsonb, status)
arenas(id, tournament_id, code, name, day)
contingents(id, tournament_id, name, external_ref)
athletes(id, tournament_id, contingent_id, nik_enc, full_name, gender, birth_date,
         height_cm, weight_kg, belt_rank, belt_band, source_row, created_at)
entries(id, tournament_id, athlete_id, team_members_jsonb, category_id, status,
        seed_no, verified_height, verified_weight, verified_at, verified_by)
categories(id, tournament_id, event, stream, age_division, gender, class_code,
           poomsae_group, entry_count)
draw_runs(id, tournament_id, params_jsonb, rng_seed, engine_version,
          input_hash, created_by, created_at, status)
pools(id, draw_run_id, category_id, index_no, size, bracket_size,
      metrics_jsonb, reasons_jsonb, flags, pinned)
slots(id, pool_id, position, entry_id NULL, is_bye)
matches(id, pool_id, round_no, code, arena_id, order_no,
        slot_a, slot_b, winner_entry_id, status)
revisions(id, tournament_id, base_draw_run_id, revision_no, locked_by, locked_at)
audit_log(id, tournament_id, actor_id, action, target, before_jsonb, after_jsonb,
          reason, created_at)
complaints(id, tournament_id, submitted_by, target_ref, reason, status,
           decision, decided_by, decided_at)
```

### 12.4 API inti (ringkas)

```
POST   /tournaments/{id}/imports              # unggah & dry-run
POST   /tournaments/{id}/imports/{iid}/commit
GET    /tournaments/{id}/categories
POST   /tournaments/{id}/draw-runs            # generate (async job)
GET    /draw-runs/{id}/quality-report
GET    /draw-runs/{id}/pools?category=...
PATCH  /pools/{id}/slots                      # drag & drop (validasi server-side)
POST   /pools/{id}/regenerate
POST   /draw-runs/{id}/lock
POST   /exports                               # pdf|xlsx, filter arena/hari
GET    /tournaments/{id}/audit
```

Validasi drag & drop dijalankan **di server juga**, bukan hanya di klien, agar aturan tidak dapat dilewati.

### 12.5 Strategi pengujian

| Jenis          | Isi                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Unit           | Fungsi biaya, DP segmentasi, `ASSIGN` bye, penalti separation                                                          |
| Property-based | Untuk sembarang n ∈ [1, 512]: bracket valid, jumlah slot = 2^k, jumlah bye = S − n, tiap paruh berimbang               |
| Golden test    | Dataset 3.153 peserta (data aktual) → hasil draw disimpan sebagai baseline; perubahan hasil harus disengaja & ditinjau |
| Determinisme   | Jalankan 100× dengan benih sama ⇒ hash output identik                                                                  |
| Beban          | 5.000 & 10.000 entry sintetis, ukur waktu & memori                                                                     |
| E2E            | Alur import → generate → drag → lock → ekspor                                                                          |

---

## 13. Metrik Keberhasilan

| KPI                                                         | Baseline (manual) | Target v1                                             |
| ----------------------------------------------------------- | ----------------- | ----------------------------------------------------- |
| Waktu membuat draw penuh (~3.000 peserta)                   | Beberapa hari     | < 1 jam                                               |
| Waktu memperbaiki satu komplain                             | 5–15 menit        | < 1 menit                                             |
| Pool melanggar toleransi TB/BB                              | Tidak terukur     | < 5%, dan 0 di atas `tol_max`                         |
| Pool berisi satu kontingen (yang sebenarnya bisa dihindari) | Tidak terukur     | < 10%                                                 |
| Pertemuan sekontingen di ronde 1                            | Tidak terukur     | < 3%                                                  |
| Kesalahan cetak / versi usang beredar                       | Sering            | 0 — setiap ekspor bernomor revisi                     |
| Adopsi                                                      | —                 | Dipakai penuh pada ≥ 3 turnamen dalam 6 bulan pertama |

---

## 14. Rencana Rilis

| Tahap                       | Lingkup                                                                 | Durasi estimasi | Kriteria selesai                                         |
| --------------------------- | ----------------------------------------------------------------------- | --------------- | -------------------------------------------------------- |
| **M0 — Fondasi**            | Skema data, auth, CRUD turnamen, import CSV/XLSX + validasi             | 3 minggu        | Data aktual 3.153 baris terimport bersih                 |
| **M1 — Mesin draw**         | Normalisasi, partisi, DP pooling, bracket, seeding, quality report, CLI | 4 minggu        | Golden test lolos; 5.000 entry < 30 s                    |
| **M2 — Workspace & editor** | Render bracket, drag & drop, validasi real-time, undo/redo, audit       | 4 minggu        | Operator dapat memperbaiki draw tanpa spreadsheet        |
| **M3 — Ekspor & lock**      | PDF bagan / match list / scoresheet, XLSX, revisi & lock                | 3 minggu        | Output setara PDF turnamen existing                      |
| **M4 — Pilot**              | Uji paralel pada satu turnamen nyata (manual vs sistem)                 | 2 minggu        | Selisih kualitas draw dapat dijelaskan; panitia menerima |
| **M5 — v2**                 | Penjadwalan arena, live result, halaman publik, workflow komplain       | 6 minggu        | —                                                        |

**Total ke rilis produksi: ± 16 minggu.**

Strategi peluncuran: jalankan **paralel dengan proses manual** pada turnamen pertama. Sistem dianggap lulus bila panitia teknis menilai hasil otomatis setara atau lebih baik dan waktu kerja turun signifikan.

---

## 15. Risiko & Mitigasi

| Risiko                                              | Dampak                              | Mitigasi                                                                                             |
| --------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Aturan draw berbeda antar penyelenggara             | Sistem tidak terpakai di event lain | Semua aturan berupa konfigurasi + template; tidak ada logika turnamen yang di-hard-code              |
| Kontingen dominan membuat separation mustahil       | Panitia menganggap sistem "salah"   | Perlakukan sebagai soft constraint, laporkan transparan beserta alasan kuantitatifnya                |
| Data pendaftaran kotor (TB/BB/tanggal lahir keliru) | Draw salah sejak awal               | Laporan kualitas data wajib ditinjau sebelum generate; modul timbang ulang                           |
| Perubahan menit terakhir setelah bagan dicetak      | Kekacauan di venue                  | Revisi bernomor, penomoran partai stabil, sub-nomor untuk sisipan, watermark versi di setiap cetakan |
| Penolakan pengguna terhadap otomasi                 | Adopsi rendah                       | Explainability di setiap keputusan + editor manual penuh; sistem membantu, tidak mendikte            |
| Koneksi internet venue buruk                        | Tidak bisa akses bagan              | Mode offline/PWA + PDF cetak sebagai fallback wajib                                                  |
| Ketergantungan pada satu format import              | Integrasi rapuh                     | Wizard pemetaan kolom + preset, bukan format tetap                                                   |
| Sengketa keadilan draw                              | Reputasi penyelenggara              | Determinisme berbenih + audit log + laporan yang dapat dipublikasikan                                |

---

## 16. Pertanyaan Terbuka (butuh keputusan sebelum implementasi)

| #   | Pertanyaan                                                                                                                       | Mengapa penting                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Q1  | Belt band resmi yang dipakai — apakah pembagian 4 band pada BR-3 sesuai praktik? Apakah lintas band pernah dibolehkan?           | Menentukan hard/soft constraint utama pooling         |
| Q2  | Untuk **Poomsae Semi Prestasi**, apakah benar memakai bracket head-to-head, atau sistem skor/babak penyisihan berdasarkan nilai? | Mengubah total struktur output untuk 533 peserta      |
| Q3  | Atribut "gerakan poomsae" — kriteria pembagian bagan atau hanya penentu jurus yang dimainkan?                                    | Menentukan apakah masuk kunci Category                |
| Q4  | Tanggal cut-off umur resmi (31 Desember tahun berjalan, atau tanggal event)?                                                     | Menggeser divisi umur sebagian peserta                |
| Q5  | Apakah TB/BB diverifikasi ulang di venue, dan seberapa sering berubah dari data pendaftaran?                                     | Menentukan bobot fitur weigh-in dan frekuensi re-draw |
| Q6  | Jumlah medali perunggu: 2 (default) atau 1 dengan partai perebutan juara 3?                                                      | Struktur bracket & jumlah partai                      |
| Q7  | Jumlah arena, durasi rata-rata partai, dan jam operasional per hari                                                              | Prasyarat penjadwalan otomatis (v2)                   |
| Q8  | Apakah format PDF wajib mengikuti persis layout TKD Tomato, atau boleh format baru?                                              | Beban kerja modul ekspor                              |
| Q9  | Apakah sistem harus mendukung repechage / double-elimination untuk kelas tertentu?                                               | Struktur bracket alternatif                           |
| Q10 | Deployment: cloud terpusat, on-prem di venue, atau keduanya?                                                                     | Arsitektur & biaya operasional                        |

---

## 17. Lampiran A — Analisis Data Aktual

Sumber: `DATA_KOLEKTIF_FESTIVAL_PRESTASI - query_kolektif.csv`, 3.153 baris data (di luar header).

### A.1 Komposisi

| Klasifikasi           | Jumlah | Grup kelas | Ukuran grup min / median / maks |
| --------------------- | ------ | ---------- | ------------------------------- |
| Kyorugi Semi Prestasi | 1.863  | 105        | 1 / 15 / 86                     |
| Kyorugi Prestasi      | 591    | 71         | 1 / 6 / 24                      |
| Poomsae Semi Prestasi | 533    | 12         | 4 / 27 / 135                    |
| Poomsae Prestasi      | 146    | 21         | 1 / 6 / 22                      |
| Freestyle             | 21     | —          | Urutan penampilan, bukan bagan  |

Gender: 1.792 putra, 1.362 putri. Divisi umur: Cadet 1.030, Junior 883, Pra Cadet C 710, Pra Cadet B 245, Senior 152, Pra Cadet 87, Pra Cadet A 47.

### A.2 Distribusi sabuk

| Sabuk                       | Jumlah |
| --------------------------- | ------ |
| GEUP 9 – Kuning             | 794    |
| GEUP 7 – Hijau              | 531    |
| GEUP 8 – Kuning strip hijau | 445    |
| GEUP 6 – Hijau strip biru   | 302    |
| GEUP 5 – Biru               | 294    |
| GEUP 3 – Merah              | 269    |
| GEUP 4 – Biru strip merah   | 224    |
| GEUP 1 – Merah strip 2      | 114    |
| HITAM DAN 1                 | 90     |
| GEUP 2 – Merah strip 1      | 83     |
| HITAM DAN 2                 | 5      |
| HITAM DAN 3                 | 3      |

### A.3 Temuan yang berdampak pada desain

1. **Konsentrasi kontingen ekstrem.** Kota Surabaya 2 memegang 26,9% peserta; pada 29 dari 105 grup semi prestasi satu kontingen menguasai >50%. ⇒ contingent separation wajib soft constraint (BR-6).
2. **Grup besar dengan sebaran fisik lebar.** `Laki-laki / PRA CADET C / -30`: 86 atlet, TB 120–154 cm, BB 27–33 kg, 7 tingkat sabuk. ⇒ pooling multi-tahap adalah kebutuhan nyata, bukan fitur tambahan.
3. **12 grup berukuran 1 atlet** pada Kyorugi Semi Prestasi. ⇒ penanganan Dummy (BR-5 poin 4) harus menjadi alur kerja resmi, bukan kasus tepi.
4. **Format kelas tidak konsisten** (`=+65`, `=+78`, `=+87`). ⇒ normalisasi parser wajib (FR-1.3).
5. **Poomsae Semi Prestasi hanya terbagi berdasarkan gender/umur/tipe** pada data mentah, menghasilkan grup hingga 135 orang. ⇒ perlu keputusan Q2 sebelum implementasi.
6. **Seluruh baris memiliki 13 kolom konsisten** — struktur CSV tidak rusak; nama atlet tidak mengandung koma.

---

## 18. Lampiran B — Analisis Artefak Bagan Existing

Sumber: 23 berkas PDF, 4 hari lomba, arena A–G.

| Temuan                                                                                                   | Implikasi                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Bagan prestasi digenerate oleh **TKD Tomato** (footer "Printed by Tomato, Copyright 2015")               | Sistem baru harus setidaknya menyamai kualitas & keterbacaan output ini                                 |
| Header memuat nama turnamen, arena, kategori (`Junior M-63`), jumlah peserta (`18 competitors`), tanggal | Wajib ada di ekspor (FR-9.1)                                                                            |
| Kode partai berawalan huruf arena (`A01`…`A53`, `V01`…`V10`), diurutkan per ronde lintas kategori        | Konfirmasi aturan penomoran BR-9                                                                        |
| Blok medali `1. / 2. / 3. / 3.`                                                                          | Konfirmasi default dua perunggu (BR-7)                                                                  |
| Bagan semi prestasi berupa daftar berpasangan dengan nomor partai, bukan bracket grafis                  | Sistem baru dapat menyediakan **kedua** format; daftar berpasangan lebih ringkas untuk pool yang banyak |
| Poomsae Pair/Team menampilkan nama anggota dipisah `\|` dan terpotong bila panjang                       | Ekspor harus menangani nama tim panjang (wrap/ellipsis terkontrol)                                      |
| Freestyle Poomsae hanya berupa tabel urutan tampil                                                       | FR-9.5                                                                                                  |

---

## 19. Persetujuan

| Peran                                | Nama | Tanggal | Status |
| ------------------------------------ | ---- | ------- | ------ |
| Product Owner                        |      |         | ☐      |
| Technical Delegate / Pengurus Cabang |      |         | ☐      |
| Panitia Teknis (Drawing Officer)     |      |         | ☐      |
| Tech Lead                            |      |         | ☐      |

---

_Dokumen ini adalah spesifikasi produk, bukan dokumen desain teknis final. Pertanyaan pada Bab 16 harus dijawab sebelum M1 dimulai karena berdampak langsung pada struktur mesin draw._
