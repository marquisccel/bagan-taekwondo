import type { SimulationReport, SimulationVolatile } from './simulate.js';

/** p50 / p95 / max of the per-seed durations (nearest-rank percentiles). */
export function timingSpread(ms: readonly number[]): { p50: number; p95: number; max: number } {
  const xs = [...ms].sort((a, b) => a - b);
  const at = (q: number) => xs[Math.max(0, Math.ceil(q * xs.length) - 1)] ?? 0;
  return { p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(xs[xs.length - 1] ?? 0) };
}

/** Human-readable summary written next to report.json. */
export function renderSummary(
  report: SimulationReport,
  reportFingerprint: string,
  volatile?: SimulationVolatile,
): string {
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
    `| Deterministic replay of golden seed ${report.replay.goldenSeed} (${report.replay.runs} runs) | ${s.replayIdentical ? 'identical' : '**DIFFERENT**'} |`,
    '',
  );
  const e = report.explainability;
  lines.push('## Scope and explainability (golden seed)', '');
  lines.push(
    `- Scope ${report.plan.scopeMode}: ${report.plan.drawn} of ${report.plan.categories} categories drawn; not drawn: ${JSON.stringify(report.plan.blockedByReason)}`,
    `- Pools ${e.pools} (without reason: ${e.poolsWithoutReason}); byes ${e.byes} (without reason: ${e.byesWithoutReason})`,
    `- Pooled categories ${e.pooledCategories}, all five candidates kept: ${e.pooledCategoriesWithAllFiveCandidates}; selected with tier-0 violations: ${e.selectedCandidatesWithTier0}`,
    `- Selected strategies: ${JSON.stringify(e.selectedStrategy)}`,
  );
  const cv = report.coverage;
  lines.push(
    `- Coverage: ${cv.rows} rows → ${cv.snapshotEntries} entries (${cv.unresolvedRows} rows unresolved); ${cv.eligibleEntries} eligible, ${cv.withheldEntries} withheld; categories ${cv.categories.ready} ready / ${cv.categories.blocked} blocked (${cv.categories.zeroEligible} with no eligible entry)`,
    `- Placed ${cv.placedEntries} in ${cv.pools} pools (${cv.walkoverPools} walkovers); not placed ${cv.notPlaced.total}: ${cv.notPlaced.entryNotEligible} not eligible ${JSON.stringify(cv.notPlaced.entryNotEligibleByReason)}, ${cv.notPlaced.categoryBlocked} in blocked categories ${JSON.stringify(cv.notPlaced.categoryBlockedByReason)}; accounted: ${cv.accounted ? 'yes' : '**NO**'}`,
  );
  if (volatile) {
    const t = timingSpread(Object.values(volatile.seedMs));
    lines.push(
      `- Timing (not fingerprinted): per seed p50 ${t.p50} ms, p95 ${t.p95} ms, max ${t.max} ms; replay ${Math.round(volatile.replayMs)} ms`,
    );
  }
  lines.push('');
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
