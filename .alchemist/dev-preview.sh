#!/usr/bin/env bash
#
# Boot this project's API inside a Chipp Builder sandbox.
#
# The Builder reads `.alchemist/dev-server.json` and runs this from the repo
# root. Without it the Builder falls back to "find a dev script and run it",
# which starts the API with no database, so every stored-data route is empty.
#
# This project has no web/ front end, so the API itself listens on the port the
# preview tunnel reaches (5173) and is what the preview pane shows.
#
# What this deliberately does NOT do: touch the project's real credentials. The
# sandbox gets its OWN Postgres (the sandbox image runs one, handed to us as
# SANDBOX_PG_USER / SANDBOX_PG_PASSWORD) and throwaway secrets. The deployment's
# DATABASE_URL and its third-party tokens never enter a sandbox: an agent runs
# in here, and a preview must never be able to write to live customer data.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PREVIEW_PORT=5173      # the port the Builder's preview tunnel reaches
DB_NAME=app_preview
PG_USER="${SANDBOX_PG_USER:-test}"
PG_PASS="${SANDBOX_PG_PASSWORD:-test}"
PG_PORT="${SANDBOX_PG_PORT:-5432}"

export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${DB_NAME}"
export PORT="$PREVIEW_PORT"
export HOST=0.0.0.0
export APP_URL="http://localhost:${PREVIEW_PORT}"
export NODE_ENV=development
export ALCHEMIST_DEV_ROUTES=1
PREVIEW_SECRET="preview-only-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export JWT_SECRET="${JWT_SECRET:-$PREVIEW_SECRET}"
export SESSION_SECRET="${SESSION_SECRET:-$PREVIEW_SECRET}"

echo "[preview] database ${DB_NAME} on the sandbox's own Postgres"
# Same npm:postgres client scripts/dev.sh uses, so this needs no psql binaries.
DB_NAME="$DB_NAME" deno run --allow-net --allow-env - <<'TS'
const postgres = (await import("npm:postgres@3.4.5")).default;
const url = new URL(Deno.env.get("DATABASE_URL")!);
const name = Deno.env.get("DB_NAME")!;
url.pathname = "/postgres";
const meta = postgres(url.toString(), { max: 1, onnotice: () => {} });
try {
  const rows = await meta`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (rows.length === 0) await meta.unsafe(`CREATE DATABASE "${name}"`);
} catch (e) {
  console.error("[preview] could not ensure the database:", e instanceof Error ? e.message : e);
} finally {
  await meta.end({ timeout: 5 });
}
TS

echo "[preview] migrating"
deno task db:migrate || echo "[preview] migrations failed -- the API may serve empty data"

echo "[preview] starting the API on ${PREVIEW_PORT}"
exec deno task dev
