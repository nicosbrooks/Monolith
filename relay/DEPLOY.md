# Going live: Cloudflare Pages + the relay, for about 100 people

This is the whole path from this folder to a public site: the web app on Cloudflare Pages, the sync relay on
Cloudflare Workers, both on your own domain. It's sized for roughly 100 active people. For a quick personal setup,
[README.md](README.md) is enough.

What you'll end up with:

| Piece | Where | Address (example) |
| --- | --- | --- |
| Web app | Cloudflare Pages | `https://monolith.example.com` |
| Relay (sync + calendar links) | Cloudflare Worker + Durable Objects | `https://relay.monolith.example.com` |
| Staging relay | Same Worker, `staging` environment | `https://monolith-relay-staging.<you>.workers.dev` |
| Pages previews | Every non-main branch | `https://<branch>.monolith.pages.dev` |

Replace `monolith.example.com` with your domain throughout.

## 0. Before you start

- Node 22 or newer, and a Cloudflare account.
- Your domain added to Cloudflare (Websites → Add a domain), so Cloudflare runs its DNS. Both custom domains below
  depend on it.
- The project in a Git repository on GitHub or GitLab. Pages builds from it on every push. (Direct upload with
  `npx wrangler pages deploy dist` also works, but you lose preview builds.)

## 1. The relay

```bash
cd relay
npm install
npx wrangler login
```

### 1a. Set it up for production

Edit `wrangler.toml`:

1. **Your own domain.** Uncomment and set:

   ```toml
   routes = [{ pattern = "relay.monolith.example.com", custom_domain = true }]
   ```

   Cloudflare creates the DNS record and certificate on deploy. Keep `workers_dev = true` until you've checked the
   custom domain works, then set it to `false` so there's only one public address.

2. **Only your site may use it.** Browsers send their origin; the relay refuses any it doesn't know:

   ```toml
   [vars]
   ALLOWED_ORIGINS = "https://monolith.example.com"
   ```

   Don't list `*.pages.dev` preview addresses here; previews use the staging relay (step 1c). The iPhone app
   doesn't send an origin and isn't affected.

3. **Calendar links rate limit.** Already on: 30 calendar fetches a minute per IP address (`ICS_LIMIT`). One
   person refreshing every calendar they follow uses a handful per 15 minutes, so it only stops abuse. If many
   people share one network (a school or office behind one IP), raise `limit` to 120.

### 1b. Deploy and check

```bash
npm run deploy
npm run smoke -- https://relay.monolith.example.com
```

Smoke checks that two test devices join a room and swap messages. Also check the calendar endpoint by hand. It
should return `BEGIN:VCALENDAR…`:

```bash
curl -s -X POST -H 'Origin: https://monolith.example.com' --data 'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics' https://relay.monolith.example.com/ics | head -3
```

and `https://relay.monolith.example.com/health` should return `{ "ok": true }`. Point an uptime checker at
`/health` (Cloudflare Health Checks, or any free one).

If you previously deployed `socratic-relay` on `workers.dev`, the deploy prints a new address for `monolith-relay`.
Use that address for `VITE_RELAY_URL` and rebuild the web app. Existing pairings store the old address, so keep the
old Worker running until you’ve paired those devices again and checked that they sync through the new relay.

### 1c. Staging

`wrangler.toml` has a `staging` environment: the same relay under another name, so you can try relay changes
without touching the one your users are on.

```bash
npm run deploy:staging
npm run smoke -- https://monolith-relay-staging.<you>.workers.dev
```

Leave its `ALLOWED_ORIGINS` empty (any origin), or set it to your Pages preview addresses. It shares nothing with
production: different Worker, different rooms.

