import { fingerprint, fingerprintBytes, type Fingerprint } from '@bagantkd/shared';

/**
 * Four distinct fingerprints (Phase 6 ACCEPTANCE §2) — never one vague hash. Each answers a
 * different question about "what produced this file":
 *
 *  - sourceFingerprint: which persisted revision content did the renderer read?
 *  - parametersFingerprint: which export request (type/format/mode/locale/template) was this?
 *  - semanticExportFingerprint: what is the deterministic logical content of the document, apart
 *    from any rendering noise (wall clock, filesystem path, random id, locale defaults, DB
 *    ordering)? Two runs of the same revision+params always produce the same value.
 *  - fileSha256: the exact bytes of the file that was written. This CAN differ between two runs
 *    that share an identical semanticExportFingerprint, because a PDF's binary metadata (producer
 *    string, /CreationDate) is written by the renderer itself and is not semantic content. XLSX
 *    workbooks written by exceljs do not embed a timestamp and so are expected to be byte-stable
 *    for an identical ExportModel; PDF workbooks are not, and that distinction is intentional, not
 *    a bug — do not "fix" fileSha256 instability for PDF by trying to strip renderer metadata.
 */
export interface ExportFingerprints {
  readonly sourceFingerprint: Fingerprint;
  readonly parametersFingerprint: Fingerprint;
  readonly semanticExportFingerprint: Fingerprint;
}

/** Identifies the exact persisted revision content an export reads — computed at request time, before any render. */
export function computeSourceFingerprint(args: {
  readonly revisionId: string;
  readonly contentFingerprint: string | null;
  readonly scopeType: 'REVISION' | 'CATEGORY' | 'POOL';
  readonly categoryId: string | null;
  readonly poolId: string | null;
}): Fingerprint {
  return fingerprint({
    revisionId: args.revisionId,
    contentFingerprint: args.contentFingerprint,
    scopeType: args.scopeType,
    categoryId: args.categoryId,
    poolId: args.poolId,
  });
}

/** Identifies the normalized export request itself — computed at request time, before any render. */
export function computeParametersFingerprint(args: {
  readonly exportType: string;
  readonly format: string;
  readonly mode: string;
  readonly locale: string;
  readonly templateVersion: string;
}): Fingerprint {
  return fingerprint({
    exportType: args.exportType,
    format: args.format,
    mode: args.mode,
    locale: args.locale,
    templateVersion: args.templateVersion,
  });
}

/**
 * The semantic export fingerprint: a fingerprint of the exact canonical content a given artifact
 * covers — the whole `ExportModel` for a revision-scoped document, or just the relevant category/
 * pool (plus tournament/revision identity) for a category- or pool-scoped one, so that two
 * different categories exported from the same revision never collide on the same fingerprint.
 * Since `buildExportModel` (model.ts) is a pure function with explicit deterministic ordering and
 * no wall-clock/random/path/locale-default inputs, fingerprinting any of its (sub-)content is
 * exactly "fingerprint the deterministic logical content" — nothing renderer-specific leaks in
 * because the renderers never feed anything back into the model.
 */
export function computeSemanticExportFingerprint(content: unknown): Fingerprint {
  return fingerprint(content);
}

/** Hash of the final binary file bytes (PDF or XLSX). See the fileSha256 caveat above. */
export function computeFileSha256(bytes: Uint8Array): Fingerprint {
  return fingerprintBytes(bytes);
}
