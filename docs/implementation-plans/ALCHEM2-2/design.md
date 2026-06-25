# ALCHEM2-2 — Headless API Starter Template

## What was built

Converted `alchemist-template-api` from an exact copy of the full-stack
`alchemist-template` (Deno 2 + Hono 4 + Svelte SPA) into a clean
**headless API starter template**: a pure Hono API with no web frontend.

This template is selected by `create_project(template_key='api')` and
uses `buildProfile: headless` — the Alchemist customer-build pipeline
skips the SPA build stage for headless templates entirely.

## Key changes

### Removed

- Entire `web/` directory: Svelte SPA, Vite, `web/package.json`, component
  library, stores, CSS, public assets.
- `web-builder` stage from `Dockerfile` and the `COPY --from=web-builder` step.
- `serveStatic` import and two SPA mount blocks from `app.ts` (the `/`
  catch-all fallback and the `/assets` static route).
- `hono/deno` import and `web/` lint-exclude from `deno.json`.
- Web-related tasks from `scripts/dev.sh`, `scripts/setup.sh`,
  `scripts/eject.sh`, `scripts/apply-observability-to-clones.sh`.
- `WEB_APP_URL` and `web/dist` from `.env.example` / `.gitignore`.

### Updated

- `app.ts`: non-API requests now fall through to the JSON 404 handler
  (`{"error":"Not found"}`), confirming there is no SPA fallback.
- `README.md` and `CLAUDE.md`: full rewrite describing the headless
  profile, `create_project` usage, Deno 2/Hono 4 conventions, and
  where to add new routes.
- `.claude/rules/auth.md`: removed client-mirror references; stated
  roles/capabilities are server-only in this template.
- `scripts/dev.sh`: API-only; accepts (and ignores) `--port` for
  backward compatibility.
- Test files: removed `web/src/**` source-shape lints that no longer apply.

## Key decisions

### Why headless (no SPA)?

Some generated projects need only an API — mobile apps, integrations,
pure backend services. Forcing them to carry Svelte/Vite/npm adds
build time, dependency surface, and cognitive overhead. The headless
template is the minimal viable starting point for those use cases.

### WEB_APP_URL / OAuth / Stripe redirect targets left for the `headless` ticket

`src/api/routes/auth/index.ts` and `src/api/routes/billing/index.ts`
still read `WEB_APP_URL` for OAuth callback redirects and Stripe
return URLs. These are **server-controlled env values, not user input**,
so they pose no security risk, but their fallback (`localhost:5173`) is
vestigial. The ticket scoped these as pre-existing runtime logic owned
by the sibling `headless` ticket — they are not changed here.

### `buildAcceptUrl` hash-route left for the `headless` ticket

`src/services/invite.service.ts:buildAcceptUrl` still returns a
`/#/invite/<token>` hash-route URL targeting the removed SPA. Same
disposition: pre-existing, untouched file, owned by the `headless`
ticket. API clients consume the invite endpoints directly.

### `serveStatic` removal makes `GET /` return 404

Without the SPA fallback, any request to a non-`/api/*` path returns
`{"error":"Not found"}` (HTTP 404). This is correct for a headless API.
Verified: `GET /health` → 200, `GET /` → 404.

### Dev-route gate is `ALCHEMIST_DEV_ROUTES`, not `NODE_ENV`

The dev routes (`/api/dev/*`) are gated by `devRoutesEnabled()` in
`src/lib/dev-mode.ts`, which reads `ALCHEMIST_DEV_ROUTES` (positive
opt-in, fail-closed). The old `NODE_ENV !== "production"` gate was
fail-open. The CLAUDE.md and test files were corrected to reflect this.

## Public contract

- `GET /health` — `{"status":"ok","db":"ok"}` (always public)
- `POST /api/auth/send-otp`, `POST /api/auth/verify-otp` — OTP auth
- `GET /api/auth/me` — session info (requires auth)
- All other routes defined in `src/api/routes/` — see `app.ts` for mounts
- Non-API paths → `{"error":"Not found"}` (HTTP 404)

## Non-obvious gotchas

1. **`deno task test:fast` references `src/__tests__/routes/`** which does
   not exist (only `services/`). The full `deno task test` task works (78/78).
   Not fixed here to avoid scope creep; the `test:fast` task will skip the
   non-existent dir silently.

2. **`src/api/routes/dev/index.ts` description strings** still mention
   `web/src/lib/devpanel/` in two places (lines 691, 862). Pre-existing
   cosmetic comments in an untouched file; harmless.

3. **`src/lib/roles.ts` and `src/lib/oauth-providers.ts`** have comments
   referencing `web/src/lib/permissions.ts` and `Login.svelte`.
   Pre-existing cosmetic comments; do not affect runtime.
