# Admin dashboard setup

The dashboard at `/admin.html` can edit visible text and link destinations on the home and blog pages. Edits are stored as plain text in a JSON file on the server; they do not replace HTML or execute saved content.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and replace `ADMIN_PASSWORD` and `SESSION_SECRET` with private values. The session secret should contain at least 32 characters.
3. Run `npm install`, then `npm start`.
4. Open `http://localhost:3000/admin.html` and sign in with the credentials from `.env`.

The local content file is `.data/content.json`. Keep `.env` and `.data` out of version control. The admin page includes a preview, filters by page and section, a search box, and a Save Changes button.

## Hosting

The application is a Node.js web service that serves the existing website, dashboard, and API together. Deploy it to a Node-capable host and set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and `DATA_DIR` as private environment variables. Do not use the example credentials in production.

The content file must live on persistent storage. Container filesystems are often temporary; on Render, attach a persistent disk to the web service and set `DATA_DIR` to its mount path (for example `/var/data`). A persistent Render disk requires a paid service plan. Without persistent storage, saved edits can be lost when the host restarts or redeploys. No hosting service has been created or charged by this code change.

If the public site is hosted on a different origin from the API, set `SITE_ORIGIN` on the API to the exact public website origin, then set `window.PEFRIKA_API_BASE_URL` in `api-config.js` to the API's HTTPS origin. `SITE_ORIGIN` accepts a comma-separated allowlist. Both settings must match the actual deployment URLs; do not use `*`.

The server requires a secure session secret and admin credentials at startup. It uses HTTP-only signed cookies, origin checks on writes, login throttling, restrictive link validation, and atomic content-file updates.

## Verify

Run `npm test` to check sign-in, origin validation, access control, safe link handling, and persisted content writes.
