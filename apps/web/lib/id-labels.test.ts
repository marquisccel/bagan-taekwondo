import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import {
  drawReasonLabel,
  drawRunStatusLabel,
  eligibilityLabel,
  formatDateRange,
  formatLabel,
  humanizeCode,
  issueCodeLabel,
  ruleFindingLabel,
} from './id-labels';

describe('id-labels', () => {
  it('uses Indonesian terms for statuses and formats', () => {
    expect(drawRunStatusLabel('UNSAFE')).toBe('Tidak aman');
    expect(eligibilityLabel('BLOCKED')).toBe('Diblokir');
    expect(formatLabel('PAIR')).toBe('Pasangan');
    expect(formatLabel('TEAM')).toBe('Beregu');
    expect(ruleFindingLabel('RULE_SET_NOT_ACTIVE')).toMatch(/belum berstatus aktif/);
    expect(drawReasonLabel('CATEGORY_BLOCKED')).toMatch(/diblokir/);
  });

  it('falls back to an honest humanised code for unknown codes', () => {
    expect(humanizeCode('SOME_NEW_CODE')).toBe('Some New Code');
    expect(issueCodeLabel('SOME_NEW_CODE')).toBe('Some New Code');
  });

  it('formats an event date range in Indonesian', () => {
    expect(formatDateRange('2026-08-27', '2026-08-30')).toMatch(/27.*2026.*30.*2026/);
    expect(formatDateRange('2026-08-27', '2026-08-27')).not.toContain('–');
  });
});

describe('api client additions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(body: unknown, status = 200) {
    const fn = vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      statusText: 'x',
      text: () => Promise.resolve(JSON.stringify(body)),
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('lists tournaments from the collection endpoint', async () => {
    const fn = stubFetch([]);
    await api.tournaments('actor-1');
    const call = fn.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toMatch(/\/tournaments$/);
    expect((call[1].headers as Record<string, string>)['x-actor-id']).toBe('actor-1');
  });

  it('builds the entries query string, skipping empty filters', async () => {
    const fn = stubFetch({ items: [], total: 0, limit: 50, offset: 0, facets: { categories: [] } });
    await api.entries('a', 't1', {
      q: 'budi',
      contingent: '',
      discipline: 'KYORUGI',
      hasIssues: true,
      limit: 50,
      offset: 0,
    });
    const url = (fn.mock.calls[0] as [string])[0];
    expect(url).toContain('/tournaments/t1/entries?');
    const qs = new URL(url).searchParams;
    expect(qs.get('q')).toBe('budi');
    expect(qs.get('discipline')).toBe('KYORUGI');
    expect(qs.get('hasIssues')).toBe('true');
    expect(qs.has('contingent')).toBe(false);
  });

  it('posts a draw run request to the existing endpoint', async () => {
    const fn = stubFetch({ drawRunId: 'r1', inputFingerprint: 'x', status: 'QUEUED' }, 201);
    const res = await api.createDrawRun('a', 't1', {
      ruleSetId: 'rs',
      intakeSnapshotId: 'snap',
      kind: 'CANDIDATE',
      seed: '20260827',
      scope: [],
    });
    expect(res.status).toBe('QUEUED');
    const call = fn.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toMatch(/\/tournaments\/t1\/draw-runs$/);
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body as string)).toMatchObject({
      kind: 'CANDIDATE',
      seed: '20260827',
      scope: [],
    });
  });
});
