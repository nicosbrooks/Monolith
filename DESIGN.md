# Monolith design foundations

The rules every screen is built from, on web (`src/`) and iOS (`apple/iOS/`). Started Nov 15 2026 with the Home rework; add to it whenever a new pattern is settled. If a screen disagrees with this file, the screen is wrong, or this file needs a deliberate update.

Status of each area is in [Coverage](#coverage) at the end: not every screen follows all of this yet.

## Principles

1. **Calm and nearly monochrome.** Black, white and warm greys. No brand colour and no glows. Gradients are light, not colour: a small lightness shift that makes a surface look lit from above, and a faint cool and warm wash of ambient light behind the page (see [Surfaces](#surfaces)).
2. **Colour only where it means something.** Red while recording, blue for calendar time, green/red for status, and an event's own colour as a dot.
3. **AI first, in one place.** On Home the assistant speaks from a single card at the top. It says what it found, when, and exactly where (doc title plus the quoted line), then offers two labelled choices.
4. **One control per action per screen.** Secondary actions go in a ··· or right-click menu. Before adding a button, check the action isn't already on that screen.
5. **Nothing shown twice.** If the assistant is asking about a task, that task is not also listed under Tasks.
6. **Every action can be taken back.** Deletes, checks, adds and dismissals show a notification with Undo. Only "delete forever" asks first, with a consequence line ("This can't be undone.").
7. **No dividing lines.** Space, soft fills and a hover or press wash separate things. A surface's lit top edge is a highlight, not a line.
8. **About five, then the rest elsewhere, on phones.** Lists on a phone's Home show 5 items, then "See all". On a computer each Home panel scrolls inside itself instead.
9. **No visible plumbing.** Raw Markdown never appears. Counts and search appear only when there is something to count or search.
10. **No "AI" decoration.** No sparkles (✨) anywhere. The assistant is labelled with words, and actions get an icon for what they do: a speech bubble to ask, a pen to write notes, a lightbulb for insights.
11. **Same product on every device.** iOS uses the web's icons, menu order and wording, done the native way.

12. **One connected workspace.** Docs, tasks, recordings and the calendar are views of the same things, tied together by links. A task is its own record (it can name a doc it goes with); a checklist in a doc is part of that doc and stays there. A link is an ordinary link. Nothing is copied into a second place.

## Identity

Monolith is monochrome and uses the system typeface, so what makes it recognisable is the **slab** and how the app speaks.

- **The mark** is an upright slab, 4 wide to 9 tall, with softly rounded corners (`Logo` in `Sidebar.tsx`, `public/favicon.svg`). Always the text colour on the page colour. Never tinted, tilted, outlined or animated into another shape.
- **The slab marks where you are.** The current section in Settings carries a 3×14px slab at its left edge on top of the soft fill.
- **The slab is the waiting sign.** While the assistant works, one small slab breathes beside the words that say what it's doing (`.slab-wait`). No dots, no spinners for the assistant.
- **Titles go through one token**, `--font-display` (page titles, doc titles, headings in docs, setup). It is set to the system sans. Changing the app's display face is one line in `src/soft.css`; don't hard-code a family on a title.
- Names for places are plain nouns in this order everywhere: **Home, Tasks, Docs, Recordings, Calendar**.

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

- Primary buttons are the text colour with the page colour as the label (white on dark, near-black on light), as a flat fill (`--btn-primary-grad` is a solid colour).
- Anything that pops up (menu, dialog, palette, Ask bar options, conversation, notification) uses the frosted `--glass` layer: about 90% opaque in both themes, blurred, with a hairline edge and one soft shadow, over a dark scrim. It is always the most opaque layer on screen, so text on it keeps full contrast. With glass off (the `glass` setting, or the OS asks for reduced transparency) it falls back to the solid `--raised` surface.
- Glass tokens (`--glass`, `--glass-sheen`, `--glass-filter`, `--ambient-a/b`) live in `src/theme.css`; panel and button tokens (`--panel`, `--panel-edge`, `--btn-grad`, `--btn-edge`) live in `src/soft.css`.

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

Cards have no border. A card is a flat fill with a hairline edge (`--panel`, `--panel-edge`): no gradient, no shadow, no lift on hover. Toolbar actions in a page header (listen, favourite, ···) are 34px round chips on `--btn-grad`.

### iOS spacing (`Space` in `apple/iOS/Theme.swift`)
iPhone screens felt cramped at web sizes, so iOS runs a little roomier. Use the tokens, not new numbers.

| Token | Value | Use |
|---|---|---|
| `Space.page` | 20pt | side padding of a screen |
| `Space.section` | 32pt | gap between sections |
| `Space.card` | 18pt | inner padding of a card |
| `Space.row` | 48pt | minimum row height in cards and lists |

The drawer is min(310pt, 80% of the width), with 44pt rows (40pt for Recents), a 24pt icon column so every label starts at the same x, and 24pt above each heading.

### iPhone: calm, not boxed (Nov 16)
The iPhone read as clunky when every group sat in its own card. The rules now:
- **One card per screen at most.** On Home that's the assistant card. Calendar, Tasks and Recent are plain rows under a small grey label. Never a box inside a box: inside the card, starting points are rows, and a suggestion's source is one quiet line (doc name, then the words it found).
- **No doubled header.** Home's title bar is empty; the greeting is the title, with the date in small grey text under it.
- **Empty is one quiet line** ("Nothing coming up", tertiary), not a box.
- **Two buttons at most in a title bar.** In a doc: ··· (there are no favorites, Nov 17). Listen lives in ···; while it reads aloud, a stop button appears up top.
- **Menus are one line per option.** The + menu reads Event, Record, Doc, with no descriptions.
- **No flashes.** The launch screen is black, like the app's default, and the assistant card appears only once Home has read the docs, so nothing jumps in.
- **Dates read as words.** "Nov 13", with the year only when it's another year.

### iPhone: touch, holds and feel (Nov 16)
- **Haptics through `Haptics` only** (`apple/iOS/Haptics.swift`), never a generator made on the spot. `tap` for a choice (a checkbox, a Markdown shortcut taking effect, a toolbar format), `thud` for something removed (trash, delete a line, unlink), `success` when something new works (linked a computer, finished a task from a hold menu), `warning` when a gesture can't do anything (indenting the first item). Never on scroll or on every keystroke.
- **Hold shows what you're holding.** Docs and recordings (Home, cards, Library) open a preview of their first lines above the menu (`.itemMenu`), as words, never Markdown. Tasks on Home show the doc they live in, with Mark complete and Copy.
- **Hold a line's marker** (bullet, number, checkbox, quote bar, divider, picture) for Move up, Move down, Duplicate and Delete line. The same moves sit in the keyboard's Aa menu.
- **Keyboard bar, one line:** Checklist, Bullets, Aa | Outdent, Indent, Hide keyboard. Outdent and Indent are greyed out off a list item rather than hidden, so the bar doesn't shift.
- **Removing asks or offers Undo, never neither.** Trashing a doc or event shows the Undo pill; swiping to unlink a computer asks first, because there's nothing to undo.

### iPhone from outside the app (`SystemActions.swift`)
Monolith should be one gesture away wherever you are on the phone, and never leak anything to get there.
- **Hold the app icon:** Ask (puts the cursor in the Ask bar), Record (starts at once), New Doc, then the doc you were last in, labelled "Continue".
- **Siri, Shortcuts, the Action button:** Ask Monolith (with the question), New Doc, Start Recording, Open Doc (by name), New Event. Each opens the app and does the one thing; no confirmation screens in between.
- **Spotlight** finds docs and recordings by title and first lines, and opens them directly. The index lives on this iPhone.
- **With the app lock on**, none of this shows content: Spotlight is cleared, Siri finds no docs, and the Continue action is dropped.
- All of these go through `Router.shared.action`, so there is one place that knows how to start a doc or a recording.

### Linking a device: the check code
After pairing, both screens show the same six digits (`checkCode`, "824 793"). The phone shows them large under "Linked to …", the browser in the success note; both keep them in the device's ··· menu. Copy: "Your computer shows the same code." Never call it a key, fingerprint or hash.

### Fills inside a card
`Theme.wash` (iOS) and `--card-hover` (web) are for the page. Anything filled *inside* a card (an icon tile, a status row, a secondary pill) uses `Theme.tile`: white 7% in dark, black 4.5% in light. A wash on a card is too close to read.

## Surfaces

Added Nov 16 for the frosted-glass rework. Everything on screen sits on one of three layers, from back to front:

1. **Ground.** The page colour with a faint ambient wash: a cool light at the top left and a warm one at the bottom right, no stronger than about 17% in dark and 22% in light (`.app` background in `src/theme.css`). Nothing on the ground has its own fill.
2. **Panels.** Cards and the Library. Flat fills with a hairline edge, no shadow. Only popups and the Library are frosted; cards, the rail and the Ask bar are flat, because depth belongs to what floats, not to what sits on the page.
3. **Popups.** Menus, dialogs, the palette, the conversation and notifications. The most opaque layer (about 90%), blurred 28px with saturation 1.6, always over a scrim.

Rules:
- A layer is never more see-through than the one behind it. Popups outrank panels.
- Inside a panel, rows are flat. They get a hover or press wash, never a filled box of their own. Round icon tiles and pills are fine; nested rectangles are not.
- Inside a popup, controls use the flat `--raised-fill` / `--raised-fill-2` fills, not gradients or blur (a blurred layer can't blur through its own parent).
- Glass is off when the `glass` setting is false or the OS asks for reduced transparency; everything must still read correctly on the solid fallback.
- Gradients stay under about 10% lightness change and carry no hue of their own. If a surface looks tinted, it is too much.

## Components

### Card and rows (`.hm-card`, `.hm-list`, `.hm-row`)
A card holds a short list. Each row is one target: a 20px icon column, the title (one line, ellipsis), then meta on the right. Hover shows `--card-hover`; press goes one step stronger. Focus is a 2px inset outline in `--text-2`.

### Section label (`.hm-label`)
A quiet label above a card, with at most one text link on the right ("Open calendar", "See all").

### Assistant card (`.hm-asst`)
The card shows one of two things: a suggestion found in your docs (below), or **starting points**.

**Starting points** (`.hm-starters` / iOS `starters`). Up to three rows that each open the assistant with that question already asked, so the person can take the conversation anywhere. They are built from what is really there: the next event ("Help me get ready for “calc review”"), the open tasks ("Which of my 2 tasks should I do first?"), and the last doc worked on ("Summarize “…”"). Each row is flat, with no fill until hover: a round 34px icon tile, the question, and a small ↗ that appears on hover or focus. They are shown only when a model is ready.

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
- `.btn`: the alternative, a pill on a flat fill (`--btn-grad`). Inside a popup it sits on the flat `--raised-fill-2` instead, so it never fights the glass.
- In cards and empty states they are 38px tall with 18px side padding. Labels are verbs: "Add to calendar", "Start recording".
- `.icon-btn`: round, for toolbar actions. Always has a `title` and `aria-label`.

### Notifications (`.toaster`, `.toast` in `src/soft.css`; `Toast.tsx`; `Toaster` / `ToastView` in `apple/iOS/Feedback.swift`)
- **In from the top right**, a small pill on the raised surface with an edge and shadow. Never white, never at the bottom (the Ask bar owns the bottom).
- **Never over a control.** Each time one appears it measures the top-right of the window and sits just below the lowest button there: a page's header pills, Calendar's Week / Month, the header of a doc open beside, a dialog's close. Text and doc titles don't count; buttons do.
- **One at a time.** A new one replaces the one showing (the old slides out first); they never stack.
- Resting the pointer on it holds it there.
- Phone width: top centre, below the title bar. iOS: 54pt below the top safe area, trailing edge, so the title bar and its buttons stay clear.
- Text is a short past-tense statement: "Added to calendar", "Task done", "Doc moved to Recently Deleted".
- At most one action, as a small pill inside: usually Undo.
- 4 seconds by default; 6 seconds when it carries Undo or reports a problem.

### Empty state (`.blank`)
One per screen: a 52px round icon, a title that names the state ("No recordings yet"), one sentence on what the place is for, and at most one primary button. When the empty state has the button, the same action is hidden from the header.

### Ask bar (`.home-dock`, `.ask-field`, `AskBar.tsx`)
The **only** place the assistant lives: there is no chat panel or sidebar. One 48px pill at the bottom of every page; its placeholder says what it will do here ("Ask about “Title”", "Add an event or ask about your schedule"). The page fades into the background beneath it (`.home-dock::before`) so rows never collide with it. Calendar has no fade because its grid runs to the edge. The bar is one fixed width (720px max) whether or not the conversation is open, so it never moves.
- **It understands, then shows what Enter will do.** EmbeddingGemma reads each request as an event, a task, a new doc, something to find, or a question (`src/ai/understand.ts`, rules in `src/lib/request.ts` until it has downloaded). The first row of the popup is what Enter does, marked with ↵ ("Add “Dentist” · Fri, Nov 20 · 3:00 PM", "Add task “Email the professor”", "New doc “The trip”"); below it, quieter, the other readings (Ask, add to the calendar, add as a task, matching docs). ↑↓ moves between them.
- **The title is the thing itself, never the request.** "Make an event for tomorrow" has no name, so the bar asks "What should I call it?" in the conversation and the next thing typed is the name. "Can you schedule a meeting with Sam on Friday at 3" is "Meeting with Sam". With a name but no day, it asks "When is “…”?".
- **Changes happen at once, with Undo** in the toast. Questions open the conversation.
- With nothing typed, the popup offers starting points for this page (Summarize this, Find the to-dos, Quiz me on this…), plus "Back to the conversation" when one is hidden.
- `/` or ⌘J focuses it from anywhere. Esc clears the text, then hides the conversation.

### Conversation (`.convo`, `Thread` in `AskBar.tsx`, `src/ai/conversation.ts`)
- Opens above the Ask bar, the same width, at most 62% of the window tall, on the raised surface (22px corners). The page stays visible around it. Follow-ups continue it; it scrolls to the newest answer unless you've scrolled up to read.
- Header: "About “Title”" as a pill when a doc or recording is open (tap to ask about everything instead), the model's name in grey, then New conversation and Hide. Nothing else.
- Your words in a soft bubble on the right; answers as plain rendered text (never raw Markdown) on the left.
- The app's own short replies ("What should I call it?") have no Listen/Copy/Retry row.

### The sidebar and the workspace (desktop, Nov 17)
Desktop is a workspace, not a poster: dense, and arranged by the person. The **Ask bar** sits at the bottom centre of every page.
- **Sidebar** (`Rail.tsx`, `.rail`): a slim rail of icons down the left edge (Search, Home, Tasks, Docs, Recordings, Calendar; Settings at the foot). Resting the pointer on it for a moment (or tabbing into it) **opens it in place** over the page, 246px wide on the popup glass: names appear beside the same icons (each row keeps a fixed 40px icon column, so nothing moves), then **Recent** docs, which scroll on their own, and Recently Deleted and Settings at the foot, always. Moving away, Esc or choosing something closes it; coming back while it is closing keeps it open. **⌘\\** (or the button at its top) keeps it open beside the page as a flat panel, remembered in this browser. There is no separate Library popup any more; the old `Sidebar.tsx` is only the phone drawer.
- **Docs and Recordings pages** (`DocsLibrary.tsx`): a wide page of small cards (icon tile, title, first lines, time), with search, folder chips and New doc / Record. Phones keep their own lists and tab bar.
- **Home is a few panels and open space** (`Board` in `HomeView.tsx`, `.hm-grid`, `.hm-tile`): a four-column grid; by default **Tasks and Calendar side by side at the top**, each as tall as what's in it (up to its height), and nothing filling the rest. **Empty space is fine.** Each panel has its name and link (Open, See all) in a 40px header and scrolls inside itself. **Hold a panel's header and drag** to move it (a mouse can just drag; touch holds still first); **drag its corner** to resize (whole columns 1–4, heights 1–3); its **⋯** menu does the same from the keyboard. **Panels** chooses which show (Calendar, Tasks) and resets the layout. **Calendar hides itself when nothing is left today**, and comes back in its place tomorrow; while it's away, the panel beside it in that row takes its columns, so no row is left half empty. **There is no assistant panel**: its starting points show when you click into the Ask bar. Remembered in this browser (`monolith-home-board-3`). Under 880px of board it shows two columns; phones keep one column (Calendar if anything is left, Tasks, Recent).
- **Recent leads Home** (`.hm-recent-row`): right under the header, the docs you were just in as the same cards as the Docs page (icon, title, first two lines, time), one row that fits the window, with See all. The card whose doc is open beside is marked. (It replaced the quiet row of chips above the Ask bar, which was too easy to miss.)
- **New** (`NewMenu.tsx`): Home has one **New ⌄** button instead of New doc / Record. Its menu: Doc (⌘N), Recording, Event, Task, then Upload files to the Vault and Upload a recording. Events and tasks open their page with the Ask bar ready.
- **The Vault** (`VaultView.tsx`, sidebar › Vault): every uploaded file lives here, once. Docs **link** to a file (`monolith-file:<hash>`) instead of holding it, so one file can be in many docs. The page is a grid of cards (picture or kind icon, name, size, age, "in N docs"), with search, kind chips (Pictures, PDFs, Audio and video, Other) and drop-to-upload. Click opens it; **drag a card onto a doc** to link it; its menu has Rename, Download, **Linked from** (each doc), and Delete, which warns how many docs will show it missing. In a doc, **/ › From the Vault** opens a picker (search, arrow keys, Enter). Files in the Vault are never cleaned up on their own; only Delete removes them.
- **A doc beside the page** (`lib/panes.ts`, `.side-pane`): from Home, Tasks and Calendar, a doc opens **beside** the page instead of replacing it; ⌘ or Ctrl-click does that from anywhere. Its header ends with **Open as the page** and **Close** (Esc). The edge between them drags to resize (double-click resets). Remembered in this browser.
- **One page header** (`.hm-head`, and `.cal-head` on Calendar): title (22px) over one quiet line, actions as 30px pills on the right, centred on both lines. Every page starts at the same left edge and the header is the same height with or without actions, so moving between pages nothing jumps. Tasks keeps its rows within 920px but sits where every other page does.
- **Current page in the sidebar**: a firmer fill, a heavier name and a short bar at the rail's edge (accent color when there is one). Hover is only the light fill, so where you are and where the pointer is never look alike.
- **A link in a doc opens beside it** (Nov 17): clicking a `[[` link on a computer opens that doc beside the one you're in, so you keep your place; **⌘ or Ctrl-click** makes it the page. Clicking a link inside the doc beside replaces what's beside. Narrow windows open it as the page.
- **Where am I**: a doc's or recording's header starts with **back** and **forward** and its **place** ("Docs /", "Recordings /", "Recently Deleted /"), which goes to that page.

### Surface (Settings › Appearance › Surface, `lib/looks.ts`, `--mat-*` in `soft.css`)
What panels, cards and the doc beside are made of. Three starting points, **Clear**, **Frosted** (the default) and **Solid**, then four sliders: **Fill** (how much panel color covers the look, 10–100%), **Frost** (blur, 0–48px), **Edge** (outline strength, 0–24%) and **Corners** (4–28px). Fill and frost only show over a look with color; on Graphite their sliders are dimmed and one line says why. Reset returns to Frosted. Popups keep their own fixed glass, so they always outrank panels.

### Own icons (`src/components/icons.tsx`)
Three icons are drawn for Monolith instead of taken from lucide, because the stock ones read as generic: the **Vault** (a small safe with a dial), **Listen** (lines of text with sound coming off them) and the **menu** (three solid dots, which hold up at small sizes). Same 24-unit grid, 1.8 stroke and round ends as lucide, and the same props, so they sit beside it without a seam. iPhone and iPad use the same drawings (template images `mono.listen`, `mono.more`, `mono.vault` in the asset catalog, through `Icon` in `apple/iOS/Icons.swift`); everything else stays an SF Symbol.

**No favorites** (Nov 17): there is no star, pin or Favorites list anywhere. Docs and recordings are ordered by when they were last edited, and Recent (Home, the sidebar, ⌘K) is how you get back to what you use. The old `pinned` field is still read and written so older backups and devices sync, but nothing shows or sorts by it.

### Looks and accent (Settings › Appearance, `lib/looks.ts`)
Dark is the default; light and System are there too. On top of either:
- **Look**: a soft wash of color that blooms from three corners of the window, behind everything. Graphite (none, the default), Dusk, Tide, Moss, Ember, Bloom, Aurora. With a look on, the page is clear and panels, the rail and the doc beside are frosted over the wash; the fade under the Ask bar blurs instead of painting plain ground. Color lives in the wash and the accent only, never on text or rows.
- **Accent**: the color of primary buttons, the current place's icon, today, selection, focus rings and checkboxes. Neutral (the text color, the default), Match the look, Blue, Violet, Teal, Green, Amber, Rose. Dark mode uses the light shade with dark text on it; light mode uses a deep shade with white text. Calendar keeps its own blue.

### Desktop density
| Thing | Desktop | Phones |
|---|---|---|
| Page title | 22px / 650 | 26px |
| Row | 34px, radius 8px, 14px text | 48px, radius 16px, 15px |
| Panel (card) radius | 12px | 22px |
| Panel label | 12.5px | 13.5px |
| Header pills | 30px tall, 13px | 36px |
| Page padding | 26px 28px; content up to 1480px (Tasks 920px) | 14px |
| Gap between panels | 12px | 30px |

### Quick access (⌘K, `.palette.qa`, `CommandPalette.tsx`)
The fastest way to anything. One input, a row of scopes under it (All, Docs, Tasks, Events, Recordings, Commands; Tab and Shift-Tab move between them, `>` means Commands, Backspace on an empty input goes back to All), a list of fixed height (so it doesn't resize as you type), and a footer of key hints.
- **Nothing typed:** Recent docs, Open tasks, Coming up, and Create (New doc, Start recording, New event).
- **Something typed:** a **Do** group first, read the same way as the Ask bar ("Add “Dentist” · Fri…", "Add task …", "New doc …", and always "Ask the assistant", ⌘↵), then Docs (ranked: title starts with the words, then a word in the title starts with them, then contains, then the text), Related in meaning (EmbeddingGemma), Tasks, Events, Recordings, Commands.
- Each row: icon, title, a grey second line (snippet, doc, place), and a grey detail on the right (date, due). ⌘↵ on a task checks it off.

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

### Assistant answers (in the conversation above the Ask bar)
- **Exact answers are instant.** "What's on tomorrow", "what's next", "what's left to do" are answered from the calendar and docs on the spot (`src/ai/instant.ts`), even before the model has loaded, and never with a wrong date. Anything that needs judgement ("am I free", "what should I focus on") goes to the model.
- **While waiting, say what's happening**, in grey beside the dots: "Getting the assistant ready…", "Reading “Biology notes”…", "Thinking…". Never a bare spinner.
- **Sources under the answer**: "From" and up to three pills, each a doc the answer read (click to open it), or "Your calendar" / "Your open tasks". Nothing is listed that wasn't actually given to the model.
- **Actions are cards, with no sentence above them** (the card already says it; a sentence was the same thing twice). One card per change: an icon for what it does, the title, a second line with exactly what will happen ("Sun 2:00 PM → Tue, Nov 17 · 3:00 PM – 4:00 PM", "Add to “Week plan”", "Check off in …"), and one button (Add, Move, Remove, Check off, Create). Remove is the only non-primary button. After the tap the button becomes a green "Added"/"Moved"/…, and the toast says what happened, with **Undo**.
- Under each answer: Listen, Copy, Add to doc (when a doc is open), and Retry on the last one. No copy of these anywhere else.
- The Ask bar is always usable; asking before the model is ready starts it ("Getting the assistant ready…") and answers when it can.

### Recently Deleted (`TrashView.tsx`)
One page, like Tasks: **Docs and recordings**, newest first, "Doc · deleted 5 minutes ago", a **Restore** button on every row, Delete forever in the row's ··· menu (always confirmed). Clicking the title previews it, with Back and Restore in its header. "Empty" next to the heading deletes them all forever, after asking. Checked-off tasks are not here: they fold under Tasks › Done.

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

### Links between docs (`src/lib/graph.ts`, `Editor.tsx`)
- Typing `[[` in a doc opens a short list titled "Link to" (only while typing: putting the cursor into old text that contains `[[`, or into code, never opens it; the same goes for `/`): matching docs and recordings (most recent first), then "New doc “…”" when nothing has that exact name. Enter or Tab picks; Escape closes. `/` › "Link to a doc" does the same.
- A link shows as the doc's name on a soft fill (`--card-hover`), 550 weight, no underline: it reads as a name, not a web address. Clicking it opens the doc beside this one (⌘-click: as the page). Web links keep the underline.
- A link is stored as an ordinary link to `#doc/<id>`, so Markdown files, backups and phone sync carry it unchanged. Renaming a doc renames the links that still show its old name.
- Picking a name that doesn't exist makes the doc and stays where you are.

### Connections (`.cx`, `Connections.tsx`)
Under a doc's or recording's text, only when there is something to show, in this order: **Linked from** (each doc that links here, with the sentence it's mentioned in), **On your calendar** (its upcoming events), **Related** (up to three docs close in meaning, from System 1, never ones already linked). A group label is a section label (13.5px / 550, `--text-2`); rows are icon, title, one quiet line. 56px above the first group.

**Mentioned in** sits between Linked from and On your calendar: docs that say this doc's name in plain words without linking to it (titles of four letters or more, whole phrase, any case; at most five). Each row has one small **Link** button, which turns the first mention into a link, with Undo.

### Tasks (`TasksView.tsx`, `src/lib/tasks.ts`, `.tk-*`, `.hm-due`)
Tasks are **their own list** (Nov 17), stored as records of their own (`tasks` in the store), backed up, exported as `Tasks.md` and synced to the phone as `task` records. A checklist in a doc is part of that doc and is **not** pulled into Tasks. The "Tasks" doc older versions kept was moved into the list once, on update.
- A page in the Home column: the title "Tasks", one line ("3 things to do, 1 late"), then a card per time group in this order: **Overdue, Today, Next 7 days, Later, No date**. Empty groups aren't shown. At the bottom, **Done ›** folds open the checked-off ones (remembered), newest first; unchecking one puts it back. Done tasks go after 30 days.
- A row: checkbox, the task, a small chip with the doc it goes with (if any; opens it beside), and when it's due on the right in faint tabular text ("Today", "Tomorrow", "Fri", "Nov 28", with a time if it has one). The date turns `--danger` only once it's late.
- **Clicking a task opens it in place**: its name becomes a text field on the row, and under it, aligned with the words, sit Due (date, and Time once there's a date), a clear ×, **Doc** (which doc it goes with), Notes, then Delete (with Undo) and Done. No second box: the row keeps its hover fill and the fields sit on the card. Enter or Esc closes. From Home, ⌘K or Calendar, clicking a task opens it this way on the Tasks page.
- Adding is the Ask bar's job ("Add a task or ask what to do first"). The date words are read once, when it's made ("essay draft by Friday" → "Essay draft", due Friday); after that the date is the task's own. Asked from inside a doc, the task goes with that doc. The option and the toast show it as it will be listed ("Added “Renew library books” · due Tomorrow"; never "due Due …"), with Undo. ⌘K's Do row and the assistant's `@task` do the same.
- Home's Tasks panel shows the same rows (all of them, scrolling, on a computer; the first five on a phone), with "See all N" or "Open" as its one link.
- Checkboxes in docs are the same 20px rounded square as Home and Tasks, inside a 24px target.
- **iPhone and iPad** (`Todo` in `apple/iOS/Tasks.swift`): the same list as its own screen, **Tasks**, second in the drawer and the sidebar, grouped the same way, with Done folded at the bottom. On that screen the bottom bar reads "Add a task or ask" and adds what isn't a question; the + menu's **Task** goes there with the bar ready. Tap a task's words for a sheet (name, Due and Time, Doc, Notes, Delete); tap its box to check it off, with Undo; hold it for Mark done, Edit, Open the doc, Copy, Delete. Home shows the first three, then "All N tasks". Tasks sync with computers as `task` records, ids and all, so the move from the old Tasks doc made on both sides merges.

### Settings (`.modal.settings`, `SettingsModal.tsx`)
Sections on the left (General, Assistant, Storage and files, Devices, About), one shown at a time on the right, so nothing is found by scrolling. The dialog keeps one size as sections change. The title on the right is the section's name; a section never repeats its own name as a heading. On phones the sections become a row of pills across the top.

### A linked phone's model (Settings › Assistant, `PhoneModelSettings`)
- Shown only when a phone is linked. One row, "Use my phone’s model", with a segmented control **Auto / Always / Never**, and one line under it ("iPhone is reachable and runs Gemma 3n.", or how to make it reachable), then that questions and answers are encrypted end to end.
- **Auto** uses the phone when this browser has no model ready, loading or downloaded, so a slow computer never has to download one. **Always** prefers the phone whenever it's reachable. **Never** keeps everything on this computer.
- When the phone answered, the conversation header says so: "Gemma 3n on iPhone". No other badge or toast.
- On the iPhone: the linked-computers settings have one switch, "Let computers use this phone’s model" (on by default). Its footer names the model, says answers stay encrypted between your devices, and that it works while Monolith is open.

### Files from another device
- A picture or file in a synced doc that hasn't arrived yet shows as a quiet placeholder ("Arrives when your computer is connected" on iOS), never a broken image. It fills in by itself when the file comes.

### Calendar: making and editing events (`CalendarView.tsx`)
- A click on an empty slot makes a one-hour **draft** and opens the editor; drag to choose the length. A draft that's closed without a name is thrown away, so a stray click never leaves a "New event". An existing event closed with its name cleared becomes "New event".
- With the editor open, a click on the grid **closes it** instead of starting another event; **Esc** closes it too.
- Clicking an event opens it. It only moves once the pointer has travelled 5px, so a click's wobble never nudges it.
- The editor sits **beside** the week, not over it: the header and grid make room for it, so every day and the Week / Month switch stay in view. The grid leaves room under its last hour for the Ask bar.

### Repeating events (`src/lib/repeat.ts`, `EventEditor` in `CalendarView.tsx`)
- The editor has a **Repeat** choice: Never, Every day, Weekdays, Every week, Every 2 weeks, Every month, Every year, and when it repeats an optional **Until** date. One quiet line under it says how changes apply.
- **The editor changes every date; the grid changes one.** Editing a field changes the whole series (a new time moves every date by the same amount). Dragging or resizing one in the grid moves only that date and says "Moved this one. The others stay." with Undo. No "this or all?" dialog.
- A repeating event shows a small repeat arrow before its time. Deleting offers two buttons side by side, "Delete this one" and "Delete all" (red), each with Undo.
- Quick add reads "every tuesday", "weekdays", "every other week", "every month", and "daily"/"weekly" only where they can't be part of a name ("gym daily 7am" repeats; "weekly review fri 3pm" is a name). The preview and toast end with the repeat ("· Every week").
- The assistant moves or removes one date at a time.

### Tasks on the calendar (`.chip.task`)
A task with a date sits in the all-day row of its day (and at the top of its day in the month view): a small empty box and its words on the neutral soft fill, never an event colour. The box checks it off (with Undo); the words open it on the Tasks page.

### Earlier versions (`HistoryDialog.tsx`, `src/lib/history.ts`)
Doc ··· › "Earlier versions". Versions on the left ("Today · 3:42 PM", word count), the page as it was on the right, read-only, and one primary button, "Restore this version", beside the line "Restoring keeps today’s version too." Restoring says "Restored the version from …" with Undo. With no versions yet it is an empty state, not an empty list.

### Reminders (`src/lib/reminders.ts`)
One switch in Settings › General, off by default; turning it on is when the browser asks for permission. The line under it says exactly when reminders arrive and that Monolith must be open or installed. If notifications are blocked, it says so and that reminders still appear inside the app. Inside the app a reminder is an ordinary notification pill: "Standup · In 10 min · 9:00 AM".

### Storage and files (`StorageSettings.tsx`, `.st-status`)
Settings › Storage and files answers three questions, in order:
1. **Is my work safe?** One status line at the top: a green tick and "Your work is kept" (the browser promised to keep it, or there's a backup from the last two weeks), or an amber alert and "Your work has no copy yet" with one **Back up now** button. Its second line says what the browser promised and when the last backup was.
2. **Where it’s saved**: This browser (docs, recordings, open tasks, events, and space used), each connected folder, GitHub or Drive with its sync state, then Connect storage. One line under it: tasks, events, recordings and settings always stay in this browser, and backups and exports include all of it.
3. **Keep a copy**: **Backup file** (encrypted, everything, for restoring) and **Export as Markdown** (a zip any app reads, with Tasks.md and Calendar.ics; not for restoring). Then **Privacy**: the passcode.

### Export everything (`src/lib/exportAll.ts`)
Settings › Storage and files › Keep a copy › "Export as Markdown". Backup is encrypted and restores the app exactly; Export is plain files for any other app. The toast says what was written ("Exported 12 docs, 3 recordings, 5 tasks, 8 events").

### Printing
Doc ··· › "Print or save as PDF" prints the doc alone, dark text on white whatever the theme: no sidebar, toolbar, Ask bar, contents or connections.

### Menus and dialogs
- A dialog stops catching clicks the moment it starts closing, so a click right after Esc lands on the page.
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

### Markdown (`editor/markdownInput.ts`; iOS `BlockEditor`, `Rich.inlineShortcut`)
Nobody has to know Markdown: every format is in the toolbar, the `/` menu and (iOS) the keyboard bar's Aa menu. But it's read wherever it turns up, and never left on the page as symbols.
- **Typed**: `# ` headings, `- ` / `1. ` / `[] ` lists, `> ` quotes, ```` ``` ```` code, `---` dividers, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `==highlight==` and `[words](address)` become what they mean as you type them.
- **Pasted** as plain text (from a chat, a README, a notes app): becomes formatted text: headings, marks, links, lists nested by indent, tables. Rich pastes keep their own formatting; nothing changes inside code. On iPhone and iPad the same: several lines pasted become blocks at the cursor (the first joins the words before it), and every pair of marks in a line converts, not just the first.
- Docs are stored as Markdown on the phone and in files, so what's converted is exactly what was meant.

### Record into a doc (`/record`; iOS `/record` or `/rec`, Insert › Recording, ⋯ › Record into this doc)
A recording that starts now and belongs to the doc: the line becomes a link to it ("Lecture notes · Recording Nov 17"), stored like any doc link (`#doc/<id>`). On a wide screen it opens beside the doc and you keep writing while it records; narrow, it opens as the page. On iPhone you stay in the doc; the recording shows above the bar until stopped. Hold the link to open it. Only offered in docs.

### Apple Watch (`apple/Watch/WatchApp.swift`)
Made for recording, like a voice memo: the first thing is one big red **Record** row (during an event it names it, and the recording is named after the event). Recording opens a screen with the time, a live level meter and one Stop button; it keeps going with your wrist down. Each recording is saved on the watch first and listed under **Recordings** with where it is: *Waiting for iPhone*, *Sending*, *On iPhone* (✓). The phone saves it once (by the watch's id), transcribes it, and confirms; only then does the watch delete its copy, so nothing is lost when the phone is away. Below: Up next (the phone's agenda) and a Quick note field that becomes a doc.

### Lists in docs (`editor/lists.ts`)
- **Tab / Shift-Tab** indent and outdent a list line, and never move focus out of the doc, even when the line can't go further.
- **Backspace at the start of a line** takes its bullet away (nested: moves it out one level); it never glues the line onto the one above.
- **Typing a marker at the start of a line changes the list**: `1. ` numbers a bulleted list, `- ` turns a numbered one back to bullets, `[] ` makes a checklist. It doesn't nest a new list inside the line.
- **Plain text pasted** as lines starting with `- `, `* `, `1. ` or `[ ] ` becomes a real list, nested by indent (see Markdown).
- Nested levels change marker so an outline reads at a glance: • ◦ ▪ and 1. a. i.

### Lists in the Library
- Docs, Folders and Recordings are listed in the Library (fold a group to hide it); pages show them as cards, and there's no second list column anywhere.
- Titles get two lines before they're cut, with the full title as the tooltip. Hover buttons take no room: they float over the end of the row.

### Nothing jumps
- Nothing that loads late is placed above what's already there. Home's assistant card shows from the first frame (it used to appear once the model loaded and push the page down).
- Every screen's code is loaded in the background after start, so switching never shows a placeholder first.
- Popups (Ask options, conversation, menus, toasts) float over the page; they never push it.

## Coverage

| Area | Follows this file? |
|---|---|
| Web Home | Yes (Nov 15) |
| Web notifications | Yes (Nov 15) |
| Web empty states: Recordings, Recently Deleted, no doc open | Yes (Nov 15) |
| Web assistant chat, Settings switches and Integrations | Reviewed Nov 15 (pass 5) |
| Web Tasks, links and connections, Settings sections | Yes (Nov 15, 0.10): dark and light, axe-checked |
| Web repeating events, event editor, earlier versions, reminders, export | Yes (Nov 16, 0.11): axe-checked; print checked in the print preview only |
| Web Ask bar, conversation, quick access (⌘K), sidebar, Recently Deleted | Yes (Nov 15, 0.12): dark, desktop width, axe-checked in the e2e run. Light mode and phone width not re-checked |
| Web looks and accent; Home panels you drag; doc beside the page; back/forward in doc headers (Nov 17, later) | Seen on desktop in dark (Dusk, Ember, Moss) and light (Tide); e2e and axe pass. Phone width, iPad and iOS not ported |
| Web Vault, New menu, Home with Recent above the Ask bar (Nov 17, latest) | Seen on desktop in dark; upload, link from a doc and "in N docs" checked by hand; e2e passes. Light mode, phone width and iOS not done; the Vault has no axe check of its own yet |
| Web shell: dock, Library, Docs page, Home board (Nov 17) | Home, Docs page, open doc and Library flyout seen on desktop in dark and light; Home seen on phone in dark. axe contrast 0 issues. Calendar, Tasks and Recordings pages not re-checked under the new dock; iOS not yet ported |
| Web surfaces: frosted popups, panels, round buttons, ambient light | Home, sidebar, Ask bar, ⌘K palette, Settings, doc header and Calendar header seen on desktop in dark and light (Nov 16). Phone seen on Home in dark only. Light-mode popups and the conversation panel need a contrast check |
| Web Docs, doc editor, Recordings detail, Calendar | Not yet reviewed against this file |
| iOS Tasks, links, connections | Not built: iOS shows a link as its text, and has no Tasks screen yet |
| iOS Home, drawer, Docs and Recordings lists | Yes (Nov 15, pass 2): `Space` tokens, drawer icon column. Checked in the iPhone 17 simulator, dark only |
| iOS Integrations | Yes (Nov 15): seen in the iPhone 17 simulator with every switch on. iPad and light mode not checked |
| iOS chat, menus, doc editor | Follows the principles from the Nov 14 passes; not re-checked against the iOS spacing tokens |
| Web Integrations | Not built (web would need browser location and a weather source) |
| iOS notifications | Yes (Nov 15): top-right pill under the title bar, seen in the iPhone 17 simulator. iPad not checked |
| iPad, Watch | Not reviewed |
