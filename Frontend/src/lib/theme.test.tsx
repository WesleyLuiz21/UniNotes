import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './theme';

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="pref">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setPreference('dark')}>dark</button>
      <button onClick={() => setPreference('light')}>light</button>
    </div>
  );
}

describe('theme', () => {
  it('switches themes, applies the class and remembers the choice', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('pref')).toHaveTextContent('system');
    act(() => screen.getByText('dark').click());
    expect(document.documentElement).toHaveClass('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(localStorage.getItem('uninotes-theme')).toBe('dark');
    act(() => screen.getByText('light').click());
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('reads the stored preference on start', () => {
    localStorage.setItem('uninotes-theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('pref')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });
});
