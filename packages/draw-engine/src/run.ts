import { assessRuleSet } from '@bagantkd/rules';
import { fingerprint } from '@bagantkd/shared';

import {
  ENGINE_STAGES,
  ENGINE_VERSION,
  type EngineInput,
  type EngineOutput,
  type EngineStage,
  type Reason,
  type StageStatus,
} from './contract.js';

/**
 * Implementation status per stage. A stage flips to IMPLEMENTED only together with its
 * tests (docs/ACCEPTANCE_CRITERIA.md §5). Phase 1 ships the contract, not the algorithms.
 */
export const STAGE_STATUS: Readonly<Record<EngineStage, StageStatus>> = Object.fromEntries(
  ENGINE_STAGES.map((s) => [s, 'NOT_IMPLEMENTED']),
) as Record<EngineStage, StageStatus>;

/**
 * Runs the draw. Pure: no clock, no I/O, no ambient randomness.
 *
 * The engine refuses rather than guesses. Any precondition failure, or any stage that is not
 * implemented yet, produces status UNSAFE with machine-readable reasons and no placements —
 * "draw cannot be safely generated" is a valid, expected result.
 */
export function runDraw(input: EngineInput): EngineOutput {
  const unsafe: Reason[] = [];

  if (input.engineVersion !== ENGINE_VERSION) {
    unsafe.push({
      code: 'ENGINE_VERSION_MISMATCH',
      params: { requested: input.engineVersion, installed: ENGINE_VERSION },
    });
  }
  if (input.purpose === 'CANDIDATE' && input.assumptions !== null) {
    unsafe.push({ code: 'ASSUMPTIONS_NOT_ALLOWED_FOR_CANDIDATE', params: {} });
  }

  const assessment = assessRuleSet(input.ruleSet, input.purpose);
  if (!assessment.allowed) {
    for (const f of assessment.findings.filter((x) => x.level === 'INVALID')) {
      unsafe.push({ code: 'RULE_SET_INVALID', params: { finding: f.code, path: f.path } });
    }
  }

  const stages = ENGINE_STAGES.map((stage) => ({ stage, status: STAGE_STATUS[stage] }));
  const firstMissing = stages.find((s) => s.status === 'NOT_IMPLEMENTED');
  if (firstMissing) {
    unsafe.push({ code: 'ENGINE_STAGE_NOT_IMPLEMENTED', params: { stage: firstMissing.stage } });
  }

  const inputFp = fingerprint({
    engineVersion: input.engineVersion,
    purpose: input.purpose,
    seed: input.seed,
    entries: input.entries,
    scope: input.scope,
    assumptions: input.assumptions,
  });
  const rulesFp = assessment.fingerprint ?? fingerprint(input.ruleSet);

  const body = {
    engineVersion: ENGINE_VERSION,
    purpose: input.purpose,
    seed: input.seed,
    status: unsafe.length === 0 ? ('SAFE' as const) : ('UNSAFE' as const),
    unsafeReasons: unsafe,
    stages,
    categories: [],
    quality: { findings: [], metrics: { entries: input.entries.length } },
  };
  return {
    ...body,
    fingerprints: { input: inputFp, rules: rulesFp, output: fingerprint({ ...body, inputFp, rulesFp }) },
  };
}
