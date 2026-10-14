# Admin dashboard setup

The dashboard at `/admin.html` can edit visible text and link destinations on the home and blog pages. Edits are stored as plain text in a JSON file on the server; they do not replace HTML or execute saved content.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and replace `ADMIN_PASSWORD` and `SESSION_SECRET` with private values. The session secret should contain at least 32 characters.
3. Run `npm install`, then `npm start`.
4. Open `http://localhost:3000/admin.html` and sign in with the credentials from `.env`.

The local content file is `.data/content.json`. Keep `.env` and `.data` out of version control. The admin page includes a preview, filters by page and section, a search box, and a Save Changes button.

## Hosting

The public site is hosted separately from the Node.js backend. Deploy the public repository files (including `api-config.js` and `public-content.js`) to Vercel, and deploy the Node.js service to Render. Render serves the admin dashboard at `/` and `/admin.html`, its JavaScript/config assets, and `/api/*`; it does not host the public homepage or blog.

Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and `DATA_DIR` as private Render environment variables. Do not use example credentials in production. Set `SITE_ORIGIN` to the comma-separated exact origins for the deployed public site and Render admin (for example `https://pefrika-website.vercel.app,https://pefrika-admin.onrender.com`). Do not use `*`.

`api-config.js` sets the API origin, public preview origin, and the only admin origin allowed to control the cross-origin preview. These must match the actual deployment URLs. The dashboard and public preview exchange only inspected text/link data and edit commands through `postMessage`; both sides validate the exact peer origin and iframe window.

The content file must live on persistent storage. **Render's free plan does not provide a persistent disk**, so saved edits can be lost when its instance restarts, sleeps, or redeploys. Use a paid Render plan with a persistent disk and set `DATA_DIR` to its mount path (for example `/var/data`) to retain changes. The server also uses HTTP-only signed cookies, origin checks on writes, login throttling, restrictive link validation, and atomic content-file updates.

## Verify

Redeploy Vercel after publishing the public site/config changes and deploy the backend branch to Render. Check `https://pefrika-admin.onrender.com/api/health` and confirm the dashboard at `/` (or `/admin.html`) can sign in, preview both Vercel pages, and save a harmless test edit. Confirm `/index.html` and `/blog.html` on the Render host return 404.

For local development, temporarily use `http://localhost:3000` for the API, public site, and admin origins in `api-config.js`, and include that origin in `SITE_ORIGIN`. Do not commit local-only origin changes.

Run `npm test` to check sign-in, origin validation, access control, safe link handling, content writes, and the backend's restricted routes.
