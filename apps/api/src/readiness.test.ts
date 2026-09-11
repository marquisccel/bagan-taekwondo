import { describe, expect, it } from 'vitest';

import { createPool } from './app.module';
import { evaluateReadiness } from './health/readiness';

describe('postgres pool', () => {
  it('survives an idle-client error instead of crashing the process (smoke-test regression)', async () => {
    const warnings: string[] = [];
    const pool = createPool('postgres://u:p@127.0.0.1:1/x', { warn: (m: string) => warnings.push(m) });
    expect(() =>
      pool.emit('error', new Error('terminating connection due to administrator command')),
    ).not.toThrow();
    expect(warnings).toEqual([
      'postgres idle client error: terminating connection due to administrator command',
    ]);
    await pool.end();
  });
});

describe('readiness', () => {
  it('is ready only when every probe succeeds', async () => {
    const ok = { name: 'postgres', check: () => Promise.resolve() };
    const down = { name: 'queue', check: async () => Promise.reject(new Error('connection refused')) };
    expect((await evaluateReadiness([ok], 100)).status).toBe('ready');
    const r = await evaluateReadiness([ok, down], 100);
    expect(r.status).toBe('not_ready');
    expect(r.checks).toContainEqual({ name: 'queue', ok: false, error: 'connection refused' });
  });

  it('treats a hanging dependency as not ready', async () => {
    const hang = { name: 'postgres', check: () => new Promise<void>(() => undefined) };
    const r = await evaluateReadiness([hang], 20);
    expect(r.checks[0]).toEqual({ name: 'postgres', ok: false, error: 'timed out after 20 ms' });
  });
});
