import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RevisionConflictBanner } from './RevisionConflictBanner';

describe('RevisionConflictBanner', () => {
  it('tells the operator to reload rather than silently retrying (ACCEPTANCE §REVISION CONFLICT)', () => {
    render(<RevisionConflictBanner onReload={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/changed by another operator/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/reload/i);
  });

  it('calls onReload when the Reload button is pressed', () => {
    const onReload = vi.fn();
    render(<RevisionConflictBanner onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
