import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_FILTERS } from '../lib/category-filters';
import { CategoryFilters } from './CategoryFilters';

describe('CategoryFilters', () => {
  it('reports a search change', () => {
    const onChange = vi.fn();
    render(<CategoryFilters value={EMPTY_FILTERS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/search category/i), { target: { value: 'KYORUGI' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, search: 'KYORUGI' });
  });

  it('reports a readiness filter change without touching the other fields', () => {
    const onChange = vi.fn();
    render(<CategoryFilters value={{ ...EMPTY_FILTERS, search: 'x' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/readiness/i), { target: { value: 'BLOCKED' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, search: 'x', readiness: 'BLOCKED' });
  });
});
