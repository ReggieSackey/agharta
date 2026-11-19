/**
 * E2E specs for AGHARTA web.
 *
 * Two suites:
 *  1. Public pages (no auth): marketing page + login redirect — always runnable.
 *  2. Authenticated flow (AuthKit): requires WORKOS_* env vars and a test
 *     account; skipped automatically when credentials are absent.
 */
import { test, expect } from '@playwright/test';

const hasAuth =
  !!process.env.WORKOS_CLIENT_ID &&
  !!process.env.WORKOS_API_KEY &&
  !!process.env.E2E_TEST_EMAIL &&
  !!process.env.E2E_TEST_PASSWORD;

test.describe('public pages', () => {
  test('marketing page renders product framing', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toContainText(/agharta/i, { timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/unconventional thinking/i);
  });

  test('unauthenticated dashboard visit redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/login|callback|workos|auth/i, { timeout: 15_000 }).catch(() => {});
    // Either on /login or forwarded to AuthKit — both prove middleware gating.
    const url = page.url();
    expect(/login|workos|auth/i.test(url)).toBeTruthy();
  });

  test('login page renders AuthKit state (configured notice or sign-in CTA)', async ({ page }) => {
    await page.goto('/login');
    const body = page.locator('body');
    // With real WorkOS keys: sign-in button. Without: explicit configuration
    // notice. Both are valid renderings of the login route.
    await expect
      .soft(body, 'login route renders')
      .toContainText(/sign in|not configured|WORKOS_/i, { timeout: 15_000 });
  });
});

test.describe('authenticated flow (requires WorkOS credentials)', () => {
  test.skip(!hasAuth, 'WORKOS_CLIENT_ID / WORKOS_API_KEY / E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set');

  test('login → dashboard → new problem form', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/auth\.workos\.com|sign-in/i, { timeout: 15_000 });

    // AuthKit hosted page
    await page.getByLabel(/email/i).fill(process.env.E2E_TEST_EMAIL!);
    await page.getByRole('button', { name: /continue|sign in|submit/i }).click();
    await page.getByLabel(/password/i).fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByRole('button', { name: /continue|sign in|submit/i }).click();

    await page.waitForURL(/dashboard/, { timeout: 30_000 });
    await expect(page.locator('body')).toContainText(/problems|explorations|dashboard/i);

    await page.goto('/problems/new');
    await expect(page.getByLabel(/title/i)).toBeVisible();
  });
});
