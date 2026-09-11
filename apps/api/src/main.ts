import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

/**
 * Phase 1 API skeleton: health endpoints only. Domain commands, draw runs, revisions and
 * audit arrive in Phase 4 (docs/PHASE0_PROPOSAL.md §5).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port, '127.0.0.1');
}

void bootstrap();
