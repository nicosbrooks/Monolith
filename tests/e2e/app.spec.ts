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
  await page.click('.side-group-add[aria-label="Start recording"]')
  await expect(page.locator('button[title="Stop"]')).toBeVisible()
  await page.waitForTimeout(1500)
  await page.click('button[title="Stop"]')
  await expect(page.locator('.side-tree .nav.sub.on')).toHaveCount(1)
})

test('Recently Deleted holds deleted docs and completed checklist lines, and restores each', async ({ page }) => {
  await start(page)
  // A deleted doc waits there, and Restore puts it back in the sidebar.
  await page.locator('.sidebar .tree-title', { hasText: 'Study system' }).click({ button: 'right' })
  await page.getByText('Delete', { exact: true }).click()
  await expect(page.locator('.toast')).toContainText('Recently Deleted')
  await expect(page.locator('.sidebar .tree-title', { hasText: 'Study system' })).toHaveCount(0)
  // A checklist line checked off on Home is listed under Completed.
  const task = page.locator('.hm-task').first()
  const words = (await task.locator('.hm-row-main span').textContent())!.trim()
  await task.locator('input').click()
  await expect(page.locator('.toast', { hasText: 'Task done' })).toBeVisible()
  await page.locator('.sidebar .nav', { hasText: 'Recently Deleted' }).click()
  await expect(page.locator('.hm-head h1')).toHaveText('Recently Deleted')
  const doc = page.locator('.tr-row', { hasText: 'Study system' })
  await expect(doc).toContainText('deleted')
  const done = page.locator('.tr-row', { hasText: words })
  await expect(done).toContainText('checked')
  // Restore each: the doc is back, and the line is an open task again.
  await doc.getByRole('button', { name: 'Restore' }).click()
  await expect(page.locator('.sidebar .tree-title', { hasText: 'Study system' })).toHaveCount(1)
  await expect(page.locator('.tr-row', { hasText: 'Study system' })).toHaveCount(0)
  await done.getByRole('button', { name: 'Restore' }).click()
  await expect(page.locator('.tr-row', { hasText: words })).toHaveCount(0)
  await page.locator('.sidebar .nav', { hasText: 'Tasks' }).click()
  await expect(page.locator('.hm-task', { hasText: words })).toHaveCount(1)
})

test('Ask bar: "make an event for tomorrow" asks for the name instead of using the prompt as the title', async ({ page }) => {
  await start(page)
  const bar = page.locator('.ask-field input')
  await bar.fill('make an event for tomorrow')
  // What Enter will do is shown first: an event tomorrow, named next.
  await expect(page.locator('.ask-opt.on')).toContainText('New event')
  await bar.press('Enter')
  await expect(page.locator('.convo .cv-a').last()).toContainText('What should I call it?')
  await bar.fill('Dentist')
  await bar.press('Enter')
  await expect(page.locator('.toast')).toContainText('Added “Dentist”')
  // A request that names it is added at once, with the name alone.
  await bar.fill('can you schedule a meeting with Sam on friday at 3')
  await bar.press('Enter')
  await expect(page.locator('.toast', { hasText: 'Meeting with Sam' })).toBeVisible()
  await page.locator('.sidebar .nav', { hasText: 'Calendar' }).click()
  await expect(page.locator('.calendar').getByText('Dentist').first()).toBeVisible()
  await expect(page.locator('.calendar').getByText(/make an event/i)).toHaveCount(0)
})

