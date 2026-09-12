import { ENGINE_VERSION, runDraw } from '@bagantkd/draw-engine';
import {
  buildTransformationReport,
  diffAgainstBaseline,
  diffAgainstDetail,
  type BaselineCounts,
  type BaselineDetail,
  type Difference,
  type IntakeResult,
  type TransformationReport,
} from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { compareStrings, fingerprint, parseDrawSeed, sortedBy, type Fingerprint } from '@bagantkd/shared';

/**
 * E8 — Data Transformation Report + Differential Report + engine stages 1–4 summary for one intake.
 * Aggregates only: the row-level differential is reduced to counts, so every output can be
 * committed. Deterministic: the same inputs give the same report fingerprint.
 */
export interface IntakeReport {
  readonly transformation: TransformationReport;
  readonly differential: {
    readonly aggregate: { readonly compared: boolean; readonly differences: readonly Difference[] };
    readonly detail: {
      readonly compared: boolean;
      readonly rowsCompared: number;
      readonly entriesCompared: number;
      readonly rowDifferences: number;
      readonly entryDifferences: number;
    };
  };
  readonly engine: {
    readonly version: string;
    readonly status: string;
    readonly unsafeReasons: readonly string[];
    readonly metrics: Readonly<Record<string, number>>;
    readonly readinessPolicy: { readonly withheldEntries: string; readonly provenance: string };
    readonly categoriesByTemplate: Readonly<
      Record<string, { readonly ready: number; readonly blocked: number }>
    >;
    readonly singletonCategories: number;
  };
}

export function buildIntakeReport(args: {
  readonly result: IntakeResult;
  readonly ruleSet: RuleSet;
  readonly baselineCounts: BaselineCounts | null;
  readonly baselineDetail: BaselineDetail | null;
}): { report: IntakeReport; fingerprint: Fingerprint } {
  const transformation = buildTransformationReport(args.result);
  const detail = args.baselineDetail ? diffAgainstDetail(args.result, args.baselineDetail) : [];

  const out = runDraw({
    engineVersion: ENGINE_VERSION,
    purpose: 'SIMULATION',
    seed: parseDrawSeed('20260827'),
    ruleSet: args.ruleSet,
    entries: args.result.snapshot?.entries ?? [],
    scope: [],
    assumptions: null,
  });
  const byTemplate = new Map<string, { ready: number; blocked: number }>();
  for (const c of out.categories) {
    const slot = byTemplate.get(c.templateCode) ?? { ready: 0, blocked: 0 };
    if (c.readiness === 'READY') slot.ready += 1;
    else slot.blocked += 1;
    byTemplate.set(c.templateCode, slot);
  }

  const report: IntakeReport = {
    transformation,
    differential: {
      aggregate: {
        compared: args.baselineCounts !== null,
        differences: args.baselineCounts ? diffAgainstBaseline(transformation, args.baselineCounts) : [],
      },
      detail: {
        compared: args.baselineDetail !== null,
        rowsCompared: args.baselineDetail ? Object.keys(args.baselineDetail.rows).length : 0,
        entriesCompared: args.baselineDetail ? Object.keys(args.baselineDetail.entries).length : 0,
        rowDifferences: detail.filter((d) => d.scope === 'row').length,
        entryDifferences: detail.filter((d) => d.scope === 'entry').length,
      },
    },
    engine: {
      version: ENGINE_VERSION,
      status: out.status,
      unsafeReasons: out.unsafeReasons.map((r) => r.code),
      metrics: out.quality.metrics,
      readinessPolicy: {
        withheldEntries: args.ruleSet.categoryReadiness.withheldEntries,
        provenance: args.ruleSet.categoryReadiness.provenance.source,
      },
      categoriesByTemplate: Object.fromEntries(
        sortedBy([...byTemplate], (a, b) => compareStrings(a[0], b[0])),
      ),
      singletonCategories: out.categories.filter((c) => c.entryIds.length === 1).length,
    },
  };
  return { report, fingerprint: fingerprint(report) };
}

const table = (rows: readonly (readonly (string | number)[])[], head: readonly string[]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');

export function renderIntakeReport(r: IntakeReport, fp: Fingerprint): string {
  const t = r.transformation;
  const p = t.pipeline;
  const d = r.differential;
  const lines = [
    `# Intake report — ${t.source.name}`,
    '',
    `Report fingerprint \`${fp}\` · source \`${t.source.fingerprint}\` · snapshot \`${t.snapshotFingerprint ?? '—'}\``,
    '',
    '## Pipeline',
    '',
    `${p.rows} rows → ${p.persons} persons → ${p.entries} entries (${p.entryGroups} entry groups, ${p.unresolvedRows} unresolved rows) → ${p.categories} categories; ${t.blockedEntries} entries blocked.`,
    '',
    table(Object.entries(t.categoriesByStream), ['Categories by stream', 'n']),
    '',
    table(Object.entries(t.entryGroupsByProvenance), ['Entry groups (source/status/confidence)', 'n']),
    '',
    table(Object.entries(t.blockedEntriesByStream), ['Blocked entries by stream', 'n']),
    '',
    table(Object.entries(t.blockedEntriesByReason), ['Blocking reason', 'entries']),
    '',
    '## Issues',
    '',
    table(Object.entries(t.issueCounts), ['Issue', 'count']),
    '',
    table(Object.entries(t.openIssuesBySeverity), ['Severity (all subjects)', 'count']),
    '',
    '## Field outcomes (RAW → NORMALIZED)',
    '',
    table(Object.entries(t.fieldOutcomes), ['field:outcome', 'rows']),
    '',
    table(Object.entries(t.classNormalizations), ['Class raw', 'normalized']),
    '',
    table(Object.entries(t.suggestions), ['Suggestion rule (never applied)', 'count']),
    '',
    '## Rule provenance usage',
    '',
    table(Object.entries(t.ruleProvenanceUsage), ['provenance:rule', 'uses']),
    '',
    '## Differential',
    '',
    d.aggregate.compared
      ? `Aggregate vs Python baseline (O2): **${d.aggregate.differences.length} differences**.`
      : 'Aggregate baseline not supplied.',
    d.detail.compared
      ? `Row/entry detail vs Python baseline: ${d.detail.rowsCompared} rows and ${d.detail.entriesCompared} entries compared — **${d.detail.rowDifferences} row and ${d.detail.entryDifferences} entry differences**.`
      : 'Row/entry detail baseline not supplied (private).',
    ...d.aggregate.differences.map(
      (x) =>
        `- ${x.scope} ${x.key}: baseline ${String(x.baseline)} vs implementation ${String(x.implementation)}`,
    ),
    '',
    '## Engine stages 1–4',
    '',
    `Engine ${r.engine.version}: ${r.engine.status} (${r.engine.unsafeReasons.join(', ')}). Readiness policy for withheld entries: ${r.engine.readinessPolicy.withheldEntries} (${r.engine.readinessPolicy.provenance}). Singleton categories (1 eligible entry, decided at pooling by poolPolicies.singleton): ${r.engine.singletonCategories}.`,
    '',
    table(Object.entries(r.engine.metrics), ['Metric', 'value']),
    '',
    table(
      Object.entries(r.engine.categoriesByTemplate).map(([k, v]) => [k, v.ready, v.blocked]),
      ['Template', 'ready', 'blocked'],
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}
