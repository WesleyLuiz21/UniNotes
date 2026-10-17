import { expect, test } from '@playwright/test';
import { createNote, login } from './helpers';

// Rich content must work under the production Content-Security-Policy (no eval, no inline
// scripts, no remote resources). Most meaningful when run against the Docker stack.
test('rich Markdown renders without CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await login(page);
  await createNote(
    page,
    'CSP check',
    '# Heading\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n```ts\nconst x: number = 1;\n```\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: Hi\n```\n\n![remote](https://example.com/pixel.png)\n',
  );
  await page.getByRole('radio', { name: 'Preview' }).click();
  const preview = page.getByTestId('note-preview');
  await expect(preview.locator('.katex-display')).toBeVisible();
  await expect(preview.locator('img[alt="Mermaid diagram"]')).toBeVisible({ timeout: 20_000 });
  // Shiki applied token colours (CSS variables on spans).
  await expect.poll(() => preview.locator('.shiki span[style*="--shiki"]').count()).toBeGreaterThan(0);
  await expect(preview.getByText('External image: remote')).toBeVisible();
  expect(violations).toEqual([]);
});
