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
10. **Same product on every device.** iOS uses the web's icons, menu order and wording, done the native way.

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

## Components

### Card and rows (`.hm-card`, `.hm-list`, `.hm-row`)
A card holds a short list. Each row is one target: a 20px icon column, the title (one line, ellipsis), then meta on the right. Hover shows `--card-hover`; press goes one step stronger. Focus is a 2px inset outline in `--text-2`.

### Section label (`.hm-label`)
A quiet label above a card, with at most one text link on the right ("Open calendar", "See all").

### Assistant card (`.hm-asst`)
Order, top to bottom:
1. Sparkles icon and a one-word role: "Suggestion", "Today's plan" or "Assistant".
2. The question or headline, as a sentence.
3. One supporting line (the full date and time).
4. The source (`.hm-source`): doc title in bold, the quoted line under it. Clicking opens the doc. Never a vague "from a doc".
5. Two pill buttons: the primary action, then "Not now".

Data: `Suggestion.found` in `src/types.ts` (`what`, `when`, `itemId`, `docTitle`, `line`, `add()`); `add()` returns the new event's id so Undo can remove it.

### Checkbox
A 20px rounded square (6px radius) with a 1.6px outline, on web and iOS. Checking a task on Home completes it and offers Undo; clicking the words opens the doc instead.

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
- Greeting by hour: morning before 12, afternoon before 18, otherwise evening (including after midnight).

## Where the styles live (web)

Three files load in order: `src/index.css` (base), `src/theme.css`, `src/soft.css` (current look). A later file overrides an earlier one, so:
- Edit a rule where it is defined; do not add another override layer.
- New patterns go in `src/soft.css` under a commented section, with their own class prefix (Home uses `hm-`).
- When a pattern is replaced, delete the old rules in all three files in the same change.

## Coverage

| Area | Follows this file? |
|---|---|
| Web Home | Yes (Nov 15) |
| Web notifications | Yes (Nov 15) |
| Web empty states: Recordings, Recently Deleted, no doc open | Yes (Nov 15) |
| Web Docs, doc editor, Recordings detail, Calendar, Settings, assistant panel, command palette | Not yet reviewed against this file |
| iOS Home, drawer, chat, menus | Follows the principles from the Nov 14 passes; sizes differ slightly (cards 22–26pt, rows 50pt) |
| iOS notifications | Yes (Nov 15): top-right pill under the title bar, seen in the iPhone 17 simulator. iPad not checked |
| iPad, Watch | Not reviewed |
