import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('shows text, not just color, for every quality level (ACCEPTANCE §ACCESSIBILITY)', () => {
    render(<StatusBadge quality="GREEN" />);
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('renders Warning for YELLOW and Blocked for RED', () => {
    const { rerender } = render(<StatusBadge quality="YELLOW" />);
    expect(screen.getByText('Warning')).toBeInTheDocument();
    rerender(<StatusBadge quality="RED" />);
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });
});
