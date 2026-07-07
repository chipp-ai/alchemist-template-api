/**
 * /docs (server-rendered HTML docs) route tests.
 *
 * No DB required: the routes only touch the DB when a session cookie is
 * present (optional authMiddleware), and every request here is anonymous.
 *
 *   - index 200 + group titles + page links
 *   - /docs/endpoints 200 + known real routes, minus hidden prefixes
 *   - /docs/:slug 200 + rendered heading
 *   - unknown slug 404
 *   - requiresAuth page 404s for anonymous requests (uniform with unknown)
 *
 * The endpoint-index tests go through the REAL app (app.ts calls
 * setEndpointSource at module load), which is exactly the production wiring.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTestServer } from "../helpers.ts";
import { docsHtmlRoutes } from "@/api/routes/docs-html/index.ts";
import { app as realApp } from "../../../app.ts";

function deno(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

function makeApp() {
  return withTestServer((a) => {
    a.route("/docs", docsHtmlRoutes);
  });
}

deno("docs-html: index renders groups and page links", async () => {
  const app = makeApp();
  const res = await app.request("/docs");
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/html");
  const html = await res.text();
  assertStringIncludes(html, "Reference");
  assertStringIncludes(html, "API reference");
  assertStringIncludes(html, `href="/docs/api-reference"`);
  assertStringIncludes(html, `href="/docs/endpoints"`);
  // Footer branding.
  assertStringIncludes(html, "Powered by");
});

deno("docs-html: index hides requiresAuth pages from anonymous visitors", async () => {
  const app = makeApp();
  const html = await (await app.request("/docs")).text();
  // "welcome" and "searching-docs" are registered requiresAuth: true.
  assertEquals(html.includes(`href="/docs/welcome"`), false);
  assertEquals(html.includes(`href="/docs/searching-docs"`), false);
});

deno("docs-html: /docs/endpoints lists real mounted routes", async () => {
  const res = await realApp.request("/docs/endpoints");
  assertEquals(res.status, 200);
  const html = await res.text();
  // Known real routes, read live from app.routes -- not hardcoded docs.
  assertStringIncludes(html, "/api/api-keys");
  assertStringIncludes(html, "/api/org");
  // Method labels are present.
  assertStringIncludes(html, ">GET</span>");
  assertStringIncludes(html, ">POST</span>");
});

deno("docs-html: /docs/endpoints excludes dev + observability routes and middleware", async () => {
  const res = await realApp.request("/docs/endpoints");
  const html = await res.text();
  assert(!html.includes("/api/dev"), "hidden /api/dev leaked into the endpoint index");
  assert(!html.includes("/api/_observability"), "hidden /api/_observability leaked");
  // Middleware registrations (method ALL) are filtered out.
  assert(!html.includes(">ALL</span>"), "middleware ALL entries leaked");
});

deno("docs-html: /docs/:slug renders the page markdown", async () => {
  const app = makeApp();
  const res = await app.request("/docs/api-reference");
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "<h1>API reference</h1>");
  assertStringIncludes(html, "Authorization: Bearer api_sk_");
});

deno("docs-html: unknown slug 404s", async () => {
  const app = makeApp();
  const res = await app.request("/docs/no-such-page");
  assertEquals(res.status, 404);
  assertStringIncludes(await res.text(), "Page not found");
});

deno("docs-html: requiresAuth page 404s unauthenticated, uniform with unknown", async () => {
  const app = makeApp();
  const gated = await app.request("/docs/welcome");
  assertEquals(gated.status, 404);
  const unknown = await app.request("/docs/no-such-page");
  const gatedBody = await gated.text();
  const unknownBody = await unknown.text();
  // Uniform 404: an attacker can't distinguish "gated" from "missing".
  assertEquals(gatedBody, unknownBody);
});

deno("docs-html: mounted on the real app at /docs", async () => {
  const res = await realApp.request("/docs");
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "Documentation");
});
