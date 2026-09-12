import { assessRuleSet, type RuleSet } from '@bagantkd/rules';
import { compareStrings, DomainError, fingerprint, sortedBy, type Fingerprint } from '@bagantkd/shared';

import {
  ENGINE_STAGES,
  ENGINE_VERSION,
  type CategoryResult,
  type EngineInput,
  type EngineOutput,
  type EngineStage,
  type LockAssessment,
  type QualityFinding,
  type Reason,
  type SimulationAssumptions,
  type StageStatus,
} from './contract.js';
import { drawCategory } from './draw.js';
import { checkPlacementInvariants } from './invariants.js';
import { resolveLimits, type EngineLimits } from './limits.js';
import type { MetricPool } from './quality.js';
import { semiPrestasiMetrics } from './quality.js';
import {
  buildCategories,
  gateEligibility,
  normalizeEntries,
  validateEntries,
  type EntryFinding,
} from './stages.js';

/**
 * Implementation status per stage. A stage flips to IMPLEMENTED only together with its tests
 * (docs/ACCEPTANCE_CRITERIA.md §5). Stages 1–4: Phase 2; 5–14: Phase 3. `allocateMatchCodes`
 * allocates stable match identities; public codes need arenas and a schedule (ADR-0005, Phase 4).
 */
const IMPLEMENTED: ReadonlySet<EngineStage> = new Set(ENGINE_STAGES);
export const STAGE_STATUS: Readonly<Record<EngineStage, StageStatus>> = Object.fromEntries(
  ENGINE_STAGES.map((s) => [s, IMPLEMENTED.has(s) ? 'IMPLEMENTED' : 'NOT_IMPLEMENTED']),
) as Record<EngineStage, StageStatus>;

/**
 * SIMULATION what-if (ADR-0007): an assumed maximum tolerance replaces the rule-set value for that
 * policy/dimension/division in this run only. It is recorded in the input fingerprint (assumptions)
 * and never written back; CANDIDATE runs refuse assumptions.
 */
function withAssumptions(rs: RuleSet, assumptions: SimulationAssumptions | null): RuleSet {
  if (!assumptions || assumptions.maxTolerances.length === 0) return rs;
  return {
    ...rs,
    poolPolicies: rs.poolPolicies.map((p) => ({
      ...p,
      tolerances: p.tolerances.map((t) => {
        const a = assumptions.maxTolerances.find(
          (x) =>
            x.policyCode === p.code && x.dimension === t.dimension && x.ageDivisionCode === t.ageDivisionCode,
        );
        return a
          ? {
              ...t,
              max: {
                status: 'SET' as const,
                value: a.value,
                provenance: { source: 'TBD' as const, note: 'SIMULATION assumption' },
              },
            }
          : t;
      }),
    })),
  };
}

const toFinding = (level: QualityFinding['level'], f: EntryFinding): QualityFinding => ({
  level,
  code: f.reason.code,
  subject: f.entryId,
  params: { stage: f.stage, ...f.reason.params },
});

const limitExceeded = (limit: keyof EngineLimits, value: number, actual: number, scope: string): Reason => ({
  code: 'RESOURCE_LIMIT_EXCEEDED',
  params: { limit, value, actual, scope },
});

/** The input is a set of entries: its fingerprint does not depend on array order. */
function inputFingerprint(input: EngineInput): Fingerprint {
  return fingerprint({
    engineVersion: input.engineVersion,
    purpose: input.purpose,
    seed: input.seed,
    entries: sortedBy(input.entries, (a, b) => compareStrings(a.entryId, b.entryId)),
    scope: sortedBy([...input.scope], compareStrings),
    assumptions: input.assumptions,
  });
}

