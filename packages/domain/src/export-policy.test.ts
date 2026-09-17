import { describe, expect, it } from 'vitest';

import { canExportInMode, exportTransitionAllowed } from './export-policy.js';
import { canRequestExport, canViewExport } from './rbac.js';

describe('canExportInMode', () => {
  it('allows OFFICIAL only from LOCKED, PUBLISHED, or AMENDED', () => {
    expect(canExportInMode('LOCKED', 'OFFICIAL')).toBe(true);
    expect(canExportInMode('PUBLISHED', 'OFFICIAL')).toBe(true);
    expect(canExportInMode('AMENDED', 'OFFICIAL')).toBe(true);
    expect(canExportInMode('DRAFT', 'OFFICIAL')).toBe(false);
    expect(canExportInMode('REVIEW', 'OFFICIAL')).toBe(false);
    expect(canExportInMode('APPROVED', 'OFFICIAL')).toBe(false);
    expect(canExportInMode('SUPERSEDED', 'OFFICIAL')).toBe(false);
  });

  it('allows PREVIEW from any live lifecycle but never from SUPERSEDED', () => {
    for (const lifecycle of ['DRAFT', 'REVIEW', 'APPROVED', 'LOCKED', 'PUBLISHED', 'AMENDED'] as const) {
      expect(canExportInMode(lifecycle, 'PREVIEW')).toBe(true);
    }
    expect(canExportInMode('SUPERSEDED', 'PREVIEW')).toBe(false);
  });
});

describe('exportTransitionAllowed', () => {
  it('only allows REQUESTED -> GENERATING -> {READY, FAILED}', () => {
    expect(exportTransitionAllowed('REQUESTED', 'GENERATING')).toBe(true);
    expect(exportTransitionAllowed('GENERATING', 'READY')).toBe(true);
    expect(exportTransitionAllowed('GENERATING', 'FAILED')).toBe(true);
    expect(exportTransitionAllowed('REQUESTED', 'READY')).toBe(false);
    expect(exportTransitionAllowed('READY', 'GENERATING')).toBe(false);
    expect(exportTransitionAllowed('FAILED', 'GENERATING')).toBe(false);
  });
});

describe('canRequestExport', () => {
  it('requires DRAWING_OFFICER+ for PREVIEW and TECHNICAL_DELEGATE+ for OFFICIAL', () => {
    expect(canRequestExport('VIEWER', 'PREVIEW')).toBe(false);
    expect(canRequestExport('DRAWING_OFFICER', 'PREVIEW')).toBe(true);
    expect(canRequestExport('DRAWING_OFFICER', 'OFFICIAL')).toBe(false);
    expect(canRequestExport('TECHNICAL_DELEGATE', 'OFFICIAL')).toBe(true);
    expect(canRequestExport('ADMIN', 'OFFICIAL')).toBe(true);
  });
});

describe('canViewExport', () => {
  it('is true for any resolved role and false for an unresolved actor', () => {
    expect(canViewExport('VIEWER')).toBe(true);
    expect(canViewExport(null)).toBe(false);
  });
});
