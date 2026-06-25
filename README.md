<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="Alchemist API Template" width="520">
  </picture>
  <p><strong>A headless API starter template for Alchemist AI projects. Deno 2 + Hono 4, no frontend.</strong></p>
  <p>
    <a href="#quick-start">Quick Start</a> &#8226;
    <a href="#whats-in-the-box">What's in the Box</a> &#8226;
    <a href="#architecture">Architecture</a> &#8226;
    <a href="#adding-routes">Adding Routes</a> &#8226;
    <a href="#working-with-ai-agents">Agents</a> &#8226;
    <a href="#license">License</a>
  </p>
</div>

---

**This is the headless API starter template** (`buildProfile: headless`) used by `create_project(template_key='api')` on the [Alchemist AI](https://adaas.dev) platform.

It is a minimal, production-grade Hono API with no web frontend. The customer-build pipeline skips the SPA build stage for this template, so the repo must build and boot with no `web/` directory and no static asset serving.

It ships with auth, billing, RBAC, structured logging, and an idiomatic Kysely + services layout, plus a `CLAUDE.md` authored so AI agents can navigate and extend it without fighting the conventions.

## What's in the box

- **API** -- Deno 2 + Hono 4 with Zod request validation and typed error handling.
- **Database** -- PostgreSQL via Kysely with `CamelCasePlugin` (camelCase in TS, snake_case in SQL). Migrations are plain SQL files in `db/migrations/`, auto-applied on startup.
- **Cache + sessions** -- Redis, with helpers for rate limits and key-scoped invalidation.
- **Auth** -- Email OTP login, session cookies, JWT for API tokens, OAuth providers via Arctic 2. Includes a documented dev-login escape hatch so local + agent testing works without an SMTP inbox.
- **Billing** -- Stripe 17. Subscriptions, credit grants, metered usage, customer portal.
- **Email** -- SMTP via nodemailer with environment-driven configuration.
- **RBAC + teams** -- Organizations, members, roles, invites. Wired through the auth middleware and routes.
- **Logging** -- Structured logger (pretty in dev, NDJSON in production), ready for Loki / Datadog / any aggregator.
- **Tests** -- Routes + services split (`test:fast` runs just those). No DB mocks -- tests hit a real Postgres instance.
- **Container-ready** -- Dockerfile + docker-compose for the dev stack; k8s-compatible image for any cluster.
- **`CLAUDE.md`** -- Authored for AI agents. They read it on session 1 and immediately know your conventions, dev login, gotchas.

## Architecture

```
Client (curl, SDK, browser fetch, etc.)
   |
   v
Hono 4 API                (src/api/routes/  ->  src/services/)
   |   Zod-validated, session + JWT auth, structured errors
   v
PostgreSQL                (Kysely, NNN_*.sql migrations auto-applied)
   +
Redis                     (sessions, cache, rate limits)
   +
Stripe                    (subscriptions, credits, customer portal)
```

**Stack:** Deno 2, Hono 4, Kysely 0.27, PostgreSQL, Redis, Arctic 2, Stripe 17, Zod 3, nodemailer 6.

No SPA layer. No Vite. No Svelte.

## Quick start

### 1. Clone and bootstrap

```bash
git clone https://github.com/chipp-ai/alchemist-template-api.git my-api
cd my-api
./scripts/setup.sh
```

`setup.sh` checks your toolchain (Deno, Docker), brings up Postgres + Redis via `docker-compose`, and runs all migrations.

### 2. Start the dev server

```bash
./scripts/dev.sh --api-port 8000
```

This runs the Hono API on `:8000`.

### 3. Test it

```bash
curl http://localhost:8000/health
```

### 4. Log in (no SMTP needed for dev)

There's no SMTP harness in dev, so OTP codes never reach an inbox. Use the dev-login escape hatch:

```bash
curl -X POST -H 'Content-Type: application/json' \
     -d '{"email":"agent@dev.local"}' \
     http://localhost:8000/api/dev/login \
     -c /tmp/jar.txt
```

Re-use the cookie jar with `-b /tmp/jar.txt` on subsequent requests.

The `/api/dev/*` routes 404 when `NODE_ENV=production` -- they are local-only by construction.

## Project structure

```
src/
  api/
    routes/        Hono handlers (thin orchestration)
    middleware/    auth, validation, error handling
  services/        business logic (one file per domain)
  db/
    client.ts      Kysely client (CamelCasePlugin)
    schema.ts      table type definitions
  lib/logger.ts    structured logger (NDJSON in prod)
  __tests__/
    routes/        route integration tests
    services/      service unit tests
    helpers.ts     test utilities (createIsolatedUser, ...)
db/
  migrations/      NNN_*.sql files, auto-applied on startup
  migrate.ts       migration runner
scripts/
  setup.sh         one-shot dev bootstrap
  dev.sh           run API server
CLAUDE.md          project context for AI agents
```

## Adding new API routes

1. Create a route module under `src/api/routes/your-feature/index.ts` that exports a Hono router (e.g. `yourFeatureRoutes`).

2. Mount it in `app.ts`:
   ```ts
   import { yourFeatureRoutes } from "@/api/routes/your-feature/index.ts";
   app.route("/api/your-feature", yourFeatureRoutes);
   ```

3. Put business logic in `src/services/your-feature.service.ts`. Keep routes thin (validation + orchestration only).

See existing routes (e.g. `src/api/routes/health/`, `src/api/routes/auth/`) for the pattern. All routes use `zValidator` + `validationHook` and return `{ data }` or `{ error, code }`.

### Import convention: bare specifiers only

Source files import via **bare specifiers** declared in the `imports` map of `deno.json` (e.g. `import { Hono } from "hono"`). Do **not** inline `npm:` / `jsr:` / `https:` specifiers in source files -- add the dependency to `deno.json` and import the bare name. Inline prefixes trip `deno lint` (`no-import-prefix`) and fail CI.

## Development

```bash
deno task dev          # Run API with --watch
deno task check        # Type-check
deno task test:fast    # Route + service tests
deno task test         # Full test suite
deno task fmt          # Format
deno task lint         # Lint
deno task db:migrate   # Apply pending migrations explicitly
```

Run a single test file:

```bash
deno test --env --no-check --allow-all src/__tests__/services/my_test.ts
```

## Deployment

### Alchemist AI (autonomous)

Push to your fork's default branch. The Alchemist AI platform builds, migrates, and rolls out via its build orchestrator and rollout controller. No CI to configure -- the platform's own agents handle deploys. For `template_key='api'`, the build pipeline uses `buildProfile: headless` and skips any web/SPA stage.

### Self-host on Kubernetes

The Dockerfile produces a runtime-image suitable for any cluster. You need:

- A PostgreSQL instance (the app auto-applies migrations on boot).
- A Redis instance.
- Environment variables from `.env.example` (database URL, Redis URL, session secret, Stripe keys, OAuth credentials, SMTP config).

Mount the secrets, point at your databases, and run the image. A `/health` endpoint is exposed for liveness probes.

### Docker Compose

```bash
docker-compose up
```

## Contributing

Issues and pull requests welcome. If you're using Claude Code or another AI agent to contribute, the [`CLAUDE.md`](CLAUDE.md) in the repo root has the project context they'll need.

## License

[MIT](LICENSE)
