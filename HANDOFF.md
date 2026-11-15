# Handoff: Monolith (formerly Socratic), Nov 13 2026

The project folder is still named `socratic/`. It is a git repo pushed to github.com/nicosbrooks/Monolith (`main`); commit only when asked. The web app is React + Vite (typecheck: `npx tsc -b`), the iOS/iPad/Watch app is SwiftUI (`apple/`, XcodeGen), and the relay is a Cloudflare Worker (`relay/`).

## Ground rules from the user
- **localhost:5199 holds the user's real data.** Never write to it, including through a second store instance in the browser preview. Test on **5210** (launch config `monolith-test`).
- Never log in or enter credentials. `wrangler login` and deploying are the user's to do.
- Pin new dependencies to versions **at least 2 weeks old** (exact versions).
- Design: calm, dark-first, monochrome. One control per action (no duplicates), no raw Markdown anywhere, popups with clear contrast. See memory files `no-duplicate-controls.md` and `design-preferences.md`.
- There's no Prettier config. Don't run Prettier with its defaults (they add double quotes and semicolons). The style is single quotes, no semicolons, long lines.

## Just finished, needs checking

### 1. Firefox AI fix (works: confirmed in Firefox 160)
- **Cause:** Firefox auto-updated to 160 on Nov 12. Its WebGPU adapter reports `maxStorageBuffersPerShaderStage = 9`, and WebLLM hard-refuses to start below 10.
- **Fix:** [src/ai/llm.worker.ts](src/ai/llm.worker.ts) wraps `navigator.gpu.requestAdapter`. WebLLM sees 10, and the device is created with the real limit of 9.
- `browserEngine()` in [src/ai/llm.ts](src/ai/llm.ts) now uses WebLLM wherever WebGPU exists.
- **Tested:** in a throwaway Firefox 160 profile, WebLLM loaded `Qwen3.5-0.8B-q4f16_1-MLC` through the app's own `loadModel` and answered a chat. First token came in about 13.5 s, and the full answer in 21 s. Gemma 4 and the Enhanced tier are untested on Firefox.
- **To re-test:** the throwaway profile is at `<scratchpad>/ffdiag/profile` and the log server is `<scratchpad>/ffdiag/serve2.py`, which POSTs results to 127.0.0.1:5299. If that scratchpad is gone, open http://localhost:5210 in Firefox 160 and ask the assistant something.
  - Clean up afterwards: delete `__fftest.html` from the project root if it's still there.
- **If a model's shader needs 10 buffers**, loading fails and the app falls back to the second engine (below).

### 2. Second engine: Transformers.js (fallback only)
- [src/ai/onnx.worker.ts](src/ai/onnx.worker.ts), plus `ONNX_MODELS` / `loadOnnx` / `onnxCall` in `llm.ts`. It's used only if WebLLM fails in the tab, or when there's no WebGPU (CPU/WASM).
- **Benchmarks in Firefox 160:**
  - Qwen3-0.6B and LFM2-1.2B (q4f16) fail on the same 9-buffer limit.
  - Qwen3-1.7B, and Qwen3-0.6B on WASM, hit `bad_alloc` (possibly because all models ran in the same page).
  - Only Qwen3.5-0.8B-ONNX ran: about 100 s to the first token, then 3–4 tokens/s.
- **The `ONNX_MODELS` catalogue still lists the failing models.** The user said to leave it for now.
- `@huggingface/transformers` is pinned to exactly 4.3.2.

### 3. Rename Socratic → Monolith (done; iOS build succeeds)
- **Web:**
  - `APP_NAME` lives in `src/brand.ts`.
  - Updated: page title, manifest, the Settings and Link dialog text, and the pairing link (now `monolith://pair`).
  - The Drive folder lookup tries "Monolith", then the old "Socratic" folder.
  - New slab logo: Sidebar `Logo`, `public/favicon.svg`, and the PNG icons (drawn by a Swift script).
- **iOS:**
  - Project, targets and scheme are now `Monolith` / `MonolithWatch` (`apple/Monolith.xcodeproj`, regenerated). Files renamed: `MonolithApp.swift`, `Monolith.entitlements`.
  - Display names, permission strings and in-app text updated.
  - Both URL schemes (`monolith`, `socratic`) are accepted, and the in-app scanner accepts both.
  - New app icon in `Assets.xcassets`.
- **Kept on purpose** (renaming them loses data or breaks pairing): storage keys `socratic-v1`, `socratic-calendars`, `socratic-gdrive-token`; HKDF info `socratic/link/v1`; keychain `com.socratic.link`; bundle IDs `com.socratic.app*`; the `socratic.marks` attribute keys.
- **To do:**
  - The iOS simulator build succeeded (not yet launched). Build command:
    ```
    xcodebuild -project Monolith.xcodeproj -scheme Monolith -destination 'id=3CAB31E3-ED9F-4A8F-80B6-7B4F31AC4B16' -derivedDataPath <scratchpad>/dd build
    ```
    Install with `xcrun simctl install booted …/Monolith.app`, then `xcrun simctl launch --terminate-running-process booted com.socratic.app`.
  - Removed the stale `apple/Socratic.xcodeproj` from the workspace after the successful build recorded above. The new project file passed `plutil -lint`.
  - Check the web app on 5210 for leftover "Socratic" text.
- **Relay renamed to `monolith-relay`** in `relay/wrangler.toml`. If the user already deployed `socratic-relay` on `workers.dev`, set `VITE_RELAY_URL` to the address printed by the new deploy and rebuild. Existing pairings store their relay address, so keep the old Worker running until devices have been paired again and sync is verified. See [relay/DEPLOY.md](relay/DEPLOY.md).

## Handoff verification, Nov 13

