/**
 * Example Routes
 *
 * Starter API route demonstrating the pattern for new endpoints.
 * Mounted at /api (so GET /api/hello).
 */

import { Hono } from "hono";

const exampleRoutes = new Hono();

exampleRoutes.get("/hello", (c) =>
  c.json({
    data: {
      message: "Hello from the Alchemist API template",
      time: new Date().toISOString(),
    },
  }),
);

export { exampleRoutes };