## 2. The web app on Cloudflare Pages

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick the repository, then:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None (or Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(empty: the project root, not `relay/`)* |

**Environment variables** (Settings → Variables and secrets). The relay address is baked in at build time, so set
it per environment:

| Variable | Production | Preview |
| --- | --- | --- |
| `VITE_RELAY_URL` | `https://relay.monolith.example.com` | `https://monolith-relay-staging.<you>.workers.dev` |
| `NODE_VERSION` | `22` | `22` |

Save, then **Retry deployment** (variables only apply to new builds).

**Custom domain:** Pages project → Custom domains → Set up a domain → `monolith.example.com`. Cloudflare adds the
DNS record.

**Single-page app routing** works without setup: with no `404.html` in `dist`, Pages serves `index.html` for unknown
paths, so links like `/calendar` open the app.

**Updates reach people on their own.** The app has a service worker (`public/sw.js`), so a new deploy shows up the
next time someone opens or reloads the site. Nothing to purge.

## 3. Check it end to end

1. Open `https://monolith.example.com`, make a note.
2. Pair the iPhone from the phone icon (the QR code carries the relay address, so the phone needs no setup). Edit
   the note on one device, watch it change on the other.
3. Calendar → Calendars → paste a calendar link. Events should appear within a few seconds.
4. In a private window on a second computer, open the site: it should be empty. Nobody shares data by visiting.
5. `npm run tail` while you do the above: you see connections and `/ics` requests, nothing else.

## 4. Will 100 people fit? Cost

Short answer: yes, comfortably, and likely on the free plan. Check
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) for current numbers,
because they change.

Why it's light:

- **Nothing is stored.** No database, no KV, no file storage; there's no storage bill and nothing to back up.
- **Idle costs nothing.** Each pairing is one Durable Object using WebSocket hibernation: a connected but quiet
  phone doesn't keep it awake. Keepalive `ping`s are answered by Cloudflare without waking the object.
- **What does count:** opening a connection, and each message a device sends (Durable Objects bill incoming
  WebSocket messages at a fraction of a request each). An edit sends a few small messages; pairing or catching up
  sends one bigger snapshot. 100 people editing actively for an hour a day is in the low thousands of requests a
  day, well under the free daily allowance at the time of writing.
- **Calendar links:** one Worker request per calendar per 15 minutes while the calendar is open.

Signs you've outgrown free: the Workers dashboard shows daily request limits being hit, or Durable Object errors
in `npm run tail`. Moving to Workers Paid is a switch in the dashboard; nothing in the code changes.

Limits built into the relay (`src/index.ts`): 8 devices per pairing, 8 MB per message.

## 5. Keeping people's data apart

The design keeps people separate by default; this list is what to keep true as you go public.

- **Notes live on each person's own devices** (browser IndexedDB, the iPhone's SwiftData). The site serves the same
  static files to everyone; there's no account and no server copy to mix up.
- **Sync is per pairing.** Each pairing gets a random 128-bit room id from the QR code. Only devices that scanned it
  join that room, and everything in it is end-to-end encrypted (P-256 key agreement, AES-256-GCM), so even a guessed
  room id yields unreadable bytes. Never derive room ids from anything guessable (names, emails, counters).
- **The relay keeps nothing.** It forwards frames and forgets them. Keep it that way: no logging of message bodies.
  Logs (observability) record request paths, which include room ids but no content; calendar links are sent in the
  request body, never the URL, because private calendar links are secrets.
- **One browser profile = one person.** People sharing a computer and a browser profile share data, same as any
  local app. Worth a line in your FAQ.
- **Previews never talk to production.** Preview builds use the staging relay, so a test build can't join anyone's
  real pairing.
- **Sign-in (Google Drive, GitHub) isn't production-ready yet.** It uses a small token-exchange backend
  (`server/oauth.ts`) that only runs on the Vite dev/preview server, not on Pages. Before offering it publicly, move
  it to a Pages Function (`functions/api/…`) or a Worker, with `GITHUB_CLIENT_SECRET` stored as an encrypted secret
  (`wrangler secret put`), and register your production domain as the OAuth redirect. Until then those buttons only
  work locally.
- **Calendar links are fetched by the relay** (browsers can't fetch most calendars directly). It accepts only
  https, refuses private network addresses, caps files at 5 MB, and must see `BEGIN:VCALENDAR` before returning
  anything.

## 6. Day to day

| Task | Command (in `relay/`) |
| --- | --- |
| Deploy relay | `npm run deploy` |
| Deploy staging relay | `npm run deploy:staging` |
| Live logs | `npm run tail` / `npm run tail:staging` |
| Undo a bad relay deploy | `npx wrangler rollback` (pick the previous version) |
| Test a relay | `npm run smoke -- <url>` |
| Type-check | `npm run check` |

The web app deploys on every push to `main`. To undo a bad one: Pages project → Deployments → the previous one →
**Rollback**.

Changing the relay's protocol (the message format in `src/index.ts`, `server/relay.ts`, `src/link/` and
`apple/iOS/Link/`)? Deploy to staging, test a web preview build and a simulator build against it, then deploy
production. Phones update slower than the website, so keep the relay accepting the old format for a while.
