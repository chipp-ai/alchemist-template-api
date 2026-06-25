# Headless API Template

## What was built

Converted the full-stack Alchemist template (Deno + Hono API + Svelte SPA)
into a **headless API starter**: a pure Hono 4 JSON API with no bundled
frontend. The resulting template boots with no `web/` directory, no Vite build,
and no static-file serving.

Selected by `create_project(template_key='api')` with `buildProfile='headless'`
— the Alchemist platform skips the web SPA build stage for headless templates.

## What changed

### Removed
- `web/` directory (entire Svelte SPA: components, routes, stores, lib, Vite
  config, package.json).
- `serveStatic({ root: "./web/dist" })` SPA mount from `app.ts`.
- The `/*` catch-all route that served `index.html` for client-side routing.
- `hono/deno` import from `deno.json` (used only by `serveStatic`).
- `--port`/`VITE_PORT` arguments from `scripts/dev.sh`.
- Node/npm/web-deps install block from `scripts/setup.sh`.
- `web-builder` Docker stage and `COPY --from=web-builder /web/dist` from
  `Dockerfile`.

### Added / updated
- `src/api/routes/example/index.ts` — `GET /api/hello` starter route returning
  `{ data: { message, time } }` as the canonical example for new routes.
- `src/__tests__/routes/example_test.ts` — integration test for the example route.
- `app.ts` — `app.route("/api", exampleRoutes)` (after all other `/api/*` mounts
  so it doesn't shadow existing routes).
- `WEB_APP_URL` in `.env.example` — documented as the client redirect target for
  OAuth/Stripe flows; falls back to `APP_URL ?? localhost:8000`.
- `README.md`, `CLAUDE.md`, `.claude/rules/auth.md`, `.claude/local-dev.md` —
  re-scoped to headless API.

## Key decisions

### Why keep the full auth/billing/invite/org surface

The headless template ships a complete backend with auth (OTP + OAuth), Stripe
billing, RBAC, invite flow, email, and file storage. These are the building
blocks any API project needs. The operator strips what they don't use; starting
from the full surface is cheaper than adding it later.

### `WEB_APP_URL` replaces the implicit `:5173` Vite fallback

OAuth callbacks and Stripe return URLs need a destination that belongs to the
*client*, not the API. The old default was `localhost:5173` (the Vite dev
server) — fine for the full-stack template, wrong for headless. The replacement
chain is `WEB_APP_URL ?? APP_URL ?? localhost:8000`. In a headless deploy the
operator MUST set `WEB_APP_URL` to their own client's origin.

### Invite accept URL: `/#/invite/:token` → `/invite/:token`

The email link used a hash-route fragment (`/#/invite/…`) because the old SPA
used hash-based routing (`svelte-spa-router`). Hash fragments are invisible to
HTTP servers, so the link was SPA-only by construction. The headless template
emits a plain path (`/invite/:token`) — the client decides its own routing
convention when it builds the accept page.

### Catch-all 404 behaviour

Removing the `/*` SPA catch-all means unmatched paths now return the Hono
default JSON 404 (`{"error":"not found","code":"NOT_FOUND"}`). This is
intentional: a headless API should return JSON everywhere, not silently serve
an HTML shell.

## Public interface

```
GET  /health           → { status, db, version, uptime }
GET  /api/hello        → { data: { message: string, time: string } }
# All other routes from the full-stack template remain (auth, org, billing, …)
```

## Gotchas

- **`WEB_APP_URL` is required** for OAuth and Stripe redirect flows to land
  somewhere useful. Without it, the user's browser is redirected back to the
  API, which returns a JSON 404.
- **No `web/` means no `deno task check` coverage for web/src/** — type-check
  the API only: `deno task check` targets `main.ts`.
- **The `serveStatic` import (`hono/deno`) was removed from `deno.json`** — do
  not re-add it unless you intend to serve static files from the API. The import
  pulls in the `@hono/node-server` static-file adapter.
- **`/api/dev/login` GET magic-link** redirects to `/`, which returns a JSON 404
  in headless mode. The agent path is `POST /api/dev/login` (returns JSON); the
  GET form is intended for browser use only and works only when a client is
  serving `/`.
