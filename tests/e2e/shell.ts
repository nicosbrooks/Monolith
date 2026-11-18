import { expect, type Page } from '@playwright/test'

// The desktop shell: a sidebar rail (Rail.tsx) that opens on hover, with the places, Recent docs and
// Recently Deleted.

/** Goes to a place in the sidebar: Home, Docs, Tasks, Calendar or Recordings. */
export const place = (page: Page, name: 'Home' | 'Docs' | 'Tasks' | 'Calendar' | 'Recordings' | 'Vault') => page.locator(`.rl-place[aria-label="${name}"]`).click()

/** The sidebar, opened by resting the pointer on it. */
export async function library(page: Page) {
  const rail = page.locator('.rail')
  // Already open: use it. Otherwise wait until it has finished closing, so the pointer aims at where it really is.
  if (!(await rail.getAttribute('class'))?.includes('wide')) {
    await expect.poll(() => rail.evaluate((r) => Math.round(r.getBoundingClientRect().width))).toBeLessThan(60)
    await rail.hover()
  }
  await expect(rail).toHaveClass(/wide/)
  return rail
}
