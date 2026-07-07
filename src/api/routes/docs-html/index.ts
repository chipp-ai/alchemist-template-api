/**
 * Human-viewable, server-rendered docs -- mounted at `/docs` (PUBLIC).
 *
 *   GET /docs            index: DOCS_PAGES grouped by `group`.
 *   GET /docs/endpoints  dynamic endpoint index: the app's mounted /api/*
 *                        routes, read at request time from the route table.
 *   GET /docs/:slug      one registry page, rendered to HTML.
 *
 * These are developer/connection docs for the DEPLOYED product, so there
 * is no session requirement -- EXCEPT pages whose registry entry sets
 * `requiresAuth: true`, which get a uniform 404 (indistinguishable from
 * "no such page") unless the request carries a valid session cookie. The
 * optional `authMiddleware` resolves the session when present and does
 * nothing (no DB work) when absent.
 *
 * # Why the endpoint list is INJECTED (setEndpointSource) instead of
 * # importing app.ts
 *
 * This router is mounted ON the app, so `app.ts` imports this module. If
 * this module imported `app.ts` back to read `app.routes`, that would be a
 * circular import -- it happens to work in ESM when the access is deferred
 * to request time, but it is fragile (any hoisted access becomes a TDZ
 * crash) and it would also freeze tests into using the real app. Instead
 * app.ts calls `setEndpointSource(() => app.routes)` AFTER mounting all
 * routes; this module stays a leaf. The callback is invoked per request,
 * so the page always reflects the live route table.
 *
 * Markdown is rendered EXCLUSIVELY via renderMarkdownToHtml
 * (src/services/docs/render-html.ts) -- the escape-first, allowlisted-link
 * security boundary. Never render docs markdown to HTML any other way.
 *
 * Routing note: plain `:slug` param only. Hono's RegExpRouter mis-handles
 * regex-with-suffix route patterns, so slug validation happens via the
 * in-memory registry lookup (unknown slug -> 404), not the route pattern.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { BRAND } from "@/config/brand.ts";
import { authMiddleware } from "@/api/middleware/auth.ts";
import { DOCS_PAGES, type DocPage, findDoc } from "@/services/docs/registry.ts";
import { escapeHtml, renderMarkdownToHtml } from "@/services/docs/render-html.ts";

// ── Endpoint-source injection (see module doc for why) ──

export interface RouteEntry {
  method: string;
  path: string;
}

let endpointSource: (() => RouteEntry[]) | null = null;

/** Called by app.ts after all routes are mounted. */
export function setEndpointSource(source: () => RouteEntry[]): void {
  endpointSource = source;
}

/** Route prefixes that are internal-only and never documented. */
const HIDDEN_PREFIXES = ["/api/dev", "/api/_observability"];

/**
 * The public endpoint list: /api/* handler registrations (method !== "ALL"
 * filters out middleware entries), hidden prefixes excluded, deduped,
 * grouped by first path segment after /api/.
 */
function listEndpointGroups(): { group: string; entries: RouteEntry[] }[] {
  const raw = endpointSource ? endpointSource() : [];
  const seen = new Set<string>();
  const entries: RouteEntry[] = [];
  for (const r of raw) {
    if (r.method === "ALL") continue; // app.use middleware registrations
    if (!r.path.startsWith("/api/")) continue;
    if (HIDDEN_PREFIXES.some((p) => r.path === p || r.path.startsWith(`${p}/`))) continue;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ method: r.method, path: r.path });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  const groups: { group: string; entries: RouteEntry[] }[] = [];
  for (const e of entries) {
    const seg = e.path.split("/")[2] ?? "";
    const name = `/api/${seg}`;
    let g = groups.find((x) => x.group === name);
    if (!g) {
      g = { group: name, entries: [] };
      groups.push(g);
    }
    g.entries.push(e);
  }
  return groups;
}

const docsHtmlRoutes = new Hono();

// Optional auth: resolves c.get("user") when a valid session cookie is
// present; public requests pass straight through with zero DB work.
docsHtmlRoutes.use("*", authMiddleware);

function hasSession(c: Context): boolean {
  return Boolean((c as unknown as { get: (k: string) => unknown }).get("user"));
}

// ── HTML shell ──

