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

    // Handle splash screen login if present
    const usernameInput = page.locator('#username');
    if (await usernameInput.isVisible().catch(() => false)) {
      await usernameInput.fill('Tester');
    }
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

/**
 * Tests for the Time Range step date picker.
 * Verifies the date picker is clickable and editable.
 *
 * Reference: GitHub Issue - Date Picker Click/Input Not Working
 */
test.describe('Time Range Date Picker', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Check if app loaded
    const rootContent = await page.locator('#root').innerHTML().catch(() => '');
    if (rootContent.trim() === '') {
      test.skip();
      return;
    }

    // Handle splash screen login if present
    const usernameInput = page.locator('#username');
    if (await usernameInput.isVisible().catch(() => false)) {
      await usernameInput.fill('Tester');
    }
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

  test('date picker should be visible and interactable', async ({ page }) => {
    // Open the wizard
    const newModelButton = page.getByRole('button', { name: /New Fire Model/i });
    if (!await newModelButton.isVisible().catch(() => false)) {
      test.skip();
      return;
    }
    await newModelButton.click();
    await page.waitForTimeout(500);

    // Click "Upload File" and upload a GeoJSON to proceed to step 2
    const uploadButton = page.getByRole('button', { name: /Upload File/i });
    await uploadButton.click();
    await page.waitForTimeout(300);

    // Click the upload zone to trigger file chooser
    const uploadZone = page.getByText('Click or drag file to upload');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await uploadZone.click();
    const fileChooser = await fileChooserPromise;

    // Create a temp GeoJSON file content
    const geoJsonContent = JSON.stringify({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [-115.5, 54.5] }
    });

    // Set the file (using a buffer approach)
    await fileChooser.setFiles({
      name: 'test.geojson',
      mimeType: 'application/json',
      buffer: Buffer.from(geoJsonContent)
    });
    await page.waitForTimeout(500);

    // Click Continue to go to Time Range step
    const continueButton = page.getByRole('button', { name: 'Continue' });
    await continueButton.click();
    await page.waitForTimeout(500);

    // Verify we're on step 2
    const step2Heading = page.getByRole('heading', { name: 'Time Range' });
    await expect(step2Heading).toBeVisible();

    // Find and verify the date picker input is visible
    const datePicker = page.locator('input[type="date"][aria-label="Start date"]');
    await expect(datePicker).toBeVisible();

    // Verify the date picker has a value
    const dateValue = await datePicker.inputValue();
    expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD format
  });

  test('date picker should accept manual input', async ({ page }) => {
    // Open the wizard and navigate to step 2
    const newModelButton = page.getByRole('button', { name: /New Fire Model/i });
    if (!await newModelButton.isVisible().catch(() => false)) {
      test.skip();
      return;
    }
    await newModelButton.click();
    await page.waitForTimeout(500);

    // Upload file to proceed
    const uploadButton = page.getByRole('button', { name: /Upload File/i });
    await uploadButton.click();
    const uploadZone = page.getByText('Click or drag file to upload');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await uploadZone.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'test.geojson',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        type: 'Feature', properties: {},
        geometry: { type: 'Point', coordinates: [-115.5, 54.5] }
      }))
    });
    await page.waitForTimeout(500);

    // Continue to step 2
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(500);

    // Get the date picker
    const datePicker = page.locator('input[type="date"][aria-label="Start date"]');
    await expect(datePicker).toBeVisible();

    // Clear and type a new date
    await datePicker.fill('2026-06-15');
    await page.waitForTimeout(300);

    // Verify the date was accepted
    const newValue = await datePicker.inputValue();
    expect(newValue).toBe('2026-06-15');
  });

  test('quick select buttons should update date picker', async ({ page }) => {
    // Open the wizard and navigate to step 2
    const newModelButton = page.getByRole('button', { name: /New Fire Model/i });
    if (!await newModelButton.isVisible().catch(() => false)) {
      test.skip();
      return;
    }
    await newModelButton.click();
    await page.waitForTimeout(500);

    // Upload file to proceed
    const uploadButton = page.getByRole('button', { name: /Upload File/i });
    await uploadButton.click();
    const uploadZone = page.getByText('Click or drag file to upload');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await uploadZone.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'test.geojson',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        type: 'Feature', properties: {},
        geometry: { type: 'Point', coordinates: [-115.5, 54.5] }
      }))
    });
    await page.waitForTimeout(500);

    // Continue to step 2
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(500);

    // Get initial date
    const datePicker = page.locator('input[type="date"][aria-label="Start date"]');
    const initialDate = await datePicker.inputValue();

    // Click Yesterday button
    const yesterdayButton = page.getByRole('button', { name: /Yesterday/i });
    await yesterdayButton.click();
    await page.waitForTimeout(300);

    // Verify date changed
    const afterYesterday = await datePicker.inputValue();

    // Calculate expected yesterday date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const expectedYesterday = yesterday.toISOString().split('T')[0];

    expect(afterYesterday).toBe(expectedYesterday);
  });
});
