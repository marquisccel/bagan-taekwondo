import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('shows text, not just color, for every quality level (ACCEPTANCE §ACCESSIBILITY)', () => {
    render(<StatusBadge quality="GREEN" />);
    expect(screen.getByText('Aman')).toBeInTheDocument();
  });

  it('renders Perlu Perhatian for YELLOW and Tidak Dapat Diterapkan for RED', () => {
    const { rerender } = render(<StatusBadge quality="YELLOW" />);
    expect(screen.getByText('Perlu Perhatian')).toBeInTheDocument();
    rerender(<StatusBadge quality="RED" />);
    expect(screen.getByText('Tidak Dapat Diterapkan')).toBeInTheDocument();
  });
});
