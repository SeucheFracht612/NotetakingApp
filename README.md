# NotetakingApp

A personal, self-hostable research and lecture-note workspace. One owner per installation; **no public registration, shared hosted service, or preconfigured credentials**.

> **Status: Slice 0 — foundation.** Sign-in and an empty responsive workspace are implemented. Folders, notes, spatial page navigation, images, and PDF/ink functionality are **not** implemented yet. See [Issue #1](https://github.com/SeucheFracht612/NotetakingApp/issues/1).

## Requirements

- Node.js 22+ and npm for development.
- Docker with Compose plugin for self-hosting.
- An HTTPS reverse proxy such as Nginx when exposing the app on the Internet.

## Local development

1. Clone this repository and run **npm install**.
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

- **Slice 1:** folder hierarchy and note library.
- **Slice 2:** sparse spatial page grid with **explicit directional edge attachments**. Adjacent pages are not automatically linked; navigation follows attachments only. Invalid insertions reject atomically.
- **Slice 3:** rich-text editor and safe autosaving.
- Later: asset blocks, checkpoints and off-site backups, PDFs, handwriting, Zotero, search, export.

## License

The repository is public and intended to support self-hosting, but a redistribution license has **not yet been chosen**. Please get permission from the copyright holder before redistributing or publishing modifications. We will add an explicit license after that decision.
