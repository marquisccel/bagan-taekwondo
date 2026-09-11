/**
 * Phase 1 placeholder. The operator UI (participants, data-quality review, draw workspace,
 * drag and drop) starts in Phase 5, after the draw engine and simulator pass their gates
 * (docs/ACCEPTANCE_CRITERIA.md §5).
 */
export default function Home() {
  return (
    <main
      style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '48px auto', lineHeight: 1.6 }}
    >
      <h1>BaganTKD</h1>
      <p>Sistem pembuatan bagan pertandingan taekwondo.</p>
      <p>
        Fase saat ini: mesin draw dan simulator. Antarmuka operator dibangun setelah mesin draw lolos property
        test, golden test, replay deterministik, perbandingan baseline, load test, dan output penjelasan.
      </p>
    </main>
  );
}
