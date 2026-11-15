# Monolith sync relay

A small Cloudflare Worker that passes end-to-end encrypted messages between your linked devices (the iPhone and
any browsers paired with it). Devices only ever open outgoing connections to it, so sync works on any network.

Putting Monolith online for other people? Follow [DEPLOY.md](DEPLOY.md): Cloudflare Pages, your own domain, a
staging relay, costs and keeping people's data apart.

It can't read anything: devices encrypt with a key agreed through the pairing QR code. It stores nothing either;
devices catch up with each other when they reconnect. The free Workers plan is plenty for personal use.

## Set up (about five minutes)

You need Node 22 or newer and a free Cloudflare account.

1. Install:

   ```bash
   cd relay && npm install
   ```

2. Sign in to Cloudflare. This opens your browser:

   ```bash
   npx wrangler login
   ```

3. Deploy:

   ```bash
   npm run deploy
   ```

   Wrangler prints the address, something like `https://monolith-relay.<your-subdomain>.workers.dev`. The first
   time, it may ask you to pick a workers.dev subdomain.

4. Check it works. Two test devices join a room and swap messages:

   ```bash
   npm run smoke -- https://monolith-relay.<your-subdomain>.workers.dev
   ```

5. Point the web app at it. In the project root, create or edit `.env.local`:

   ```
   VITE_RELAY_URL=https://monolith-relay.<your-subdomain>.workers.dev
   ```

   Restart the dev server (or rebuild). Pair again from the web app's phone icon; the QR code carries the relay
   address, so the iPhone needs no setup.

## Options

All in `wrangler.toml`. Run `npm run deploy` again after changing anything.

- **Lock it to your site.** `ALLOWED_ORIGINS` lists the origins browsers may connect from, comma-separated, e.g.
  `"https://monolith.example.com,http://localhost:5199"`. Empty means any origin. The iPhone app isn't affected.
- **Your own domain.** Uncomment the `routes` line and set the hostname. The domain has to be on your Cloudflare
  account already. You can then set `workers_dev = false`.

## Day to day

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the relay locally at `http://localhost:8787` |
| `npm run smoke` | Tests the local relay (add `-- <url>` to test a deployed one) |
| `npm run tail` | Live logs from the deployed relay |
| `npm run check` | Type-checks the worker |

Logs also show in the Cloudflare dashboard under Workers → monolith-relay → Logs.

## How it works

- `wss://<relay>/relay?room=<id>`: devices that share a room id see each other. The id is a random 128-bit value
  chosen at pairing time.
- Every frame a device sends goes to the other devices in the room, untouched. When a device joins or leaves,
  everyone gets `{"relay":"peers","n":<count>}`. `ping` gets `pong`.
- `https://<relay>/health` returns `{ "ok": true }` for uptime checks.
- Each room is one Durable Object, so a pair's connections meet in one place wherever each device is. Limits: 8
  devices per room, 8 MB per message.

The dev server has the same protocol built in (`../server/relay.ts`), used whenever `VITE_RELAY_URL` isn't set.
