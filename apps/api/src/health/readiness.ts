/**
 * Readiness logic without framework dependencies, so it is unit-testable. The Nest controller
 * only adapts it to HTTP. Phase 4 adds the job-queue probe (pg-boss, ADR-0002).
 */
export interface Probe {
  readonly name: string;
  check(): Promise<void>;
}

export interface ReadinessResult {
  readonly status: 'ready' | 'not_ready';
  readonly checks: readonly { readonly name: string; readonly ok: boolean; readonly error?: string }[];
}

export async function evaluateReadiness(
  probes: readonly Probe[],
  timeoutMs: number,
): Promise<ReadinessResult> {
  const checks = await Promise.all(
    probes.map(async (p) => {
      try {
        await withTimeout(p.check(), timeoutMs);
        return { name: p.name, ok: true };
      } catch (e: unknown) {
        return { name: p.name, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return { status: checks.every((c) => c.ok) ? 'ready' : 'not_ready', checks };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}
