/**
 * Example route integration test.
 *
 * Verifies the headless starter route responds with the expected JSON shape.
 * This route is DB-free and unauthenticated, so no test isolation helpers needed.
 */

import { assertEquals } from "@std/assert";
import { withTestServer } from "../helpers.ts";
import { exampleRoutes } from "@/api/routes/example/index.ts";

Deno.test("GET /api/hello returns 200 with data envelope", async () => {
  const app = withTestServer((app) => {
    app.route("/api", exampleRoutes);
  });

  const res = await app.request("/api/hello", { method: "GET" });
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.data.message, "Hello from the Alchemist API template");
  assertEquals(typeof body.data.time, "string");
  // ISO timestamp sanity check
  assertEquals(body.data.time.includes("T"), true);
});
