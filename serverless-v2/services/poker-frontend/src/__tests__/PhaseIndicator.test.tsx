import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PhaseIndicator from '../components/info/PhaseIndicator';

describe('PhaseIndicator', () => {
  it('displays hand number and phase label', () => {
    render(<PhaseIndicator handStep={5} stepName="PRE_FLOP_BETTING_ROUND" gameNo={3} />);

    expect(screen.getByText('Hand #3')).toBeInTheDocument();
    expect(screen.getByTestId('phase-label')).toHaveTextContent('Pre-Flop Betting');
  });

  it('shows raw step name if no label found', () => {
    render(<PhaseIndicator handStep={99} stepName="UNKNOWN_STEP" gameNo={1} />);

    expect(screen.getByTestId('phase-label')).toHaveTextContent('UNKNOWN_STEP');
  });
});
