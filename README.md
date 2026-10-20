# NotetakingApp

A personal, self-hostable research and lecture-note workspace. One owner per installation; **no public registration, shared hosted service, or preconfigured credentials**.

> **Status:** Slices 0–3 are merged into main. **Slice 4 — unified canvas and freeform objects** is under review in [PR #10](https://github.com/SeucheFracht612/NotetakingApp/pull/10) on branch `feat/slice-4-unified-canvas`. Image uploads, inking, diagram drawing, PDF embedding and auto-pagination are not yet implemented.

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
- For attached-only navigation use the visible Go controls or **AltGr + Arrow** on a German/Linux keyboard (right Alt, not ordinary Alt). Firefox on Linux reports this modifier as `AltGraph`. This also works while the text editor is focused; **Ctrl + Arrow** remains available for cursor/word movement and **Super + Arrow** remains available to the desktop window manager.
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


## Test Slice 3: rich-text editing (feature branch)

Stop your dev server, then from an existing clone:

    git fetch origin
    git switch feat/slice-3-rich-text
    npm ci
    npm run dev

Use your existing owner account; migrations are additive. Open a note from the sidebar and create a page if needed. **Click a page to select it; the selected page becomes editable.** Use the formatting toolbar for bold/italic/underline/strike, headings (H1–H3), bullet/numbered lists, quotes, code, rules, undo and redo. Content is stored as semantic TipTap/ProseMirror JSON, never as arbitrary HTML.

**Autosave:** editing starts a ~1-second debounce. Wait for **Saved** (green) before assuming the server accepted your edits. **Saving** means a request is in progress; **Unsaved** indicates pending work. Failed/offline saves leave the draft in browser session storage, with a **Retry save** option; a 409 conflict explicitly says your draft was kept and offers **Copy draft**. **Discard draft & reload** permanently discards your local version and should only be used intentionally. Closing the browser tab with pending edits triggers an unsaved-work warning where supported.

Text is bound to its **own page**, independently of the spatial attachment graph. Inserting/moving adjacent pages never moves their writing. Page document revisions are independent of note-layout revisions. A4 content that runs beyond its writing area shows an overflow warning and remains scrollable/editable **inside that page**. No automatic page continuation or text splitting is performed.

### Rich document API

Authenticated owner API (same-origin mutations):

- \`GET /api/notes/:noteId/pages/:pageId/document\` returns \`{ noteId, pageId, revision, doc, updatedAt }\`. New pages expose a revision-0 empty document without an insert.
- \`PUT /api/notes/:noteId/pages/:pageId/document\` accepts \`{ expectedRevision: 0, doc: { type: "doc", content: [...] } }\`. Success increments the content revision; stale revision returns **409 without changing data**. Invalid content, arbitrary HTML nodes/marks, or oversized documents return **400**.
- Documents are scoped by note/page UUIDs and deleted with their pages by SQLite foreign keys. No upload URLs or HTML tags are accepted.

### Slice 3 manual acceptance checklist

1. Type paragraphs, headings, bold/italic, nested lists and quotations. Refresh and confirm the content remains.
2. Switch between pages during typing. Return and confirm the pending work is still there; check the **Saved** indicator.
3. Open the same page in two Firefox tabs, edit one, then the other. The stale tab must report a conflict and must not overwrite the first edit.
4. Stop the backend, type more text, and check the offline warning; reconnect and use Retry save.
5. Fill more than one A4 page: overflow should be warned about, not clipped or silently moved to another page.
6. Check a tablet-sized Firefox viewport. Ctrl + Arrow moves within text normally, and **AltGr + Arrow** navigates attached pages even while writing.

**Not included:** image/PDF attachment, inking, cross-page flowing paragraphs, merging conflicting drafts, collaboration, or remote deployment. A successful CI run does not replace the manual checks above.


## Slice 4: unified A4 + freeform canvas

Try locally:

    git fetch origin
    git switch feat/slice-4-unified-canvas
    npm ci
    npm run dev

Existing owner, folder, note, spatial layout, and page contents are preserved by **additive migration 5**. As usual, back up a valuable database before testing development branches.

### Everyday workflow

- Open any note. Its **A4 pages and movable cards inhabit the same scrollable canvas**; there is no separate canvas mode. The library sidebar can be collapsed using the top-left button.
- The **formatting toolbar is outside the A4 sheet**. The selected page is editable and its confirmed save status appears in the heading. Other pages show compact previews of actual saved text, fetched via one authenticated request rather than mounting an editor for each page.
- Use **+ Sticky**, **+ Text**, or **+ Quote** for freely positioned, overlapping cards. New objects initially appear near the current page. Drag a card by its header, resize it from its bottom-right handle, and type inside its text area. This slice stores **plain text** in cards, with a 6000-character bound.
- Use the contextual **+** buttons beside a selected page edge to append/insert A4 sheets. Empty insertions happen directly; when existing page groups must shift, the prior preview and confirmation are still required. Nearby unlinked A4 pages show an explicit attachment action (↔).
- Open **Page actions** for the detailed directional actions (navigate, attach, detach, delete) and **Overview** for the page map. Neither occupies the writing area by default.
- Pan via trackpad/scroll or drag the **empty canvas background**. Use zoom controls or Center page to focus the selected A4 page. **AltGr + Arrow** continues to follow explicit page attachments; Ctrl + Arrow remains for text cursor navigation.
- Card edits are debounced and saved separately from A4 content. A saved status only appears after an API acknowledgement; if a card cannot be saved, its text remains as a browser-session draft with Retry/Copy controls. Two tabs changing the same card get a revision conflict and **do not overwrite each other**. Freeform cards are independent of page movement.

The design follows the minimal grayscale UI reference (near-black in system dark mode with restrained accent, and a light equivalent) across the login, library, workspace, dialogs and canvas.

### Freeform canvas API

Routes are owner-only and enforce the existing same-origin protections:

- \`GET /api/notes/:noteId/canvas\` returns \`{noteId,version,items}\`.
- \`POST /api/notes/:noteId/canvas/items\` takes \`{kind,x,y,width,height,content?,expectedVersion}\` to create an item (sticky/text/quote). Note-wide version prevents stale creation.
- \`PATCH /api/notes/:noteId/canvas/items/:itemId\` takes \`{expectedRevision,x?,y?,width?,height?,content?}\`; each successful change increments **that item's** revision.
- \`DELETE /api/notes/:noteId/canvas/items/:itemId\` takes \`{expectedRevision}\`.
- \`GET /api/notes/:noteId/page-previews\` returns short, plain-text excerpts of the note's A4 page contents for efficient canvas viewing.

Coordinates and dimensions are bounded integer world units, but **not snapped to the A4 grid**. A card may overlap a page. Card state is scoped per note; deleting the note cascades the objects. No HTML content is inserted or rendered by the API.

### Slice 4 acceptance checklist (Firefox and tablet)

1. In an existing note, add all three types of cards, write text, move and resize them, refresh the browser, and check positions and content.
2. Add two cards close together and intentionally overlap them. Confirm the page attachments and page insertion mechanics still work; freeform cards should stay in place during page insertion.
3. Open another note. Its canvas items should be independent. Confirm page previews display saved document text.
4. Try Ctrl + Arrow while editing, AltGr + Arrow for attached-page navigation, zoom, empty-background drag to pan, library collapse and reopen, and tablet screen sizing.
5. Add an A4 page to a note started with only freeform cards. Try both a simple page addition (no confirmation) and an insertion requiring displacement (confirmation).
6. Test card autosave and conflict recovery: edit the same card from two browser tabs, then verify a stale update is rejected without silently losing the local text.
7. Check both system light and dark themes, mobile folder navigation, formatting toolbar and status display.

**Not included yet:** image/PDF uploads, ink/handwriting, drawing/diagrams, true freeform connectors, multiple-selection/group dragging, rich text inside freeform cards or automatic cross-page text flow. No VPS deployment performed. PR #10 stays draft pending manual acceptance.


## Slice 4B: Continuous A4 writing flows (experimental, unmerged)

This iteration changes the architecture of text inside the **open Slice 4 PR**. The previous Slice 4 plain freeform system remains, but now has quiet styling and proper quotation source fields. It has **not** received hands-on Firefox acceptance.

### Data integrity and behavior

- **Real A4**: 210 × 297 mm document geometry, fixed 16px text layout, ~25mm margins. At every zoom level the *whole sheet* scales together. CSS millimeters are print-related units (96 CSS px/inch), not a guarantee that a particular monitor is calibrated to real centimeters.
- **One canonical writing document per branch**: migration 6 creates writing flows and copies earlier per-page TipTap JSON into independent root flows. The API lazily adopts pages made after that migration, preserving their existing content/revision. Existing document content is not merged into its spatial neighbors.
- **TipTap v3 pagination**: the MIT-licensed \`tiptap-pagination-plus\` extension lays out one ProseMirror editor through successive vertical A4 sheets. This preserves editing selection/undo across page breaks within a writing flow; the paginated visual pages correspond to graph continuation members.
- **Physical continuation**: once a saved flow needs another page, the client checks the insertion plan under the tail's southern edge. If no existing page needs to move, it appends a new attached sheet automatically. If pages would shift, a **confirmation dialog** shows the displacement before anything moves. The API repeats the calculation atomically and rejects stale versions or impossible collisions.
- **Protected continuation edges**: you can't delete continuation sheets separately or insert another page between two automatically continued sheets via the manual page controls. Other independent A4 branches keep their own writing flows.
- **No silent deletion**: reducing the text length can leave empty continuation sheets; automatically deleting them is deferred until we can prove there is no branch or saved content attached. Writing isn't discarded just to shrink the graph.
- **Stale tabs**: old per-page save requests are rejected with HTTP 409 after their page joins a flow. The older tab keeps its locally recoverable draft. Document saves have their own optimistic revisions and browser-session recovery.

### Freeform annotations

- Sticky notes now use the same neutral surface palette, rather than an arbitrary brown/yellow color. Hover/select to reveal movement/deletion controls.
- Plain text cards can be frameless; all annotations scale as complete objects at canvas zoom.
- Quotations now have distinct serif/italic presentation plus **source** (up to 350 characters) and **locator/page** (up to 80 characters) persisted as separate validated fields via migration 7. This is a first step toward source-backed citations; no Zotero integration yet.

### Test instructions

    git fetch origin
    git switch feat/slice-4-unified-canvas
    npm ci
    npm run dev

Use a fresh test note rather than your only important lecture, and make a backup of \`.data/\` first. Test in Firefox on the laptop:

1. Write a continuous 2–3-page text in a new A4 branch. Check the cursor, formatting, lists, text search, undo/redo and content after refreshing.
2. Reach the bottom of the first sheet by typing normally. Confirm the next sheet appears **below**, attached in the spatial graph, with no split into independent documents.
3. Create an unrelated page directly below another writing-flow root, then type until the root needs a continuation. Confirm you see a displacement warning, can cancel, and no writing is lost. Confirm acceptance only moves exactly the previewed pages.
4. Switch among continuation sheets and other branches. Check the editor's caret/undo remains stable within a flow; test AltGr+Arrow and conventional Ctrl+Arrow text navigation.
5. Test a multi-paragraph paste, deletion that causes reflow back toward earlier pages, headings and lists, and document reload. Report any Firefox pagination misalignment or caret jumps.
6. Add, type, move and resize all three freeform object kinds. Confirm quotation source/locator fields persist, cards do not obscure their document unexpectedly, and both light/dark appearance and Galaxy Tab S9 navigation remain usable.
7. Open two tabs, edit one flow in both, and verify the stale tab's save is rejected rather than overwriting the first.

**Explicit limitations:** pagination comes from a newly integrated third-party extension and has not been browser-verified in this PR. The page geometry and continuation synchronization still need careful manual Firefox checks. The extension is capped at 50 auto-continued visual sheets for safety. No print/PDF guarantee, automatic deletion of blank continuation pages, full source citation manager, image/ink/diagram tools or deployment yet.

The page-number/preview layer is still simplified for inactive branches. Do **not** merge PR #10 based on CI alone.
