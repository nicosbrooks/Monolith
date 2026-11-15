# Monolith

Notes, docs, lecture recordings and a calendar in one app, with an AI that runs **entirely on your device**.

```bash
npm install
npm run dev   # http://localhost:5199
```

## What's in it

- **Notes** (Apple Notes-style): title/heading/body/monospace styles, checklists (move checked to bottom), tables, images (paste/drag), freehand **sketch** blocks (pen, highlighter, eraser; pressure-sensitive), folders, #tags, pinning, gallery view, Recently Deleted, Markdown export.
- **Docs** (Slite-style): nested pages, emoji icons, `/` slash commands, Markdown shortcuts, table of contents, Markdown import/export.
- **Lectures**: record or import audio → live captions → on-device Whisper transcript (click a line to jump in the audio) → AI study notes and flashcards.
- **Calendar**: week/month views, drag to create/move/resize, natural-language quick add ("calc review thu 4pm for 2h"), link events to notes or recordings.
- **Proactive help**: spots dates in your writing ("essay due Nov 14") and offers to schedule them, prompts you before/after classes, and the local model suggests what's missing from the page you're on.
- **⌘K** search everything · **⌘N** new note · **⌘J** assistant · **⌘\\** sidebar · **⌘,** settings · **?** all shortcuts
- **Right-click** notes, docs and folders for quick actions. Works on phones (bottom tabs, 3-day calendar) and installs as an app (Add to Home Screen / Install).

## Storage

Everything is saved in this browser (IndexedDB) by default. Use **Connect storage** (sidebar, the Create menu, or Settings → Storage) to keep **docs as Markdown files** somewhere you own:

| Source | How it saves | Setup |
| --- | --- | --- |
| **Folder on this computer** | Edits the `.md` files in place, autosaving as you type | Pick a folder (Chrome, Edge, Arc) |
| **GitHub repository** | Collects changes, then commits them together from the sidebar | **Continue with GitHub**, then pick a repo (or create one) and optionally a folder in it. Without one-click sign-in, a pre-filled token link is offered instead. |
| **Google Drive** | Autosaves into a folder named after the app in your Drive (`drive.file` scope, so it can't see your other files) | **Continue with Google** |

Folders in the source become nested docs. A leading `# Title` line becomes the doc title (otherwise the file name does, and renaming the doc renames the file). Front matter is kept as-is. If a file changes in two places, the doc shows **Keep mine / Use theirs**. Sketch blocks aren't available in file-backed docs because Markdown can't hold them.

Tokens stay in this browser and the app talks to GitHub and Google directly. The only server code is a small endpoint in the dev server (`server/oauth.ts`) that swaps GitHub's sign-in code for a token, since GitHub requires a client secret for that step.

### One-time setup for one-click sign-in

Copy `.env.example` to `.env.local` and fill in:

- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`: from a [GitHub OAuth App](https://github.com/settings/applications/new) with callback URL `<your origin>/oauth/github.html`.
- `GOOGLE_CLIENT_ID`: from a Google OAuth client of type *Web application* with your origin as an authorized JavaScript origin, plus the Drive API enabled.

Restart `npm run dev` after editing it. If these are missing, the dialog falls back to pasting a token (GitHub) or a client ID (Google).

## Name

The product name lives in `src/brand.ts`.

## Local AI

- **Language model**: [WebLLM](https://github.com/mlc-ai/web-llm) running in a Web Worker via WebGPU. Pick a model in Settings (SmolLM2 360M → Llama 3.2 3B). Downloaded once, cached in the browser, works offline.
- **Speech-to-text**: Whisper (tiny/base/small) via [Transformers.js](https://github.com/huggingface/transformers.js), WebGPU with WASM fallback.
- **Ollama** (optional): if running on `localhost:11434`, you can switch to any model you've pulled.

Needs a WebGPU browser for the in-browser model: Chrome, Edge, Arc, or Safari 26+.

All data is stored locally in IndexedDB.

## Offline

Fonts are bundled, so the app makes no third-party requests on load. The production build (`npm run build && npm run preview`) registers a service worker that caches the app, so it opens without a network after the first visit. The dev server doesn't, to keep hot reload working.

## Phone sync

Your iPhone is the hub. In the browser, click the phone icon in the sidebar (or Settings → Your phone) and scan the code with the iPhone camera, or in Monolith → Settings → Link a computer. Notes, docs, lectures (transcripts) and events then sync both ways, newest edit wins.

Devices never connect to each other directly. Each opens an outgoing connection to a small relay, so they work on any network: no shared Wi‑Fi, VPN or port forwarding. Everything is end-to-end encrypted (P-256 key exchange from the QR code, AES-GCM). The relay only forwards sealed messages and stores nothing.

- **Hosted relay:** `relay/` is a Cloudflare Worker (free plan is enough). Deploy it once with `cd relay && npm install && npx wrangler login && npm run deploy`, check it with `npm run smoke -- <url>`, then put the URL in `.env.local` as `VITE_RELAY_URL=https://monolith-relay.<you>.workers.dev`. Step-by-step setup and options are in [relay/README.md](relay/README.md).
- **Development:** without `VITE_RELAY_URL`, the dev server's built-in relay (`server/relay.ts`) is used. Only a simulator on this Mac can reach it; open the pairing link in the simulator with `xcrun simctl openurl booted '<link>'`.
- **Sync mode** (iPhone Settings): keeps the app open, dimmed and locked with Face ID, so linked computers stay in sync overnight while it charges.

## iPhone, iPad and Apple Watch

Native SwiftUI apps live in `apple/`. The Xcode project is generated from `apple/project.yml`:

```bash
cd apple && xcodegen generate && open Monolith.xcodeproj
```

Set your team under Signing & Capabilities for both targets. Requires iOS 26.1 / watchOS 26.

- **iPhone**: Today, Notes, Lectures, Docs, Calendar and Search tabs (Liquid Glass tab bar). Lectures record and transcribe live on device; study notes and "plan my day" use Apple's on-device model (Apple Intelligence). Data is stored with SwiftData.
- **iPad**: sidebar, list and editor side by side; a week calendar grid (tap a slot to add an event); Apple Pencil sketching in notes; keyboard shortcuts (⌘N note, ⌥⌘N doc, ⇧⌘R record, ⇧⌘E event, ⌘K search). The same layout appears in any wide window, including iPhone landscape on Plus/Max models.
- **Watch**: today's agenda from the phone, a record button (the phone transcribes it) and dictated quick notes.
- **Editor**: notes and docs show formatted text only, never Markdown symbols. Type shortcuts as you would on the web (`# `, `- `, `[] `, `1. `, `> `, ```` ``` ````, `---`, `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`) and they turn into formatting as you type; or use the keyboard bar (checklist, bullets, and **Aa** for styles, links, indent and inserts). Return continues a list, Return on an empty item ends it, Delete at the start of a line joins it to the one above. Notes are still stored and synced as Markdown.
