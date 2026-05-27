/**
 * SplashModal tests (#275)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplashModal } from './SplashModal';

describe('SplashModal', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders title and body when given enabled content', () => {
    render(
      <SplashModal
        version="1.0.0"
        title="Welcome to Nomad"
        body="Hello world"
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Welcome to Nomad')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders markdown body as HTML elements (## becomes h2)', () => {
    render(
      <SplashModal
        version="1.0.0"
        title="T"
        body={'## A heading\n\nSome paragraph.'}
        onDismiss={() => {}}
      />,
    );
    const h2 = screen.getByRole('heading', { level: 2, name: /a heading/i });
    expect(h2).toBeInTheDocument();
  });

  it('clicking the dismiss button calls onDismiss with the version', () => {
    const onDismiss = vi.fn();
    render(
      <SplashModal
        version="2.3.4"
        title="T"
        body="b"
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(onDismiss).toHaveBeenCalledWith('2.3.4');
  });
});
