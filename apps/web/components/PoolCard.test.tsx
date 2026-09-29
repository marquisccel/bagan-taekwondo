import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EntryDisplay, PoolDetail } from '../lib/api';
import { PoolCard } from './PoolCard';

const entry: EntryDisplay = {
  entryId: 'e1',
  externalRef: 'R1',
  contingent: 'Kota A',
  displayName: 'Budi',
  athletes: [
    { fullName: 'Budi', gender: 'MALE', weightG: 45000, heightMm: 1600, beltCode: 'BLACK', beltLabel: null },
  ],
};
const pool: PoolDetail = {
  id: 'p1',
  poolUid: 'POOL-A',
  ordinal: 1,
  isWalkover: false,
  metrics: {},
  explanation: [],
  members: [entry],
  bracket: null,
};

function noop() {
  /* not exercised by these tests */
}

describe('PoolCard drag-and-drop', () => {
  it('drops onto a different pool call onDropEntry with the dragged entry id and the target pool uid', () => {
    const onDropEntry = vi.fn();
    render(
      <PoolCard
        pool={{ ...pool, poolUid: 'POOL-B', id: 'p2', ordinal: 2 }}
        editable
        onOpenDetail={noop}
        onMoveEntry={noop}
        onSwapEntry={noop}
        onDropEntry={onDropEntry}
        onMovePool={noop}
      />,
    );

    const dataTransfer = { getData: vi.fn().mockReturnValue('e1'), setData: vi.fn() };
    const card = screen.getByRole('group', { name: /budi/i });
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(screen.getByText('Pool 2').closest('.pool-card')!, { dataTransfer });

    expect(onDropEntry).toHaveBeenCalledWith('e1', 'POOL-B');
  });

  it('does nothing on drop when the pool is not editable (revision is not DRAFT)', () => {
    const onDropEntry = vi.fn();
    render(
      <PoolCard
        pool={pool}
        editable={false}
        onOpenDetail={noop}
        onMoveEntry={noop}
        onSwapEntry={noop}
        onDropEntry={onDropEntry}
        onMovePool={noop}
      />,
    );

    const dataTransfer = { getData: vi.fn().mockReturnValue('e1'), setData: vi.fn() };
    fireEvent.drop(screen.getByText('Pool 1').closest('.pool-card')!, { dataTransfer });
    expect(onDropEntry).not.toHaveBeenCalled();
    // Read-only pools offer neither the keyboard Pindahkan nor Tukar Peserta fallback.
    expect(screen.queryByRole('button', { name: 'Pindahkan' })).not.toBeInTheDocument();
  });

  it('the keyboard-accessible Pindahkan/Tukar Peserta buttons are available whenever the pool is editable', () => {
    render(
      <PoolCard
        pool={pool}
        editable
        onOpenDetail={noop}
        onMoveEntry={noop}
        onSwapEntry={noop}
        onDropEntry={noop}
        onMovePool={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Pindahkan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tukar Peserta' })).toBeInTheDocument();
  });
});
