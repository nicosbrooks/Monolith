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

## Gemma on LiteRT-LM (Nov 15, cloud session, last)
User: "LiteRT-LM with Gemma models seems great". Web tiers now: **Fast** Qwen 3.5 0.8B (WebLLM), **Default** Gemma 4 E2B and **Enhanced** Gemma 4 E4B (LiteRT-LM, `@litert-lm/core` 0.19.0, exact pin). Fallbacks if LiteRT-LM can't start: Qwen 3.5 2B and Gemma 4 E2B in WebLLM (`hidden` models, never listed). iOS unchanged (LFM 3 Default via MLX).
- `src/ai/litert.worker.ts`: LiteRT-LM in a module worker. Two shims were needed and are verified: LiteRT-LM loads its runtime with `importScripts`, which throws in module workers, so the worker replaces it with a sync XHR + global eval; and it sets `Module.locateFile` so the runtime finds its `.wasm` next to the script (otherwise it requests it from the worker's own origin and gets index.html).
- **Caching is ours:** LiteRT-LM's JS doesn't cache models ("Not supported in JS" in its source). `src/ai/litert-cache.ts` stores the model in OPFS; a marker with the size is written only after the whole file is stored, and a file is "cached" only if marker and size match. A Web Lock stops two tabs downloading at once. Incomplete downloads are deleted and count as network errors (no fallback). If the runtime says the stored file is invalid ("magic number", header), it's deleted so the next try re-downloads. `navigator.storage.persist()` is requested before the download. Once Gemma runs, the WebLLM fallback downloads are deleted (`clearFallbacks`).
- **Runtime files** load from `cdn.jsdelivr.net/npm/@litert-lm/core@0.19.0/wasm/` (LiteRT-LM's own default): the asyncify builds are ~37 MB, over Cloudflare Pages' 25 MiB per-file limit, so they can't be self-hosted there. `public/sw.js` caches them (`litert-runtime-v1`) for offline use.
- **Chat:** one LiteRT-LM `Conversation` per chat; if a request is the previous chat plus one new question, only the question is sent (the model keeps its state); otherwise a new conversation is made with the earlier messages as its preface. Window 4,096 tokens (`LITERT_WINDOW`), chats fitted with `fit()`. Stop calls `conversation.cancel()`.
- **Tested** (headless Chromium, software WebGPU, Hugging Face and the CDN stood in by Playwright routes serving the real runtime from node_modules): the runtime loads in the worker (JSPI build), the repo resolves, the model downloads once into OPFS with its marker, a reload doesn't download again, a fake model is rejected by the real runtime and deleted, the Default tier falls back to Qwen 3.5 2B, a cut-off download leaves nothing and doesn't fall back. **Not tested:** a real Gemma file loading and answering, speed, E4B's real size and memory, Safari/Firefox, gating of the litert-community repos (if gated, resolving fails and the tier falls back to WebLLM). First thing to check in Chrome: Default downloads (~2 GB), answers, a follow-up answers quickly (conversation reuse), Stop works, and Enhanced loads on a machine with enough memory.

## Testing pass (Nov 15, cloud session)
Ran the main flows in Chromium (desktop dark/light, iPhone 15 size, fake microphone): setup, Ctrl+N, Markdown shortcuts, checklists, Home tasks and date suggestion, ⌘K search, calendar quick add + Undo, month view, right-click menu, delete → Recently Deleted + Undo, Settings, Escape, focus outlines, recording, phone Home and doc. No page errors anywhere. Fixed:
- **Title swallowed the first keystrokes after Enter** ("Biology plan#" + a plain "Week 3" instead of a heading): Tiptap's `focus()` waits a frame. `DocView` now calls `view.focus()` first. Verified 3/3.
- **"Start recording" didn't record**: the empty-state button, the list's mic and ⌘K's "Start recording" only created an item ("Not recorded"); a second press was needed. `src/lib/recordNext.ts` flags the new item and `LectureView` starts on open. Verified: one press records, Stop saves audio.
- **Setup and the lock screen weren't modal**: Tab reached the sidebar behind them, and ⌘, opened Settings underneath. The app behind is now `inert` (`useInertBehind` in `Setup.tsx`; the backup dialog stays usable) and global shortcuts are ignored while `.su` is up.
- Calendar Ask bar still offered "Plan my day" (removed elsewhere at the user's request): now "What’s left today?".
- Measured: a 5.3 MB pasted JPEG is stored at full size (3000×2200) as 7.0 MB of base64 inside the doc; the whole workspace record (7 MB) is rewritten on every save (~80 ms read+parse+stringify on a fast desktop). Typing stayed smooth on desktop. This is the case for the separate file store (proposed to the user, not built yet).
Noted, not changed: notifications briefly cover the calendar's Thu–Sat day labels; the phone doc header shows a struck-through star for "Remove from favorites" (reads as "not a favorite").

## Files, and the UI/UX fixes (Nov 15, cloud session)
User: "implement all of those fixes" (the six from the UI/UX review).
1. **File store** (`src/lib/files.ts`, `image.worker.ts`, `components/editor/FileNode.ts`, `lib/fileUpkeep.ts`). Files live once in IndexedDB as `file:<sha256 prefix>` records `{ data, name, type, size, at }` (data sealed by the vault like audio; `resealAudio` now covers `file:` keys). Docs hold a Markdown image `![name](monolith-file:<hash>)`: pictures render as pictures, anything else as an attachment card (Open/Download). Pictures are resized in a worker to ≤2560 px WebP (JPEG where WebP can't be written; GIF/SVG kept). Slash menu: Image (pictures) and File (anything); drop/paste accept any file; 250 MB cap.
   - Migration and incoming pictures: the open doc's editor moves `data:` pictures into the store (`storeEmbedded` in Editor.tsx, not undoable); other local docs are handled in the background (`fileUpkeep.ts`, doesn't touch `updatedAt`). Unused files are removed a day after nothing refers to them (Recently Deleted still counts).
   - Phone sync (`link.ts toRec`), Markdown export and Copy as Markdown embed pictures as data (`inlineFiles`); attachments stay references (iOS shows "Open it on your computer"). Backups carry `files`; restore imports them before the docs.
   - Docs kept in a folder, GitHub or Drive are unchanged: pictures stay embedded, the File block is hidden (`NO_SKETCH` now excludes `file`). Writing assets as sibling files there is the follow-up.
   - Performance fixes found on the way: Tiptap's `getHTML()` built HTML in the page document (every picture started loading on every save), now an inert document (patch in `extensions.ts`); the Markdown converter draws pictures as nothing; task parsing in `util.ts`/`act.ts` uses inert `<template>`s instead of `<div>`s; `Editor` destroys its Tiptap editor before `EditorContent` unmounts (EditorContent would redraw without node views). Dev-only leftover: React StrictMode's simulated unmount still triggers one failed `monolith-file:` lookup per picture; production is clean (checked with `vite preview`).
   - Tested: 9.1 MB 4000×3000 photo → 2560×1920 WebP, workspace record stays 3 KB (was 7 MB with a 5 MB photo); PDF card, Download, reload, Markdown round trip (phone path), phone payload, export; migration of a v10 workspace with two embedded pictures (471 KB → 1 KB, one shared file, dates kept, open doc still shows it); vault on/off over files. Open in headless Chromium opens a tab but can't render PDFs; check in real Chrome.
2. **Phone Home:** the page fades out under the Ask bar and + (`.p-dock::before`); the scrolled header bar is opaque.
3. **Calendar notifications** sit below the day labels (`.app:has(.main.sec-calendar) .toaster`).
4. **Home** never suggests events from the sample docs (`SAMPLE_IDS` in store.ts: `welcome`, `doc-guide`).
5. **Labels:** a favourite shows a filled star (`aria-pressed`); Settings › Storage has a **Passcode** row (On/Off) and a **Change** button on the row where new docs go; sidebar titles wrap to two lines (hover buttons now `display: none` until hover/focus, `.nav.sub` min-height).
6. **Recordings like Docs:** listed in the sidebar under Recordings (`RecordingList`), with a + that starts recording; no list column on desktop (Recently Deleted keeps one); empty state has Start recording. `startRecording()` in `lib/recordNext.ts` is the one way to start.
Also: "Transcription failed: Failed to fetch" now reads "The speech model couldn’t download. Check your connection and try again."

## Compression, file controls, icons, alignment (Nov 15, cloud session, last)
User: compress uploads automatically (on by default, can be turned off), sound-wave icon for each recording, fix misaligned elements, give users more control.
- **Settings › Files** (`FilesSettings` in SettingsModal.tsx): *Make files smaller* (`settings.compressFiles`, unset = on); *Pictures* Small/Medium/Large = 1280/1920/2560 px (`pictureSize`, default large); *Recordings* Voice 32 kbps / High quality 96 kbps Opus (`recordingQuality`, default voice; passed to `MediaRecorder` in LectureView); storage used and saved, and *Clear unused* (`collectGarbage(htmls, true)`).
- **Lossless compression** (`putFile` in files.ts): when on, files that aren't already compressed (not image/audio/video/zip/Office/etc., >4 KB) are stored gzip-compressed if that saves ≥10%; record gets `gz: true`, `fileBlob` decompresses, so files come back byte for byte. Hash is of the original bytes. Compression off: pictures are stored exactly as added. Files already added are not re-compressed.
- **File cards** (FileNode.ts): icon by type (sound wave for audio, film, picture, document, archive, file), Open plus a ··· menu (Rename = the Markdown alt text, Open, Download, Remove); pictures get the same menu in their corner on hover. `insertFiles` now inserts all files at once (inserting one by one replaced each with the next, since an inserted node is selected).
- **Icons:** each recording uses `AudioWaveform` (sidebar, Home, ⌘K, Ask bar, calendar links). Mic stays on actions (Start recording, Recordings section).
- **Alignment** (measured, not eyeballed): sidebar row icons centred (`.nav .emoji` grid), folder icon 17 px like other rows (text at 61 px everywhere); recording view has a crumb in the bar and an editable large title in the content column like docs, and `.recorder.bare` once there's audio so Transcribe lines up with the player (all at the same left edge).
- **Tested:** CSV 162 KB → 30 KB stored, downloads identical; ZIP untouched; Large 2560 / Small 1280; compression off keeps the original JPEG; type icons; Rename; Remove; recording at 32 kbps; Settings screenshot; file, setup/flows and migration suites pass on fresh origins. One unexplained result: the migration test once reported the *open* doc's picture still embedded when run on an origin reused from an earlier run; it passed on a fresh origin, and the re-run was interrupted. Worth checking: open an old doc with an embedded picture after a previous session and confirm it converts.
- Not committed to `main`; branch `claude/inspiring-planck-9mqp4n` only. Not tested: iOS (not compiled), real PDF viewing, imported audio files aren't re-encoded (only new recordings use the quality setting).

## Speed and speech to text (Nov 15, pass 7)
Direction confirmed by the user: everything stays on-device (no cloud models). Priorities: speech to text, then model speed.
- **iOS model speed:** `Assistant.Conversation` (Intelligence.swift) keeps one MLX `ChatSession` / `LanguageModelSession` per chat, so follow-ups reuse the KV cache and only send the question plus newly relevant notes (dates/calendar/tasks are sent once). It resets at midnight, on model change, on stop/failure, and retries once with full material if a long chat overflows. `Assistant.warm()` runs when the Ask field gets focus: loads an already-downloaded open model (`OpenModels.onDevice`, remembered in UserDefaults; never starts a download) or calls `prewarm()` on Apple's model. Temperature 0.3.
- **iOS speech to text:** lectures use Apple's SpeechAnalyzer/SpeechTranscriber (iOS 26) when the language's model is installed (`LiveSpeech.transcriber()`; a supported but missing model starts downloading for next time). `Feeder` converts mic audio to the analyzer's format on the audio thread. One continuous stream, no one-minute restarts; sentence lines carry word times. Files (watch recordings) use it too. SFSpeechRecognizer remains the fallback. **Builds; not tested on a device** (needs a mic and real hardware).
- **Web speech to text:** `src/ai/stt.ts` + `stt.worker.ts` replace Whisper. Live transcription runs on the device while recording: audio is cut at pauses (adaptive noise floor, 0.5 s pause after 2 s, hard cut at 15 s at the quietest frame), each phrase is read by the model, and the phrase in progress is shown about once a second. The live lines *are* the transcript, so it's ready the moment recording stops (files still go through `transcribe`). Chrome's Web Speech captions were removed (they send audio to Google). Models: Moonshine Base (Fast, ≈100 MB, default) and Whisper Large v3 Turbo (Most accurate, ≈560 MB, 4-bit). The setting key is still `whisperModel`; `sttModel()` maps old Whisper ids to the default.
- **Measured** (hidden pane, throttled): Moonshine read a 14 s clip in 2.7 s warm; good punctuation and numbers, but misheard "eigenvalues". Parakeet CTC 0.6B (q4) took 0.3 s but outputs lowercase without punctuation and misheard words; its q4f16 build returned nothing, so it was dropped. **Whisper turbo was not yet measured** (the test was interrupted), and the live path has not been tried with a real microphone.
- **Web model runtime:** LiteRT-LM for Gemma 4 E2B was built in a parallel local session (`src/ai/litert.worker.ts`, `litert-cache.ts`); see "Local follow-up: smaller prompts and TurboQuant" below for its benchmark. Google's claimed web numbers: ~4,850 tok/s prefill / 73 tok/s decode on an M4 Max.
- Not done yet: Phonon on iOS (gradium-ai/xn-ptts Swift package), streaming read-aloud on web, FluidAudio Parakeet on iOS as an optional accurate model.

## Next steps (in priority order)
State at hand-off: all work is on `claude/inspiring-planck-9mqp4n` (last commit "Compress uploads by default…"). `main` is at "Remove Ollama and MLX-server support" (a318528). The user said not to push to `main` until they've tried it.

### 1. Verify on a real machine before merging to `main`
Nothing below could be checked in the cloud session (no real GPU, huggingface.co and the jsDelivr CDN blocked, no Xcode). Test on :5210 (never :5199, which holds the user's data).
- **Gemma on LiteRT-LM (Chrome):** pick Default (Gemma 4 E2B, ~2 GB download). Confirm: progress shows; it answers; a follow-up answers quickly (conversation reuse in `litert.worker.ts`); Stop works mid-answer; reload loads from OPFS without downloading (DevTools › Application › Storage › OPFS shows `litert-community__gemma-4-E2B-it-litert-lm.litertlm` + `.json` marker). Then Enhanced (Gemma 4 E4B) on a machine with ≥8 GB: note its real download size and memory, and adjust `needMB` (4400) in `llm.ts` if needed.
- **Gating:** if `resolveModel('hf://litert-community/gemma-4-E2B-it-litert-lm')` fails with 401/403, the repos are gated: the tiers fall back to WebLLM (Qwen 3.5 2B / Gemma 4 E2B). Then either host the `.litertlm` files ourselves (Cloudflare R2; Pages' 25 MiB file limit rules Pages out) or switch the Gemma tiers back to WebLLM.
- **Fallback path:** in Firefox and Safari, see what happens with LiteRT-LM (expected: fallback to WebLLM). Record which engine actually answered (`useAI.getState().loadedModel`).
- **Long chats:** ask 6+ follow-ups that pull in notes; they must keep answering (`fit()` keeps the window at 4,096 tokens).
- **GPU loss:** sleep the laptop mid-session, wake, ask again; it should reload the model from cache and answer (`gpuLost` in `chat()`).
- **Files:** paste a phone photo, drop a PDF, a CSV and a ZIP; Open the PDF (real Chrome shows it; headless couldn't); Download each; Rename/Remove from ···; reload; Settings › Files › Small, then off. Turn the passcode on and off with files present.
- **Migration on a used profile:** the one unexplained test result. Copy an older workspace (or use a profile from before the file store) with a doc that has an embedded picture, open that doc, wait a few seconds, check the stored doc HTML has `monolith-file:` and no `data:image`. If it stays embedded, debug `storeEmbedded` in `Editor.tsx` (the `storing` ref and the `exclude` closure from the first render are suspects).
- **Phone sync with files:** pair the iPhone, open a doc with a picture and an attachment on the phone (picture embedded; attachment shows "Open it on your computer"), edit it on the phone, confirm the web copy keeps its references (the background upkeep re-stores the picture, same hash).
- **iOS:** build in Xcode (`QuickAdd.swift` WEEKDAY/day-of-month/range changes, `Intelligence.swift` Conversation engine reset, `OpenModels.swift` tiers, `Markdown.swift` attachment label were never compiled). Run the 86 date cases against the Swift port, as before.
- When all of the above pass: merge the branch into `main` (fast-forward if `main` hasn't moved).

### 2. Files: finish the platform
- **Folder / GitHub / Drive docs:** they still embed pictures and can't hold attachments (sources store text only). Add a binary write to the providers (`FileProvider.write` takes text today; folder: `createWritable` with a Blob; GitHub: blob API with base64; Drive: multipart upload), write files to `assets/<hash>.<ext>` beside the doc, and convert `monolith-file:` references to relative Markdown links on write (and back on read). Then remove `'file'` from `NO_SKETCH` in `DocView.tsx`.
- **Sync files to the phone properly:** today pictures travel embedded in the Markdown (large payloads; every edit resends them) and attachments don't travel at all. Add a file channel to the relay protocol: send `monolith-file:` hashes the other side lacks, chunked and encrypted with the pairing key, deduplicated by hash. iOS then needs a file store (Application Support/files/<hash>) and the same reference format.
- **Adding files on iOS:** PhotosPicker + fileImporter into that store; same resize rules (`MAX_SIDE` by `pictureSize`), HEIC/JPEG output.
- **Imported audio** (recordings › Use an audio file) isn't compressed: decode with WebCodecs/AudioContext and re-encode to Opus at the chosen quality when it's large (WAV/AIFF/FLAC).
- **Video attachments:** no compression yet; consider an inline player in the card for audio/video instead of Open in a new tab.
- **Storage limits:** call `navigator.storage.estimate()` and warn in Settings › Files when near the quota; `collectGarbage` only removes unreferenced files.

### 3. Assistant
- **LiteRT-LM follow-ups:** `@litert-lm/core` is pinned at 0.19.0 ("early preview"). Watch for: vision/audio input (Gemma 4 can read pictures; would let the assistant look at stored pictures), a built-in cache (would replace `litert-cache.ts`), and a module-worker-friendly loader (would remove the `importScripts`/`Module.locateFile` shims in `litert.worker.ts`). Re-test speed against WebLLM for the Enhanced tier.
- **Conversation reuse misses:** `litert.worker.ts` reuses a conversation only if the new request is exactly the previous messages plus one question; AIPanel rewrites past turns (`said()` strips action lines), so action turns start a new conversation. Make the history the worker records match what AIPanel will send next.
- **Transformers.js fallback** (Firefox without WebLLM, no-GPU browsers) still reads prompts in one pass; it's capped at a 2,048-token window in `fit()`. If transformers.js ships chunked prefill (issue #1836), raise it.
- **The `ONNX_MODELS` list** still includes Qwen 3 0.6B and LFM 2 1.2B, untested since the Firefox 160 benchmarks.

### 4. UI/UX follow-ups seen but not done
- Phone Home: the greeting plus the assistant card fill the first screen; consider a smaller greeting on phones.
- The Ask bar's suggestion chips stay open after adding an event from it on Calendar (input keeps focus).
- Settings has grown long (You, Appearance, Phone, Storage, Files, Assistant, Speech…): consider grouping or a sidebar of sections.
- `DESIGN.md` › Coverage still lists Docs, editor, Recordings detail, Calendar and most of Settings as "not yet reviewed"; review them against the file now that the patterns are settled.
- Keyboard: setup traps focus correctly now; check the other dialogs (Backup, Link, Connect) the same way.

### 5. Before a public launch
- Deploy per `relay/DEPLOY.md`: relay Worker, Pages project with `VITE_RELAY_URL`, `GITHUB_CLIENT_ID`/`GOOGLE_CLIENT_ID` variables and `GITHUB_CLIENT_SECRET` secret; register the domain with GitHub and Google OAuth.
- LFM 3 licence (iOS Default): free only under $10M annual revenue (LFM Open License v1.0).
- Dev-only noise: React StrictMode's simulated unmount triggers one failed `monolith-file:` lookup per picture in the console; production is clean. Ignore, or move the destroy-before-unmount logic into Tiptap if it ever ships a fix.

## Local follow-up: smaller prompts and TurboQuant (Nov 15)

Local `main` was fast-forwarded to `origin/main` at `ce165a2`, which includes the earlier handoff changes. The web changes and benchmark below are local and uncommitted. Keep using the test origin on port **5210**. Port **5199** holds the user's data.

### What landed locally

- Web chat keeps a short, stable system prompt and selects workspace evidence for each turn. [Context and retrieval](src/ai/context.ts) split the full transcript into timestamped passages, reserve evidence for explicitly named docs, and pack whole entries to fit the engine's window. Earlier evidence is dropped from replay when its source changes. The source links reflect what was included in that turn.
- When a question specifies a duration, day, and a gap **between events**, Monolith calculates and returns a slot directly from the calendar. The model test found the correct noon slot but also suggested a slot after the last event. Moving a timed event now keeps its original duration unless the request specifies a new one. The model had shortened a two-hour seminar to one hour in both prompt variants. The audit covers both preserving the two hours and honoring an explicit 45-minute change. [Availability](src/ai/availability.ts) · [Action validation](src/ai/act.ts) · [Audit cases](scripts/assistant-cases.ts)
- Calendar's web Ask bar now sends dated questions to chat, matching iOS, and closes its suggestions after adding an event. Search stops after the four matches it can display. The Ask bar interactions still need a live UI pass.

### Web benchmark

With Vite serving the test origin, open `http://127.0.0.1:5210/scripts/assistant-benchmark.html`. **Run prompt audit** checks seven synthetic cases at 2,048 and 4,096 tokens without loading a model. **Compare on Fast** and **Compare on Default** run both prompt layouts and record what model and engine actually answered. The broad comparison uses the same retrieval with the larger workspace snapshot.

The full paired run used Gemma 4 E2B through LiteRT-LM in a visible, isolated macOS WebKit window. These are medians across seven cases with the model already loaded.

| Measure | Broad prompt | Focused prompt |
| --- | ---: | ---: |
| Time to first visible text | 1.21 s | 0.32 s |
| Full response | 1.98 s | 1.22 s |
| Estimated input tokens | 1,293 | 285 |
| Runtime context tokens after response, including output | 1,665 | 296 |

First text was faster in all seven pairs. A follow-up with a matching prefix reported reuse and first text in 98 ms. In one headless Firefox CPU pair, Qwen 3 0.6B gave the same correct transcript answer with first text at 239 s for broad and 13.5 s for focused. Treat that as one fallback case. WebKit Fast loaded Qwen 3.5 0.8B through WebLLM, then produced a disposed-object error or empty output. There is no valid Fast GPU timing or peak memory comparison. The web build, seven prompt cases at both window sizes, and all 86 web date cases passed. The earlier iPhone simulator build and all 86 Swift date cases also passed.

### Next steps

1. **Reproduce the web results in regular browser sessions.** Use the same fixtures on the Fast and Default tiers in Safari, Firefox, and Chrome where available. Investigate the WebKit Fast generation failure separately from prompt packing. Record which engine ran, model load versus warm response latency, answer failures, and peak memory where measurable. Also exercise Stop, reload from OPFS, and a chat long enough to evict earlier turns. Keep the synthetic A/B and the normal UI smoke tests on 5210.
2. **Trial TurboQuant on a real iPhone.** The pinned `mlx-swift-lm` 3.32.3 already exposes `KVCacheConfiguration(strategy: .turboQuant(.balanced))`. Try it in `OpenModels.session` with the same model, prompts, and generation settings in both runs. Compare against the default cache at several context lengths. Measure peak memory, first text, decode speed, and answer quality. Check which layers actually use the compressed cache, especially with the custom LFM3 model and Gemma's sliding-window layers. Keep the default cache available until the trial shows a benefit. [Pinned MLX release](https://github.com/ml-explore/mlx-swift-lm/releases/tag/3.32.3) · [MLX KV cache documentation](https://github.com/ml-explore/mlx-swift-lm/blob/main/Libraries/MLXLMCommon/Documentation.docc/kv-cache-quantization.md) · [TurboQuant paper](https://arxiv.org/abs/2504.19874)
3. **Keep TurboQuant separate from web prompt packing.** The pinned LiteRT-LM and WebLLM browser APIs expose no TurboQuant option that was found in this pass. Revisit when a supported browser runtime ships it. Shorter prompts reduce work before the first answer, while a compressed KV cache is primarily a way to lower memory pressure as a conversation grows. [LiteRT-LM tracking issue](https://github.com/google-ai-edge/LiteRT-LM/issues/1951)
4. **Extend context handling only where the fixtures show misses.** Port tested retrieval and budgeting to iOS using the same fixtures. On long web chats, track which excerpts are still in the retained window and retrieve them again when needed. When older chat turns need compaction, preserve goals, decisions, constraints, and unresolved questions with references back to the original turns. Record confirmed actions from app state. Keep learned compression and multi-pass reasoning as experiments gated by a measured gain in quality, latency, or memory.
5. **Keep experience changes within the existing flows.** For any Mobbin reference, identify what triggers the behavior, what happens next, and whether Monolith has the same need before adapting it. Share actual web and iPhone screenshots during UI work.

## Files in connected folders (Nov 15, cloud session)
Docs in a connected **folder** now hold pictures and attachments like local docs (GitHub and Drive still embed pictures and hide the File block).
- In Monolith the doc keeps `monolith-file:` references. On save (`flush` in `sync.ts`), `exportAssets` (`src/storage/assets.ts`) writes each file once into `assets/` beside the doc and the Markdown links it relatively: `![photo.jpg](assets/1a2b3c4d-photo.webp)` (8-char hash + readable name + the extension its content has). On read (`pull`), `importAssets` turns relative picture/file links into stored files and references. Folder files are written whole (decompressed), so other apps open them.
- A file that was already in the folder (an Obsidian vault's `assets/chart.png`) is linked where it is, never copied or renamed: `asset-places:<sourceId>` in IndexedDB maps content hash → path, filled on read and on write; a doc in another directory links the same file with `../` paths. Missing assets leave the link as it is.
- With the passcode lock on, the Markdown is encrypted, so files are not written out: the doc keeps references (readable only in this browser).
- Providers gained optional `readFile`/`writeFile` (`types.ts`); only `folderProvider` implements them. Next: the same for Drive (multipart upload) and GitHub (blobs in the commit), then drop `'file'` from `NO_SKETCH` for them.
- **Tested** with the real modules against a folder in the site's private storage (same File System Access API): read import, missing asset, web links untouched, write (WebP picture, whole PDF), no references left in the Markdown, round trip gives the same references, re-saving writes nothing new, existing files linked in place, cross-directory relative links. The full UI flow couldn't run here: in this cloud sandbox, reading an OPFS folder handle back from IndexedDB closes the page (both headless builds), so connecting a folder through setup wasn't exercised. Check in real Chrome: connect a folder, add a picture and a PDF to a doc in it, look at the folder in Finder, open it in Obsidian/VS Code, then edit the `.md` there and pull.

## System 1 / System 2 (Nov 15, cloud session)
User: a small "System 1" model like EmbeddingGemma, always on and efficient; the general model (System 2) takes most of the memory but loads in and out as needed.
- **System 1** = EmbeddingGemma 2 text 270M (`litert-community/embeddinggemma-2-text-270m-litert-lm`) on LiteRT-LM's `EmbeddingEngine`, in its own worker (`src/ai/embed.worker.ts`); prefers the CPU build (GPU stays for System 2), GPU build as fallback. Vectors: `normalize: true, outputSize: 256` (Matryoshka), stored as int8 + a per-vector scale (~260 bytes a passage) in IndexedDB `s1:<itemId>` (versioned by model + size) and in memory. `src/ai/system1.ts`: background indexing at idle, only docs whose text changed (hash), 8 passages per batch; same passages as `context.ts chunks()`, keyed `itemId#n`. EmbeddingGemma prompt formats (`title: … | text: …`, `task: search result | query: …`).
  - Used for: assistant context (`passageScores` → `turnEvidence(…, semantic)` → `relevant()` adds `(sim − 0.35) × 14`, and passages above ~0.45 qualify with no shared words); ⌘K "Related" group (`related()`, score > 0.45, docs the words didn't find). Queries time out at 300 ms, then words alone decide.
  - Settings › Assistant › *Understand meaning, not just words* (`settings.system1`, unset = on); status line shows download / indexing progress. Starts after hydration (`App.tsx`), downloads once to OPFS like Gemma.
- **System 2 memory:** `scheduleRelease()` in `llm.ts` after every answer and load; after *Keep the assistant loaded* (`settings.keepLoaded`: 2 min / 10 min default / always) `releaseModel()` unloads all engines unless busy. The next question reloads from cache (chat's reload path handles it).
- Shared worker code moved out: `litert-shim.ts` (importScripts + locateFile workaround), `litert-download.ts` (OPFS download, now `backend`-aware cache names `repo@backend`).
- **Tested** with a stand-in embedder (the model can't download in the cloud sandbox): indexes all docs, 260 bytes per passage, a question with no shared words ("what are eigenvectors used for?") now reaches the linear-algebra notes and leaves unrelated docs out, `related()` ranks correctly, editing one doc re-embeds only that doc, ⌘K shows Related, stopping frees it. **Not tested:** the real EmbeddingGemma 2 file (resolving the repo, CPU vs GPU build, speed, real similarity thresholds: 0.35/0.45/0.5 were set for normalised cosine and should be tuned on real notes), whether the repo is gated, and the idle unload with a real loaded model.
- **Next for System 1:** tune thresholds on real data; intent routing in the Ask bar (nearest labelled examples: add event / ask / search / new doc) instead of regexes; related docs in the doc view; suggestions (folder/tags for a new doc); port to iOS (EmbeddingGemma via MLX or LiteRT-LM Swift) with the same index format.
- **Dynamic System 2 (follow-up the same day):** *Keep the assistant loaded* now defaults to **Auto** (`keepLoaded: 'auto'`; 2 min / 10 min / Always still offered).
  - **Load ahead:** System 1 classifies what's typed in the Ask bar (`intent()` in system1.ts: nearest labelled examples for ask / add / find, EmbeddingGemma's `task: classification` prompt; examples embedded once). A question (`ask`, confidence > 0.03; or a trailing "?" when System 1 isn't ready) calls `warmUp()` in llm.ts, which loads the general model only if it's already downloaded. Adding and finding never wake it. On Calendar, events recognised by the parser skip System 1 entirely.
  - **Keep as long as it's used:** `enqueue()` records when people ask (background insights don't count); Auto keeps the model for 2.5× the median gap of the last few questions, between 90 s and 12 min (4 min until there are three questions). `keepAliveMs()` is pure and tested.
  - **Let go when away:** with Auto, the model is released after the tab has been hidden for a minute.
  - Tested with a stand-in embedder: six unseen phrasings classified correctly, keep-alive bounds, the Ask bar consulting System 1 for questions. Not tested with the real models: real intent accuracy (tune the examples and the 0.03 margin), real warm-up timing.

## File viewer and sidebar spacing (Nov 15, cloud session)
- **Sidebar:** items under Docs, Recordings and folders are flush with their section (Docs etc. are types, not levels): same highlight edge, titles at the same x (61 px), 12 px per deeper level; a doc with sub-docs shows its arrow in place of its icon on hover/focus (`.emoji.has-kids` in Sidebar.tsx / soft.css). `.side-tree` lost its 10 px inset.
- **File viewer** (`src/components/FileViewer.tsx`, `openViewer()`), opened by a card's Open, a picture's double-click, or View in the ··· menu:
  - Pictures full window (click toggles fit / actual size); PDF in the browser's own viewer (iframe); audio and video play in place.
  - **Editable:** plain text and code (JSON, YAML, source files: monospaced textarea), Markdown (Preview rendered with the same Tiptap converter as docs, so checklists/tables/code match; Edit tab), CSV/TSV (table of inputs, + Row / + Column, RFC 4180 quoting kept). Up to 2 MB; larger text is view-only.
  - Save (button or ⌘S) stores the edited content as a new file (`putFile`) and points every use of the old one in that doc at it, so compression, the passcode lock, folder assets and sync need nothing special. Esc closes; unsaved changes ask first.
  - Office files and archives: Download only.
  - Tested: picture, CSV edit (cell, new row, quoted cell kept) and save (doc reference changes, new content correct), Markdown preview with a real checklist and edit, JSON as editable code, unsaved-close prompt. Not tested: PDF/audio/video in real Chrome (headless has no PDF viewer), phone layout of the viewer (full screen under 680 px).

## Product hardening (Nov 15, cloud session)
- **Error boundaries** (`src/components/ErrorBoundary.tsx`): the sidebar, the page and the assistant each fail on their own with "This part of … stopped working · Your work is saved" and Try again / Reload / Copy details; the page resets when you move to another doc or screen; a top-level boundary in `main.tsx` replaces a blank page. Saving lives in the store, outside React, so a crash never loses work.
- **Deploy blocker fixed:** the build emitted ONNX Runtime's 27 MB wasm (Transformers.js), over Cloudflare Pages' 25 MiB file limit. Transformers.js already loads ORT from jsDelivr at its exact version, so the emitted copy was unused: the `fitPages` plugin in `vite.config.ts` drops it and **fails the build if any file exceeds 25 MiB**. The service worker caches ORT's jsDelivr files for offline (same rule as LiteRT-LM's runtime). dist is now 32 MB total, largest file ~6 MB.
- **Tests and CI:** `npm test` = date cases + Playwright end-to-end (`tests/e2e/app.spec.ts`, 7 tests, ~10 s) against the production build (`vite preview` on :5220, a fresh origin per test): setup focus trap and blocked shortcuts, ⌘N title/body and reload, file store (resize to 2560, references, workspace stays small), viewer CSV edit and save, calendar quick add + Undo, one-press recording, delete → Recently Deleted. `@playwright/test` pinned at 1.64.1. Locally with a preinstalled browser: `PW_CHROMIUM=/path/to/chrome npm run test:e2e`. `.github/workflows/ci.yml` runs tsc, oxlint, date cases, build (with the size check), and the e2e suite on every push and pull request; the HTML report is uploaded on failure.

## Roadmap to 1.0
In order. "You" items need the owner (accounts, devices, decisions).
1. **Verify on real devices** (HANDOFF › Next steps 1): Gemma and EmbeddingGemma 2 in Chrome (downloads, gating, speed, intent and similarity thresholds), Safari/Firefox fallbacks, connecting a real folder, PDF/audio/video in the viewer, iOS build and device run. Turn each into an e2e test where it can run headless.
2. **Deploy (you):** relay Worker; Pages project with `VITE_RELAY_URL`, OAuth client IDs and the GitHub secret; register the domain with GitHub/Google. CI is ready to gate it.
3. ~~**Trust pages:** an About screen (version from package.json and build date, open-source licences, model licences: Gemma terms, EmbeddingGemma, LFM 3's $10M threshold on iOS) and a short privacy page saying exactly what leaves the device: model and runtime downloads (Hugging Face, jsDelivr), weather/location only when turned on, sealed relay messages, sign-in token exchange. No analytics.~~ Done.
4. ~~**Updates:** when the service worker finds a new build, show "A new version is ready · Reload" instead of waiting for the next visit; bump `CACHE` in sw.js per release.~~ Done.
5. ~~**Data safety:** a gentle backup reminder (e.g. 14 days without a backup and more than N docs), and a check-in that `navigator.storage.persist()` was granted, with a plain warning if not (the browser may clear data under storage pressure).~~ Done.
6. ~~**Accessibility pass:** run axe in the e2e suite on Home, a doc, Calendar, Settings, the viewer; fix contrast and labels; check every dialog traps focus like setup now does.~~ Done.
7. ~~**Performance budget:** add a CI check on the startup bundle (index + CSS gzip) so it can't creep; lazy-load anything not needed for Home.~~ Done.
8. **iOS to TestFlight (you + Xcode):** compile the pending Swift changes, run the 86 date cases against Swift, device tests (Face ID lock, speech, MLX/LFM 3), then TestFlight.
9. **Then:** System 1 intent routing tuned on real data, related docs in the doc view, Settings grouped into sections, GitHub/Drive file assets, phone file sync.

## Roadmap 3–7 done (Nov 15, cloud session)
Items 3–7 of the roadmap above are done (the struck-through items are kept for context). Version is now **0.9.0** in package.json.
- **About and privacy** (`src/components/About.tsx`, end of Settings): version and build date (Vite `define`: `__APP_VERSION__`, `__BUILD_DATE__`, declared in `src/env.d.ts`); Privacy lists exactly what goes online and when (model and runtime downloads from Hugging Face and jsDelivr; BigDataCloud and Open-Meteo only with location or weather on; the relay for phone sync and calendar subscriptions, sealed; GitHub and Drive talked to directly, with sign-in going through `/api/github/token`); there are no analytics. Licences links `/licenses.txt`, which the `licenses()` Vite plugin generates on every build and serves in dev. It covers every shipped package and its dependencies, with licence texts. Each model links to its Hugging Face page instead of restating its licence terms. Check that the wording still matches if you add a network call.
- **Updates** (`src/lib/updates.ts`, `public/sw.js`): the `stampWorker` plugin rewrites `const CACHE = 'app-v1'` in `dist/sw.js` to `app-<version>-<build time>`, so every build is a new service worker; don't bump it by hand. The first install takes over at once. An update waits, and the page shows "A new version of Monolith is ready · Reload". Reload saves the open doc (`saveNow`), then sends `activate` to the new worker, and the page reloads on `controllerchange`. Updates are checked at start, every hour, and when the tab becomes visible. Tested end to end (build, load, rebuild, prompt, reload, old cache gone).
- **Data safety** (`src/lib/safekeeping.ts`): once there's own work (not samples or connected storage), the app calls `navigator.storage.persist()`. Settings › Storage shows a plain warning when the browser hasn't agreed, suggesting backups and installing the app (or, on Safari, adding it to the Dock or Home Screen). A backup toast with a Back up action appears when there are 5 or more own items and the last backup, or the oldest item if there has never been a backup, is older than 14 days. That drops to 7 days when the data isn't persisted. The toast shows 60 s after launch, then daily, and at most once a week (`settings.backupNudgedAt`).
- **Accessibility** (`tests/e2e/a11y.spec.ts`, axe 4.14.0, WCAG 2.2 A and AA): checks setup, Home, a doc, Recordings, Calendar, Settings with Privacy open, the command menu, a doc with a file card, and the file viewer, in both dark and light. Fixes made so the suite passes:
  - Secondary text greys raised in all three token layers (index.css, theme.css, soft.css; there are three, and soft.css wins).
  - Calendar blue split into `--blue` (fill) and `--blue-text`.
  - Chips and event text darkened.
  - Week strip day buttons now have names that start with their visible text.
  - Labels on the setup step dots, the Settings close button and the editor (`Doc body`).
  - The week scroll area is focusable.
  - Small buttons are at least 24 px.

  Focus trapping is one global handler (`src/lib/focusTrap.ts`) for any `[aria-modal="true"]`, `.overlay > .modal` or `[cmdk-dialog]`. All modals now have `role="dialog"` and `aria-modal`. A test tabs through Settings and the viewer 40 times. If a new dialog fails axe, fix the dialog; don't loosen the tags.
- **Startup budget** (`scripts/bundle-budget.mjs`, `npm run budget`, run in CI after the build): measures the entry JS, its modulepreloads and the CSS that index.html links, gzipped. At the time of writing it's 184 KB of a 200 KB JS budget and 26 KB of a 30 KB CSS budget. Raise the budget only on purpose; prefer `import()` for anything Home doesn't need.
- Full local run: `npx tsc -b`, `npx oxlint` (warnings only), `npm run test:dates` (86/86), `npx vite build`, `npm run budget`, then `PW_CHROMIUM=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npx playwright test --trace off` (13/13). The Playwright config serves `vite preview` on 5220, so build first.
- Not verifiable here: whether a real browser grants `persist()` (headless says no, which is how the warning was checked), and Firefox's persist prompt wording.

## One connected workspace: links, Tasks, Settings sections, the slab (Nov 15, cloud session, 0.10.0)
The app was four lists side by side (docs, recordings, calendar, a task card on Home). This pass ties them together and gives the app a sign of its own. Rules for each are in `DESIGN.md` (Identity, Links between docs, Connections, Tasks, Settings).

- **`src/lib/graph.ts` is the new shared layer.** It reads every doc once (again only when its text or the day changes) and keeps: every checklist line as a task (with a due date when the line names one, via `parseQuickEvent`), what each doc links to, and what links back to it with the sentence. `useWorkspace()` for components, `readWorkspace(items, now)` elsewhere. Home, Tasks, the sidebar count, the command menu, instant answers and the assistant's context all read it, so they agree. `extractOpenTodos` in `util.ts` is gone (it also counted a nested checklist's words as part of its parent line).
- **Links.** `[[` in the editor (or `/` › Link to a doc) opens "Link to"; the link is an ordinary link mark with `href="#doc/<id>"`. Checked: Copy as Markdown gives `[Study system](#doc/doc-guide)`, and importing that Markdown brings the link back. `updateItem` renames links that still show a doc's old title (without touching the other docs' `updatedAt`). Clicking a doc link opens it (`handleClick` in `Editor.tsx`); web links behave as before.
- **Connections** (`src/components/Connections.tsx`) under every doc and recording: Linked from, On your calendar (events with `linkedItemId`), Related (System 1 `related()`, score above 0.5, when it's ready).
- **Tasks** (`src/views/TasksView.tsx`, section `tasks`): grouped Overdue / Today / Next 7 days / Later / No date. `TaskRow` and `completeTask` are shared with Home. The Ask bar adds tasks on this page (`addTask` puts them in a doc titled "Tasks", created on first use; `removeTask` is its Undo).
- **Assistant:** task lines it's given now carry due dates; docs linked to or from the open doc get a small boost in `relevant()` when they already match the question.
- **Settings** is sectioned (General, Assistant, Storage and files, Devices, About) instead of one long scroll (was UI follow-up 4 and roadmap item 9).
- **Identity:** the slab marks the current top-level sidebar row and Settings section, and replaces the three dots while the assistant works. The mark is now exactly 4:9. Titles all read `--font-display` (still the system sans; one line to change). Manifest, page description and theme colours now match the app (they still said "notes" and used an older background colour).
- **Bug fixed on the way:** text typed in the last 250 ms before leaving a doc was lost. The editor was destroyed (layout cleanup) before its pending save ran (effect cleanup), and the save skips a destroyed editor. The layout cleanup now saves first. Found because a test typed a checklist and clicked Tasks straight away.
- **Also fixed:** checkboxes in docs were 17px (axe target-size) and didn't match the spec; the shortcuts sheet listed "New note ⌘N / New doc ⌘⌥N", which don't exist.
- Tests: 3 new end-to-end tests (links, Tasks, Settings sections) and axe on a doc with a link, Tasks and each Settings section. 16/16 pass; dates 86/86; startup JS 187 KB of 200, CSS 27 KB of 30.

### Not done, in the order I'd do it
1. **iOS has none of this.** A link arrives on the phone as link text that does nothing; there is no Tasks screen, and no Connections. `Markdown.swift` needs to treat `#doc/<id>` links as in-app navigation, and `TodayView` needs the grouped task list (port `taskGroup` / `dueLabel`). Nothing in `apple/` was touched or compiled.
2. **Links in connected folders point at ids, not files.** In a folder or GitHub repo the Markdown says `[Title](#doc/<id>)`, which another editor can't follow. Writing a relative path (`[Title](other.md)`) on save and mapping it back on read would make the files stand on their own. Linking to a doc in a different source is the awkward case.
3. **The three CSS layers** (`index.css`, `theme.css`, `soft.css`: 6,500 lines, many selectors defined three or four times) are the biggest structural debt left on web. This pass removed a few dead rules it touched and added nothing as an override. Flattening them into one resolved sheet needs screenshot comparison of every screen in both themes to be safe; worth its own session.
4. Tasks: a due date can only be typed in the line. A date control on the row, and showing dated tasks on the calendar, are the natural next steps.
5. Unlinked mentions (a doc's title appearing as plain text elsewhere) could be offered under Connections as "Mentioned in", with a one-press Link.

## Competitive gaps closed: repeats, versions, export, reminders, mentions, print (Nov 16, cloud session, 0.11.0)
Rules for each are in `DESIGN.md` (Repeating events, Tasks on the calendar, Earlier versions, Reminders, Export everything, Printing).

- **Repeating events** (`src/lib/repeat.ts`). A stored event with `repeat: { every, until? }` is a series; `expandEvents(events, from, to)` hands out its dates as events with id `<series id>@<start>` and `seriesId`. `skip` holds the starts of removed dates. In the store, `updateEvent` on an occurrence id changes the series (a new time shifts every date and the skips), `deleteEvent` on an occurrence id skips that date, `detachEvent` turns one date into its own event. The calendar expands around the month on screen; everything else uses `src/lib/events.ts` (`useEvents`, `useOwnEvents`, `allEvents`, `ownEvents`: a year ahead, cached until an event or the day changes). Quick add: `parseRepeat` in `dates.ts`, with 8 new cases in `scripts/test-dates.ts` (94 total; "tutoring mondays at 4pm" now repeats weekly, on purpose).
- **Tasks on the calendar:** dated tasks from `graph.ts` as `.chip.task` in the all-day row and month cells.
- **Earlier versions** (`src/lib/history.ts`, `HistoryDialog.tsx`): a store subscription keeps a doc's previous content when its newest version is over 10 minutes old, or the change is large (over 400 characters or 30%). 30 per doc, in IndexedDB under `history:<id>`, sealed with the passcode, removed when the doc is deleted for good. The preview goes through `safeHtml` because a restored backup's HTML isn't guaranteed to have come from the editor.
- **Export everything** (`src/lib/exportAll.ts`): own small zip writer (stored, UTF-8 names), `Docs/` laid out like the sidebar, `Files/`, `Recordings/` with audio and transcript, `Calendar.ics` with RRULE and EXDATE. Doc links become relative file links. Checked by unzipping the result and with Python's `zipfile.testzip()`.
- **Reminders** (`src/lib/reminders.ts`): `settings.remind`; a 30-second check while the app is open; a toast in the app plus a system notification through the service worker when permitted. `sw.js` focuses the app on click.
- **Mentioned in** (`unlinkedMentions`, `linkMention` in `graph.ts`) and **Print or save as PDF** (`@media print` at the end of `soft.css`).
- **Fixed on the way:** the event editor had unlabelled buttons, colour swatches and date fields, and a red-on-grey delete label under 4.5:1 (axe had never been pointed at it).
- Tests: 21 end-to-end (repeat, task chip, versions, export + reminder firing, mentions; axe now also covers the event editor and the versions dialog).

### What I couldn't verify here
- A real system notification (headless Chromium reports notifications as denied, so only the in-app reminder was seen firing).
- Importing the exported `.ics` into Google or Apple Calendar. Timed events are written with `TZID=<IANA zone>` and no VTIMEZONE block, which both accept in my experience but which I did not test.
- Real printing; the print layout was checked with print media emulation.

### Known limits
- **The phone doesn't know about repeats.** It receives a series as one event on its first date. `repeat` and `skip` are sent in the sync record and kept on the web when the phone edits other fields, but `apple/` needs `expandEvents` ported before repeats show there.
- Earlier versions are not in the backup file and don't sync. Pictures in an old version show as their names.
- A repeat can't be "every Monday and Wednesday" in one event (make two), and has no "N times" end, only a date.
- Reminders can't fire while the app is closed: there is no server to send them. A push service would be the only way.
- Still open from before: iOS Tasks/links, relative links inside connected folders (Export already writes them, so the same mapping can be reused in `storage/sync.ts`), and flattening the three CSS files.

## Models and speed (Nov 16, cloud session, 0.12.0)
Nothing here could be run against a real model: huggingface.co and jsDelivr are blocked in the cloud session and there is no GPU. So this pass changed only what could be measured or tested without one, and left the model line-up and every model id alone.

### Speed, measured on a 3,000-doc workspace (5.9 MB saved), before → after
| | Before | After |
|---|---|---|
| Opening Docs (long tasks) | 664 ms | 60 ms |
| Typing in a doc (long tasks per 60 characters) | 163 ms | 0 |
| Command menu, typing 17 characters | 1,820 ms (22 long tasks) | 708 ms (1) |
| Ask bar, typing 18 characters | 962 ms | 625 ms |
| Opening Home (long tasks) | 383 ms | 0 |
| Files downloaded at launch, no WebLLM model stored | 7.40 MB | 1.45 MB |

Typing figures include Playwright's own 30 ms a key (510–540 ms is the floor). What changed:
- **`src/lib/text.ts`:** a doc's plain text is worked out once per doc object and remembered (`textOf`, `fullText`, `searchText`, `wordCount`). Search, the Ask bar, Home, word counts, suggestions and the assistant's passages all use it. Before, the command menu parsed every doc's HTML on every keystroke, and did so even while closed, each time a doc changed.
- **Sidebar tree:** children were found by scanning every doc for every row (9 million comparisons at 3,000 docs). Now grouped once. A level shows 100 rows, then "Show 100 more of N"; the open doc is always shown.
- **Saving (`store.ts`):** zustand's JSON storage turned the whole workspace into text on every state change, including opening a menu. The store now hands over the object and text is made only when a save happens; a change to nothing that's saved causes no save; a save waits for a 0.4 s pause, at most 2 s while changes keep coming (it was every 0.5 s). Hidden or closed tab still saves at once. **Trade-off:** a crashed tab can lose up to 2 s of typing instead of 0.5 s.
- **Launch:** `refreshCache`, `clearRetired` and `clearFallbacks` imported WebLLM's 6 MB library at every start to ask what was downloaded. They now check first whether its cache (`webllm/model` in the Cache API, the name read from the library's source) exists at all.

### Model downloads
- **`src/ai/resumable.ts`:** LiteRT-LM models (Gemma, EmbeddingGemma) are written in place in OPFS as they arrive (a sync access handle in the worker, flushed every 32 MB), with a `<file>.part.json` note of the address and length. The next try sends `Range: bytes=<have>-` with `If-Range`; a 200 answer restarts cleanly; a part from a different file is never reused (addresses are compared without their query string, since download links are signed afresh). Free space is checked first (`navigator.storage.estimate`).
- Tested in `tests/e2e/download.spec.ts` against a local server that cuts the connection twice: the right ranges are asked for and the finished file matches byte for byte.
- A failed download now says "What arrived is kept, so the next try carries on from there", and running out of space is an error on screen instead of a silent fall-back to another multi-gigabyte model.
- Settings › Assistant shows "Downloaded" or "40% downloaded · continues when picked" under a tier, and the free space when it's under 6 GB.
- WebLLM and Transformers.js downloads are unchanged: those libraries fetch and cache their own files.

### Follow-ups in the same conversation (the "conversation reuse misses" item above)
`src/ai/reuse.ts` decides whether a request continues the conversation LiteRT-LM holds. It compares a key per message instead of the exact text: every answer has the same key, a question's key leaves out the per-turn action instructions (`turnKey` in `chat()`'s options, set by `AIPanel`), and a conversation made with room for a longer answer serves a shorter one. Retries, edits, dropped turns and changed evidence still start afresh. 12 cases in `scripts/test-reuse.ts` (`npm run test:reuse`, in `check`, `test` and CI).

### Check on a real machine
1. Start a Gemma download, turn Wi-Fi off part-way, turn it on, pick the tier again: it should continue, not restart (DevTools › Network shows a `Range` request and a 206). Hugging Face redirects to a signed CDN address; if `resolveModel` returns that signed address rather than the stable one, the comparison without the query string still matches, but confirm the 206.
2. Ask a question, then an action ("move calc review to Thursday 3pm"), then two more questions, with `onMetrics` logging: `reused` should be true for every turn except the first and the action turn, and `prefillTokens` should be small on those.
3. With a Fast (WebLLM) model downloaded, Settings should still show it as downloaded after a reload (the cache-name check).

### Left alone, on purpose
- Model ids and tiers. I can't confirm from here which builds exist or how fast they are.
- Storing each doc under its own key, so a save writes only what changed. It's the real fix for very large workspaces, but it touches the passcode lock, backup and restore, and the migration of existing data. Worth doing with the user's real data backed up first.
- The first question after launch still builds passages for every doc on the main thread (about a third of a second at 3,000 docs when System 1 hasn't already done it).
