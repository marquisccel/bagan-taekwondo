import type { SimulationReport } from './simulate.js';

/** Human-readable summary written next to report.json. */
export function renderSummary(report: SimulationReport, reportFingerprint: string): string {
  const lines: string[] = [];
  const s = report.safety;
  lines.push(`# Draw simulation — ${report.dataset.name}`, '');
  lines.push(`Report fingerprint: \`${reportFingerprint}\``, '');
  lines.push('## Safety (correctness)', '');
  lines.push(`| Check | Result |`, `|---|---|`);
  lines.push(
    `| All seeds produced a SAFE draw | ${s.allSeedsSafe ? 'yes' : '**no** — engine refused (see reasons)'} |`,
  );
  lines.push(`| Invariant violations across seeds | ${s.invariantViolations} |`);
  lines.push(
    `| Deterministic replay of golden seed ${report.replay.goldenSeed} | ${s.replayIdentical ? 'identical' : '**DIFFERENT**'} |`,
    '',
  );
  lines.push('## Inputs', '');
  lines.push(
    `- Dataset: ${report.dataset.rows} rows × ${report.dataset.columns} columns, \`${report.dataset.fingerprint}\``,
  );
  lines.push(`- Rule set: ${report.ruleSet.code ?? '(invalid)'} \`${report.ruleSet.fingerprint ?? '-'}\``);
  lines.push(
    `- Purpose: ${report.purpose}; allowed: ${report.ruleSet.allowedForPurpose ? 'yes' : 'no'}; lock allowed: ${report.ruleSet.lockAllowed ? 'yes' : 'no'}`,
  );
  if (report.ruleSet.lockBlockers.length > 0) {
    lines.push(`- Lock blockers (${report.ruleSet.lockBlockers.length}):`);
    for (const b of report.ruleSet.lockBlockers) lines.push(`  - \`${b}\``);
  }
  lines.push(`- Assumptions: ${report.assumptions ? JSON.stringify(report.assumptions) : 'none'}`, '');
  lines.push('## Engine stages', '');
  for (const st of [...report.preEngine, ...report.stages]) lines.push(`- ${st.stage}: ${st.status}`);
  lines.push('', '## Seeds', '', '| Seed | Status | Reasons | Output fingerprint |', '|---|---|---|---|');
  for (const r of report.seeds) {
    lines.push(
      `| ${r.seed} | ${r.status} | ${r.unsafeReasons.map((x) => x.code).join(', ') || '-'} | \`${r.fingerprints.output.slice(0, 19)}…\` |`,
    );
  }
  if (report.baseline) {
    lines.push('', `## Quality benchmark vs ${report.baseline.code}`, '', `_${report.baseline.note}_`, '');
    lines.push('| Metric | Baseline | Engine | Status |', '|---|---|---|---|');
    for (const c of report.baseline.comparisons) {
      lines.push(`| ${c.metric} | ${c.baseline} ${c.unit} | ${c.engine ?? '—'} | ${c.status} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}