- The production web build passed. Its title and manifest say Monolith, and the favicon and manifest icons are present. The source audit found the old name in compatibility identifiers and in the sample document's “Socratic method” reference. A live UI check still needs port 5210. This session could not bind the test server.
- Firefox 160.0 is installed. WebLLM 0.2.86 includes both shader builds for Default (Gemma 4 E2B) and Enhanced (Qwen 3.5 4B). Both tiers still need to load and answer in Firefox on port 5210. Record which model and engine actually answered, since the app can fall back.
- The iOS and Watch plists say Monolith. iOS still registers both pairing schemes, and Watch still points to the existing companion bundle ID. This session could not access CoreSimulator or write SwiftPM manifest diagnostics, so the simulator launch remains open.
- The relay type-check passed. Wrangler packaged both production and staging in dry runs. The deployed Worker still needs a smoke test against its actual URL.

## Done earlier this session (verified on 5210)
- **Ask bar on every page** (`src/components/AskBar.tsx`, CSS at the end of `src/soft.css`):
  - It adjusts to context: calendar, open note/doc/recording, home, lists.
  - On the calendar, a date in the text adds the event right away, with Undo.
  - Elsewhere it asks the assistant or searches.
  - The phone dock and phone detail screens have it; it hides while the editor has focus.
  - The calendar's duplicate quick-add input was removed, and toasts sit above the bar.
- **Relay guide:** `relay/DEPLOY.md` covers Cloudflare Pages, a staging relay (`npm run deploy:staging`, `[env.staging]` in wrangler.toml), costs, data separation and rollback. Production deploy is now `wrangler deploy --env=''`.
- **Calendar:** subscribe to calendars (ical.js; `src/lib/calendars.ts`; the relay `/ics` endpoint takes POST with a rate limit), event colors, swipe between weeks, a week strip on Home, and assistant action cards (`src/ai/act.ts`).

## Speed pass (Nov 13, late)
- Sidebar subscribes only to section/folders/sources (`useShallow`), so typing no longer re-renders it.
- Phone sync (`src/link/link.ts`) skips unchanged objects before JSON-comparing, instead of serializing every note every 600 ms.
- Event colours moved to `src/lib/colors.ts`; Calendar is its own lazy chunk again (Home was pulling it in).
- Removed ~210 CSS rules for classes nothing renders (index/theme/soft.css: 152 KB → 129 KB source). Don't re-add layered overrides; edit the rule in place.
- Startup JS 122 → 110 KB gzipped, CSS 27.7 → 24.3 KB gzipped.
- iOS: Today caches its date scan, tasks and agenda and rebuilds them 0.4 s after edits stop (`rederive()`); Calendar's week dots come from one lookup; `Rich.plain` skips the Markdown parser for plain text; `Item.preview` stops at the first usable line. Removed unused `PageSection`/`Row`/`EventRow`.
- Chat (web): the add-event/note format (`ACT_GUIDE`) is only sent when the message asks to add/create/write something (`wantsAction`). Its examples are `<placeholders>` because small models copied the old sample values. Earlier replies go back without their action lines, the prompt now lists open tasks and recent items, events already on the calendar aren't offered again, and replies cap at 600 tokens.

- iOS layout: no tab bar. iPhone uses the same sidebar layout as iPad (`PadRoot`); it opens on Home, Back shows the sidebar. The only bottom control is Home's Ask pill + new-note button. Calendar adds events through one field (+ opens the full form). `PhoneRoot`, `CaptureSheet`, `Tabs` and `Router.tab/editing` were removed. The user explicitly doesn't want the bottom bar back.
- Chat prompt is built once per conversation (stable system prompt, date only), and per-turn extras ride on the user message, so WebLLM reuses its KV cache instead of re-reading everything each turn.

## Open follow-ups
- Sign-in (Google Drive, GitHub) only works on the Vite dev server (`server/oauth.ts`). It needs a Pages Function or Worker before public launch; DEPLOY.md explains.
- The phone editor toolbar shows about 8 icons, which may count as clutter.
- Not verified: iPad layout, EventKit on a real device, the deployed relay.

