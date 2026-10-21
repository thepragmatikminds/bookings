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
