import { test as base, expect } from '@playwright/test';

/**
 * Every spec imports `test` from here. It hides real game controllers from the page, so a gamepad plugged into the
 * machine running the tests cannot steer the ship or take over the HUD. A spec that wants a pad installs a fake one with
 * its own init script, which runs after this one.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      navigator.getGamepads = () => [];
    });
    await use(page);
  },
});

export { expect };
