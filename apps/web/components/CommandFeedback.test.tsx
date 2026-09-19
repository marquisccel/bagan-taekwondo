import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CommandVerdict } from '../lib/api';
import { CommandFeedback, ReasonPrompt } from './CommandFeedback';

const metrics = {
  tier0: 0,
  tier1Fp: 0,
  tier2Fp: 0,
  spread: 0,
  sizePenaltyFp: 0,
  singletons: 0,
  ranges: {},
  excess: {},
};
const yellow: CommandVerdict = {
  level: 'YELLOW',
  softViolations: ['HEIGHT_TOLERANCE_WORSENED', 'CONTINGENT_CONCENTRATION_WORSENED'],
  reasonRequired: true,
  impact: { change: 'WORSE', poolUids: ['p1', 'p2'], before: metrics, after: metrics },
};

describe('CommandFeedback (server verdict, Indonesian)', () => {
  it('GREEN is a quiet confirmation', () => {
    render(<CommandFeedback verdict={{ level: 'GREEN' }} onDismiss={() => undefined} />);
    const el = screen.getByTestId('command-feedback');
    expect(el).toHaveAttribute('data-level', 'GREEN');
    expect(el).toHaveTextContent('Perubahan diterapkan.');
  });

  it('YELLOW lists every server reason code in Indonesian and says the quality dropped', () => {
    render(<CommandFeedback verdict={yellow} onDismiss={() => undefined} />);
    const el = screen.getByTestId('command-feedback');
    expect(el).toHaveAttribute('data-level', 'YELLOW');
    expect(el).toHaveTextContent('peringatan kualitas');
    expect(el).toHaveTextContent('Kualitas pengelompokan menurun.');
    expect(el.querySelector('[data-code="HEIGHT_TOLERANCE_WORSENED"]')).toHaveTextContent(
      'selisih tinggi badan',
    );
    expect(el.querySelector('[data-code="CONTINGENT_CONCENTRATION_WORSENED"]')).toHaveTextContent(
      'kontingen',
    );
  });

  it('an unknown code is shown as-is, never hidden', () => {
    render(
      <CommandFeedback
        verdict={{ level: 'YELLOW', softViolations: ['SOMETHING_NEW'], reasonRequired: true }}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByText('SOMETHING_NEW')).toBeInTheDocument();
  });
});

describe('ReasonPrompt', () => {
  it('requires a non-empty reason, then confirms with it trimmed', () => {
    const onConfirm = vi.fn();
    render(<ReasonPrompt verdict={yellow} onConfirm={onConfirm} onCancel={() => undefined} />);
    const apply = screen.getByRole('button', { name: 'Terapkan' });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Alasan'), { target: { value: '   ' } });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Alasan'), { target: { value: '  Komplain K-12  ' } });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalledWith('Komplain K-12');
  });

  it('can be cancelled and shows what the server found', () => {
    const onCancel = vi.fn();
    render(<ReasonPrompt verdict={yellow} onConfirm={() => undefined} onCancel={onCancel} />);
    expect(screen.getByRole('dialog', { name: 'Alasan perubahan' })).toHaveTextContent(
      'selisih tinggi badan',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