/** Lock readiness of a run (ADR-0007): only a SAFE CANDIDATE run on a lockable rule set, without assumptions. */
function assessLock(input: EngineInput, status: EngineOutput['status']): LockAssessment {
  const blockers: Reason[] = [];
  if (input.purpose !== 'CANDIDATE') blockers.push({ code: 'SIMULATION_RUN_NOT_LOCKABLE', params: {} });
  if (status !== 'SAFE') blockers.push({ code: 'RUN_NOT_SAFE', params: { status } });
  if (input.assumptions !== null) blockers.push({ code: 'ASSUMPTIONS_PRESENT', params: {} });
  const lock = assessRuleSet(input.ruleSet, 'LOCK');
  for (const f of lock.findings.filter((x) => x.level === 'LOCK_BLOCKER' || x.level === 'INVALID')) {
    blockers.push({ code: f.code, params: { path: f.path, level: f.level } });
  }
  return { lockable: blockers.length === 0, requiresAcknowledgement: lock.requiresAcknowledgement, blockers };
}

/**
 * The engine's single entry point. Pure: no clock, no I/O, no ambient randomness.
 *
 * - SAFE: every in-scope category is drawn and every self-check passed.
 * - UNSAFE: the draw cannot be used; `unsafeReasons` say why. No pool, bracket or candidate is
 *   returned — never a partial or guessed draw (categories keep their readiness and reasons).
 * - FAILED: an execution failure (a defect or an unreadable input), not a business outcome;
 *   `failure` carries a stable code. Nothing is returned but the failure.
 */
export function runDraw(input: EngineInput): EngineOutput {
  try {
    return drawChecked(input);
  } catch (e: unknown) {
    const failure = {
      code: e instanceof DomainError ? e.code : 'ENGINE_INTERNAL_ERROR',
      message: e instanceof Error ? e.message : String(e),
    };
    let inputFp: Fingerprint;
    try {
      inputFp = inputFingerprint(input);
    } catch {
      inputFp = fingerprint({ unreadableInput: failure });
    }
    const body = {
      engineVersion: ENGINE_VERSION,
      purpose: input.purpose,
      seed: input.seed,
      status: 'FAILED' as const,
      unsafeReasons: [],
      failure,
      stages: ENGINE_STAGES.map((stage) => ({ stage, status: STAGE_STATUS[stage] })),
      categories: [],
      quality: { findings: [], metrics: {} },
      lock: {
        lockable: false,
        requiresAcknowledgement: false,
        blockers: [{ code: 'RUN_NOT_SAFE', params: { status: 'FAILED' } }],
      },
      limits: resolveLimits(undefined),
    };
    const rulesFp = fingerprint({ unassessed: true });
    return {
      ...body,
      fingerprints: { input: inputFp, rules: rulesFp, output: fingerprint({ ...body, inputFp, rulesFp }) },
    };
  }
}

