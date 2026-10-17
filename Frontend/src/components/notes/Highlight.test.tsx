import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Highlight, stripMarks } from './Highlight';

describe('Highlight', () => {
  it('turns markers into <mark> elements', () => {
    const { container } = render(<Highlight text={'a \u0001hit\u0002 b \u0001two\u0002'} />);
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['hit', 'two']);
  });
  it('never interprets snippet text as HTML', () => {
    const { container } = render(<Highlight text={'<img src=x onerror=alert(1)> \u0001<b>x</b>\u0002'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
  it('strips markers', () => {
    expect(stripMarks('\u0001a\u0002b')).toBe('ab');
  });
});
