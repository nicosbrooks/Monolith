import { expect, type Page } from '@playwright/test'

// The desktop shell since the dock rework: places are buttons on the dock; the doc tree, folders, recordings and
// Recently Deleted live in the Library flyout (⌘\).

/** Goes to a place on the dock: Home, Docs, Tasks, Calendar or Recordings. */
export const place = (page: Page, name: 'Home' | 'Docs' | 'Tasks' | 'Calendar' | 'Recordings') => page.locator(`.dock-btn[aria-label="${name}"]`).click()

/** The Library flyout, opened if it isn't already. */
export async function library(page: Page) {
  const lib = page.locator('.library')
  if (!(await lib.count())) await page.locator('.dock-btn[aria-label="Library"]').click()
  await expect(lib).toBeVisible()
  return lib
}
