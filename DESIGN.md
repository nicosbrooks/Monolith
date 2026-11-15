# Monolith design foundations

The rules every screen is built from, on web (`src/`) and iOS (`apple/iOS/`). Started Nov 15 2026 with the Home rework; add to it whenever a new pattern is settled. If a screen disagrees with this file, the screen is wrong, or this file needs a deliberate update.

Status of each area is in [Coverage](#coverage) at the end: not every screen follows all of this yet.

## Principles

1. **Calm and monochrome.** Black, white and warm greys. No brand colour, gradients or glows.
2. **Colour only where it means something.** Red while recording, blue for calendar time, green/red for status, and an event's own colour as a dot.
3. **AI first, in one place.** On Home the assistant speaks from a single card at the top. It says what it found, when, and exactly where (doc title plus the quoted line), then offers two labelled choices.
4. **One control per action per screen.** Secondary actions go in a ··· or right-click menu. Before adding a button, check the action isn't already on that screen.
5. **Nothing shown twice.** If the assistant is asking about a task, that task is not also listed under Tasks.
6. **Every action can be taken back.** Deletes, checks, adds and dismissals show a notification with Undo. Only "delete forever" asks first, with a consequence line ("This can't be undone.").
7. **No dividing lines.** Space, soft fills and a hover or press wash separate things.
8. **About five, then the rest elsewhere.** Lists on Home show 5 items, then "Show all" / "See all".
9. **No visible plumbing.** Raw Markdown never appears. Counts and search appear only when there is something to count or search.
10. **No "AI" decoration.** No sparkles (✨) anywhere. The assistant is labelled with words, and actions get an icon for what they do: a speech bubble to ask, a pen to write notes, a lightbulb for insights.
11. **Same product on every device.** iOS uses the web's icons, menu order and wording, done the native way.

## Colour

Web tokens are CSS variables; the current values are set in `src/soft.css` (it loads last). iOS equivalents are in `apple/iOS/Theme.swift`.

| Role | Web token | Dark | Light | iOS |
|---|---|---|---|---|
| Page | `--bg` | `#0f0f0e` | `#f4f3f0` | `Theme.paper` (true black in dark) |
| Card on the page | `--card` | `#191918` | `#ffffff` | `Theme.card` |
| Row hover / soft fill | `--card-hover` | white 6% | black 4.5% | `Theme.wash` (press) |
| Popup surface | `--raised` | `#252523` | `#ffffff` | `Theme.raised` |
| Popup edge | `--raised-edge` | white 11% | black 10% | `Theme.rule` |
| Fill inside a popup | `--raised-fill` / `--raised-fill-2` | white 7% / 12% | black 5% / 9% | |
| Button | `--btn` / `--btn-hover` | `#2a2a28` / `#353533` | `#e6e5e0` / `#dad9d3` | |
| Text | `--text` | `#eeedea` | `#1d1d1b` | `.primary` |
| Secondary text | `--text-2` | `#b9b8b3` | `#5f5e59` | `.secondary` |
| Faint text (times, sources) | `--text-3` | `#94938e` | `#8a8983` | |
| Status | `--ok` `--info` `--danger` | `#7fd69e` `#86b3ff` `#ff7a70` | `#2f9e62` `#2f6fdb` `#d4483f` | `Theme.local`, `Theme.time` |

- Primary buttons are the text colour with the page colour as the label (white on dark, near-black on light).
- Anything that pops up (menu, dialog, palette, notification) uses the solid `--raised` surface with an edge and a real shadow. No see-through glass on popups.

## Type

One typeface: the system sans (`--font`), with JetBrains Mono only for code.

| Use | Size / weight |
|---|---|
| Page title (Home greeting) | 30px / 650, tracking -0.028em (26px on phones) |
| Card headline (assistant) | 19px / 600 |
| Empty-state title | 17px / 600 |
| Row and body text | 15px |
| Supporting text | 14–15px, `--text-2` |
| Section label | 13.5px / 550, `--text-2`, sentence case |
| Meta (times, source doc) | 13px, `--text-3`, tabular numbers |

No uppercase labels and no mono labels.

## Shape and space

| Thing | Value |
|---|---|
| Card radius | 22px (assistant card 24px) |
| Row radius inside a card | 16px |
| Chip / source block radius | 14px |
| Buttons, inputs like the Ask bar, notifications | full pill |
| Popups (menu, dialog, palette) | 18px |
| Row height | 48px minimum (44px for "Show all") |
| Card inner padding | 6px around rows; 20–22px for the assistant card |
| Gap between sections | 30px |
| Content column | 728px max, centred, 24px side padding (14px on phones) |
| Bottom clearance for the Ask bar | 132px (110px on phones) |

Cards have no border. In light mode they carry a 1px-soft shadow; in dark the fill alone lifts them.

### iOS spacing (`Space` in `apple/iOS/Theme.swift`)
iPhone screens felt cramped at web sizes, so iOS runs a little roomier. Use the tokens, not new numbers.

| Token | Value | Use |
|---|---|---|
| `Space.page` | 20pt | side padding of a screen |
| `Space.section` | 32pt | gap between sections |
| `Space.card` | 18pt | inner padding of a card |
| `Space.row` | 54pt | minimum row height in cards and lists |

The drawer is min(310pt, 80% of the width), with 50pt rows, a 24pt icon column so every label starts at the same x, and 30pt above each heading.

### Fills inside a card
`Theme.wash` (iOS) and `--card-hover` (web) are for the page. Anything filled *inside* a card (an icon tile, a status row, a secondary pill) uses `Theme.tile`: white 7% in dark, black 4.5% in light. A wash on a card is too close to read.

## Components

### Card and rows (`.hm-card`, `.hm-list`, `.hm-row`)
A card holds a short list. Each row is one target: a 20px icon column, the title (one line, ellipsis), then meta on the right. Hover shows `--card-hover`; press goes one step stronger. Focus is a 2px inset outline in `--text-2`.

### Section label (`.hm-label`)
A quiet label above a card, with at most one text link on the right ("Open calendar", "See all").

### Assistant card (`.hm-asst`)
The card shows one of two things: a suggestion found in your docs (below), or **starting points**.

**Starting points** (`.hm-starters` / iOS `starters`). Up to three rows that each open the assistant with that question already asked, so the person can take the conversation anywhere. They are built from what is really there: the next event ("Help me get ready for “calc review”"), the open tasks ("Which of my 2 tasks should I do first?"), and the last doc worked on ("Summarize “…”"). Each row has an icon, the question, and a small ↗. They are shown only when a model is ready.

The card's title changes so a daily app never repeats itself (`startersTitle` in `src/lib/greeting.ts`, iOS `Greeting.startersTitle`): "Start from here" only on the first day after setup, then "Coming up" when an event starts within 90 minutes, "Pick up where you left off" when the only starting point is a doc, otherwise "For this morning" / "For this afternoon" / "For tonight".

The assistant never hands over a fixed plan or brief on Home. That was "Plan my day", removed Nov 15 because it was too rigid. Anything like it is just a question someone can ask.

A suggestion card, top to bottom:
1. A one-word role in words only: "Suggestion". No icon.
2. The question or headline, as a sentence.
3. One supporting line (the full date and time).
4. The source (`.hm-source`): doc title in bold, the quoted line under it. Clicking opens the doc. Never a vague "from a doc".
5. Two pill buttons: the primary action, then "Not now".

Data: `Suggestion.found` in `src/types.ts` (`what`, `when`, `itemId`, `docTitle`, `line`, `add()`); `add()` returns the new event's id so Undo can remove it.

### Checkbox
A 20px rounded square (6px radius) with a 1.6px outline, on web and iOS. Checking a task on Home completes it and offers Undo; clicking the words opens the doc instead.

### Home section names
Home's sections are **Calendar**, **Tasks** and **Recent**, named for what they hold (not "Today", "Up next" or "Schedule"). The Calendar label's link says "Open".

### Event row (`.hm-ev`, iOS `eventRow`)
- The event's colour as a 4px rounded bar down the left side, as tall as the row's text and centred in the icon column (web `.hm-bar`). Not a dot. The week strip keeps its small dots, which count events per day.
- The title, with the place under it (a small pin, then the location).
- Start over end on the right, with the start a step brighter. All-day events say "All day".
- On iOS, an event on another day puts the weekday at the front of the second line ("Thu · Room 204") so the times stay short.
- No location means no second line. Never print an empty placeholder.

### Week row (`.hm-week`)
Seven equal day buttons: weekday, date, up to three event-colour dots. The selected day gets a filled pill and lists its events below. Selecting it again opens that day in Calendar.

### Buttons
- `.btn.primary`: one per card or dialog, for the action we expect.
- `.btn`: the alternative, on the `--btn` fill.
- In cards and empty states they are 38px tall with 18px side padding. Labels are verbs: "Add to calendar", "Start recording".
- `.icon-btn`: round, for toolbar actions. Always has a `title` and `aria-label`.

### Notifications (`.toaster`, `.toast` in `src/index.css`; `Toaster` / `ToastView` in `apple/iOS/Feedback.swift`)
- A small pill in the **upper right**, on the raised surface with an edge and shadow. Never a white bar, never at the bottom (the Ask bar owns the bottom).
- Web: 56px from the top so it sits under the page's own top-right buttons; moves left of the assistant panel when that is open. Phone width: top centre.
- iOS: 54pt below the top safe area, trailing edge, so the title bar and its buttons stay clear.
- Text is a short past-tense statement: "Added to calendar", "Task done", "Doc moved to Recently Deleted".
- At most one action, as a small pill inside: usually Undo.
- 4 seconds by default; 6 seconds when it carries Undo.

### Empty state (`.blank`)
One per screen: a 52px round icon, a title that names the state ("No recordings yet"), one sentence on what the place is for, and at most one primary button. When the empty state has the button, the same action is hidden from the header.

### Ask bar (`.home-dock`, `.ask-field`)
One 48px pill at the bottom of every page; its placeholder says what it will do here ("Ask about “Title”", "Add an event or ask about your schedule"). The page fades into the background beneath it (`.home-dock::before`) so rows never collide with it. Calendar has no fade because its grid runs to the edge.

### Sidebar
Its own rounded surface (18px). Rows are icon + label, 38px tall (34px for sub-rows), with a soft fill for the current page. Add buttons appear on hover or while you are in that section.

### Switches
On iOS a switch is tinted the status green (`Theme.local`). The app tint is the text colour, which makes an "on" switch white with a white knob. On/off is a status, so green is allowed (Principle 2).
On web (`.toggle`) it's the same: a 40×24 track on `--raised-fill-2` (visible on any card or modal), green `--ok` when on, a white knob with a small shadow. Never the accent colour: in the dark theme that's near-white, which hid the knob.

### Integration card (iOS `IntegrationsView`)
One card per device service (Location, Weather, Maps, Location history), in this order:
1. A 40pt icon tile on `Theme.tile`, the name, and one line saying what it gives the assistant. A switch on the right.
2. When on: one status row on `Theme.tile` saying what it knows now ("Near San Francisco, CA", "Calc review: 12 min walk, leave by 3:43 PM") or why not ("Add a place to an event to see travel time").
3. At most a row of pills for its own actions (history: See places, Clear history).

Rules:
- Everything is off until the person turns it on. Turning on something that needs a permission asks for it at that moment, never at launch.
- While a system permission prompt is open, the screen shows "Waiting for permission" and no warnings.
- A problem with one service is shown in that service's card, with its fix (Open Settings). Only a full "no" to location gets a notice at the top of the page.
- The page ends with plain privacy lines: what stays on the device, and what asks Apple's services.

### Integrations on web (Settings › Integrations, `src/lib/integrations.ts`)
Location and Weather, as switches with one line each saying what they give the assistant. Turning Weather on turns Location on too; turning Location off turns Weather off. One quiet status line underneath says what it knows ("Near London, England · 7°C and cloudy") or why not (location blocked, with how to allow it). The position is rounded to about a kilometre before it goes to Open-Meteo (forecast) and BigDataCloud (town name); neither needs an account. Off until turned on.

### Quick add (`parseQuickEvent` in `src/lib/dates.ts`; iOS `QuickAdd.swift`)
- The title is what's left once the date, time, length and place are read: "math 19a homework due tomorrow 9pm" → **Math 19a homework**. Words that only tie the date to the sentence ("due", "on", "at", "by", "from") never stay in the title.
- "due" or "by <date>" makes it a **deadline**: rose, 30 minutes from the due time (or all day without a time), and the preview says "Due Mon, Nov 16 · 9:00 PM".
- A place goes into the event's location, not the title: "@ Room 204", "at Chipotle" (capital letter), "at the library", "in Room 101".
- Bare numbers aren't times unless something says so ("at 3", "3pm", "3:30", "from 3 to 5", "tonight 7-9"), so course codes and room numbers stay put. Without am/pm, 1–6 is afternoon, 7–11 morning, and evening plans ("dinner at 7:30") are PM.
- Weeks run Sunday to Saturday: "Friday" is the next one coming, "Friday next week" is the one after.
- Every preview and toast uses the same label (`whenLabel`). New phrasings go in `scripts/test-dates.ts` (`npm run test:dates`), and the iOS port is checked against the same cases.

### Assistant chat (`Chat` in `AIPanel.tsx`)
- **Exact answers are instant.** "What's on tomorrow", "what's next", "what's left to do" are answered from the calendar and docs on the spot (`src/ai/instant.ts`), even before the model has loaded, and never with a wrong date. Anything that needs judgement ("am I free", "what should I focus on") goes to the model.
- **While waiting, say what's happening**, in grey beside the dots: "Getting the assistant ready…", "Reading “Biology notes”…", "Thinking…". Never a bare spinner.
- **Sources under the answer**: "From" and up to three pills, each a doc the answer read (click to open it), or "Your calendar" / "Your open tasks". Nothing is listed that wasn't actually given to the model.
- **Actions are cards, with no sentence above them** (the card already says it; a sentence was the same thing twice). One card per change: an icon for what it does, the title, a second line with exactly what will happen ("Sun 2:00 PM → Tue, Nov 17 · 3:00 PM – 4:00 PM", "Add to “Week plan”", "Check off in …"), and one button (Add, Move, Remove, Check off, Create). Remove is the only non-primary button. After the tap the button becomes a green "Added"/"Moved"/…, and the toast says what happened, with **Undo**.
- Under the last answer: Listen, Insert (when a doc is open), Retry. No copy of these anywhere else.
- The composer is always usable; sending before the model is ready starts it and answers when it can.

### First-time setup (`.su-*`, `src/components/Setup.tsx`; iOS `SetupView` in `Setup.swift`)
Two short steps on one calm card (web) or full screen (iOS), with a step indicator of two short bars and a back button on step 2.
1. **Name.** "Welcome to Monolith", one line about the app, "What should we call you?", and "Used in greetings. Leave it blank if you'd rather not." Continue works with it empty.
2. **Where your work lives.**
   - Web: radio cards, "A folder on this computer" (marked Recommended) or "This browser". Where the browser can't save to folders, the folder card is greyed out and says why ("Needs Chrome, Edge or Arc"). Then a "Lock with a passcode" switch; turning it on shows two fields and one plain warning that a forgotten passcode can't be recovered.
   - iOS: "On this iPhone" (iOS already encrypts it) and a "Lock with Face ID" switch (or Touch ID / Passcode, named for the device). Turning the lock on asks once, so a lock that can't be opened is never saved; if that fails, one line says the lock is still off.
- The primary button says what happens: "Choose folder…", "Start using Monolith", or "Save" when run again.
- Existing installs never see setup. Web: Settings › Storage › the lock row reopens step 2. iOS: Settings › You holds the name and the lock.

### Backup file (`BackupDialog`, `src/lib/backup.ts`)
- Settings › Storage › "Backup file" row: "Last backed up 2 days ago" (or what it is, if never), with **Back up** and **Restore** buttons. Setup step 2 has a quiet "Restore from a backup" link beside the main button, for someone arriving on a new computer.
- Back up: a title, one line on what's inside, a password typed twice (8+ characters), and one plain warning that without it the file can't be opened. The button says "Download backup", then "Encrypting…".
- Restore: a file card that shows the file's name, when it was made, and what's in it ("12 docs · 3 recordings · 8 events") before any password is asked; then the password, and one line saying it replaces what's here and that connected folders stay connected.
- A wrong password clears the field and says "That password doesn't open this backup."

### Lock screen (`Unlock` on web, `LockScreen` on iOS)
A lock icon in a soft circle, "Monolith is locked", one line, a password field (web) and one full-width Unlock button. A wrong passcode clears the field and says "That passcode isn't right." On iOS it asks for Face ID as soon as the app is in front, and covers the app in the app switcher.

### Menus and dialogs
- Menu order for a doc: Add sub-doc, favourite, Move to, then Delete in red after a gap. iOS copies this order.
- Confirm dialogs: a question as the title, one consequence line, a verb on the confirm button, and the main button disabled until the form is valid.

## Motion

- Hover and press fills: 120–150ms.
- Things entering (notifications, panels): a short spring, about 350ms, little or no bounce. Notifications drop in from above and leave to the right.
- Respect `prefers-reduced-motion`.

## Writing

- Sentence case everywhere.
- Suggestions are a gentle question: "Add “Problem set due” to your calendar?"
- Say what happened, not what the system did: "Task done", not "Item updated".
- Relative times: "Just now" under a minute, then "5 minutes ago", "1 day ago".
- Greetings use the person's first name when they gave one, and vary so they never feel canned: a few phrases per part of the day (night before 5, morning, afternoon, evening), plus "Happy Friday" / "Happy Saturday" mixed in, and "Welcome back" after two days away. The choice is fixed for a day and part of day, so it doesn't flicker. Web `src/lib/greeting.ts` and iOS `Greeting` share the same phrases.

## Where the styles live (web)

Three files load in order: `src/index.css` (base), `src/theme.css`, `src/soft.css` (current look). A later file overrides an earlier one, so:
- Edit a rule where it is defined; do not add another override layer.
- New patterns go in `src/soft.css` under a commented section, with their own class prefix (Home uses `hm-`).
- When a pattern is replaced, delete the old rules in all three files in the same change.

### Files in docs
- A picture shows inline at its natural size (at most the text column), with a soft corner; selected, it gets a faint outline.
- Any other file is a card on the soft fill: a file icon tile, the name (one line), "PDF · 2.3 MB" in faint tabular text, then **Open** and **Download**. A file that isn't on this device says so in place of its size.
- On iOS an attachment shows its name and "Open it on your computer".

### Lists in the sidebar
- Docs and Recordings both list their items in the sidebar while you're in that section; there's no second list column (only Recently Deleted keeps one). Each section row has its own + (New doc / Start recording).
- Titles get two lines before they're cut, with the full title as the tooltip. Hover buttons take no room until they show.

## Coverage

| Area | Follows this file? |
|---|---|
| Web Home | Yes (Nov 15) |
| Web notifications | Yes (Nov 15) |
| Web empty states: Recordings, Recently Deleted, no doc open | Yes (Nov 15) |
| Web assistant chat, Settings switches and Integrations | Reviewed Nov 15 (pass 5) |
| Web Docs, doc editor, Recordings detail, Calendar, rest of Settings, assistant For you tab, command palette | Not yet reviewed against this file |
| iOS Home, drawer, Docs and Recordings lists | Yes (Nov 15, pass 2): `Space` tokens, drawer icon column. Checked in the iPhone 17 simulator, dark only |
| iOS Integrations | Yes (Nov 15): seen in the iPhone 17 simulator with every switch on. iPad and light mode not checked |
| iOS chat, menus, doc editor | Follows the principles from the Nov 14 passes; not re-checked against the iOS spacing tokens |
| Web Integrations | Not built (web would need browser location and a weather source) |
| iOS notifications | Yes (Nov 15): top-right pill under the title bar, seen in the iPhone 17 simulator. iPad not checked |
| iPad, Watch | Not reviewed |
