# NotetakingApp

A personal, self-hostable research and lecture-note workspace. One owner per installation; **no public registration, shared hosted service, or preconfigured credentials**.

> **Status:** Slice 0 and Slice 1 are merged into main. **Slice 2 spatial pages** is under review in [PR #6](https://github.com/SeucheFracht612/NotetakingApp/pull/6) on branch `feat/slice-2-spatial-pages`. Rich-text editing, images, and PDF/ink are **not** implemented yet.

## Requirements

- Node.js 22+ and npm for development.
- Docker with Compose plugin for self-hosting.
- An HTTPS reverse proxy such as Nginx when exposing the app on the Internet.

## Local development

1. Clone this repository and run **npm ci**.
2. Optionally configure environment variables in your shell (see **.env.example**). Development defaults work without any .env file; environment files are *not* automatically loaded.
3. Run **npm run owner:create** from an interactive terminal. Enter and confirm an owner password (at least 12 characters); input is hidden. This creates the sole owner, once per installation.
4. Run **npm run dev**.
5. Open **http://localhost:5173** in Firefox. Sign in with the password you created.

The development frontend proxies /api to the Fastify backend (port 3000). SQLite data is stored in .data/ and excluded from Git.

### Commands

| Command | Description |
| --- | --- |
| npm run dev | Start Vite and the API together |
| npm run dev:web | Start frontend only |
| npm run dev:server | Start backend only |
| npm run owner:create | One-time interactive owner provisioning in development |
| npm run migrate | Apply SQLite migrations (also applied automatically at startup) |
| npm run lint | Run ESLint |
| npm run typecheck | Validate server and browser TypeScript |
| npm test | Run server integration tests |
| npm run build | Build production frontend and server |

There is no password reset UI yet. Do not delete your database or lose your password without having a recovery strategy.

## Self-host with Docker Compose

1. Clone the repository on a server with Docker and its Compose plugin.
2. Set your **APP_ORIGIN** to the real public HTTPS origin, for example by creating a local, uncommitted .env containing **APP_ORIGIN=https://notes.example.com**.
3. Run **docker compose up -d --build**. By default the service binds on **127.0.0.1:3000 on the host**, never a public interface.
4. Provision that installation's owner account by running **docker compose exec -it app node apps/server/dist/cli/create-owner.js**.
5. Put an existing HTTPS reverse proxy in front of http://127.0.0.1:3000 and open your HTTPS domain.

Example Nginx proxy location inside an existing HTTPS server block:

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

Set **APP_PORT** if the default host port 3000 is already used. The API and frontend are served on the same origin in production. Startup refuses a missing APP_ORIGIN or an APP_ORIGIN that does not use HTTPS. Incorrect APP_ORIGIN blocks state-changing requests from browsers.

Each deployment is independent. The SQLite database and session data live in a persistent local Docker volume named **notes-data**. No author-specific domain, external identity provider, or upstream account is needed. The service runs as a nonroot user in a container with a read-only root filesystem; only the SQLite volume and /tmp are writable.

### Backups and upgrading

**Backup automation has not been implemented in Slice 0.** Arrange consistent off-host backups before storing valuable research. SQLite databases using WAL must be backed up with SQLite's online backup facility or after a clean shutdown; avoid copying only the live .sqlite file. A future slice will add and test automated backups. Back up before changing versions.

## Authentication and security

- One owner per deployment, created only by an interactive server-side CLI. There is no public sign-up endpoint.
- Passwords are stored using Argon2id, not in source files or environment variables.
- Server-side sessions have random opaque tokens; only token hashes are stored in SQLite. Sessions survive restarts, expire after seven days, and are revoked on logout.
- Session cookies use HttpOnly and SameSite=Lax. Production cookies also use Secure over HTTPS.
- Login attempts are rate-limited; state-changing requests require a matching Origin; the API does not trust arbitrary forwarded-proxy headers.
- The public /api/health endpoint reveals only status. Owner data requires authentication.

The app is single-user by design, but **not** single-installation. Anyone deploying it receives a separate owner account and isolated local data.

## Development roadmap

- **Slice 1:** folder hierarchy and note library (in development on `feat/slice-1-library`).
- **Slice 2:** sparse spatial page grid with **explicit directional edge attachments**. Adjacent pages are not automatically linked; navigation follows attachments only. Invalid insertions reject atomically.
- **Slice 3:** rich-text editor and safe autosaving.
- Later: asset blocks, checkpoints and off-site backups, PDFs, handwriting, Zotero, search, export.

## License

The repository is public and intended to support self-hosting, but a redistribution license has **not yet been chosen**. Please get permission from the copyright holder before redistributing or publishing modifications. We will add an explicit license after that decision.


## Test Slice 1 locally (feature branch)

From an existing clone:

    git fetch origin
    git switch feat/slice-1-library
    npm ci
    npm run dev

No need to recreate your owner account. SQLite migrations run automatically and add library tables without deleting your account or sessions. If you have a local production database with important data, make a consistent backup before testing new branches.

In Firefox: create a top-level folder; add subfolders from the folder menu; create and open notes; rename/move items using their menus; change order with Move up/Move down. On desktop you can also drag a folder onto another folder to nest it. On tablets and keyboards use the menus rather than drag-and-drop. Selecting a note deliberately shows a placeholder until the editor slice.

The \`GET /api/library\` endpoint returns flat \`folders\` and \`notes\` arrays with parent/folder IDs and sort keys; clients build the hierarchy. Protected mutation routes are \`POST/PATCH/DELETE /api/folders\` and \`POST/PATCH/DELETE /api/notes\` (PATCH/DELETE require a UUID in the URL). Request JSON for create: \`{ "name": "...", "parentId": null }\` or \`{ "title": "...", "folderId": "<uuid>" }\`. Rename/move/reorder using PATCH fields \`name\`/\`title\`, \`parentId\`/\`folderId\`, and/or \`beforeId\` (UUID of a sibling, or null for last position). JSON payloads are validated. Missing items return 404, malformed values return 400, invalid folder cycles / nonempty deletions return 409.

Nonempty folders must be emptied or their contents moved first. Note deletion is permanent at this stage, so confirm carefully. Checkpoints/restore are not implemented yet.


## Try Slice 2: spatial pages (development branch)

From your existing clone, stop the development server and run:

    git fetch origin
    git switch feat/slice-2-spatial-pages
    npm ci
    npm run dev

Sign in and select a note in the sidebar. Click **Create first page** if that note does not yet contain pages. Pages have fixed A4 proportions (210:297) and positions on a signed integer grid. They remain blank in this slice; actual note editing follows in Slice 3.

### Editing a page layout

- Click a page on the canvas or minimap to select it.
- Use the directional controls to **Go** to an explicitly attached neighbor, **Add** a page to an open edge, or **Insert** between attached pages. Every insertion shows a preview and requires confirmation.
- Pages that merely touch on the grid are **not** automatically attached. Use **Attach existing** to create an explicit link to an adjacent unlinked page.
- Use **Detach** to intentionally remove an attachment while retaining both pages and coordinates. Insertion operations never silently detach existing connections.
- A connected B-side group shifts one cell when inserting between A and B. If that shift hits independent groups, the planner pushes each group rigidly in the same direction. If any pinned/anchored page would need to move, the whole insertion is rejected transactionally. Inserting into a cycle is rejected because A and B remain connected by another path.
- A leaf page can be deleted after confirmation. Pages with two or more attachments cannot be deleted in this slice.
- For attached-only navigation use the visible Go controls or **Ctrl + Arrow** while the spatial view is focused. The app no longer uses Super/Meta + Arrow, because Linux window managers commonly reserve those combinations for window movement or resizing.
- Scroll the canvas to pan, or use zoom and Center page. The overview lets you select any page.
- The database records the complete layout under a per-note revision. If another tab changes the layout before you confirm, the server returns HTTP 409 and the UI reloads the newer version instead of overwriting it.

**Persistence:** database migration 3 is additive; owner accounts, sessions, folders and note metadata are preserved. Back up any valuable local data before checking out development branches. Note-page content does not exist yet, and backups/checkpoints are not implemented.

### Spatial page API

These endpoints live under \`/api/notes/:noteId/pages\` and require the logged-in owner session. All mutations require the existing same-origin protections.

| Method | Suffix | JSON body |
| --- | --- | --- |
| GET | (none) | no body; returns \`{noteId,version,pages,edges}\` |
| POST | \`/initialize\` | \`{expectedVersion}\` — one initial page at (0,0) |
| POST | \`/preview\` | \`{anchorId,direction,expectedVersion}\` — no writes |
| POST | \`/insert\` | \`{anchorId,direction,expectedVersion}\` — transactionally apply insertion |
| POST | \`/link\` | \`{fromPageId,toPageId,direction,expectedVersion}\` — attach adjacent pages |
| POST | \`/unlink\` | \`{fromPageId,direction,expectedVersion}\` — explicitly remove a link |
| DELETE | \`/:pageId\` | \`{expectedVersion}\` — delete a leaf page only |

Directions are \`N\`, \`E\`, \`S\`, or \`W\`. Pages and edges have UUID IDs scoped to a note. A wrong layout version or impossible insertion returns HTTP 409; malformed requests return HTTP 400, missing notes return 404, and missing owner sessions return 401.

The graph solver is pure and tested independently of SQLite. Its invariant checks require unique coordinates, signed bounds, at most one attachment per side, and exactly adjacent endpoints.
