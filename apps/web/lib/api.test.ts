import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError, api } from './api';

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'x',
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
}

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the actor id as x-actor-id and parses a successful response', async () => {
    mockFetchOnce(200, {
      id: 't1',
      code: 'T1',
      name: 'Test',
      activeRuleSetStatus: 'ACTIVE',
      latestDrawRun: null,
      latestRevision: null,
      categoryCounts: { total: 0, ready: 0, blocked: 0 },
      warningCount: 0,
      errorCount: 0,
    });
    const result = await api.tournament('actor-1', 't1');
    expect(result.id).toBe('t1');
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call?.[0]).toContain('/tournaments/t1');
    expect((call?.[1]?.headers as Record<string, string>)['x-actor-id']).toBe('actor-1');
  });

  it('throws ApiClientError with the backend code and message on a non-2xx response, never the raw fetch error', async () => {
    mockFetchOnce(409, {
      code: 'REVISION_CONFLICT',
      message: 'expected lock_version 0, current is different',
    });
    await expect(api.revision('actor-1', 'rev-1')).rejects.toMatchObject({
      status: 409,
      code: 'REVISION_CONFLICT',
    });
  });

  it('surfaces an unknown-shaped error body without crashing', async () => {
    mockFetchOnce(500, null);
    try {
      await api.revision('actor-1', 'rev-1');
      throw new Error('expected a rejection');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiClientError);
      expect((e as ApiClientError).code).toBe('UNKNOWN_ERROR');
    }
  });
});