function drawChecked(input: EngineInput): EngineOutput {
  const unsafe: Reason[] = [];
  const limits = resolveLimits(input.limits);

  if (input.engineVersion !== ENGINE_VERSION) {
    unsafe.push({
      code: 'ENGINE_VERSION_MISMATCH',
      params: { requested: input.engineVersion, installed: ENGINE_VERSION },
    });
  }
  if (input.purpose === 'CANDIDATE' && input.assumptions !== null) {
    unsafe.push({ code: 'ASSUMPTIONS_NOT_ALLOWED_FOR_CANDIDATE', params: {} });
  }
  if (input.entries.length > limits.maxEntries) {
    unsafe.push(limitExceeded('maxEntries', limits.maxEntries, input.entries.length, 'INPUT'));
  }

  const assessment = assessRuleSet(input.ruleSet, input.purpose);
  if (!assessment.allowed) {
    for (const f of assessment.findings.filter((x) => x.level === 'INVALID')) {
      unsafe.push({ code: 'RULE_SET_INVALID', params: { finding: f.code, path: f.path } });
    }
  }

  // Stages 1–4. They run only on a rule set that passed assessment and an input within limits.
  const findings: QualityFinding[] = [];
  const drawFindings: QualityFinding[] = [];
  let categories: CategoryResult[] = [];
  let metrics: Record<string, number> = { entries: input.entries.length };
  const drawMetrics: Record<string, number> = {};
  if (assessment.ruleSet !== null && assessment.allowed && input.entries.length <= limits.maxEntries) {
    const rs = withAssumptions(assessment.ruleSet, input.purpose === 'SIMULATION' ? input.assumptions : null);
    const normalized = normalizeEntries(input.entries);
    const problems = validateEntries(normalized.entries, rs);
    const gate = gateEligibility(normalized.entries, problems);
    const eligibleIds = new Set(gate.eligible.map((e) => e.entryId));
    const built = buildCategories(normalized.entries, eligibleIds, rs, input.scope);

    const unknownScope = input.scope.filter((k) => !built.categories.some((c) => c.categoryKey === k));
    for (const key of sortedBy([...new Set(unknownScope)], compareStrings)) {
      unsafe.push({ code: 'SCOPE_CATEGORY_UNKNOWN', params: { categoryKey: key } });
    }
    const aggregate = (code: string, list: readonly EntryFinding[]) => {
      if (list.length > 0)
        unsafe.push({ code, params: { entries: new Set(list.map((f) => f.entryId)).size } });
    };
    aggregate('ENTRY_MALFORMED', normalized.rejected);
    aggregate('INTAKE_DISAGREEMENT', gate.disagreements);
    aggregate('CATEGORY_KEY_MISMATCH', built.mismatches);

    // Withheld entries block their category only under the rule set's readiness policy (provenance
    // travels with the reason). A category of one eligible entry is READY: singletons are decided
    // by poolPolicies.singleton at pooling (walkover / merge suggestion / TD decision), not here.
    const readiness = rs.categoryReadiness;
    const entryById = new Map(normalized.entries.map((e) => [e.entryId, e]));
    const metricPools: MetricPool[] = [];
    const selfCheck: Reason[] = [];
    const placements: { poolUid: string; entryId: string }[] = [];
    const placeable: string[] = [];
    categories = built.categories.map((c) => {
      const blockedReasons: Reason[] = [];
      if (c.withheldEntryIds.length > 0 && readiness.withheldEntries === 'BLOCK_CATEGORY') {
        blockedReasons.push({
          code: 'ENTRIES_WITHHELD',
          params: {
            entries: c.withheldEntryIds.length,
            policy: readiness.withheldEntries,
            provenance: readiness.provenance.source,
          },
        });
      }
      if (c.entryIds.length === 0) blockedReasons.push({ code: 'NO_ELIGIBLE_ENTRIES', params: {} });
      if (c.entryIds.length > limits.maxCategoryEntries) {
        blockedReasons.push(
          limitExceeded('maxCategoryEntries', limits.maxCategoryEntries, c.entryIds.length, c.categoryKey),
        );
      }
      const template = rs.categoryTemplates.find((t) => t.code === c.templateCode);
      // Stages 5–14 run only for a READY category; a blocked category places nothing.
      const draw =
        blockedReasons.length === 0 && template
          ? drawCategory({ rs, category: c, template, entries: entryById, seed: input.seed, limits })
          : null;
      if (draw) {
        blockedReasons.push(...draw.blocked);
        selfCheck.push(...draw.selfCheck);
        drawFindings.push(...draw.findings);
      }
      const ready = blockedReasons.length === 0;
      if (ready && draw) {
        metricPools.push(...draw.metricPools);
        placeable.push(...c.entryIds);
        for (const p of draw.pools)
          for (const id of p.entryIds) placements.push({ poolUid: p.poolUid, entryId: id });
      }
      return {
        categoryKey: c.categoryKey,
        templateCode: c.templateCode,
        readiness: ready ? ('READY' as const) : ('BLOCKED' as const),
        blockedReasons,
        entryIds: c.entryIds,
        withheldEntryIds: c.withheldEntryIds,
        candidates: draw?.candidates ?? [],
        pools: ready ? (draw?.pools ?? []) : [],
        reasons: draw?.reasons ?? [],
      };
    });
    const blockedCategories = categories.filter((c) => c.readiness === 'BLOCKED').length;
    if (blockedCategories > 0)
      unsafe.push({ code: 'CATEGORY_BLOCKED', params: { categories: blockedCategories } });

    // Engine self-check before anything is returned as SAFE: INV-02/03 over every placement, and
    // every bracket's INV-04/08 violations found while drawing.
    for (const v of checkPlacementInvariants(placeable, placements)) {
      selfCheck.push({
        code: 'PLACEMENT_INVARIANT_VIOLATED',
        params: { invariant: v.invariant, violation: v.code, entryId: v.subject },
      });
    }
    if (selfCheck.length > 0) unsafe.push(...selfCheck);

    const pools = categories.flatMap((c) => c.pools);
    if (pools.length > limits.maxPools)
      unsafe.push(limitExceeded('maxPools', limits.maxPools, pools.length, 'RUN'));
    const movementScheme = rs.beltBandSchemes.find((s) => s.purpose === 'MOVEMENT');
    const rank = new Map(rs.belts.map((b) => [b.code, b.rank]));
    const bandOfRank = new Map<number, string>();
    for (const band of movementScheme?.bands ?? [])
      for (const code of band.beltCodes) bandOfRank.set(rank.get(code) ?? -1, band.code);
    Object.assign(drawMetrics, semiPrestasiMetrics(metricPools, bandOfRank), {
      pools: pools.length,
      poolsWalkover: pools.filter((p) => p.isWalkover).length,
      entriesPlaced: placements.length,
      byes: pools.reduce((s, p) => s + p.bracket.byes, 0),
      realMatches: pools.reduce((s, p) => s + p.bracket.matches.filter((m) => m.real).length, 0),
      sameContingentRound1: pools.reduce(
        (s, p) => s + (p.bracket.placement.sameContingentByRound[0] ?? 0),
        0,
      ),
    });

    findings.push(
      ...normalized.rejected.map((f) => toFinding('ERROR', f)),
      ...gate.disagreements.map((f) => toFinding('ERROR', f)),
      ...built.mismatches.map((f) => toFinding('ERROR', f)),
      ...gate.withheld.map((f) => toFinding('INFO', f)),
      ...built.unverified.map((f) => toFinding('INFO', f)),
    );
    Object.assign(metrics, {
      entriesMalformed:
        normalized.rejected.length === 0 ? 0 : new Set(normalized.rejected.map((f) => f.entryId)).size,
      entriesEligible: gate.eligible.length,
      entriesWithheld: gate.withheld.length,
      intakeDisagreements: gate.disagreements.length,
      categoryKeyMismatches: built.mismatches.length,
      categoryKeysUnverified: built.unverified.length,
      categories: categories.length,
      categoriesReady: categories.length - blockedCategories,
      categoriesBlocked: blockedCategories,
    });
  }

  const stages = ENGINE_STAGES.map((stage) => ({ stage, status: STAGE_STATUS[stage] }));
  const firstMissing = stages.find((s) => s.status === 'NOT_IMPLEMENTED');
  if (firstMissing) {
    unsafe.push({ code: 'ENGINE_STAGE_NOT_IMPLEMENTED', params: { stage: firstMissing.stage } });
  }

  const status = unsafe.length === 0 ? ('SAFE' as const) : ('UNSAFE' as const);
  if (status === 'SAFE') {
    metrics = { ...drawMetrics, ...metrics };
    findings.push(...drawFindings);
  } else {
    // No partial draw: an UNSAFE run returns readiness and reasons, never pools or candidates.
    categories = categories.map((c) => ({ ...c, candidates: [], pools: [], reasons: [] }));
  }

  const inputFp = inputFingerprint(input);
  const rulesFp = assessment.fingerprint ?? fingerprint(input.ruleSet);
  const body = {
    engineVersion: ENGINE_VERSION,
    purpose: input.purpose,
    seed: input.seed,
    status,
    unsafeReasons: unsafe,
    failure: null,
    stages,
    categories,
    quality: {
      findings: sortedBy(
        findings,
        (a, b) =>
          compareStrings(a.level, b.level) ||
          compareStrings(a.code, b.code) ||
          compareStrings(a.subject, b.subject),
      ),
      metrics,
    },
    lock: assessLock(input, status),
    limits,
  };
  return {
    ...body,
    fingerprints: { input: inputFp, rules: rulesFp, output: fingerprint({ ...body, inputFp, rulesFp }) },
  };
}