/** Env-sourced brand colors go into inline CSS -- validate the shape first. */
function cssColor(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

function shell(title: string, content: string): string {
  const brandName = escapeHtml(BRAND.name);
  const primary = cssColor(BRAND.primaryColor, "#4f46e5");
  const neutral = cssColor(BRAND.neutralColor, "#1f2937");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | ${brandName}</title>
<style>
  :root { --primary: ${primary}; --ink: ${neutral}; }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); background: #fff;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header { border-bottom: 1px solid #e5e7eb; }
  header .inner, main, footer .inner { max-width: 46rem; margin: 0 auto; padding: 0 1.25rem; }
  header .inner { display: flex; align-items: baseline; gap: 0.75rem; padding-top: 1rem; padding-bottom: 1rem; }
  header a { color: var(--ink); text-decoration: none; font-weight: 700; font-size: 1.05rem; }
  header .crumb { color: #6b7280; font-size: 0.9rem; }
  main { padding-top: 2rem; padding-bottom: 4rem; }
  h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 1rem; }
  h2 { font-size: 1.25rem; margin: 2.25rem 0 0.75rem; }
  h3 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; }
  a { color: var(--primary); }
  p { margin: 0.75rem 0; }
  ul, ol { padding-left: 1.4rem; }
  li { margin: 0.3rem 0; }
  hr { border: 0; border-top: 1px solid #e5e7eb; margin: 2rem 0; }
  blockquote { margin: 1rem 0; padding: 0.1rem 1rem; border-left: 3px solid var(--primary);
    background: #f9fafb; color: #374151; }
  code { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px;
    padding: 0.1em 0.35em; font-size: 0.875em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: #111827; color: #f9fafb; border-radius: 8px; padding: 1rem;
    overflow-x: auto; margin: 1rem 0; }
  pre code { background: none; border: 0; padding: 0; color: inherit; font-size: 0.85rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.925rem; }
  th, td { border: 1px solid #e5e7eb; padding: 0.5rem 0.65rem; text-align: left; vertical-align: top; }
  th { background: #f9fafb; }
  .group { margin: 2rem 0 0; }
  .group h2 { margin-top: 0; color: #6b7280; font-size: 0.8rem; letter-spacing: 0.08em;
    text-transform: uppercase; }
  .toc-item { margin: 0.75rem 0 1.25rem; }
  .toc-item a { font-weight: 600; }
  .toc-item p { margin: 0.15rem 0 0; color: #4b5563; font-size: 0.925rem; }
  .method { display: inline-block; min-width: 3.6rem; font-weight: 700; font-size: 0.75rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--primary); }
  footer { border-top: 1px solid #e5e7eb; }
  footer .inner { padding-top: 1rem; padding-bottom: 1.5rem; color: #6b7280; font-size: 0.85rem; }
</style>
</head>
<body>
<header><div class="inner"><a href="/docs">${brandName}</a><span class="crumb">Documentation</span></div></header>
<main>
${content}
</main>
<footer><div class="inner">Powered by ${brandName}</div></footer>
</body>
</html>`;
}

/** Uniform HTML 404 -- used for unknown slugs AND auth-gated pages alike. */
function htmlNotFound(c: Context): Response {
  return c.html(
    shell("Not found", `<h1>Page not found</h1><p>No documentation page exists at this address. <a href="/docs">Back to the docs index</a>.</p>`),
    404,
  );
}

// ── Routes ──

// Index: registry pages grouped by `group` (registry order), plus a link
// to the live endpoint index. Auth-gated pages are hidden from the public
// index (they uniformly 404 anyway -- no dead links).
docsHtmlRoutes.get("/", (c) => {
  const authed = hasSession(c);
  const visible = DOCS_PAGES.filter((p) => !p.requiresAuth || authed);

  const groups: { group: string; pages: DocPage[] }[] = [];
  for (const p of visible) {
    let g = groups.find((x) => x.group === p.group);
    if (!g) {
      g = { group: p.group, pages: [] };
      groups.push(g);
    }
    g.pages.push(p);
  }

  const groupHtml = groups
    .map((g) =>
      `<section class="group"><h2>${escapeHtml(g.group)}</h2>${
        g.pages
          .map((p) =>
            `<div class="toc-item"><a href="/docs/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a><p>${
              escapeHtml(p.summary)
            }</p></div>`
          )
          .join("")
      }</section>`
    )
    .join("\n");

  const endpointsHtml = `<section class="group"><h2>API</h2>
<div class="toc-item"><a href="/docs/endpoints">Endpoint index</a><p>Every mounted /api/* route, generated live from the app's route table.</p></div></section>`;

  return c.html(shell("Documentation", `<h1>Documentation</h1>\n${groupHtml}\n${endpointsHtml}`));
});

// Dynamic endpoint index. Registered BEFORE /:slug so a registry page can
// never shadow it (don't register a doc with slug "endpoints").
docsHtmlRoutes.get("/endpoints", (c) => {
  const groups = listEndpointGroups();
  const sections = groups
    .map((g) =>
      `<h2><code>${escapeHtml(g.group)}</code></h2><ul>${
        g.entries
          .map((e) =>
            `<li><span class="method">${escapeHtml(e.method)}</span> <code>${escapeHtml(e.path)}</code></li>`
          )
          .join("")
      }</ul>`
    )
    .join("\n");
  const body = `<h1>Endpoint index</h1>
<p>Generated at request time from the running app's route table, so it always
matches the deployed code. Auth, request/response shapes, and error codes are
in the <a href="/docs/api-reference">API reference</a>.</p>
${sections || "<p><em>No endpoints registered.</em></p>"}`;
  return c.html(shell("Endpoint index", body));
});

// One page. Unknown slug and auth-gated-without-session are the SAME 404.
docsHtmlRoutes.get("/:slug", (c) => {
  const page = findDoc(c.req.param("slug"));
  if (!page) return htmlNotFound(c);
  if (page.requiresAuth && !hasSession(c)) return htmlNotFound(c);
  const body = `<p><a href="/docs">&larr; All docs</a></p>\n${renderMarkdownToHtml(page.body)}`;
  return c.html(shell(page.title, body));
});

export { docsHtmlRoutes };
