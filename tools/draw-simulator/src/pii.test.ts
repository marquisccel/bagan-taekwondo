import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { nonSyntheticNikShapedValues, repositoryTextFiles } from './pii-scan.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('PII audit of committable files (ADR-0014)', () => {
  it('scans the whole repository outside ignored folders', () => {
    expect(repositoryTextFiles(root).length).toBeGreaterThan(150);
  });

  it('every NIK-shaped value in a committable file is synthetic (region 99, or the synthetic fixture)', () => {
    expect(nonSyntheticNikShapedValues(root)).toEqual([]);
  });
});
