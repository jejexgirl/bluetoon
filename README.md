# BlueToon portfolio (with private dashboard)

No dependencies. Needs Node.js 18+.

## Run on your computer
Double-click `start.bat` (or run `node server/main.mjs`) and open http://localhost:8080. The first start asks you to choose the dashboard password (or set `INITIAL_PASSWORD`).
Do not open index.html as a file: YouTube refuses to play videos on file pages (Error 153) and the dashboard needs the server.

## Open the dashboard
On any page of the site, type the secret word on the keyboard (not inside a text box): the sign-in box appears.
After signing in you can add and delete videos, channels, accounts and services, reorder everything (drag or arrows), upload logos, hide videos, and change the password. Press Save (or Ctrl+S) and the change is live for every visitor.

- Design tab: pick a ready theme (Cobalt, Violet, Ember, Forest, Rose, Mono, Gold, Daylight) or set each colour yourself, choose fonts, corner style, and switch effects (grain, cursor, timeline, faded views number, portrait, REC badge) on or off. The site changes live behind the panel; Save publishes it.
- Add a video: paste its link in Videos. Title, thumbnail, duration and real view counts are read from YouTube automatically.
- Add a channel: paste its link in Channels. Name, description and logo are read automatically.
- View counts refresh by themselves every 6 hours, or press "Refresh view counts".
- For the most reliable view counts, create a free YouTube Data API key and start the server with `YT_API_KEY=your_key` (Windows: `set YT_API_KEY=your_key` first). The key stays on the server.

## Free hosting on GitHub Pages (no server)
See `PUBLISH-ON-GITHUB-AR.md` (Arabic, step by step). In this mode the dashboard saves to your repository with a GitHub token,
and a GitHub Action reads titles, logos and view counts from YouTube and publishes the site (`scripts/`, `.github/workflows/pages.yml`).
Build locally with `node scripts/build.mjs` (writes `_site/`).

## Put it online with a Node server instead
It must run on a host that can run Node and keep files (not Netlify/GitHub Pages, which are static only):
Render, Railway, Fly.io, or any VPS.

1. Upload this folder. Start command: `node server/main.mjs`.
2. Add a persistent disk and set `DATA_DIR` to its path (this is where saved content, uploads, backups and the password hash live).
3. Set `TRUST_PROXY=1` (the host puts a proxy in front). The host provides https: use it, never sign in over plain http on the internet.
4. The host sets `PORT` automatically.

## Security notes
- The password is never stored in any file or sent to visitors; the server keeps only a salted scrypt hash and compares it on the server.
- Five wrong passwords lock that connection for 15 minutes. Sessions use an HttpOnly, SameSite=Strict cookie plus a CSRF token; they end after 2 idle hours.
- The dashboard code is only sent to a signed-in session.
- Everything saved is validated on the server (https links only, images must be real JPG/PNG/WebP/GIF, no SVG), and shown on pages as plain text.
- Strict Content-Security-Policy, no inline scripts, clickjacking protection.
- Every save keeps a backup in `data/backups` (last 30).
- Change the first password from the Security tab right after you start. Lost password: delete `data/auth.json` and restart with `INITIAL_PASSWORD=...` set once.

## Tests
`npm test`
