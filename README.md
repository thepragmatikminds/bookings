# Nthawi's Furniture – Bookings

Installable web app (PWA) for phone and laptop. Cloudflare Pages + Pages Functions + D1 database.

## Deploy
1. Create the database: `npx wrangler d1 create nthawis-bookings` and paste the `database_id` into `wrangler.toml`.
2. Create the tables: `npx wrangler d1 execute nthawis-bookings --remote --file=schema.sql`
3. Push this folder to a new GitHub repository.
4. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick the repo. Build command: none. Output directory: `public`.
5. In the Pages project → Settings → add the D1 binding `DB` (if not picked up from `wrangler.toml`) and a secret `APP_PIN` (your staff PIN). Redeploy.

## Use
- Staff app: open your Pages URL, enter the PIN, then "Add to Home Screen" on the phone.
- Business name and services: Settings screen in the app.
- Website: link to `/book.html`, or embed it: `<iframe src="https://YOUR-SITE.pages.dev/book.html" width="100%" height="700"></iframe>`. Website requests arrive as "pending".

## Notes
- Add 192×192 and 512×512 PNG icons to `manifest.webmanifest` for the best install prompt on all phones.
- Local test: `npx wrangler pages dev public --d1 DB` (set `APP_PIN` in a `.dev.vars` file).
