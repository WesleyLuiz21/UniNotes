import { expect, type Page } from '@playwright/test';

export const USER = {
  identifier: process.env.E2E_USER ?? 'tester',
  password: process.env.E2E_PASSWORD ?? 'e2e password long enough',
};

export async function login(page: Page, identifier = USER.identifier, password = USER.password) {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export const editor = (page: Page) => page.locator('.cm-content');

/** Replace the editor's content by typing (exercises the real input pipeline). */
export async function typeInEditor(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

export async function waitForSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });
}

/** Create a note through the UI and return its id. */
export async function createNote(
  page: Page,
  title: string,
  content: string,
  opts: { date?: string; module?: string } = {},
) {
  await page.goto('/notes/new');
  await page.getByPlaceholder('Untitled note').fill(title);
  if (opts.module) await page.getByLabel('Module', { exact: true }).selectOption({ label: opts.module });
  if (opts.date) await page.getByLabel('Lecture date').fill(opts.date);
  await typeInEditor(page, content);
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await waitForSaved(page);
  return page.url().split('/').at(-1)!;
}

export async function apiCsrf(page: Page) {
  const res = await page.request.get('/api/auth/session');
  return ((await res.json()) as { data: { csrfToken: string } }).data.csrfToken;
}

// 1x1 transparent PNG
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
