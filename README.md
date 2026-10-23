# Nthawi's Furniture – Bookings

Installable web app (PWA) for phone and laptop. Cloudflare Worker (static assets) + D1 database.

## Deploy (dashboard only, no command line)
1. Cloudflare → Storage & Databases → D1 → Create database, name it `nthawis-bookings`. Copy its Database ID into `wrangler.toml` (replace `REPLACE_WITH_YOUR_D1_ID`).
2. Open that database → Console, paste the contents of `schema.sql`, run it.
3. Commit and push `wrangler.toml` to GitHub. Your Worker `bookings` rebuilds automatically (deploy command `npx wrangler deploy`).
4. Worker `bookings` → Settings → Variables and Secrets → add a secret `APP_PIN` (your staff PIN).

## Use
- Staff app: open the Worker URL, enter the PIN, then "Add to Home Screen" on the phone.
- Business name and services: Settings screen in the app.
- Website: link to `/book.html` or embed it with an iframe. Website requests arrive as "pending".

## Notes
- Add 192x192 and 512x512 PNG icons to `manifest.webmanifest` for the best install prompt on all phones.

## Updating an existing database
Run `migrate-1.sql` once in the D1 console (adds address and price columns) BEFORE deploying this version.
Also run `migrate-2.sql` once (adds assigned-to and photo columns) before deploying this version.
Also run `migrate-3.sql` once (adds price, payments, source tracking, visit counts) before deploying the Insights version.
Also run `migrate-4.sql` once (soft delete, activity log, waiting list, spam limits). Deleted bookings stay restorable for 30 days.
Backups: D1 keeps 30 days of point-in-time restore (Time Travel). For weekly file backups, connect an R2 bucket as described in `wrangler.toml`.
