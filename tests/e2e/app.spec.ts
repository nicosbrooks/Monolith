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

test('[[ links docs together: the link opens its doc, which shows what links to it, and follows a rename', async ({ page }) => {
  await start(page)
  await newDoc(page, 'Thesis outline')
  await page.keyboard.type('Builds on [[Stud')
  await expect(page.locator('.link-menu button.on')).toHaveText('Study system')
  await page.keyboard.press('Enter')
  // A name that doesn't exist yet makes the doc, without leaving this one.
  await page.keyboard.type('and [[Reading list')
  await expect(page.locator('.link-menu button.on')).toHaveText('New doc “Reading list”')
  await page.keyboard.press('Enter')
  await expect(page.locator('.doc-title')).toHaveValue('Thesis outline')
  await expect(page.locator('.ProseMirror a[href^="#doc/"]')).toHaveText(['Study system', 'Reading list'])
  await page.locator('.ProseMirror a', { hasText: 'Study system' }).click()
  await expect(page.locator('.doc-title')).toHaveValue('Study system')
  const from = page.locator('.cx-row', { hasText: 'Thesis outline' })
  await expect(from.locator('q')).toHaveText('Builds on Study system and Reading list')
  await page.fill('.doc-title', 'Study method')
  await from.click()
  await expect(page.locator('.doc-title')).toHaveValue('Thesis outline')
  await expect(page.locator('.ProseMirror a[href^="#doc/"]').first()).toHaveText('Study method')
})

test('Tasks gathers checklist lines from every doc, sorts them by date, and adds and completes them', async ({ page }) => {
  await start(page)
  await newDoc(page, 'Week plan')
  await page.keyboard.type('[] essay draft by friday')
  await page.keyboard.press('Enter')
  await page.keyboard.type('buy index cards')
  await page.locator('.sidebar .nav', { hasText: 'Tasks' }).click()
  await expect(page.locator('.hm-head h1')).toHaveText('Tasks')
  // The dated one comes first, under its time group, titled without the date words.
  const first = page.locator('.hm-task').first()
  await expect(first.locator('.hm-row-main span')).toHaveText('Essay draft')
  await expect(first.locator('.hm-due')).toBeVisible()
  await expect(page.locator('.hm-task', { hasText: 'buy index cards' })).toHaveCount(1)
  // Typing in the bar on this page adds a task, to a doc called Tasks.
  const before = await page.locator('.hm-task').count()
  await page.locator('.ask-field input').fill('renew library books tomorrow')
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast')).toContainText('Task added')
  await expect(page.locator('.hm-task')).toHaveCount(before + 1)
  await expect(page.locator('.hm-task', { hasText: 'Renew library books' }).locator('.hm-due')).toHaveText('Tomorrow')
  // Checking it here checks it in its doc, and Undo brings it back.
  await page.locator('.hm-task', { hasText: 'buy index cards' }).locator('input').click()
  await expect(page.locator('.hm-task', { hasText: 'buy index cards' })).toHaveCount(0)
  await page.locator('.toast', { hasText: 'Task done' }).getByText('Undo').click()
  await expect(page.locator('.hm-task', { hasText: 'buy index cards' })).toHaveCount(1)
  await page.locator('.hm-task', { hasText: 'Essay draft' }).locator('.hm-row-main').click()
  await expect(page.locator('.doc-title')).toHaveValue('Week plan')
})

test('Settings shows one section at a time', async ({ page }) => {
  await start(page)
  await page.keyboard.press('Control+,')
  await expect(page.locator('#su-name, .modal input[aria-label="Your name"]').first()).toBeVisible()
  await page.locator('.set-nav button', { hasText: 'Storage and files' }).click()
  await expect(page.locator('.modal h3', { hasText: 'Files' })).toBeVisible()
  await expect(page.locator('.modal input[aria-label="Your name"]')).toHaveCount(0)
  await page.locator('.set-nav button', { hasText: 'About' }).click()
  await expect(page.locator('.about-version')).toContainText('Monolith')
})

test('a repeating event shows on every date; one date can be removed, or all of them', async ({ page }) => {
  await start(page)
  await page.locator('.sidebar .nav', { hasText: 'Calendar' }).click()
  const bar = page.locator('input[placeholder*="Add an event"]').first()
  await bar.fill('seminar every day 1pm')
  await bar.press('Enter')
  await expect(page.locator('.toast')).toContainText('Every day')
  await bar.press('Escape')
  await page.locator('.cal-head h2').click()
  await page.keyboard.press('ArrowRight') // next week: all seven days
  const seminars = page.locator('.ev', { hasText: 'Seminar' })
  await expect(seminars).toHaveCount(7)
  // The editor says it repeats; deleting this one leaves the others.
  await seminars.first().click()
  await expect(page.locator('.sheet select[aria-label="Repeat"]')).toHaveValue('day')
  await page.getByRole('button', { name: 'Delete this one' }).click()
  await expect(seminars).toHaveCount(6)
  await page.locator('.toast', { hasText: 'Removed this one' }).getByText('Undo').click()
  await expect(seminars).toHaveCount(7)
  // Turning repeat off keeps the date being looked at.
  await seminars.nth(2).click()
  await page.locator('.sheet select[aria-label="Repeat"]').selectOption('')
  await expect(seminars).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.cal-head')).toBeVisible()
})

test('a task with a date shows on the calendar and can be checked off there', async ({ page }) => {
  await start(page)
  await newDoc(page, 'Plan')
  await page.keyboard.type('[] essay draft today')
  await page.locator('.sidebar .nav', { hasText: 'Calendar' }).click()
  const chip = page.locator('.chip.task', { hasText: 'Essay draft' })
  await expect(chip).toBeVisible()
  await chip.locator('.box').click()
  await expect(chip).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Task done')
})

