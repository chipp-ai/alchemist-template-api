/**
 * Chipp Insights -- first-party analytics beacon.
 *
 * Activated ONLY when a `chipp-insights.json` file exists at the repo
 * root, shaped `{"telemetryPublicKey": "tk_pub_..."}`. The Alchemist AI
 * platform writes this file into a project when the Insights add-on is
 * enabled for it; its absence (the default for every project, including
 * local dev) means Insights stays fully inert -- no script tag rendered,
 * no network request, no behavior change. See CLAUDE.md -> "Chipp
 * Insights beacon" for the full contract and why this headless template
 * wires the identify call differently than a template with a browser
 * login flow.
 *
 * Split into two halves on purpose:
 *   - Resolution (`parseInsightsPublicKey` + the module-load read below)
 *     is where the file I/O and fail-open behavior live.
 *   - Rendering (`renderInsightsScriptTag` / `renderInsightsIdentifyScript`)
 *     are pure functions of an explicit key, so they're unit-testable
 *     without touching the filesystem or module-load caching.
 */

/**
 * Parse `chipp-insights.json`'s raw text into a public key, or null when
 * the content is malformed / missing the field. Pure -- no I/O.
 */
export function parseInsightsPublicKey(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { telemetryPublicKey?: unknown };
    if (typeof parsed.telemetryPublicKey === "string" && parsed.telemetryPublicKey.length > 0) {
      return parsed.telemetryPublicKey;
    }
  } catch {
    // Malformed JSON -- treated the same as "file absent": inert, no log.
  }
  return null;
}

// Resolution happens ONCE at module load. This module lives at
// `src/services/`, so `../../` reaches the repo root -- same convention
// as the repo-root markdown reads in `src/services/docs/registry.ts`. A
// missing file is NOT an error: try/catch, fail open, no log line either
// way -- most projects never have this file, and logging its absence on
// every boot would be pure noise.
let cachedPublicKey: string | null = null;
try {
  const raw = Deno.readTextFileSync(new URL("../../chipp-insights.json", import.meta.url));
  cachedPublicKey = parseInsightsPublicKey(raw);
} catch {
  // chipp-insights.json is absent -- Insights stays inert.
}

/** The configured public key, or null when Insights isn't enabled here. */
export function getInsightsPublicKey(): string | null {
  return cachedPublicKey;
}

/** HTML-attribute-escape a value for use inside a double-quoted attribute. */
function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * A JS string literal safe to inline inside a `<script>` element: quotes
 * and control characters are escaped by JSON.stringify, and a defensive
 * replace closes off the `</script` HTML-parser escape hatch that
 * JSON.stringify does NOT know about (the string is going into an HTML
 * document, not just a JS file).
 */
function jsStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
}

/**
 * The beacon `<script>` tag for the given key, or "" when `key` is null
 * (Insights not configured). Caller places this in `<head>` (or anywhere
 * before `</body>`) of every served HTML page -- it should load on every
 * page view, not just authenticated ones. Pass `getInsightsPublicKey()`
 * from the call site.
 */
export function renderInsightsScriptTag(key: string | null): string {
  if (!key) return "";
  return `<script src="https://build.chipp.ai/i/beacon.js" data-project-key="${
    escapeHtmlAttr(key)
  }" async></script>`;
}

/**
 * The inline `window.chippInsights.identify(email)` snippet for the given
 * key, or "" when `key` is null (identifying to a beacon that was never
 * loaded is pointless). The guard mirrors the platform-wide contract used
 * by every other Alchemist template: it no-ops silently if the beacon
 * script hasn't finished loading yet, so it is always safe to emit.
 *
 * This template has no browser-executed login flow (auth is a pure JSON
 * API -- `/api/auth/*` -- consumed by whatever external client the
 * project's frontend or integration is; there is no first-party page that
 * performs a login and then runs client JS on success). The honest analog
 * here is to identify on every server-rendered page view where the
 * request already carries an authenticated session, rather than at a
 * "login" event that doesn't exist in this codebase.
 */
export function renderInsightsIdentifyScript(key: string | null, email: string): string {
  if (!key) return "";
  return `<script>if (typeof window !== "undefined" && window.chippInsights?.identify) { window.chippInsights.identify(${
    jsStringLiteral(email)
  }); }</script>`;
}
