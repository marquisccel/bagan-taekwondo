import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { DomainErrorFilter } from './errors/domain-error.filter';

/**
 * Phase 4: draw runs, revision commands, lifecycle actions and the audit trail (docs/PHASE0_PROPOSAL.md §5).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.useGlobalFilters(new DomainErrorFilter());
  // The operator UI (apps/web) is a separate origin. CORS_ORIGIN is a comma-separated allowlist;
  // unset means same-origin only (safe default), never a wildcard.
  const corsOrigin = process.env['CORS_ORIGIN'];
  if (corsOrigin) {
    app.enableCors({ origin: corsOrigin.split(',').map((o) => o.trim()), credentials: false });
  }
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port, '127.0.0.1');
}

void bootstrap();
