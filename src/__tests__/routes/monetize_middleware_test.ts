/**
 * Monetization middleware tests -- the three REST lanes end to end:
 *
 *   requireAuthOrApiKey  session-or-key identity resolution
 *   requirePurchase      entitlement gate + checkout funnel (402)
 *   chargeCredits        atomic per-request debit + refund-on-failure
 *   mppPaid              MPP 402 challenges (signed, offline) + fail-closed
 *
 * The MPP tests mutate env; they restore in `finally` and this is the only
 * file that reads MPP_* env, so parallel test files cannot race it.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { createIsolatedUser, withTestServer } from "../helpers.ts";
import { requireAuthOrApiKey } from "@/api/middleware/api-key-auth.ts";
import { chargeCredits, mppPaid, requirePurchase } from "@/api/middleware/monetize.ts";
import { getUser } from "@/api/middleware/auth.ts";
import { apiKeyService } from "@/services/api-key.service.ts";
import { creditService } from "@/services/credit.service.ts";
import { recordProductPurchase } from "@/services/product.service.ts";
import { db } from "@/db/client.ts";

function test(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

function buildApp() {
  return withTestServer((app) => {
    app.get("/whoami", requireAuthOrApiKey, (c) => {
      const user = getUser(c);
      return c.json({ data: { email: user.email, organizationId: user.organizationId } });
    });
    app.get(
      "/premium",
      requireAuthOrApiKey,
      requirePurchase("monetize_test_product"),
      (c) => c.json({ data: { ok: true } }),
    );
    app.post(
      "/metered",
      requireAuthOrApiKey,
      chargeCredits(5),
      (c) => c.json({ data: { ok: true } }),
    );
    app.post(
      "/metered-failing",
      requireAuthOrApiKey,
      chargeCredits(5),
      () => {
        throw new Error("intentional handler failure");
      },
    );
    app.get(
      "/mpp-paid",
      mppPaid({ fiatUsd: "0.50" }),
      (c) => c.json({ data: { secret: "paid content" } }),
    );
  });
}

async function insertTestProduct(productKey: string, opts: { grantsCredits?: number } = {}) {
  const row = await db
    .insertInto("products")
    .values({
      productKey,
      name: `Test ${productKey}`,
      description: null,
      type: "one_time",
      priceCents: 2900,
      currency: "usd",
      billingInterval: null,
      stripeProductId: null,
      stripePriceId: "price_test_monetize",
      grantsCredits: opts.grantsCredits ?? null,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return row.id;
}

async function deleteTestProduct(productId: string) {
  await db.deleteFrom("purchases").where("productId", "=", productId).execute();
  await db.deleteFrom("products").where("id", "=", productId).execute();
}

// ── requireAuthOrApiKey ─────────────────────────────────────────────────────

test("auth: no credentials -> 401; a minted API key resolves the owning user + org", async () => {
  const { user, org, cleanup } = await createIsolatedUser("owner");
  const app = buildApp();
  try {
    const anon = await app.request("/whoami");
    assertEquals(anon.status, 401);
    await anon.text();

    const minted = await apiKeyService.mint({ userId: user.id, name: "test" });
    const res = await app.request("/whoami", {
      headers: { authorization: `Bearer ${minted.key}` },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.data.email, user.email);
    assertEquals(body.data.organizationId, org.id);

    // Revoked keys stop working.
    await apiKeyService.revoke(minted.id, user.id);
    const revoked = await app.request("/whoami", {
      headers: { authorization: `Bearer ${minted.key}` },
    });
    assertEquals(revoked.status, 401);
    await revoked.text();
  } finally {
    await cleanup();
  }
});

// ── requirePurchase ─────────────────────────────────────────────────────────

test("entitlement: unentitled -> 402 with funnel; a purchase unlocks the route", async () => {
  const { user, org, cleanup } = await createIsolatedUser("owner");
  const productId = await insertTestProduct("monetize_test_product");
  const app = buildApp();
  try {
    const minted = await apiKeyService.mint({ userId: user.id, name: "test" });
    const headers = { authorization: `Bearer ${minted.key}` };

    const blocked = await app.request("/premium", { headers });
    assertEquals(blocked.status, 402);
    const blockedBody = await blocked.json();
    assertEquals(blockedBody.code, "ENTITLEMENT_REQUIRED");
    assertEquals(blockedBody.productKey, "monetize_test_product");
    // Stripe is unconfigured in tests -> the funnel degrades to no link,
    // never a crash. The body stays machine-actionable either way.
    assert(!("checkoutUrl" in blockedBody) || typeof blockedBody.checkoutUrl === "string");

    await recordProductPurchase({
      organizationId: org.id,
      productId,
      checkoutSessionId: `cs_monetize_${org.id}`,
      amountCents: 2900,
    });
    const unlocked = await app.request("/premium", { headers });
    assertEquals(unlocked.status, 200);
    assertEquals((await unlocked.json()).data.ok, true);
  } finally {
    await deleteTestProduct(productId);
    await cleanup();
  }
});

// ── chargeCredits ───────────────────────────────────────────────────────────

test("credits: 402 at zero balance, debit per request, refund when the handler throws", async () => {
  const { user, org, cleanup } = await createIsolatedUser("owner");
  const packId = await insertTestProduct(`monetize_pack_${org.id}`, { grantsCredits: 100 });
  const app = buildApp();
  try {
    const minted = await apiKeyService.mint({ userId: user.id, name: "test" });
    const headers = { authorization: `Bearer ${minted.key}` };

    const broke = await app.request("/metered", { method: "POST", headers });
    assertEquals(broke.status, 402);
    const brokeBody = await broke.json();
    assertEquals(brokeBody.code, "INSUFFICIENT_CREDITS");
    assertEquals(brokeBody.balance, 0);
    assertEquals(brokeBody.cost, 5);

    await creditService.grant({
      organizationId: org.id,
      amount: 12,
      reason: "test_grant",
      externalRef: `t:${org.id}:monetize`,
    });

    const ok = await app.request("/metered", { method: "POST", headers });
    assertEquals(ok.status, 200);
    await ok.text();
    assertEquals(await creditService.getBalance(org.id), 7n);

    // A throwing handler surfaces a 500 AND refunds the debit.
    const failed = await app.request("/metered-failing", { method: "POST", headers });
    assertEquals(failed.status, 500);
    await failed.text();
    assertEquals(await creditService.getBalance(org.id), 7n, "failed run must refund");

    // Spend down to 2, then 5 > 2 blocks again.
    await (await app.request("/metered", { method: "POST", headers })).text();
    assertEquals(await creditService.getBalance(org.id), 2n);
    const blocked = await app.request("/metered", { method: "POST", headers });
    assertEquals(blocked.status, 402);
    await blocked.text();
  } finally {
    await deleteTestProduct(packId);
    await cleanup();
  }
});

// ── mppPaid ─────────────────────────────────────────────────────────────────

const MPP_TEST_ENV = {
  MPP_SECRET_KEY: "dGVzdC1zZWNyZXQta2V5LXRlc3Qtc2VjcmV0LWtleS0xMg==",
  STRIPE_SECRET_KEY: "sk_test_dummy_for_challenge_generation",
  STRIPE_PROFILE_ID: "profile_test_dummy",
};

function withEnv(vars: Record<string, string | null>, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const previous = new Map<string, string | undefined>();
    for (const [k, v] of Object.entries(vars)) {
      previous.set(k, Deno.env.get(k));
      if (v === null) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    try {
      await fn();
    } finally {
      for (const [k, old] of previous) {
        if (old === undefined) Deno.env.delete(k);
        else Deno.env.set(k, old);
      }
    }
  };
}

Deno.test({
  name: "mpp: unpaid request gets a signed 402 Payment challenge; content is never leaked",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: withEnv(MPP_TEST_ENV, async () => {
    // Challenge generation is fully offline -- no Stripe network call
    // happens until a client presents a payment credential.
    const app = buildApp();
    const res = await app.request("http://localhost/mpp-paid");
    assertEquals(res.status, 402);
    const challenge = res.headers.get("www-authenticate") ?? "";
    assert(
      challenge.startsWith("Payment "),
      `expected a Payment challenge header, got: ${challenge.slice(0, 80)}`,
    );
    assert(challenge.includes('method="stripe"'));
    assertExists(res.headers.get("x-price"));
    const text = await res.text();
    assertEquals(text.includes("paid content"), false, "route must not run unpaid");
  }),
});

Deno.test({
  name: "mpp: fails closed (503, honest code) when no payment lane is configured",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: withEnv(
    { MPP_SECRET_KEY: null, STRIPE_SECRET_KEY: null, STRIPE_PROFILE_ID: null },
    async () => {
      const app = buildApp();
      const res = await app.request("http://localhost/mpp-paid");
      assertEquals(res.status, 503);
      const body = await res.json();
      assertEquals(body.code, "PAYMENTS_UNCONFIGURED");
    },
  ),
});

Deno.test({
  name: "mpp: x402 lane (Base USDC) issues challenges on BOTH wire formats, no Stripe needed",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: withEnv({
    MPP_SECRET_KEY: "dGVzdC1zZWNyZXQta2V5LXRlc3Qtc2VjcmV0LWtleS0xMg==",
    MPP_X402_RECIPIENT: "0x1111111111111111111111111111111111111111",
    MPP_X402_TESTNET: "1",
    STRIPE_SECRET_KEY: null,
    STRIPE_PROFILE_ID: null,
  }, async () => {
    // Challenge generation is offline; the facilitator is only contacted
    // when a client presents an x402 payment.
    const app = withTestServer((a) => {
      a.get("/x402-paid", mppPaid({ cryptoUsd: "0.01" }), (c) => c.json({ data: "secret" }));
    });
    const res = await app.request("http://localhost/x402-paid");
    assertEquals(res.status, 402);
    // MPP wire format: WWW-Authenticate Payment challenge with method=evm.
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    assert(wwwAuth.startsWith("Payment "), `expected Payment challenge, got: ${wwwAuth.slice(0, 60)}`);
    assert(wwwAuth.includes('method="evm"'), `expected evm method, got: ${wwwAuth.slice(0, 120)}`);
    // x402 wire format: the PAYMENT-REQUIRED header the existing x402
    // agent ecosystem understands natively.
    const x402Header = res.headers.get("payment-required");
    assertExists(x402Header, "expected the x402 PAYMENT-REQUIRED header");
    const text = await res.text();
    assertEquals(text.includes("secret"), false, "route must not run unpaid");
  }),
});

Deno.test({
  name: "mpp: x402 mainnet without an explicit facilitator fails closed (misconfig, not silent)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: withEnv({
    MPP_SECRET_KEY: "dGVzdC1zZWNyZXQta2V5LXRlc3Qtc2VjcmV0LWtleS0xMg==",
    MPP_X402_RECIPIENT: "0x1111111111111111111111111111111111111111",
    MPP_X402_TESTNET: null,
    MPP_X402_FACILITATOR: null,
    STRIPE_SECRET_KEY: null,
    STRIPE_PROFILE_ID: null,
  }, async () => {
    // Mainnet REQUIRES an explicit facilitator -- settling against a default
    // one would be a silent money-path decision. The lane reads as
    // unconfigured instead.
    const app = withTestServer((a) => {
      a.get("/x402-paid", mppPaid({ cryptoUsd: "0.01" }), (c) => c.json({ data: "secret" }));
    });
    const res = await app.request("http://localhost/x402-paid");
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.code, "PAYMENTS_UNCONFIGURED");
  }),
});
