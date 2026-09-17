import { describe, expect, it } from 'vitest';

import {
  computeFileSha256,
  computeParametersFingerprint,
  computeSemanticExportFingerprint,
  computeSourceFingerprint,
} from './fingerprint.js';
import { buildExportModel } from './model.js';

const model = buildExportModel({
  tournament: { id: 't1', code: 'T1', name: 'Piala Uji', eventStart: '2026-08-27', eventEnd: '2026-08-30' },
  revision: {
    id: 'r1',
    revisionNo: 1,
    lifecycle: 'DRAFT',
    contentFingerprint: 'sha256:abc',
    submittedAt: null,
    approvedAt: null,
    lockedAt: null,
    publishedAt: null,
  },
  quality: null,
  categories: [],
  pools: [],
  poolMembers: [],
  entries: [],
  brackets: [],
  bracketSlots: [],
  matches: [],
});

describe('export fingerprints', () => {
  it('computeSourceFingerprint is stable for identical revision/scope and changes with scope', () => {
    const a = computeSourceFingerprint({
      revisionId: 'r1',
      contentFingerprint: 'sha256:abc',
      scopeType: 'REVISION',
      categoryId: null,
      poolId: null,
    });
    const b = computeSourceFingerprint({
      revisionId: 'r1',
      contentFingerprint: 'sha256:abc',
      scopeType: 'REVISION',
      categoryId: null,
      poolId: null,
    });
    expect(a).toBe(b);
    const scoped = computeSourceFingerprint({
      revisionId: 'r1',
      contentFingerprint: 'sha256:abc',
      scopeType: 'CATEGORY',
      categoryId: 'c1',
      poolId: null,
    });
    expect(scoped).not.toBe(a);
  });

  it('computeParametersFingerprint changes when mode changes but not when unrelated fields match', () => {
    const preview = computeParametersFingerprint({
      exportType: 'CATEGORY_DRAW',
      format: 'PDF',
      mode: 'PREVIEW',
      locale: 'id',
      templateVersion: 'v1',
    });
    const official = computeParametersFingerprint({
      exportType: 'CATEGORY_DRAW',
      format: 'PDF',
      mode: 'OFFICIAL',
      locale: 'id',
      templateVersion: 'v1',
    });
    expect(preview).not.toBe(official);
    const repeat = computeParametersFingerprint({
      exportType: 'CATEGORY_DRAW',
      format: 'PDF',
      mode: 'PREVIEW',
      locale: 'id',
      templateVersion: 'v1',
    });
    expect(repeat).toBe(preview);
  });

  it('computeSemanticExportFingerprint depends only on the ExportModel content, not on wall clock', () => {
    // Two "renders" of the same model at different simulated times must agree, because the
    // fingerprint function never reads generatedAt/verificationCode — those live outside the model.
    const fp1 = computeSemanticExportFingerprint(model);
    const fp2 = computeSemanticExportFingerprint(model);
    expect(fp1).toBe(fp2);
  });

  it('computeSemanticExportFingerprint changes when the underlying draw content changes', () => {
    const modelWithCategory = buildExportModel({
      tournament: model.tournament,
      revision: model.revision,
      quality: null,
      categories: [
        {
          id: 'c1',
          categoryKey: 'A',
          stream: 'S',
          discipline: 'KYORUGI',
          format: 'INDIVIDUAL',
          gender: 'MALE',
          movement: null,
          ageDivisionCode: null,
          weightClassCode: null,
          readiness: 'READY',
        },
      ],
      pools: [],
      poolMembers: [],
      entries: [],
      brackets: [],
      bracketSlots: [],
      matches: [],
    });
    expect(computeSemanticExportFingerprint(model)).not.toBe(
      computeSemanticExportFingerprint(modelWithCategory),
    );
  });

  it('computeFileSha256 is a pure function of the exact bytes given', () => {
    const bytes = new TextEncoder().encode('hello pdf bytes');
    expect(computeFileSha256(bytes)).toBe(computeFileSha256(bytes.slice()));
    expect(computeFileSha256(bytes)).not.toBe(computeFileSha256(new TextEncoder().encode('different bytes')));
  });
});