## iOS simplification (Nov 14)
- iPhone: no tab bar. A drawer (≤300pt, not full width) opens from the ☰ button on every root screen. iPad keeps the split view.
- Home on iPhone: the date is the title, panels have no cards or headers' icons, 3 tasks then "Show all", ✨ in the toolbar plans the day. Tapping the selected day in the week strip opens Calendar.
- Lists: one plain list (pinned first), no folder chips or date headings, search only past 8 items. Rows are title + preview (if any) + a small date.
- Note editor: one ⋯ menu (sketch, emoji, item actions). Recordings: the Transcript/Notes switch shows only once there's a transcript.
- Nov 14, later: the iPhone menu is a sidebar beside the page (the page slides right and stays visible; swipe in from the left edge or tap ☰). Search is a sidebar row. The bottom of every screen is one chat bar (`BottomBar` in MonolithApp.swift); sending opens `ChatView`, a running conversation that passes the last two exchanges for follow-ups. The bar hides while you type in a note or doc. Home's own Ask pill and new-note button are gone.
- Nov 14, ChatGPT-style pass (from Mobbin's current ChatGPT iOS screens): dark mode is true black (`Theme.paper` 0x000000; web tokens unchanged). Sidebar = title + glass search/settings pill, icon rows, Folders, plain-text Recents, white "New note" pill. Bottom bar = glass + menu (new note/doc/recording) beside a glass "Ask Monolith" field over a fade (`Fog`). Chat = your message in a bubble on the right, answer as plain text with a copy button, model name as title.
- Local models: the app already runs MLX (mlx-swift-lm), same stack as Locally AI. Worth adding LFM 2.5 1.2B 4-bit as the fast default (reported ~60 tok/s on iPhone 17 Pro) and streaming tokens into ChatView instead of waiting for the full answer.
- Nov 14, LFM3: Liquid AI's LFM3-1.7B (`LiquidAI/LFM3-1.7B-MLX-4bit`, ~1 GB) is now the iOS Default tier; Gemma 4 E2B moved to More models. mlx-swift-lm 3.32.3 has no LFM3, so `apple/iOS/LFM3.swift` carries the model (adapted from mlx-swift-lm PR #750) and registers `lfm3` before the first load. Delete it once a release with LFM3 is out and at least two weeks old, then bump the package. Answers now stream: `OpenModels.respond` and `Assistant.ask(_:context:onText:)` pass the text so far, and Chat shows it word by word (`<think>` blocks are hidden while streaming). Built only: MLX doesn't run in the Simulator, so LFM3 still needs a first run on a real iPhone.

## Notes merged into Docs + compact screens (Nov 14)
- One kind now: **Docs**. `note` is kept only as a legacy value.
  - iOS: `Storage.mergeNotesIntoDocs` runs at launch, and `Item.kind` reads note as doc.
  - Web: persist v8 migration; sync (`link.ts`, `Linker.swift`) converts incoming notes.
- iOS: `DocsView(folder:)` replaces the separate Notes and Docs lists, and folders open a filtered DocsView. The sidebar shows Home, Docs, Recordings, Calendar, Folders and Recents.
- Web: a single Docs row. Folders filter the doc tree, every local doc gets the folder and checklist tools, and ⌘N makes a doc.
- Compact screens on iOS: `.compactList()` (40pt rows, plain list, inline titles) and one-line `ItemRow`. Home is just Coming up, Tasks (3) and Recent (5).
- Leftover: dead `kind === 'note'` branches in `src/views/ItemList.tsx` (harmless).

## iOS feel pass (Nov 14, later)
- **No dividing lines.** Rows are separated by height and spacing. Tappable Home rows use `.buttonStyle(.row)` (`RowPressStyle` in Theme.swift), a soft press wash like the web's hover.
- **Icons match web (lucide):**
  - Home: square.grid.2x2.
  - Recordings: mic.
  - Calendars: square.3.layers.3d.
  - Checklists: square / checkmark.square.fill.
  - Doc favourites: star (`Item.pinSymbol` / `pinLabel`); recordings keep pin.
- **Home:**
  - One 20pt icon column across all sections.
  - The date suggestion reads "Add “X” to your calendar?" with the day and time; tapping the row adds it.
  - Tasks: the box checks, with a 1.5s pause so a second tap undoes it; the words open the doc.
- **Calendar:**
  - The quick-add field is gone, and the week strip is pinned above the list (fixes the gap).
  - On Calendar the bottom bar reads "Add an event or ask". A dated line that isn't a question becomes an event, with an Undo toast.
  - The + menu has New event (`Router.createEvent`).
- **Friction still seen, not fixed:**
  - About 5s of black screen on cold launch.
  - The seed task says "Lectures tab".
  - Three New doc controls (sidebar, Docs toolbar, + menu).
  - The date suggestion repeats a task's text.

## Web drives iOS: menus, options and feedback (Nov 14, later still)
- **`Feedback.swift` (new; added to project.pbxproj next to LFM3.swift):**
  - `Toaster.shared`: web-style toasts with Undo, shown above the bottom bar.
  - `Item.trash()`: "Doc moved to Recently Deleted · Undo".
  - `Item.toggleFavorite()`.
  - `Speaker`: the web's Listen button, via AVSpeechSynthesizer.
- **`ItemMenu` follows the web doc menu's order:** Add sub-doc, Add to favorites, then Move to (an inline picker with a check, shown when folders exist), Copy as Markdown, Export Markdown, then Delete in red.
- **Doc header:** Listen, star and ···, as on web. The ··· menu adds Add emoji, Sketch and Uncheck all, and leaves out favourites because the star covers it.
- **Bottom bar:**
  - Inside a doc it reads "Ask about “Title”", and the chat gets that doc as context (`ChatView(about:)`, `Router.reading`).
  - On Calendar it reads "Add an event or ask".
- **All deletes go through `trash()`** (swipes and menus), so every delete can be undone.
- **Recordings, Calendar and + menus now follow web too:**
  - The recording ··· menu has Record again, Transcribe again and Use an audio file (fileImporter, copies the file into Storage.audio, then transcribes), then Pin to top and Delete.
  - Recording rows: Pin to top and Delete (Copy and Export are for docs only).
  - Event long-press: a Color picker (dots drawn by `EventColor.dot`, because menus tint symbols) and Delete event, which shows Undo through `Event.trash(ctx)`.
  - The event editor is in web's order: title, All-day, Starts, Ends, Location, colour, Notes, Linked (Notes / Recording buttons that create and open a linked item), Delete event.
  - All-day events show their last day as the end, as on web.
  - The + menu is Doc, Record and Event with web's hints. Record starts recording straight away.
- **Blank docs are dropped** when you leave them, and at launch (`Storage.dropBlankDocs`), skipping docs with sub-docs.
- **Icons from web, dialogs with clear options (iOS, iPad):**
  - Icons follow lucide:
    - Export = Download (`square.and.arrow.down`); Use an audio file = Upload.
    - Recover = RotateCcw (`arrow.counterclockwise`); Sketch = PenLine (`pencil.line`).
    - Drawer button = PanelLeft (`sidebar.left`); Event = CalendarPlus.
    - Link screen: Laptop, Moon, Check and CircleAlert.
    - iPad Daily plan = Sparkles.
    - Watch already matched (mic, stop).
  - The iPad + menu matches iPhone: Doc, Record and Event, with hints.
  - Recently Deleted:
    - Long-press offers Recover or Delete forever.
    - Swipe: Recover leading, Delete forever trailing (no full swipe).
    - Delete forever asks web's "Delete this doc forever? This can't be undone."
    - No lines, and a one-line hint.
  - Folders (drawer and iPad sidebar), on long-press:
    - New doc.
    - Delete folder, which confirms with "Its N docs stay in Docs. Nothing is deleted." and gives Undo.
  - The doc menu's Move to folder is a submenu. The editor ··· gains Move checked to bottom (`MD.checkedLast`).
  - Home Recent rows and drawer Recents now have the doc menu on long-press.
  - New folder / Link alerts disable the main button until something is typed.
  - Mic-off error offers Open Settings / Not now.
- **iPhone Home, AI-first:**
  - **Assistant card on top** (`Theme.card`, radius 26). It is the one place the assistant speaks on Home, and shows one of:
    - A date suggestion: title, full date, a source chip with the doc title and the exact quoted line (tap opens the doc), and **Add to calendar** / **Not now**. Both give a toast with Undo, and Undo restores the suggestion.
    - Plan your day: a button, then the plan with Done.
    - The error, with Try again / Dismiss.
  - The Plan button left the toolbar. `Suggestion` now carries `itemID` and `line`.
  - A task the card is already asking about is hidden from Tasks.
  - Today, Tasks and Recent are rounded cards (radius 22) with 50pt rows and 26pt between sections. Events show a colour dot instead of a bar.
  - Recent shows 5, then **See all** (`AllRecentsView`). The drawer's Recents also show 5, then See all, which opens a half sheet.
  - Toasts with Undo last 6s. Home has 110pt bottom padding so the last row clears the Ask bar.
- **Bottom bar and chat:**
  - `ChatField`:
    - 48pt tall to match the + button.
    - Send appears only when there's text, and becomes Stop while an answer is written (`stop:`). Stop used to be disabled.
  - `Fog` is fully opaque by the field and ignores only the container safe area, so it no longer slides behind the keyboard.
  - `ChatView`:
    - Title is "Ask Monolith" (or the doc's name), with the model as a subtitle.
    - Turns are a `Turn` struct, and each keeps the docs it actually matched as **Sources** chips (tap to open).
    - Answer actions follow web's AI panel: Copy, plus "Add to doc" when asked from a doc or "Save as doc" otherwise (toast with Open).
    - "Thinking" pulses while waiting; errors show as a quiet ⓘ line; answers are selectable.

## Web UI rework, pass 1 (Nov 15)
- **Home is AI-first, one column** (`src/views/HomeView.tsx`, `.hm-*` in `src/soft.css`; the old `.home-panel`, `.nudge`, `.week-strip`/`.ws-*` and `.soft-row` rules are gone):
  - Greeting + date, then one assistant card: a calendar suggestion with its date, the source doc and the quoted line (tap opens the doc) and **Add to calendar** / **Not now**; or the plan; or "Plan your day" when a model is ready.
  - Both choices show a toast with Undo. Undo removes the event and brings the suggestion back.
  - `Suggestion.found` (`src/types.ts`) carries what/when/doc/line and `add()`, which returns the new event's id. `findDatedCommitments` now returns the `line` it matched.
  - A task the card is asking about is hidden from Tasks.
  - Today: a seven-day row; pick a day to list its events, pick it again or "Open calendar" to open it. Tasks: the box checks (toast with Undo), the words open the doc; 5 then "Show all N". Recent: 5 then "See all" (opens Docs); right-click gives the doc menu.
  - The page fades out under the Ask bar (`.home-dock::before`), except on Calendar.
- **Notifications are pills in the upper right** on the raised surface, not white bars at the bottom (user request). Web: `.toaster`/`.toast` now live only in `src/index.css`. iOS: `ToastView` is a capsule shown from a `.topTrailing` overlay in `BottomBar` (seen working in the iPhone 17 simulator; iPad not checked).
- **Empty states** share `.blank`: Recordings (with the one Start recording button; the header mic shows only once there are recordings), Recently Deleted, and "No doc open" (New doc ⌘N).
- iOS starter task no longer says "Lectures tab".

- **`DESIGN.md`** (new, project root) records the UI foundations: principles, colour, type, shape, components, writing and which screens follow them. Update it whenever a pattern is settled.
- Simulator note (Nov 15): while testing the pill, two test docs (“Clean test…”, “Secon test”) were moved to Recently Deleted in the iPhone 17 simulator and not recovered, because injected taps were arriving one step late. Recover them from Docs → ··· → Recently Deleted.

## iOS roomier layout + Integrations (Nov 15, pass 2)
- **Spacing tokens** (`Space` in `apple/iOS/Theme.swift`): page 20, section 32, card 18, row 54. Home, Docs/Recordings lists and the drawer use them; the drawer is min(310, 80%) wide with 50pt rows and a fixed 24pt icon column so labels line up.
- **`Theme.tile`**: a fill that shows on a card (white 7% / black 4.5%). Use it for icon tiles and status rows inside cards; `Theme.wash` is too close to `Theme.card` to read.
- **Switches are tinted `Theme.local` (green).** The app tint is `.primary` (white), which hid the knob on an "on" switch. Applies to Integrations and the All-day switch.
- **Integrations** (`apple/iOS/Integrations.swift`, sidebar row after Calendar on iPhone and iPad):
  - Four switches, all off by default: Location, Weather (WeatherKit), Maps (travel time to the next event that has a place, MapKit), Location history (CoreLocation visits, needs "Always").
  - Each card shows what it knows now ("Near San Francisco, CA", forecast, "leave by", places this week) or why not.
  - Turning on anything that needs location asks for permission then; history asks for "Always" after "While Using". The "needs Always" message and its Open Settings button live in the history card, and are held back while the system prompt is open. A full "no" gets one notice at the top.
  - Places are saved only on the phone (`Application Support/visits.json`, file protection, 30 days / 500 entries). See places / Clear history (confirms, can't be undone).
  - `Integrations.shared.context` is added to chat; Home shows the weather beside "Calendar" and a "Leave by" row.
- **Signing:** `DEVELOPMENT_TEAM` (422K9C2579) is now in `apple/project.yml`; regenerating with xcodegen used to drop it. The entitlements add `com.apple.developer.weatherkit`. **WeatherKit needs that capability on the App ID** (automatic signing adds it on a device build). Until then, Weather shows "Weather isn't available right now", which is what the simulator shows.
- Tested in the iPhone 17 simulator (location set to San Francisco): permission prompts with our wording, Location, Weather (unavailable as above), Maps (no event with a place yet), history with Always. Not checked: a real trip time, a recorded visit, iPad, light mode.
- **Home's "Today" section is now "Calendar"** (user request; briefly "Up next"), on iOS (iPhone and iPad) and web. Empty text: "Nothing coming up". Day buttons in the week row still say "Today". Web's link beside it now says "Open".
- **"Plan my day" is gone** (user: too rigid, "the app needs to be more flexible"). The assistant card now offers up to three **starting points** built from the day (next event, open tasks, last doc). Each opens chat with that question already sent. Web: `ask()` sets `askDraft` + `aiOpen`; iOS: `Router.ask`, which `BottomBar` turns into the chat sheet. The brief code (`makeBrief`, `planDay`, `.hm-asst .md`) is deleted. iPad Home shows the same card; its schedule panel no longer repeats the suggestion.
- iOS chat context now includes up to 12 open tasks, so task questions get real answers.
- **No sparkles anywhere** (user: "reads too AI"). The assistant card's role is words only. Elsewhere: Ask bar, command palette, phone menu and editor "Ask AI" use `MessageCircle`; Write notes and Continue writing use a pen (`PenLine` / `square.and.pencil`); AI panel insights use `Lightbulb` (the `'sparkles'` icon key in `types.ts` now draws a lightbulb); iOS chat's "Thinking" is text only.
- **Calendar rows show title, place and start/end** on Home (web `.hm-ev`/`.hm-ev-time`, iOS `eventRow`). Checked on web with a test "Lab meeting · Science Hall 204, 2:15–3:15 PM" event added through the Calendar UI on :5210 (still there), and on iPhone with an event that has no place. iOS with a place and iPad are not checked.
- **Event colour is a side bar, not a dot** (web `.hm-bar`, iOS `eventRow` with `.fixedSize(vertical:)` so the bar matches the text height). Checked on web :5210 and iPhone.

## First-time setup, passcode lock, personal greeting (Nov 15, pass 3)
- **Web setup** (`src/components/Setup.tsx`, styles `.su-*` in `soft.css`): name, then storage (folder via File System Access, greyed out with a reason where unsupported; or this browser) and an optional passcode. Shown when `settings.setupAt === null`. The v9 migration marks existing installs as set up (`setupAt: 1`), so :5199 and :5210 never see it. Settings › You has the name; Settings › Storage › the lock row reopens step 2 (`setupOpen: 1`).
- **Folder as home**: `settings.home` is the folder source new docs go to (`createItem` adds `sourceId` + `file`).
- **Passcode** (`src/lib/vault.ts`): PBKDF2-SHA256 (600k) → AES-256-GCM key, memory only; a reload locks. Encrypts the persisted store (`idbStorage` waits on `vaultReady`), recorded audio, and files written to a connected folder (with a header comment line). Files Monolith never wrote stay as they are; turning it off or changing it rewrites only the files it encrypted (`rewriteSealedFiles`). No recovery by design.
- **Tested on web** at `http://setup.localhost:5210` (its own empty storage): setup → Home "Late night, Nico"; data stored as `monolith:sealed:v1:…`; reload shows the lock screen; a wrong passcode is rejected; the right one restores everything; turning the lock off stores plain data again. The throwaway passcode was `monolith-test`. **Not tested:** picking a real folder (a system dialog), the encrypted folder files, the greyed-out folder option in Safari/Firefox.
- **iOS** (`apple/iOS/Setup.swift`): `Profile` keys, `Greeting`, `AppLock`, `LockScreen`, `SetupView`, `YouSection` (Settings). Setup shows in place of the app while `setupAt == 0`; `markExistingInstall` sets it to 1 for databases that already had items. Home shows the greeting on iPhone and iPad. **Not verified:** the Face ID lock. The simulator never completed the prompt, so the switch stayed off. There's no "folder in Files" option on iOS; storage is on-device, and the computer links to it.
- Simulator note: `simctl spawn defaults write` doesn't reach the app's prefs. Edit `<data container>/Library/Preferences/com.socratic.app.plist` with `plutil` while the app is stopped.

## Workspace backup file (Nov 15, pass 4)
- `src/lib/backup.ts` + `src/components/BackupDialog.tsx`. File: `MONOLITH-BACKUP 1\n` + a plain header line (KDF params, created, counts) + AES-256-GCM(gzip(JSON)). The key is PBKDF2-SHA256 at 600k iterations from the backup password (8+ characters). It holds items (folder docs become plain docs), folders, events, settings (minus `home`/`setupAt`), dismissed suggestions, and recording audio as base64. Linked phones, connected sources and the passcode lock are left out on purpose: they're tied to the device.
- Restore replaces local items, events, folders and settings, but keeps docs from connected sources and this browser's lock. `settings.lastBackup` drives the "Last backed up" line.
- Entry points: Settings › Storage › Backup file (Back up / Restore), and the setup step 2 "Restore from a backup" link.
- **Tested** on `setup.localhost:5210`: backup → wipe → Restore dialog (file injected with DataTransfer) → wrong password rejected → right one (`backup-test-1`) restores the name and doc, and survives a reload. **Not tested:** a real download/file picker, recordings with audio, a large workspace (it's all in memory at once), the setup link.
- Gotcha: in the preview, `import('/src/store.ts')` can give a *second* store instance after HMR (the app loads `store.ts?t=…`). Check `performance.getEntriesByType('resource')` for the URL the app uses. On the throwaway origin the stray instance overwrote test data; never do this on :5199/:5210.

## Assistant: speed, accuracy, actions, web integrations (Nov 15, pass 5)
**Speed**
- `background()` in `src/ai/llm.ts`: page insights run in a background lane that is stopped (and anything queued dropped) the moment someone asks something via `enqueue()`. Before, a question could wait behind a 220-token insight run.
- Chat no longer pastes the open page (up to 6,000 chars) into the system prompt. `relevant()` in `src/ai/context.ts` picks ≤6 passages (~3,200 chars) per question from *all* docs and recordings (IDF-weighted word match; title, named-doc and open-doc boosts; a short open doc is sent whole). Passages ride on the user message, so the shared prefix (rules, dates, calendar, tasks) stays identical across turns and WebLLM reuses its KV cache. Passages already sent in this conversation aren't sent again.
- `src/ai/instant.ts`: schedule/next/tasks questions answered from data with no model. Tested phrasings are in the Nov 15 transcript; the regexes are deliberately narrow.
- Temperature 0.3 for chat, 500 tokens (800 when it's doing something).

**Accuracy**
- `CHAT_RULES` + `sharedContext()`: a 14-day **Dates** lookup ("tomorrow: Monday 2026-11-16"), current time and time zone, calendar with ISO dates and locations, open tasks with their doc. The old prompt said both "use Markdown" and "answer in plain text"; fixed.
- iOS gets the same rules and Dates list (`Assistant.instructions`, `Assistant.dates`, `Assistant.day` in `Intelligence.swift`); the chat context now puts short exact things first so the 9,000-char trim cuts the workspace, not the calendar, and the question goes last.

**Actions** (`src/ai/act.ts`): `@move`, `@cancel`, `@task`, `@done` join `@event`/`@doc`. Events are matched by title (never subscribed calendars), tasks by text. Acts are resolved once when the answer finishes and kept in `meta`, so a moved event remembers where it was. `perform()` returns an undo; the toast offers it. `@task` goes to the open doc, else a doc called "Tasks" (created if needed). Editing the open doc goes through the editor (`setContent`/`insertContent`), since the editor doesn't follow the store.

**Web integrations** (`src/lib/integrations.ts`, Settings › Integrations): Location (BigDataCloud reverse geocode, rounded to 2 decimals) and Weather (Open-Meteo). `settings.integrations`. Context line matches iOS. Refreshed at most every 10 min; a new conversation waits ≤1.5s for it.

**Also fixed**: the calendar's month cell class `.md` collided with chat answers (`.md`), giving every answer `min-height: 96px` and borders. Scoped to `.month > .md`. Web switches were invisible on modals (track = background, "on" = near-white accent); now match setup's.

**Found while testing with Gemma 4 E2B, and fixed**
- It put "Tuesday" (said on Sunday) on the Tuesday of the following week, even with the Dates list. `pinToAsked()` in `act.ts` now reads the day (and time, if given) from the request with the quick-add parser and pins the action to it; "from Monday to Wednesday" reads after the last "to"; relative requests ("an hour later") are left to the model. The Dates list no longer says "next Tuesday" for the second week, since quick add reads "next Tuesday" as the coming one.
- After an action turn it echoed a plain question back. The action instructions in earlier user turns were still steering it. Past turns now drop `ACT_GUIDE`, and card-only answers appear in history as "Offered: Move “…” (…)". This costs a KV-cache miss after action turns, which is worth it.
- Action replies are card-only (the model writes only the `@` lines): fewer tokens, and nothing said twice.
- Retrying an answer kept the old card's "done" state; it's reset now. Undo toasts last 8s (4s was too short to reach).
- Timings in the hidden preview pane (throttled, so worst case): first word 3–5.5s, full answer 8–11s, ~1,150-char shared context.

**Tested** (setup.localhost:5210): with the model: move (right day after the guard), add task (creates "Tasks"), check off → the open editor updates → Undo restores it, a question with no answer in the data. Without it: instant answers (20 phrasings, in page), quick-add card → Add → toast Undo removes it, sources pill, Settings switches, both lookup APIs answer from the browser with a fixed London coordinate. **Not tested**: turning Location on with a real position (it would send this machine's location), `@cancel` from a real model, answers that draw on doc passages (this test origin has almost no docs), other models (Fast/Enhanced, MLX, Ollama), iOS chat in the simulator (it builds).

## Quick-add parser rewrite (Nov 15, pass 6)
- `src/lib/dates.ts` `parseQuickEvent` rewritten: phrases are read and cut out one kind at a time (due-words, length, day, part of day, time or range, place); the rest is the title. New: `due` flag, `location`, ranges (3-5pm, from 2 to 4, 11-1pm), 24-hour times, ordinals (the 21st), "21 Nov", ISO dates, "in 3 days", "day after tomorrow", weekends, "Friday next week", parts of day (tomorrow morning → 9 AM), noon/midnight/EOD ("due Friday at midnight" = start of Saturday), typos (tmrw, tommorow), "SAT" the exam, evening plans default PM. Exports `eventColor`, `whenLabel`, `nextWeek`.
- All callers use them: Ask bar, command palette, assistant quick add and `pinToAsked`, doc suggestions. The doc scanner no longer splits clauses on the colon inside "11:59pm" (it was reading "by 11").
- "Next week" in instant answers now means Sunday–Saturday of next week, the same as the parser.
- iOS: `apple/iOS/QuickAdd.swift` is a step-for-step port (the old NSDataDetector version left "due", "at", "on" in titles). It sets `allDay`, `location` and the rose colour. The iOS Dates list for the assistant now uses the same labels as the web.
- **Tested**: `npm run test:dates`, 77/77 (69 phrasings + 8 that must not be events). The same cases compiled against the Swift file with `swiftc`: 77/77. In the web app: the Ask bar preview, the toast, and the rose 9 PM event for "math 19a homework due tomorrow 9pm". **Not tested**: iOS quick add in the simulator (it builds); non-US date order (11/12 is read as Nov 12).

## Review fixes (Nov 15, cloud session)
A review of the Nov 15 commit found these; all fixed.
- **Passcode lock can no longer lose data** (`src/lib/vault.ts`). The data is now encrypted with a random data key, and the passcode only wraps that key (record `{ v: 2, salt, iter, wrapped }`). Changing the passcode rewrites that one record and nothing else, so nothing is re-encrypted. Turning the lock off writes everything readable first (`clearPasscode(resave)`: writes plain, reads still decrypt), and deletes the record only if that worked, so a crash or failure leaves the lock on with every file readable. v1 records (passcode-derived key) are upgraded on unlock without touching the data.
- `saveNow()` now rejects when the write fails. It used to swallow errors (`store.ts`).
- Turning the lock off asks for folder access first (`folderAccess()` in `sync.ts`) and refuses with a clear message if a folder can't be reached. `rewriteSealedFiles` re-checks the files afterwards and throws if any are still encrypted. It used to skip unreachable folders silently.
- **Backup:** sub-folders of a connected folder come along as plain parent docs, so restored docs keep their tree. Restoring while a source is still connected skips the backup's copies of its docs instead of doubling them (same ids). "Last backed up" is recorded only after the file is written; where `showSaveFilePicker` exists the save dialog opens first, so a cancel doesn't count.
- **Insights:** a background run stopped by a question used to resolve with half a sentence, which showed as an insight. `background()` now rejects when it was stopped.
- **`wantsAction`** (`act.ts`) needs the verb to be the request ("move my 3pm…", "can you add…", "I'm done with…"), so "Help me with “Finish essay intro”" or "how do I complete the lab?" get a real answer instead of the card-only action format.
- **Quick add (web and iOS):** "thus" no longer reads as Thursday (short weekday forms take no "s"); "sun" counts as Sunday only before a date, a comma or full stop, or at the end; "read chapters 3-5 tonight" is chapters 3-5 at 8 PM, not 3–5 PM; "the 31st" in November is Dec 31, not Dec 1. 9 new cases in `scripts/test-dates.ts` (86/86).
- **iOS chat:** switching between an open model and Apple's model mid-chat now starts the conversation over, so the new model gets the Dates, calendar and tasks.
- **Tested:** typecheck, lint, build, `npm run test:dates`; the vault in Chromium on a throwaway origin (22 checks: lock, reload, wrong/right passcode, change without re-encrypting, failed and successful turn-off, v1 upgrade); the app loads on a fresh origin. **Not tested:** the Swift changes (`QuickAdd.swift`, `Intelligence.swift`) weren't compiled, since that session had no Xcode; run the 86 cases against Swift as before. Not tried: the setup screen's lock flows by hand, a real folder, the save dialog.

## The website (Nov 15, cloud session)
The user: "online" means **the app accessed on a website, with all tools local** (no cloud models). In-browser engines (WebLLM, Transformers.js) already worked from any https site. What only worked on the dev server, now fixed:
- **GitHub sign-in** on Cloudflare Pages: `functions/api/config.ts` and `functions/api/github/token.ts`, sharing `server/auth.ts` with the dev server (`server/oauth.ts` now calls it). Secrets go in the Pages project; steps in `relay/DEPLOY.md`. Tested with `wrangler pages dev dist`: `/api/config` answers, `/api/github/token` rejects a missing code and passes a code through to GitHub.
- **Ollama / MLX on the visitor's computer** (`src/ai/llm.ts`): behind the dev proxy as before (`/local/…`); elsewhere straight to `http://localhost:11434` / `:8080/v1`, using whichever answers with JSON (a hosted site returns `index.html` for `/local/…`). The hosted site never probes on its own, because Chrome may ask about local network access. Settings › Assistant has **Use a model already on this computer** (`LocalEngines`, sets `settings.localEngines`), then it's checked on every visit. If nothing's found it shows `OLLAMA_ORIGINS=<origin> ollama serve`. Tested on a simulated hosted origin with a fake Ollama that enforces origins: 0 requests before the click, found after, checked again after reload. Not tested: real Ollama/MLX, Chrome's permission prompt (it needs a public https origin), Safari.
- `public/_headers` (sw.js uncached, `/assets/*` immutable). A build without `VITE_RELAY_URL` prints a warning.
- Settings: the selected model tile had dark text on the dark popup fill (`.modal .tier.on` set the fill but kept `.tier.on`'s `color: var(--bg)`). Fixed in place.
- Noticed, not fixed: on a fresh install, ⌘, opens Settings underneath the first-time setup screen.
- **Still open from the paused model survey:** the local agent's research on the newest in-browser/iOS models and speech wasn't saved. With "all local" settled, the remaining question is which in-browser models to offer, not whether to add hosted ones.
- **Later the same day, the user: "Ollama should not be used by users. Everything should be simple and managed by Monolith."** Ollama and the `mlx_lm.server` route are gone from the web app: detection, the `/local/…` dev proxy, the Settings rows and button, the `provider`/`ollamaModel`/`localEngines` settings (v10 migration drops them; checked on a v9 install with Ollama picked), and the chat branches. `chooseModel(id)` now takes a model id; `isReady()` is just the in-browser model's status. The web app runs only models it downloads and caches itself. The iOS app's MLX runs inside the app, so it stays. Don't add engines people have to install or run themselves.

## Model line-up: smaller, faster, more versatile (Nov 15, cloud session)
User asked for "smaller, faster, more versatile models". All tiers are now ≤2B and the same on web and iOS:
- **Fast:** Qwen 3.5 0.8B (WebLLM). **Default:** LFM 3 1.7B (Liquid AI, Oct 27 2026; best in class on IFEval, ~1.1 GB q4f16), through Transformers.js as `onnx:LFM3-1.7B` from `onnx-community/LFM3-1.7B-ONNX`; WebLLM has no LFM 3 (checked 0.2.86–0.2.88). **Enhanced:** Gemma 4 E2B (WebLLM). **More:** Qwen 3.5 2B, which is also Default's fallback.
- Removed: Qwen 3.5 4B / 9B, Qwen 3 8B, Phi 4 mini (web); Qwen 3.5 4B, Gemma 4 E4B, Qwen 3 8B, Qwen 3.5 9B (iOS). Their web downloads are deleted once at startup (`clearRetired`). iOS picks of removed models now resolve to Default instead of Apple's model; their files on iOS aren't cleaned up yet.
- `src/ai/llm.ts`: a model with `onnx` loads in Transformers.js even where WebLLM works; the other engine is unloaded first (one model in memory). If LFM 3 can't start, `onnxFailed` makes Default use Qwen 3.5 2B in WebLLM. A failed *download* (`isNetwork`) never triggers a fallback or marks an engine broken; it shows "The model couldn’t download…" instead. That also fixes the older behaviour where being offline flipped the whole tab to the backup engine.
- Firefox / no-WebLLM list: Qwen 3 0.6B, LFM 3 1.7B, LFM 2 1.2B (fallback). No Enhanced there; the tile says "Not on this device".
- **Tested** (headless Chromium with a software WebGPU, model hosts blocked or faked with `page.route`): tiers show Qwen 3.5 0.8B / LFM 3 1.7B / Gemma 4 E2B; with downloads cut, only LFM 3 is tried and nothing falls back; with junk downloads, LFM 3 → Qwen 3.5 2B (WebLLM) → backup engine, in order. **Not tested:** any model actually loading or answering, since huggingface.co is blocked in that session. Check in Chrome: LFM 3 loads and answers, chat streams, the switch to Fast/Enhanced (WebLLM) and back, and long prompts. Liquid's own ONNX card says WebGPU prefill must be chunked to ≤256 tokens; if long chats fail on LFM 3, that's the first suspect. iOS changes weren't compiled.
- **Licence:** LFM 3 uses the LFM Open License v1.0: free commercial use under $10M annual revenue (already true of the iOS app).

## Browser runtime: robustness pass (Nov 15, cloud session, later)
User asked for research on browser runtimes ("look at WiCi and webAI": read as the W3C WICG work, i.e. WebNN and Chrome's Prompt API, and Google's "Web AI" runtime LiteRT-LM; webAI the company makes installed desktop software, so it doesn't fit a site that needs no installs). Findings that changed the code:
- **LFM 3 is off the web.** In the browser it only runs through Transformers.js, whose `generate()` reads a prompt in one pass. A ~870-token single pass crashes Safari's GPU process on iPhone, the official ONNX export has no `num_logits_to_keep` (prefill memory grows with prompt length × vocabulary), and chunked prefill is only a feature request there. Monolith's chat prompts are ~1,300 tokens. iOS keeps LFM 3 (MLX, native).
- **Web tiers are all WebLLM now:** Fast Qwen 3.5 0.8B, Default Qwen 3.5 2B, Enhanced Gemma 4 E2B. WebLLM compiles its kernels, prefills in chunks, and keeps a chat's shared prefix cached between turns. Fallback engine (no WebLLM): Qwen 3 0.6B, LFM 2 1.2B; no Enhanced. The per-model engine code (`onnx` on a `MODELS` entry, `onnxFailed`) stays for later but nothing uses it now.
- **Bug fixed: long chats overflowed the window.** All three WebLLM builds have a 4,096-token window; chat sent up to 12 turns, each with up to 3,200 chars of passages (a 6-turn chat was ~10k tokens), so WebLLM threw `ContextWindowSizeExceededError` after a couple of follow-ups. `fit()` in `llm.ts` now keeps the system message and newest question, drops the oldest pairs, and, for one oversized message, keeps its opening paragraph and its end. If WebLLM still says it's too long, it retries at 60% of the window. 11 cases checked against the real function.
- **GPU loss recovers.** If a generate fails with a lost/destroyed device (sleep, driver reset, memory pressure), both engines are dropped, the same model reloads from cache, and the answer is tried once more. Not exercised for real (needs a real GPU).
- **Watch:** Google's LiteRT-LM (`@litert-lm/core`, Apache-2.0, 0.19.0 on Oct 30) reports Gemma 4 E2B at ~73 tok/s decode and ~4,850 tok/s prefill on an M4 Max (Google's numbers), with a stateful `Conversation` API and cancellation. It's an "early preview": text only, WebGPU only (no CPU), Gemma 4 models only, a ~24–37 MB wasm runtime, and the web model file is ~2.0 GB. Worth a real side-by-side against WebLLM for Enhanced once it leaves preview. WebNN (the only route to NPUs) is still behind a flag or origin trial in Chromium, absent from Safari and Firefox. Chrome's Prompt API is Chrome-managed, desktop-only, needs 22 GB free; not a fit for "managed by Monolith".
- Not pushed to `main` (user said no); branch only.
