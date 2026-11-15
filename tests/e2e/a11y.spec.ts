/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Every main screen, checked against WCAG 2.2 A and AA with axe, in dark and light. Each test gets a fresh workspace.
let n = 0
async function start(page: Page) {
  await page.goto(`http://a${Date.now().toString(36)}${n++}.localhost:5220/`)
  await page.fill('#su-name', 'Sam')
  await page.click('.su button[type=submit]')
  await page.click('.su-opt:has-text("This browser")')
  await page.click('.su button.primary[type=submit]')
  await expect(page.locator('.su')).toHaveCount(0)
}
async function check(page: Page, where: string, include?: string) {
  // Measure what's on screen once things have faded in, not mid-animation.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(300)
  let axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
  if (include) axe = axe.include(include)
  const { violations } = await axe.analyze()
  const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 4).map((x) => `   ${x.target.join(' ')}  ${x.failureSummary?.split('\n')[1]?.trim() ?? ''}`).join('\n')}`)
  expect(report, `${where}:\n${report.join('\n')}`).toEqual([])
}

test('setup', async ({ page }) => {
  await page.goto(`http://setup${Date.now().toString(36)}.localhost:5220/`)
  await expect(page.locator('#su-name')).toBeVisible()
  await check(page, 'setup')
})

for (const scheme of ['dark', 'light'] as const) {
  test.describe(scheme, () => {
    test.beforeEach(async ({ page }) => {
      await start(page)
      await page.keyboard.press('Control+,')
      await page.locator('.modal .seg button', { hasText: scheme === 'dark' ? 'Dark' : 'Light' }).click()
      await page.keyboard.press('Escape')
      await expect(page.locator('.modal')).toHaveCount(0)
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
    })

    test('home, docs, recordings and calendar', async ({ page }) => {
      await check(page, 'home')
      await page.getByText('Docs', { exact: true }).first().click()
      await page.getByText('Study system').first().click()
      await expect(page.locator('.ProseMirror')).toBeVisible()
      await check(page, 'a doc')
      await page.getByText('Recordings', { exact: true }).first().click()
      await check(page, 'recordings')
      await page.getByText('Calendar', { exact: true }).first().click()
      await expect(page.locator('input[placeholder*="Add an event"]').first()).toBeVisible()
      await check(page, 'calendar')
    })

    test('settings, command menu and file viewer', async ({ page }) => {
      await page.keyboard.press('Control+,')
      await expect(page.locator('.modal')).toBeVisible()
      await page.locator('.about summary', { hasText: 'Privacy' }).click()
      await check(page, 'settings', '.modal')
      await page.keyboard.press('Escape')
      await expect(page.locator('.modal')).toHaveCount(0)
      await page.keyboard.press('Control+k')
      await expect(page.locator('[cmdk-root]')).toBeVisible()
      await check(page, 'command menu', '[cmdk-root]')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+n')
      await expect(page.locator('.doc-title')).toBeFocused()
      await page.keyboard.type('Data')
      await page.keyboard.press('Enter')
      await expect(page.locator('.ProseMirror')).toBeFocused()
      await page.keyboard.type('x')
      await page.evaluate(() => {
        const dt = new DataTransfer()
        dt.items.add(new File(['Name,Score\nAna,84\n'], 'survey.csv', { type: 'text/csv' }))
        document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      })
      await check(page, 'a doc with a file card')
      await page.click('.file-card button:has-text("Open")')
      await expect(page.locator('.fv-csv')).toBeVisible()
      await check(page, 'file viewer', '.fv')
    })
  })
}

test('dialogs keep keyboard focus inside them, and Escape closes them', async ({ page }) => {
  await start(page)
  const trapped = async (sel: string) => {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab')
      const inside = await page.evaluate((s) => !!document.activeElement?.closest(s), sel)
      expect(inside, `focus left ${sel} after ${i + 1} presses`).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(page.locator(sel)).toHaveCount(0)
  }
  await page.keyboard.press('Control+,')
  await expect(page.locator('.modal')).toBeVisible()
  await page.locator('.modal input').first().focus()
  await trapped('.modal')
  await page.keyboard.press('Control+n')
  await expect(page.locator('.doc-title')).toBeFocused()
  await page.keyboard.type('Data')
  await page.keyboard.press('Enter')
  await page.keyboard.type('x')
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['Name,Score\nAna,84\n'], 'survey.csv', { type: 'text/csv' }))
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await page.click('.file-card button:has-text("Open")')
  await expect(page.locator('.fv')).toBeVisible()
  await trapped('.fv')
})
