# Running this app on GoDaddy cPanel (self-host)

The app is now built for self-hosting (`output: 'standalone'` in `next.config.ts`)
so it can run on a plain Node host via `node server.js` instead of only on Vercel.
This guide covers GoDaddy cPanel's **Setup Node.js App** (Phusion Passenger).

## ⚠️ First: can your plan even run it? (check before doing anything)

This is a **Next.js 16** app. It only runs on cPanel if **all** are true:

1. **cPanel has a "Setup Node.js App" tile.** Present on GoDaddy *Linux Hosting*
   Deluxe/Ultimate/Maximum (cPanel) plans. **Not** on Economy, and **not** on the
   "Web Hosting" / WordPress plans (PHP-only). No tile → hard stop.
2. **Node 18.18+ or 20+ is selectable** in that tile. Next 16 won't start on Node 16.
3. **~1 GB memory** for the app (LVE/PMEM limit). Tight but usually OK for the
   standalone runtime. Do **not** build on the server — build locally (below).

If any fail, GoDaddy shared cPanel can't host this app; use a small VPS (GoDaddy
sells them) or keep it on Vercel.

## Build locally, upload the bundle

cPanel shared hosting can't run `next build` (memory/time). So:

```bash
# 1. Build + assemble the standalone bundle (folds in static + public)
npm run build
node scripts/pack-cpanel.mjs

# 2. Upload to the cPanel app root (via cPanel File Manager or SFTP):
#      .next/standalone/     (the whole folder — includes server.js + node_modules)
#      app.js                (the Passenger startup file)
#    You do NOT need to upload src/, node_modules/, or the rest of the repo.
```

> `npm run build` runs `drizzle-kit migrate` first (see `package.json`). If your
> DB isn't reachable from your laptop, run `next build` directly, then
> `node scripts/pack-cpanel.mjs`.

## Configure the Node app in cPanel

**Setup Node.js App → Create Application:**
- **Node version:** 18.x or 20.x
- **Application mode:** Production
- **Application root:** the folder you uploaded to (e.g. `apar`)
- **Application URL:** your domain/subdomain
- **Application startup file:** `app.js`

Then **Environment variables** (in the same screen) — at minimum:
- `NODE_ENV=production`
- your DB + service vars (currently `DATABASE_URL`, `DIRECT_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.)

Click **Restart**.

## Database

- If you also move the DB to this **same** cPanel's MySQL, connect over
  `localhost` — no "Remote MySQL"/`%` needed, no serverless connection-cap issue.
  (That still requires the separate Postgres→MySQL code migration — see the plan.)
- Until then, the app keeps using its current `DATABASE_URL` (Supabase Postgres),
  which works fine from a cPanel Node process.

## Known caveats on GoDaddy shared cPanel

- **Passenger + Next standalone** can be finicky; if the app 503s, check the
  cPanel app **stderr log** and confirm the startup file + Node version.
- **Memory:** if it gets OOM-killed under load, you've outgrown shared hosting.
- **No build on server:** always build locally and upload the bundle.
- **PDF generation** (`@react-pdf/renderer`) is CPU-heavy; shared LVE CPU limits
  may throttle it.
