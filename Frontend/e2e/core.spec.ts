import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { apiCsrf, createNote, editor, login, PNG_BASE64, typeInEditor, USER, waitForSaved } from './helpers';

test.describe.configure({ mode: 'serial' });

test('1. login rejects bad credentials and accepts good ones', async ({ page }) => {
  await page.goto('/notes');
  await expect(page).toHaveURL(/\/login\?next=%2Fnotes$/);
  await page.getByLabel('Username or email').fill(USER.identifier);
  await page.getByLabel('Password', { exact: true }).fill('wrong password!!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect username/email or password');
  await page.getByLabel('Password', { exact: true }).fill(USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Redirects back to the originally requested page.
  await expect(page).toHaveURL(/\/notes$/);
});

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => login(page));

  test('2. create a module', async ({ page }) => {
    await page.getByRole('link', { name: 'Modules' }).first().click();
    await page.getByRole('button', { name: 'New module' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Quantum Mechanics');
    await dialog.getByLabel('Module code').fill('PHY301');
    await dialog.getByRole('radio', { name: 'Violet' }).click();
    await dialog.getByRole('button', { name: 'Create module' }).click();
    await expect(page.getByRole('link', { name: /Quantum Mechanics/ })).toBeVisible();
  });

  test('3-5. create a note, edit Markdown, preview it, autosave and reload', async ({ page }) => {
    const id = await createNote(
      page,
      'Wave functions',
      '# Schrödinger\n\nThe **wave** function $\\psi$ evolves.\n\n- [x] read chapter 2\n',
      { module: 'PHY301 · Quantum Mechanics' },
    );
    expect(id).toMatch(/[0-9a-f-]{36}/);

    // Edit
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('\n```python\nprint("hello")\n```\n');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', /unsaved|saving/);
    await waitForSaved(page);

    // Preview
    await page.getByRole('radio', { name: 'Preview' }).click();
    const preview = page.getByTestId('note-preview');
    await expect(preview.getByRole('heading', { name: 'Schrödinger' })).toBeVisible();
    await expect(preview.locator('strong', { hasText: 'wave' })).toBeVisible();
    await expect(preview.locator('.katex')).toHaveCount(1);
    await expect(preview.locator('input[type=checkbox]')).toBeChecked();
    await expect(preview.locator('.code-block')).toContainText('print("hello")');

    // Reload: persisted, and an existing note opens in preview mode.
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Preview' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('note-preview').locator('.code-block')).toContainText('print("hello")');
    await expect(page.getByPlaceholder('Untitled note')).toHaveValue('Wave functions');
    await expect(page.getByLabel('Module', { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  });

  test('6. paste an image into the editor', async ({ page }) => {
    await createNote(page, 'Diagram note', 'Before image\n');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'screenshot.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector('.cm-content')!;
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    }, PNG_BASE64);
    await expect(editor(page)).toContainText('/api/attachments/', { timeout: 15_000 });
    await waitForSaved(page);
    await page.getByRole('radio', { name: 'Preview' }).click();
    const img = page.getByTestId('note-preview').locator('img[src^="/api/attachments/"]');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  });

  test('7. search for a note', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k');
    const box = page.getByRole('combobox', { name: 'Search notes' });
    await box.fill('schrod');
    await expect(page.getByRole('option', { name: /Wave functions/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    await expect(page.getByPlaceholder('Untitled note')).toHaveValue('Wave functions');

    await page.goto('/search?q=wave');
    await expect(page.locator('mark', { hasText: /wave/i }).first()).toBeVisible();
  });

  test('8. find a note in the calendar by lecture date', async ({ page }) => {
    await createNote(page, 'Historic lecture', 'From last year', { date: '2024-03-12' });
    await page.goto('/calendar?date=2024-03-12');
    await expect(page.getByRole('heading', { name: 'March 2024', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Tuesday 12 March 2024, 1 note/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Historic lecture' })).toBeVisible();
    // Keyboard navigation moves the selection.
    await page.getByRole('button', { name: /Tuesday 12 March 2024/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('heading', { name: 'Wednesday 13 March 2024' })).toBeVisible();
  });

  test('9. export a note as Markdown', async ({ page }) => {
    await page.goto('/search?q=schrodinger');
    await page.getByRole('link', { name: 'Wave functions' }).click();
    await page.getByRole('button', { name: 'Note actions' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: /Export Markdown/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^\d{4}-\d{2}-\d{2}-wave-functions\.md$/);
    const text = fs.readFileSync((await download.path())!, 'utf8');
    expect(text).toContain('title: "Wave functions"');
    expect(text).toContain('# Schrödinger');
  });

  test('10. import a Markdown file', async ({ page }) => {
    await page.getByRole('button', { name: 'Import Markdown' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Markdown file')
      .setInputFiles({
        name: 'week-7.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('# Entanglement\n\nSpooky action at a distance.\n'),
      });
    await expect(dialog.getByLabel('Title')).toHaveValue('Entanglement');
    await expect(dialog.getByRole('heading', { name: 'Entanglement' })).toBeVisible();
    await dialog.getByLabel('Lecture date').fill('2025-01-20');
    await dialog.getByRole('button', { name: 'Import note' }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('note-preview')).toContainText('Spooky action');

    // Re-importing the same file is detected and never overwrites.
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Import Markdown' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Markdown file')
      .setInputFiles({
        name: 'week-7.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('# Entanglement\n\nSpooky action at a distance.\n'),
      });
    await page.getByRole('dialog').getByRole('button', { name: 'Import note' }).click();
    await expect(page.getByRole('dialog')).toContainText('already imported');
  });

  test('11. restore a previous revision', async ({ page }) => {
    await createNote(page, 'Versioned', 'First draft');
    await typeInEditor(page, 'Second draft');
    await waitForSaved(page);
    await typeInEditor(page, 'Third draft');
    await waitForSaved(page);

    await page.getByRole('button', { name: 'Note actions' }).click();
    await page.getByRole('menuitem', { name: 'Version history' }).click();
    const dialog = page.getByRole('dialog', { name: 'Version history' });
    const versions = dialog.getByRole('list', { name: 'Versions' }).getByRole('button');
    await expect(versions.first()).toBeVisible();
    await versions.last().click();
    await expect(dialog).toContainText('First draft');
    await dialog.getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Restore version' }).click();
    await expect(editor(page)).toHaveText('First draft');
    await page.reload();
    await expect(page.getByTestId('note-preview')).toContainText('First draft');
  });

  test('12. delete a note and restore it from the recycle bin', async ({ page }) => {
    await createNote(page, 'Temporary note', 'Delete me');
    await page.getByRole('button', { name: 'Note actions' }).click();
    await page.getByRole('menuitem', { name: 'Move to recycle bin' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Move to recycle bin' }).click();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(page.getByRole('link', { name: 'Temporary note' })).toHaveCount(0);

    await page.goto('/archive?tab=bin');
    await page.getByRole('button', { name: 'Restore' }).first().click();
    await expect(page.getByText('The recycle bin is empty')).toBeVisible();
    await page.goto('/notes');
    await expect(page.getByRole('link', { name: 'Temporary note' })).toBeVisible();
  });

  test('conflicting edits are detected and nothing is overwritten silently', async ({ page, context }) => {
    const id = await createNote(page, 'Shared note', 'Original');
    // Simulate another device saving a newer revision.
    const csrf = await apiCsrf(page);
    const current = await (await page.request.get(`/api/notes/${id}`)).json();
    const res = await page.request.patch(`/api/notes/${id}`, {
      headers: { 'X-CSRF-Token': csrf, Origin: new URL(page.url()).origin },
      data: { revision: current.data.revision, markdownContent: 'Edited on another device' },
    });
    expect(res.ok()).toBeTruthy();

    await typeInEditor(page, 'My local edit');
    const conflict = page.getByRole('dialog', { name: 'This note was changed somewhere else' });
    await expect(conflict).toBeVisible({ timeout: 15_000 });
    await expect(conflict).toContainText('My local edit');
    await expect(conflict).toContainText('Edited on another device');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'conflict');
    await conflict.getByRole('button', { name: 'Overwrite with my version' }).click();
    await waitForSaved(page);
    const after = await (await page.request.get(`/api/notes/${id}`)).json();
    expect(after.data.markdownContent).toBe('My local edit');
    void context;
  });

  test('theme can be switched and persists', async ({ page }) => {
    await page.goto('/settings/appearance');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('13. logout ends the session', async ({ page }) => {
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    const res = await page.request.get('/api/notes');
    expect(res.status()).toBe(401);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
