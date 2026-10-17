import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from './MarkdownPreview';
import { safeUrl } from './sanitize';

const html = (md: string) => render(<MarkdownPreview markdown={md} />).container.innerHTML;

describe('Markdown rendering security', () => {
  it.each([
    ['script tags', '<script>window.__pwned = 1</script>', /<script/i],
    ['event handler attributes', '<img src=x onerror="alert(1)">', /onerror/i],
    ['iframes', '<iframe src="https://evil.example"></iframe>', /<iframe/i],
    ['javascript: links', '[click](javascript:alert(1))', /javascript:/i],
    [
      'obfuscated javascript: links',
      '[click](JaVa\tScRiPt:alert(1)) [c2](%20javascript:alert(1)) [c3](&#106;avascript:alert(1))',
      /href="[^"]*script:/i,
    ],
    [
      'data:text/html links',
      '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
      /data:text\/html/i,
    ],
    ['vbscript links', '[x](vbscript:msgbox(1))', /vbscript/i],
    ['style injection', '<style>body{display:none}</style>', /<style/i],
    ['svg payloads', '<svg onload=alert(1)></svg>', /<svg|onload/i],
    ['autolinked javascript', '<javascript:alert(1)>', /href="javascript/i],
    ['reference-style javascript link', '[a][1]\n\n[1]: javascript:alert(1)', /javascript:/i],
    ['image with javascript src', '![x](javascript:alert(1))', /javascript:/i],
    ['katex \\href', '$\\href{javascript:alert(1)}{x}$', /href="javascript/i],
    ['html in table cells', '| a |\n|---|\n| <img src=x onerror=alert(1)> |', /onerror/i],
  ])('neutralises %s', (_name, md, forbidden) => {
    expect(html(md)).not.toMatch(forbidden);
  });

  it('does not execute embedded scripts', () => {
    html('<script>window.__pwned = 1</script><img src=x onerror="window.__pwned=2">');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('adds rel=noopener to external links', () => {
    const out = html('[site](https://example.com)');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it('only loads attachment images; remote images become links', () => {
    const local = html('![d](/api/attachments/11111111-2222-3333-4444-555555555555/content)');
    expect(local).toContain('<img');
    const remote = html('![tracker](https://evil.example/pixel.png)');
    expect(remote).not.toContain('<img');
    expect(remote).toContain('External image');
  });

  it('renders GFM, maths and task lists', () => {
    const out = html('# T\n\n**b** ~~s~~\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n$x^2$ :tada:');
    expect(out).toContain('<h1');
    expect(out).toContain('<strong>b</strong>');
    expect(out).toContain('<del>s</del>');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('<table');
    expect(out).toContain('katex');
    expect(out).toContain('🎉');
  });
});

describe('safeUrl', () => {
  it('allows safe schemes and relative URLs', () => {
    expect(safeUrl('https://a.b', 'href')).toBe('https://a.b');
    expect(safeUrl('/api/attachments/x/content', 'src')).toBe('/api/attachments/x/content');
    expect(safeUrl('#section', 'href')).toBe('#section');
    expect(safeUrl('mailto:a@b.c', 'href')).toBe('mailto:a@b.c');
    expect(safeUrl('data:image/png;base64,AAAA', 'src')).toBe('data:image/png;base64,AAAA');
  });
  it('blocks dangerous schemes', () => {
    for (const u of [
      'javascript:alert(1)',
      ' JAVASCRIPT:x',
      'java\nscript:x',
      'vbscript:x',
      'data:text/html,x',
      'file:///etc/passwd',
    ]) {
      expect(safeUrl(u, 'href')).toBe('');
    }
    expect(safeUrl('data:image/svg+xml;base64,AAAA', 'src')).toBe('');
    expect(safeUrl('mailto:a@b.c', 'src')).toBe('');
  });
});
