import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedValue } from './use-debounced-value';

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds the initial value immediately, then only updates once changes settle for delayMs', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });
    expect(result.current).toBe('a');

    rerender({ value: 'ab' });
    await act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe('a'); // not yet -- still mid-typing

    rerender({ value: 'abc' });
    await act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe('a'); // the 'ab' timer was cancelled by the new keystroke

    await act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe('abc'); // 300ms after the LAST change, not the first
  });
});
