/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'

// The main flows, end to end. Each test gets a fresh origin, so a fresh workspace.
let n = 0
async function start(page: Page, name = `t${Date.now().toString(36)}${n++}`) {
  await page.goto(`http://${name}.localhost:5220/`)
  await page.fill('#su-name', 'Sam')
  await page.click('.su button[type=submit]')
  await page.click('.su-opt:has-text("This browser")')
  await page.click('.su button.primary[type=submit]')
  await expect(page.locator('.su')).toHaveCount(0)
}
/** ⌘N, then the title once the doc view (loaded on first use) is ready, then Enter into the body. */
async function newDoc(page: Page, title: string) {
  await page.keyboard.press('Control+n')
  await expect(page.locator('.doc-title')).toBeFocused()
  await page.keyboard.type(title)
  await page.keyboard.press('Enter')
  await expect(page.locator('.ProseMirror')).toBeFocused()
}
const paste = (page: Page, files: { name: string; type: string; text?: string; png?: [number, number] }[]) =>
  page.evaluate(async (files) => {
    const dt = new DataTransfer()
    for (const f of files) {
      let body: Blob
      if (f.png) {
        const c = new OffscreenCanvas(f.png[0], f.png[1])
        c.getContext('2d')!.fillRect(0, 0, 10, 10)
        body = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
      } else body = new Blob([f.text ?? ''], { type: f.type })
      dt.items.add(new File([body], f.name, { type: body.type }))
    }
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, files)

test('first-time setup traps focus and blocks shortcuts behind it', async ({ page }) => {
  await page.goto(`http://setup${Date.now().toString(36)}.localhost:5220/`)
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !document.activeElement || document.activeElement === document.body || !!document.activeElement.closest('.su'))).toBe(true)
  await page.keyboard.press('Control+,')
  await expect(page.locator('.modal')).toHaveCount(0)
})

test('a new doc keeps what is typed right after the title, and survives a reload', async ({ page }) => {
  await start(page)
  await page.keyboard.press('Control+n')
  await expect(page.locator('.doc-title')).toBeFocused()
  await page.keyboard.type('Biology plan')
  await page.keyboard.press('Enter')
  await page.keyboard.type('# Week 3', { delay: 0 }) // straight after Enter: must land in the body
  await page.keyboard.press('Enter')
  await page.keyboard.type('[] read chapter 4')
  await expect(page.locator('.doc-title')).toHaveValue('Biology plan')
  await expect(page.locator('.ProseMirror h1')).toHaveText('Week 3')
  await expect(page.locator('.ProseMirror li[data-checked="false"]')).toHaveCount(1)
  await page.waitForTimeout(1200)
  await page.reload()
  await expect(page.getByText('Biology plan').first()).toBeVisible()
})

test('files: pictures are resized and stored once, attachments get cards, the doc stays small', async ({ page }) => {
  await start(page)
  await newDoc(page, 'Files')
  await page.keyboard.type('x')
  await paste(page, [{ name: 'photo.jpg', type: 'image/jpeg', png: [4000, 3000] }, { name: 'data.csv', type: 'text/csv', text: 'a,b\n1,2\n'.repeat(400) }])
  await expect(page.locator('.ProseMirror .file-node')).toHaveCount(2)
  await expect.poll(() => page.evaluate(() => (document.querySelector('.ProseMirror .file-node img') as HTMLImageElement | null)?.naturalWidth ?? 0)).toBe(2560)
  await expect(page.locator('.file-card')).toContainText('data.csv')
  await page.waitForTimeout(1000)
  const html = await page.evaluate(async () => {
    const r = indexedDB.open('keyval-store')
    await new Promise((ok) => (r.onsuccess = ok))
    const q = r.result.transaction('keyval').objectStore('keyval').get('socratic-v1')
    await new Promise((ok) => (q.onsuccess = ok))
    return q.result as string
  })
  expect(html.length).toBeLessThan(100_000)
  expect(html).toMatch(/monolith-file:[0-9a-f]{32}/)
  expect(html).not.toContain('data:image')
})

test('the file viewer edits a CSV and saves it as a new version', async ({ page }) => {
  await start(page)
  await newDoc(page, 'Data')
  await page.keyboard.type('x')
  await paste(page, [{ name: 'survey.csv', type: 'text/csv', text: 'Name,Score\nAna,84\n"Lee, Jr",77\n' }])
  await page.click('.file-card button:has-text("Open")')
  await expect(page.locator('.fv-csv input').nth(5)).toHaveValue('77')
  await expect(page.locator('.fv-csv input').nth(4)).toHaveValue('Lee, Jr')
  await page.locator('.fv-csv input').nth(5).fill('79')
  await page.click('.fv-head button:has-text("Save")')
  await expect(page.locator('.toast')).toContainText('Saved')
  await page.keyboard.press('Escape')
  await page.click('.file-card button:has-text("Open")')
  await expect(page.locator('.fv-csv input').nth(5)).toHaveValue('79')
})

test('calendar quick add, with Undo', async ({ page }) => {
  await start(page)
  await page.getByText('Calendar', { exact: true }).first().click()
  const bar = page.locator('input[placeholder*="Add an event"]').first()
  await bar.fill('lunch with Alex tomorrow 1pm')
  await bar.press('Enter')
  await expect(page.locator('.toast')).toContainText('Lunch with Alex')
  await page.getByRole('button', { name: 'Undo' }).first().click()
  await expect(page.getByText('Lunch with Alex')).toHaveCount(0)
})

test('Start recording records on the first press', async ({ page }) => {
  await start(page)
  await page.getByText('Recordings', { exact: true }).first().click()
  await page.click('.nav-row button[aria-label="Start recording"]')
  await expect(page.locator('button[title="Stop"]')).toBeVisible()
  await page.waitForTimeout(1500)
  await page.click('button[title="Stop"]')
  await expect(page.locator('.side-tree .nav.sub.on')).toHaveCount(1)
})

test('deleting a doc can be undone and recovered', async ({ page }) => {
  await start(page)
  await page.getByText('Docs', { exact: true }).first().click()
  await page.getByText('Study system').first().click({ button: 'right' })
  await page.getByText('Delete', { exact: true }).click()
  await expect(page.locator('.toast')).toContainText('Recently Deleted')
  await page.getByText('Recently Deleted').first().click()
  await expect(page.getByText('Study system')).toBeVisible()
})
