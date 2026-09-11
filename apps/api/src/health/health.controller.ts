import { Controller, Get, HttpCode, HttpException, HttpStatus, Inject } from '@nestjs/common';

import { evaluateReadiness, type Probe, type ReadinessResult } from './readiness';

export const READINESS_PROBES = Symbol('READINESS_PROBES');

@Controller('health')
export class HealthController {
  constructor(@Inject(READINESS_PROBES) private readonly probes: Probe[]) {}

  /** Process is up. Never touches dependencies, so an orchestrator does not restart on a DB outage. */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Dependencies are reachable; 503 otherwise so the instance is taken out of rotation. */
  @Get('ready')
  async ready(): Promise<ReadinessResult> {
    const result = await evaluateReadiness(this.probes, 2000);
    if (result.status !== 'ready') {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
