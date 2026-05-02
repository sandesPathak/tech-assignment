import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Card from '../components/cards/Card';

describe('Card', () => {
  it('renders face-up card with rank and suit', () => {
    render(<Card card="AH" />);
    expect(screen.getByTestId('card-AH')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('\u2665')).toBeInTheDocument(); // heart
  });

  it('renders face-down card', () => {
    render(<Card faceDown />);
    expect(screen.getByTestId('card-back')).toBeInTheDocument();
  });

  it('renders empty placeholder when no card and not face down', () => {
    const { container } = render(<Card />);
    expect(container.firstChild).toBeInTheDocument();
    expect(screen.queryByTestId('card-back')).not.toBeInTheDocument();
  });

  it('renders 10 correctly (two-char rank)', () => {
    render(<Card card="10C" />);
    expect(screen.getByTestId('card-10C')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('\u2663')).toBeInTheDocument(); // club
  });
});