test('Ask bar: questions open a conversation above the bar; there is no chat panel', async ({ page }) => {
  await start(page)
  await expect(page.locator('.ai-panel, .ai-wrap')).toHaveCount(0)
  const bar = page.locator('.ask-field input')
  await bar.fill('what’s on tomorrow?')
  await expect(page.locator('.ask-opt.on')).toContainText('Ask')
  await bar.press('Enter')
  const convo = page.locator('.convo')
  await expect(convo.locator('.cv-q')).toHaveText('what’s on tomorrow?')
  await expect(convo.locator('.cv-a .md')).toContainText('Study group')
  await expect(convo.locator('.msg-sources')).toContainText('Your calendar')
  // Escape hides it; the bar offers to go back; ⌘J brings it back too.
  await bar.press('Escape')
  await expect(convo).toHaveCount(0)
  await bar.focus()
  await expect(page.locator('.ask-opt', { hasText: 'Back to the conversation' })).toBeVisible()
  await bar.press('Escape')
  await page.locator('.hm-head h1').click()
  await page.keyboard.press('Control+j')
  await expect(page.locator('.convo .cv-q')).toHaveCount(1)
  await expect(bar).toBeFocused()
  // A follow-up continues the same conversation; New conversation clears it.
  await bar.fill('what’s on today?')
  await bar.press('Enter')
  await expect(page.locator('.convo .cv-q')).toHaveCount(2)
  await page.getByRole('button', { name: 'New conversation' }).click()
  await expect(page.locator('.convo .cv-q')).toHaveCount(0)
})

test('Ask bar: arrow keys pick another reading, like adding a task instead', async ({ page }) => {
  await start(page)
  await page.locator('.sidebar .nav', { hasText: 'Tasks' }).click()
  const bar = page.locator('.ask-field input')
  await bar.fill('add a task to email the professor')
  await expect(page.locator('.ask-opt.on')).toContainText('Add task “Email the professor”')
  await bar.press('Enter')
  await expect(page.locator('.toast')).toContainText('Added “Email the professor”')
  await expect(page.locator('.hm-task', { hasText: 'Email the professor' })).toHaveCount(1)
  await page.locator('.sidebar .nav', { hasText: 'Home' }).click()
  await bar.fill('new doc about the trip')
  await expect(page.locator('.ask-opt.on')).toContainText('New doc “The trip”')
  await bar.press('ArrowDown')
  await expect(page.locator('.ask-opt.on')).toContainText('Ask')
  await bar.press('ArrowUp')
  await bar.press('Enter')
  await expect(page.locator('.doc-title')).toHaveValue('The trip')
})

test('quick access: finds docs, tasks and events, adds what is asked, and filters with Tab', async ({ page }) => {
  await start(page)
  await page.keyboard.press('Control+k')
  const input = page.locator('[cmdk-input]')
  await expect(input).toBeFocused()
  // With nothing typed: recent docs, open tasks, what's coming up, and ways to create.
  for (const g of ['Recent', 'Open tasks', 'Coming up', 'Create']) await expect(page.locator('[cmdk-group-heading]', { hasText: g })).toBeVisible()
  // A request is offered as one step, named as the thing itself.
  await page.keyboard.type('dentist friday 3pm')
  await expect(page.locator('[cmdk-item][data-selected="true"]')).toContainText('Add “Dentist”')
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast')).toContainText('Added “Dentist”')
  // Tab narrows the list; ">" means commands.
  await page.keyboard.press('Control+k')
  await page.keyboard.type('study')
  await page.keyboard.press('Tab')
  await expect(page.locator('.qa-scopes button.on')).toHaveText('Docs')
  await expect(page.locator('[cmdk-item]').first()).toContainText('Study system')
  await input.fill('>calendar')
  await expect(page.locator('.qa-scopes button.on')).toHaveText('Commands')
  await page.keyboard.press('Enter')
  await expect(page.locator('[cmdk-root]')).toHaveCount(0)
  await expect(page.locator('.main')).toHaveClass(/sec-calendar/)
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
  await expect(page.locator('.ask-opt.on')).toContainText('Add task “Renew library books”')
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast')).toContainText('Added “Renew library books” · due')
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
  await page.locator('.sidebar .tree-title', { hasText: 'Study system' }).click()
  await expect(page.locator('.ProseMirror')).toContainText('Weekly loop')
  await page.locator('.ProseMirror p').first().click()
  await page.keyboard.press('ControlOrMeta+a')
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
