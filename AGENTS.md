# AGENTS.md

## Cursor Cloud specific instructions

### Project overview
AvailableTime is a two-service web app for finding overlapping meeting slots across timezones. See `.github/copilot-instructions.md` for architecture details and developer workflows.

### Running services
- **Backend** (port 8000): `uvicorn backend.main:app --reload --port 8000` from the repo root.
- **Frontend** (port 5173): `npm run dev` from `frontend/`. Vite proxies `/api` to `http://127.0.0.1:8000`.
- Start the backend **before** the frontend so the proxy has a target.

### Lint / Build / Test
- **Lint**: `npm run lint` in `frontend/` (ESLint).
- **Build**: `npm run build` in `frontend/` (TypeScript + Vite). Note: there is a pre-existing TS error (`tz_aliases` not in the local state type at `App.tsx:217`); the Vite dev server ignores this, but `tsc -b` will fail.
- **No test framework** is configured in either backend or frontend.

### Caveats
- `uvicorn` installs to `~/.local/bin`; ensure `PATH` includes it (e.g. `export PATH="$HOME/.local/bin:$PATH"`).
- The Vite dev server binds to `localhost` only (not `127.0.0.1` by default on some systems). Use `http://localhost:5173` for curl checks.
- Persistence is via `settings.json` at the repo root; no database is needed.
