import { test, expect } from '@playwright/test';

/**
 * Tests for the Model Setup Wizard panel.
 * Verifies the wizard fits within viewport and drag handles are accessible.
 *
 * Reference: GitHub Issue #128 - Wizard viewport overflow fix
 */
test.describe('Model Setup Wizard', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for app to load
    await page.waitForTimeout(1000);

    // Check if app has config error (blank page)
    const rootContent = await page.locator('#root').innerHTML().catch(() => '');
    if (rootContent.trim() === '') {
      // App didn't load due to missing config - skip wizard tests
      test.skip();
      return;
    }

    // Dismiss splash screen if present
    const enterButton = page.getByRole('button', { name: 'Enter' });
    if (await enterButton.isVisible().catch(() => false)) {
      await enterButton.click();
      await page.waitForTimeout(500);
    }

    // Dismiss notification banner if present
    const notNowButton = page.getByRole('button', { name: 'Not now' });
    if (await notNowButton.isVisible().catch(() => false)) {
      await notNowButton.click();
      await page.waitForTimeout(300);
    }
  });

  test('should fit within viewport when opened', async ({ page }) => {
    // Click New Fire Model button
    const newModelButton = page.getByRole('button', { name: /New Fire Model/i });
    if (!await newModelButton.isVisible().catch(() => false)) {
      test.skip();
      return;
    }
    await newModelButton.click();
    await page.waitForTimeout(500);

    // Check that wizard panel fits within viewport
    const fitsInViewport = await page.evaluate(() => {
      const wizard = document.querySelector('.wizard-container');
      const panel = wizard?.closest('[style*="z-index: 1000"]') as HTMLElement;
      if (!panel) return { found: false };

      const rect = panel.getBoundingClientRect();
      return {
        found: true,
        panelHeight: rect.height,
        viewportHeight: window.innerHeight,
        panelBottom: rect.bottom,
        fitsVertically: rect.bottom <= window.innerHeight,
        fitsHorizontally: rect.right <= window.innerWidth,
      };
    });

    expect(fitsInViewport.found).toBe(true);
    expect(fitsInViewport.fitsVertically).toBe(true);
  });

  test('should have accessible top drag handle', async ({ page }) => {
    // Click New Fire Model button
    const newModelButton = page.getByRole('button', { name: /New Fire Model/i });
    if (!await newModelButton.isVisible().catch(() => false)) {
      test.skip();
      return;
    }
    await newModelButton.click();
    await page.waitForTimeout(500);

    // Check that top drag handle is visible
    const topDragHandle = page.locator('.wizard-drag-handle').first();
    await expect(topDragHandle).toBeVisible();

    // Verify it's within viewport (not scrolled off)
    const isInViewport = await topDragHandle.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });

    expect(isInViewport).toBe(true);
  });

  test('should have accessible bottom drag handle', async ({ page }) => {
    // Click New Fire Model button
    const newModelButton = page.getByRole('button', { name: /New Fire Model/i });
    if (!await newModelButton.isVisible().catch(() => false)) {
      test.skip();
      return;
    }
    await newModelButton.click();
    await page.waitForTimeout(500);

    // Check that bottom drag handle is visible
    const bottomDragHandle = page.locator('.wizard-drag-handle').last();
    await expect(bottomDragHandle).toBeVisible();

    // Verify it's within viewport (not scrolled off)
    const isInViewport = await bottomDragHandle.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });

    expect(isInViewport).toBe(true);
  });

  test('should fit in small viewport (762px height)', async ({ page }) => {
    // Set viewport to the problematic size from the bug report
    await page.setViewportSize({ width: 1024, height: 762 });

    // Click New Fire Model button
    const newModelButton = page.getByRole('button', { name: /New Fire Model/i });
    if (!await newModelButton.isVisible().catch(() => false)) {
      test.skip();
      return;
    }
    await newModelButton.click();
    await page.waitForTimeout(500);

    // Check that wizard fits in this viewport
    const fitsInViewport = await page.evaluate(() => {
      const wizard = document.querySelector('.wizard-container');
      const panel = wizard?.closest('[style*="z-index: 1000"]') as HTMLElement;
      if (!panel) return { found: false };

      const rect = panel.getBoundingClientRect();
      return {
        found: true,
        panelHeight: rect.height,
        viewportHeight: window.innerHeight,
        fitsVertically: rect.bottom <= window.innerHeight,
      };
    });

    expect(fitsInViewport.found).toBe(true);
    // The key fix: wizard should not exceed viewport height
    expect(fitsInViewport.fitsVertically).toBe(true);
    // Wizard height should be less than viewport (with margin)
    if (fitsInViewport.found) {
      expect(fitsInViewport.panelHeight).toBeLessThanOrEqual(fitsInViewport.viewportHeight! - 20);
    }
  });
});
