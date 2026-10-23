# Matala Review Signals — Hosted App

A private, hosted Node.js app for scanning recent low-star review signals, reviewing leads, and exporting approved leads. Jobs, results, and decisions persist in PostgreSQL. The Outscraper key is encrypted at rest with AES-256-GCM and is never sent back to the browser.

## What is included

- Private password-protected workspace with signed, HttpOnly, SameSite session cookie
- Encrypted server-side Outscraper API key storage
- Country selection for NZ, Australia, USA, or any combination
- Custom search queries, scan limits, progress, stop request, saved scan history
- Persistent lead review decisions and approved-only CSV export
- Fictional demo, not exportable as real leads
- Render deployment blueprint and health check

## Deploy on Render

1. Put this folder in a GitHub repository you control. Do not commit `.env`, API keys, passwords, database credentials, or encryption secrets.
2. Create a managed PostgreSQL database in Render. Copy its **internal** connection URL for the web service if both are in the same region.
3. Create a Web Service from the repository, or use `render.yaml` as a blueprint. Choose Node 20+.
4. Configure environment variables in Render:
   - `DATABASE_URL`: Render PostgreSQL internal connection URL
   - `APP_PASSWORD`: a strong shared workspace password for you and Sanel; share it through a private channel
   - `SESSION_SECRET`: random secret of at least 32 bytes/characters (Render can generate it)
   - `KEY_ENCRYPTION_SECRET`: **base64-encoded 32 random bytes**
   - `NODE_ENV=production`
   - `DATABASE_SSL=true` (set `false` only for a trusted local database)
5. Generate the encryption secret locally using Node: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Save it in Render secrets. **If this secret is lost/changed, saved API keys cannot be decrypted; users will need to save the key again.**
6. Deploy. Open the HTTPS URL, sign in with `APP_PASSWORD`, paste an Outscraper key, click **Save key**, and run a small scan first.

The app does not deploy itself: repository access, Render account, database creation, environment secrets, and a live provider test require the owner's account and explicit action.

## Local development

Requires Node 20+ and a PostgreSQL database. Set the same environment variables and run:

```sh
npm install
npm start
```

Open `http://localhost:3000`. For local development, `DATABASE_SSL=false` may be used with a local PostgreSQL instance. Do not expose the development server to the public internet.

## Security and operational notes

- This is a **shared-password** MVP, not separate named user accounts. Anyone with the password has workspace access. Rotate `APP_PASSWORD` to revoke access; existing sessions may remain valid until their 7-day expiry unless the session secret is rotated or sessions are cleared in PostgreSQL.
- Outscraper key is encrypted in PostgreSQL. Database and environment variables must be kept private. Back up the database and encryption secret separately.
- Active scans run in the web process. Progress is saved after each provider call/business; if the service restarts mid-scan, the job is marked interrupted rather than silently claiming completion. A durable queue/worker should be added before long or high-volume production scans.
- Provider errors and cost are not fully predictable. Begin with 5–10 businesses and confirm current Outscraper billing. The app never starts a live scan until the user clicks Start.
- Country filtering relies on provider place metadata. Inspect results manually before outreach. This is a qualification aid, not proof of a business's operational fit.
- Review provider terms, rights to store/export review content, applicable privacy requirements, and outreach rules for the selected markets before production use.
- Optional AI grouping uses `OPENAI_API_KEY` configured on the server only. It is disabled unless that environment variable is supplied. The AI key is not entered or stored by this UI.

## Testing

`npm test` runs local unit tests and makes no paid provider requests. Deployment verification still needs a real Render URL, PostgreSQL credentials, and a small live Outscraper test.

## Free local desktop use (Windows + macOS)

This mode runs on the computer itself and binds the web app to `127.0.0.1` only. It uses Docker Desktop to run Node.js and PostgreSQL in containers; no paid hosting is needed. The first Docker image download requires internet and can take several minutes. Install Docker Desktop once on each computer:

- Windows: https://www.docker.com/products/docker-desktop/ — Docker Desktop must be running before launch.
- macOS: https://www.docker.com/products/docker-desktop/ — choose the correct Apple Silicon or Intel installer.

### Windows

1. Extract the project folder to a normal folder you can keep, such as Documents. Do not run it from inside the ZIP.
2. Double-click `Start-Matala-Windows.bat`.
3. On first run, save the generated workspace password displayed in the terminal. The `.env` file stores local secrets; do not share it or upload it to GitHub.
4. The launcher checks Docker, starts the app and database, waits for `/health`, and opens the browser.
5. To stop the services, double-click `Stop-Matala-Windows.bat`. Stopping does not delete database data.

### macOS

1. Extract the project folder to Documents or another permanent folder.
2. Open Terminal once and run `chmod +x launchers/*.command` from inside that folder if macOS says the launcher is not executable. Alternatively, right-click `launchers/start-matala.command` → Open.
3. Double-click `launchers/start-matala.command` (or right-click → Open on first launch). Save the generated workspace password.
4. Double-click `launchers/stop-matala.command` to stop services without deleting saved data.

### Desktop shortcuts

Create a shortcut/alias to `Start-Matala-Windows.bat` on Windows or `launchers/start-matala.command` on macOS. Keep the entire project folder in place: the shortcut starts the app from that folder. The app URL is `http://localhost:3000` and is only accessible from that computer.

### Data and limits

- Each computer has its own PostgreSQL volume and separate jobs/results. Local data is not shared or synchronized between computers.
- Do not run two copies using the same port on one computer.
- Do not use `docker compose down -v`; `-v` deletes the saved database volume.
- This launcher does not yet enforce a hard currency-based Outscraper spend cap. Until that is implemented, keep the app's business/review limits low and check Outscraper's current pricing before a live scan. A request limit reduces exposure but is not a guaranteed spend ceiling.
- The browser uses local HTTP, not public HTTPS; it is intentionally not exposed to the internet. Use the hosted deployment for shared remote access.
