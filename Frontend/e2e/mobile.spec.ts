import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('mobile: navigation drawer, editor tabs and no horizontal overflow', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await drawer.getByRole('link', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/\/calendar/);
  await expect(drawer).toBeHidden();

  await page.goto('/notes/new');
  // Split view is not offered on small screens; Edit/Preview tabs are.
  await expect(page.getByRole('radio', { name: 'Split' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Edit' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Preview' })).toBeVisible();

  for (const path of [
    '/dashboard',
    '/notes',
    '/modules',
    '/calendar',
    '/search',
    '/archive',
    '/settings/security',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
});
