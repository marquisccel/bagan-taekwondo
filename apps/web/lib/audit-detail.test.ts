import { describe, expect, it } from 'vitest';

import { auditDetail } from './audit-detail';

describe('auditDetail', () => {
  it('shows the recorded soft violations in Indonesian', () => {
    expect(auditDetail('MOVE_ENTRY', { verdict: 'YELLOW', violations: ['HEIGHT_TOLERANCE_WORSENED'] })).toBe(
      'Kualitas menurun: selisih tinggi badan dalam pool melampaui toleransi ideal',
    );
  });
  it('says a GREEN change did not lower quality', () => {
    expect(auditDetail('SWAP_ENTRIES', { verdict: 'GREEN', violations: [] })).toBe('Kualitas: tidak menurun');
  });
  it('explains a supersede', () => {
    expect(auditDetail('LIFECYCLE_SUPERSEDE', { supersededBy: 'abcdef12-0000' })).toBe(
      'Digantikan oleh revisi abcdef12',
    );
  });
  it('has no detail for other events', () => {
    expect(auditDetail('LIFECYCLE_LOCK', { lifecycle: 'LOCKED' })).toBeNull();
    expect(auditDetail('LIFECYCLE_LOCK', null)).toBeNull();
  });
});