test('earlier versions: a replaced doc can be read and restored, and restoring can be undone', async ({ page }) => {
  await start(page)
  await page.getByText('Docs', { exact: true }).first().click()
  await page.getByText('Study system').first().click()
  await expect(page.locator('.ProseMirror')).toContainText('Weekly loop')
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Everything replaced.')
  await expect(page.locator('.ProseMirror')).not.toContainText('Weekly loop')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'More options' }).click()
  await page.getByText('Earlier versions').click()
  await expect(page.locator('.hist-list button')).toHaveCount(1)
  await expect(page.locator('.hist-page')).toContainText('Weekly loop')
  await page.getByRole('button', { name: 'Restore this version' }).click()
  await expect(page.locator('.ProseMirror')).toContainText('Weekly loop')
  await page.locator('.toast', { hasText: 'Restored' }).getByText('Undo').click()
  await expect(page.locator('.ProseMirror')).toContainText('Everything replaced.')
})

test('Export everything downloads a zip, and reminders can be turned on', async ({ page }) => {
  await start(page)
  await page.keyboard.press('Control+,')
  await page.locator('.set-nav button', { hasText: 'Storage and files' }).click()
  const [file] = await Promise.all([page.waitForEvent('download'), page.locator('.model', { hasText: 'Export everything' }).getByRole('button').click()])
  expect(file.suggestedFilename()).toMatch(/^Monolith \d{4}-\d\d-\d\d\.zip$/)
  await expect(page.locator('.toast')).toContainText('Exported 2 docs')
  await page.locator('.set-nav button', { hasText: 'General' }).click()
  await page.locator('.modal label.toggle', { hasText: 'Remind me' }).click()
  await expect(page.locator('.modal')).toContainText(/reminders appear inside Monolith only|Ten minutes before an event/)
  await page.keyboard.press('Escape')
  // An event a few minutes away is announced (skipped in the minutes before midnight, when "today" would be wrong).
  const soon = new Date(Date.now() + 6 * 60_000)
  if (soon.getDate() === new Date().getDate()) {
    await page.locator('.sidebar .nav', { hasText: 'Calendar' }).click()
    const bar = page.locator('input[placeholder*="Add an event"]').first()
    await bar.fill(`standup today ${soon.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '')}`)
    await bar.press('Enter')
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)))
    await expect(page.locator('.toast', { hasText: /Standup · In \d+ min/ })).toBeVisible({ timeout: 40_000 })
  }
})

test('a doc named in plain words is offered under Mentioned in, and one press links it', async ({ page }) => {
  await start(page)
  await newDoc(page, 'Thesis')
  await page.keyboard.type('I should follow my study system more closely.')
  await page.locator('.sidebar .tree-title', { hasText: 'Study system' }).click()
  const pair = page.locator('.cx-pair', { hasText: 'Thesis' })
  await expect(pair.locator('q')).toHaveText('I should follow my study system more closely.')
  await pair.locator('.btn').click()
  await expect(page.locator('.cx-pair')).toHaveCount(0)
  await page.locator('.cx-row', { hasText: 'Thesis' }).click()
  await expect(page.locator('.ProseMirror a[href="#doc/doc-guide"]')).toHaveText('study system')
})

test('a workspace of 2,000 docs opens, lists and searches without stalling', async ({ page }) => {
  await start(page)
  await page.waitForTimeout(1200) // let the first save land
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok) => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => ok(r.result) })
    const saved = JSON.parse(await new Promise<string>((ok) => { const r = db.transaction('keyval').objectStore('keyval').get('socratic-v1'); r.onsuccess = () => ok(r.result) }))
    const now = Date.now()
    for (let i = 0; i < 2000; i++) {
      saved.state.items.push({ id: `seed${i}`, kind: 'doc', title: `Seed ${i}`, content: `<p>${'lecture notes on linear algebra and biology '.repeat(20)}${i === 1234 ? 'zebrafish' : ''}</p>`, folderId: null, parentId: null, pinned: false, tags: [], createdAt: now - i * 60000, updatedAt: now - i * 60000 })
    }
    await new Promise<void>((ok) => { const t = db.transaction('keyval', 'readwrite'); t.objectStore('keyval').put(JSON.stringify(saved), 'socratic-v1'); t.oncomplete = () => ok() })
  })
  await page.reload()
  await page.locator('.sidebar .nav', { hasText: 'Docs' }).first().click()
  // The sidebar draws the first hundred and offers the rest.
  await expect(page.locator('.more-rows')).toContainText('Show 100 more of 2002')
  expect(await page.locator('.sidebar .tree-title').count()).toBeLessThan(110)
  await page.locator('.more-rows').click()
  expect(await page.locator('.sidebar .tree-title').count()).toBeGreaterThan(190)
  // A word that's in one doc out of two thousand is found as it's typed.
  await page.locator('.sidebar .nav', { hasText: 'Home' }).click()
  await page.keyboard.press('Control+k')
  await expect(page.locator('[cmdk-input]')).toBeFocused()
  const t = Date.now()
  await page.keyboard.type('zebrafish')
  await expect(page.locator('[cmdk-item]', { hasText: 'Seed 1234' })).toBeVisible()
  expect(Date.now() - t).toBeLessThan(3000)
  // And what was typed in a doc is still saved with this much around it.
  await page.locator('[cmdk-item]', { hasText: 'Seed 1234' }).click()
  await expect(page.locator('.doc-title')).toHaveValue('Seed 1234')
  await page.locator('.ProseMirror').click()
  await page.keyboard.type(' quokka')
  await page.waitForTimeout(1200)
  await page.reload()
  await expect(page.locator('.ProseMirror')).toContainText('quokka')
})
