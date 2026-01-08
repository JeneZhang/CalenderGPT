# CalenderGPT / AvailableTime – Copilot instructions

## Big picture
- Two-part app:
  - `backend/` is a FastAPI JSON API (single-file service in `backend/main.py`).
  - `frontend/` is a Vite + React + TypeScript SPA.
- Persistence is file-based: app settings live in `settings.json` at repo root and are read/written by the backend.

## Backend (FastAPI)
- Main entrypoint: `backend/main.py`.
- Core behavior:
  - Working hours window: 07:30–18:00 local per timezone.
  - Slots are 30-minute increments across a base timezone “local day”.
  - Computes `perfect_overlap` and a summary (`best_slot`, plus expanded-window 07:00–21:00 suggestion).
- Key API endpoints (frontend relies on these exact shapes):
  - `GET /api/settings` → `{ settings: { base_timezone, timezones } }`
  - `POST /api/settings/timezones` → updates `settings.json` (keeps base timezone included)
  - `GET /api/timezones?q=...&limit=...` → IANA tz names (uses `zoneinfo.available_timezones()`)
  - `GET /api/slots?day=YYYY-MM-DD` → slots + `summary`
- Date parsing: backend expects ISO `YYYY-MM-DD` (`_parse_date`).

## Frontend (React)
- App UI lives in `frontend/src/App.tsx` + styles in `frontend/src/App.css`.
- API wrapper is `frontend/src/api.ts` (typed fetch helpers). Prefer adding new endpoints/types there.
- Dev server proxy: `frontend/vite.config.ts` proxies `/api` → `http://localhost:8000`.
  - Optional override: set `VITE_API_BASE_URL` to call a hosted backend.

## Developer workflows
- Backend:
  - Install: `pip install -r backend/requirements.txt`
  - Run: `uvicorn backend.main:app --reload --port 8000`
  - Windows note: `tzdata` is required so `zoneinfo.ZoneInfo("Asia/Shanghai")` works.
- Frontend:
  - Install: `cd frontend && npm install`
  - Run: `npm run dev` (default http://localhost:5173)
  - Build: `npm run build`
  - Lint: `npm run lint`

## Project-specific conventions
- Keep UI minimal (Outlook/Teams-like day grid): timezone rows × 30-min columns.
- Timezone ordering matters: backend returns `per_timezone` in the same order as `settings.timezones`; UI assumes alignment by index.
- Settings normalization is backend-owned: invalid tz names are dropped; base tz is forced into the list.
