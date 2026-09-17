import { defineConfig } from 'vitest/config';

/**
 * Test tiers (docs/ACCEPTANCE_CRITERIA.md §4):
 *   unit      *.test.ts            fast, pure, always run
 *   property  *.property.test.ts   fast-check invariants, always run
 *   golden    *.golden.test.ts     real 2026 dataset from data/private (skipped with a notice if absent)
 *   db        *.db.test.ts         migrations + constraints on PGlite, and on real PostgreSQL when DATABASE_URL is set
 *   render    *.render.test.ts     Phase 6 PDF/XLSX rendering via headless Chromium — slow, isolated from the fast unit loop
 */
const workspaceSource = {
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  ssr: { resolve: { conditions: ['source', 'module', 'node', 'development|production'] } },
};

const common = ['packages/**/src/**', 'tools/**/src/**', 'apps/*/src/**'];

export default defineConfig({
  ...workspaceSource,
  test: {
    reporters: ['default'],
    projects: [
      {
        ...workspaceSource,
        test: {
          name: 'unit',
          include: common.map((g) => `${g}/*.test.ts`),
          exclude: [
            '**/*.property.test.ts',
            '**/*.golden.test.ts',
            '**/*.db.test.ts',
            '**/*.render.test.ts',
            '**/node_modules/**',
          ],
        },
      },
      {
        ...workspaceSource,
        test: {
          name: 'property',
          include: common.map((g) => `${g}/*.property.test.ts`),
          testTimeout: 60_000,
        },
      },
      {
        ...workspaceSource,
        test: {
          name: 'golden',
          include: common.map((g) => `${g}/*.golden.test.ts`),
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
      {
        ...workspaceSource,
        test: {
          name: 'db',
          include: common.map((g) => `${g}/*.db.test.ts`),
          testTimeout: 120_000,
          // Migrating a fresh database can take tens of seconds while golden tests load the CPU.
          hookTimeout: 120_000,
        },
      },
      {
        ...workspaceSource,
        test: {
          name: 'render',
          include: common.map((g) => `${g}/*.render.test.ts`),
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        ...workspaceSource,
        test: {
          name: 'web',
          include: ['apps/web/{app,lib,components}/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['apps/web/vitest.setup.ts'],
        },
      },
    ],
  },
});
