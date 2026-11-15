# Handoff: Monolith (formerly Socratic), Nov 13 2026

The project folder is still named `socratic/` and isn't a git repo, so don't commit. The web app is React + Vite (typecheck: `npx tsc -b`), the iOS/iPad/Watch app is SwiftUI (`apple/`, XcodeGen), and the relay is a Cloudflare Worker (`relay/`).

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
