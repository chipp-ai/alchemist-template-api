/**
 * Chipp Insights beacon -- parsing + rendering tests.
 *
 * `parseInsightsPublicKey` and the render functions are pure (no
 * filesystem access), so these tests exercise them directly with
 * explicit inputs instead of round-tripping through a real
 * `chipp-insights.json` file. The module-load file read itself is
 * covered implicitly: in this test environment (and in every project
 * without the Insights add-on enabled) the file is absent, so
 * `getInsightsPublicKey()` must resolve to null and every render
 * function must no-op -- exercised by the "disabled by default" case
 * below using the real module export.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  getInsightsPublicKey,
  parseInsightsPublicKey,
  renderInsightsIdentifyScript,
  renderInsightsScriptTag,
} from "@/services/insights.ts";

function assertNotIncludes(actual: string, needle: string) {
  assert(
    !actual.includes(needle),
    `Expected output NOT to include ${JSON.stringify(needle)}:\n${actual}`,
  );
}

// ── Disabled by default (no chipp-insights.json in this repo checkout) ──

Deno.test("insights: getInsightsPublicKey is null when chipp-insights.json is absent", () => {
  assertEquals(getInsightsPublicKey(), null);
});

Deno.test("insights: renderInsightsScriptTag is empty when key is null", () => {
  assertEquals(renderInsightsScriptTag(null), "");
});

Deno.test("insights: renderInsightsIdentifyScript is empty when key is null", () => {
  assertEquals(renderInsightsIdentifyScript(null, "user@example.com"), "");
});

// ── parseInsightsPublicKey ──

Deno.test("parseInsightsPublicKey: valid file yields the key", () => {
  assertEquals(
    parseInsightsPublicKey(`{"telemetryPublicKey": "tk_pub_abc123"}`),
    "tk_pub_abc123",
  );
});

Deno.test("parseInsightsPublicKey: malformed JSON is treated as absent", () => {
  assertEquals(parseInsightsPublicKey("{not json"), null);
});

Deno.test("parseInsightsPublicKey: missing field is treated as absent", () => {
  assertEquals(parseInsightsPublicKey(`{"other": "value"}`), null);
});

Deno.test("parseInsightsPublicKey: empty string key is treated as absent", () => {
  assertEquals(parseInsightsPublicKey(`{"telemetryPublicKey": ""}`), null);
});

Deno.test("parseInsightsPublicKey: non-string key is treated as absent", () => {
  assertEquals(parseInsightsPublicKey(`{"telemetryPublicKey": 12345}`), null);
});

// ── renderInsightsScriptTag ──

Deno.test("renderInsightsScriptTag: emits the beacon tag with the key", () => {
  const tag = renderInsightsScriptTag("tk_pub_abc123");
  assertStringIncludes(tag, `src="https://build.chipp.ai/i/beacon.js"`);
  assertStringIncludes(tag, `data-project-key="tk_pub_abc123"`);
  assertStringIncludes(tag, "async");
});

Deno.test("renderInsightsScriptTag: escapes a key containing quotes", () => {
  const tag = renderInsightsScriptTag(`tk_pub_"><script>alert(1)</script>`);
  assertNotIncludes(tag, `<script>alert(1)</script>`);
  assertStringIncludes(tag, "&quot;&gt;&lt;script&gt;");
});

// ── renderInsightsIdentifyScript ──

Deno.test("renderInsightsIdentifyScript: emits a guarded identify call with the email", () => {
  const script = renderInsightsIdentifyScript("tk_pub_abc123", "user@example.com");
  assertStringIncludes(script, "window.chippInsights?.identify");
  assertStringIncludes(script, JSON.stringify("user@example.com"));
});

Deno.test("renderInsightsIdentifyScript: neutralizes a </script> breakout attempt in the email", () => {
  const maliciousEmail = `x@example.com</script><script>alert(1)</script>`;
  const script = renderInsightsIdentifyScript("tk_pub_abc123", maliciousEmail);
  // The raw, unescaped breakout sequence must never appear verbatim --
  // that's what would let the payload close the wrapper's <script> tag
  // early and get its own <script>alert(1)</script> parsed as a real tag.
  assertNotIncludes(script, maliciousEmail);
  // The escaped form (backslash inserted before every "/" in "</script")
  // is what should have landed in the output instead.
  assertStringIncludes(script, "x@example.com<\\/script><script>alert(1)<\\/script>");
  // Exactly one genuine closing </script> tag in the whole output: the
  // wrapper's own. Every "</script" from the payload must have been
  // neutralized, not just the first one.
  const closingTags = script.match(/<\/script>/g) ?? [];
  assertEquals(closingTags.length, 1);
});
