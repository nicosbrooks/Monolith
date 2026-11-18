# iOS redo: simpler, warmer, refined (iPhone, iPad, Watch)

> **Update, Nov 17:** after this plan was built, the iPhone navigation in section 2 changed to match the Claude
> iPhone app:
> - **☰ drawer:** opens with Search, Recents, Folders and More, plus your initials (Settings) and New doc at the foot.
> - **Four tabs:** Home, Tasks, Docs and Calendar.
> - **Ask composer on Home**, above the tabs, with + and the mic.
>
> Ask is no longer a tab; on iPhone it opens from the drawer's Search. DESIGN.md has the current rules.

## Context
You said you really don't like the iOS UI. The four reasons you gave:
- It's too dark and empty.
- It feels like the Settings app.
- There are too many places to go.
- The editor feels raw.

You chose to:
- Match the web look: themes, gradient washes, accent color, soft glass panels.
- Cover iPhone, iPad and Watch.
- Consider a bottom nav row.

That replaces the earlier ChatGPT-style direction (true black, a slide-in drawer, no tab bar). The current work is committed (eba87c7), so the redo starts from a clean point.

The goal is an app that opens onto color and content rather than black and grey rows. You get around with one row of tabs, and writing feels as finished as on the web.

## 1. Foundation: the web look on iOS (`apple/iOS/Theme.swift`)
- **Looks, ported from `src/lib/looks.ts`.** The same seven looks (Graphite, Dusk, Tide, Moss, Ember, Bloom, Aurora) with the same three hex colors each.
  - A new `Wash` view draws them as three soft radial blooms, or a `MeshGradient`, behind every screen. It is set once at the root, so pages and sheets sit on it.
- **Accent, ported from TINTS.** Neutral, Match the look, Blue, Violet, Teal, Green, Amber, Rose.
  - Applied with `.tint()` at the root, so toggles, checkboxes, today and selection all pick it up.
  - Dark mode uses the light shade; light mode uses the deep shade, as on the web.
- **Surface: Clear / Frosted / Solid.**
  - One `.panel()` modifier draws cards on a Material, or glass, with `Space`-token corners.
  - It replaces the flat `Theme.card` and `Theme.panel` fills.
- **Stored in `@AppStorage`:** `look`, `tint`, `surface`. Settings › Appearance gets the same swatch row, accent dots and three surface choices as the web.
  - Setup gains one "Pick a look" step.
  - New default: **Dusk**, at a low, calm intensity. Graphite is still there for anyone who wants plain.
- `Theme.paper` stops being true black. With a look on, the page is clear over the wash; Graphite keeps the web's `#0f0f0e` / `#f4f3f0`.

## 2. Navigation: one bottom row (iPhone)
- `PhoneRoot` in `MonolithApp.swift` changes from the drawer and ZStack to a native iOS 26 **`TabView`** with Liquid Glass. Tabs: **Home, Tasks, Docs, Calendar**, plus a separate **Ask** tab with the search role (the round glass button at the right end).
  - Ask opens the assistant and search in one place. That replaces both the drawer's Search and the floating Ask pill, so the bottom has one control row, not two.
  - **Recording in progress** shows in `tabViewBottomAccessory`, replacing `RecordingAccessory` in `BottomBar`.
  - The tab bar minimizes on scroll (`.tabBarMinimizeBehavior(.onScrollDown)`), so docs get the full screen.
- **Fewer places:**
  - **Recordings join Docs.** The Docs tab has chips: All · Docs · Recordings · each folder · +. That matches the web's library chips, and folders move out of a drawer into these chips.
  - **Integrations and Recently Deleted move into Settings.**
  - **Settings** opens from the top-right of Home: one round button for the profile or slab.
- **Create:** each tab's title bar has a single + that makes the right thing:
  - Home: the New menu (Doc, Recording, Task, Event)
  - Tasks: a task
  - Docs: a doc in the current chip
  - Calendar: an event
  - That's one control per action, so the old global + circle goes.
- The drawer code (`menu`, `openDrawer`, edge-swipe) and `drawerButton()` are removed. `Router.showSection`, `showTasks` and `pending` become tab selection.

## 3. Screens that feel like a notebook, not Settings
- **Home** (`TodayView.swift`):
  - A large greeting over the wash.
  - **Recent** as a horizontal row of doc cards: icon tile, title, two preview lines, time. Same as the web's `.hm-recent-row`.
  - **Tasks** and **Calendar** as two frosted panels, each with a header link (See all). The assistant's starting points move into the Ask tab.
  - Rule kept: no box inside a box.
- **Docs** (`DocViews.swift`, `Lectures.swift` list): a two-column grid of cards (one column on narrow phones, set by a toggle in ⋯) instead of `List` rows with chevrons.
  - Holding a card opens the existing `itemMenu`.
  - Opening uses the zoom transition (`.navigationTransition(.zoom(sourceID:in:))`), so a doc grows out of its card.
- **Tasks** (`Tasks.swift`):
  - Rows on one frosted panel per group (Today, Upcoming, Someday).
  - The accent-colored checkbox animates and plays a haptic.
  - An inline "New task" row at the top replaces the bottom bar's task mode.
- **Calendar:**
  - Keeps its blue for events.
  - Its day list sits on a panel over the wash.
  - The week strip uses the accent for today.
- **Empty states:**
  - The slab mark, one warm sentence and one primary button ("New doc", "Add a task").
  - They replace `ContentUnavailableView`'s grey icon.
- **Motion:**
  - Spring presses on cards (scale 0.97).
  - Tab changes keep the wash still, so only content moves.
  - Toasts stay top-right pills as on the web.

## 4. Editor that feels finished (`BlockEditor.swift`, `LineField.swift`, `ItemViews.swift` NoteEditor)
- **Type:**
  - Title in the display style (34pt, semibold, tight tracking).
  - Body 17pt with roomier line height (about 1.4) and 10pt between blocks.
  - Headings get proper space above.
  - A readable max width of 680pt on iPad.
- **Header:**
  - Back, then the doc's place (Docs / folder), then a single ⋯ menu. Listen and Record move into ⋯.
  - The header fades to glass on scroll.
- **Keyboard toolbar:** one glass row above the keyboard.
  - **Aa** opens a style sheet with Title, Heading, Subheading, Body, Quote and Code, plus bold, italic and strike.
  - Then bulleted list, checklist, link (`[[`), record, photo/file, and dismiss.
  - This replaces the current mixed toolbar and menus.
- **Slash menu:** the same glass popup style as the web, with an icon tile and one line per entry, filtered as you type.
- **Placeholders:** an empty doc reads "Start writing, or type / for more". Empty lines show nothing.
- **Checklists and bullets:** accent checkbox, correct indent steps of 22pt, bullet glyph aligned on the first baseline.

## 5. iPad (`Pad.swift`)
- `NavigationSplitView` sidebar over the wash, with Home, Tasks, Docs and Calendar, then folders, then Recent. It mirrors the web rail opened as a panel.
- The Docs grid goes three to four columns. A doc opens in the detail column with the 680pt column.
- Ask is a toolbar button that opens the same Ask screen as a sheet, or as an inspector on wide screens.

## 6. Watch (`apple/Watch/WatchApp.swift`)
- The phone sends `look` and `tint` in the applicationContext (new keys in `apple/Shared/Link.swift`).
  - The watch paints a small wash at the top of Home.
  - It uses the accent for the record ring and the timer.
- **Home:**
  - A big round **Record** button: a red core with an accent ring.
  - **Recordings** as rows with a state pill: Waiting, Sending, On iPhone.
  - Up next, then a compact Quick note row.
- **Recording screen:**
  - A full-screen live waveform from the existing `Meter`.
  - A large timer, Stop, and a haptic on start and stop.
- A complication or Smart Stack widget to start recording is a possible follow-up, not in this pass.

## Files
- **Core:**
  - `Theme.swift`: Look, Tint, Surface, `Wash`, `.panel()`
  - `MonolithApp.swift`: TabView root; slimmed `BottomBar`
  - `Pad.swift`
  - `TodayView.swift`
  - `DocViews.swift`: card grid, chips
  - `Lectures.swift`: list merged into Docs
  - `Tasks.swift`
  - `CalendarScreen.swift`
- **Editor:** `BlockEditor.swift`, `LineField.swift`, `ItemViews.swift`
- **Settings and setup:** `Setup.swift` (Pick a look), the Settings sheet (Appearance; Integrations and Recently Deleted move in)
- **Watch:** `WatchApp.swift`, `Shared/Link.swift`, `PhoneLink.swift` (send look and tint)
- **DESIGN.md:** rewrite the iOS sections. The tab bar, looks on iOS, cards and the editor replace "iPhone: calm, not boxed" and the drawer notes.
- **Reused:**
  - `Folders` (Folders.swift)
  - `itemMenu` / `ItemMenu`
  - `Todos`, `TodoRow`
  - `Toaster`
  - `RowPressStyle`
  - `Icon` (Icons.swift)
  - `Block` parsing
  - `LectureRecorder`
  - `Linker` sync (unchanged; no data-model changes)

## Order
1. Foundation (looks, accent, surface, wash) and Settings › Appearance
2. iPhone TabView, removing the drawer
3. Home, Docs (with Recordings and folders), Tasks, Calendar
4. Editor
5. iPad
6. Watch
7. DESIGN.md

There is a screenshot checkpoint after each step.

## Verification
- `xcodegen generate` when files are added, then build with `xcodebuild` for the iPhone 18 Pro, iPad Pro 11 and the paired Watch.
- On iPhone and iPad simulators, in dark and light and with two or three looks:
  - Walk each tab.
  - Create, rename and delete a folder chip.
  - Record from the + menu and watch the bottom accessory.
  - Open a doc via the zoom transition and type with the new toolbar: /, a checklist, a link.
  - Take screenshots and send them with SendUserFile.
- Watch: needs you to grant simulator access in the panel. Then check the recording flow and that the look reaches it.
- Web tests are unaffected, but `npm run check` still runs in case shared docs or tests change.
