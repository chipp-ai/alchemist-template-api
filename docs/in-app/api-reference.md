# API reference

This service is a JSON API served under `/api/*` at:

```
https://<your-domain>/api
```

The live, always-current list of mounted endpoints is at
[/docs/endpoints](/docs/endpoints) -- it is generated from the running app's
route table, so it never drifts from the code.

## Authentication

Two credential types exist, and they deliberately unlock different surfaces:

| Credential | Sent as | Works on |
| --- | --- | --- |
| Session cookie | `session_id` cookie (set by the login flow) | Every authenticated route, including account management (key minting, billing, team) |
| API key `api_sk_...` | `Authorization: Bearer api_sk_...` header | Product routes mounted with `requireAuthOrApiKey` -- the middleware this template ships for your API product's endpoints |

**Minting a key:** a signed-in team member calls `POST /api/api-keys` with
`{ "name": "my key" }`. The response includes the plaintext key **once**; it
is stored hashed and cannot be retrieved again. Keys have no separate scopes:
a key acts as the user who minted it (same role, same organization). Revoke
with `DELETE /api/api-keys/:id`.

Key management is deliberately **session-only** -- a leaked API key cannot be
used to mint replacement keys or change billing. Built-in account-management
routes (`/api/org`, `/api/billing`, `/api/api-keys`) are likewise
session-authenticated; apply `requireAuthOrApiKey` to the routes that make up
your API product so programmatic callers can reach them with a key.

## Response envelope

Every JSON response is one of two shapes:

```json
{ "data": { ... } }
```

```json
{ "error": "Human-readable message", "code": "MACHINE_CODE" }
```

Read `code` programmatically; `error` is display copy. (One exception:
request-validation failures return `{ "error": "..." }` with HTTP 400 and no
`code` field.)

## Error codes

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed input the server understood enough to reject |
| 401 | `UNAUTHORIZED` | Missing, invalid, expired, or revoked credentials |
| 402 | `ENTITLEMENT_REQUIRED` | The route requires a product purchase; the body includes a `checkoutUrl` to buy it |
| 402 | `INSUFFICIENT_CREDITS` | Prepaid credit balance too low; the body includes a top-up `checkoutUrl` |
| 403 | `FORBIDDEN` | Authenticated, but your role lacks the required permission |
| 404 | `NOT_FOUND` | No such resource (or no such route) |
| 409 | `CONFLICT` | The write conflicts with existing state |
| 502 | `EXTERNAL_SERVICE_ERROR` | An upstream dependency failed |
| 503 | `AUTH_UNAVAILABLE` | Transient auth-backend failure -- retry with the SAME key; do not rotate |
| 503 | `PAYMENTS_UNCONFIGURED` | A paid route was called before the operator configured payments |
| 500 | `INTERNAL_ERROR` | Unexpected server error; the `X-Request-Id` response header traces it in logs |

Monetized routes may also respond `402` with a `WWW-Authenticate: Payment`
challenge (MPP machine payments) instead of an entitlement body -- MPP-capable
agents pay and retry automatically.

## Worked example

Check the service is up (public, no auth -- note this probe predates the
envelope and returns a bare status object):

```bash
curl -s https://<your-domain>/health
```

Mint an API key (session cookie required -- run from a browser session or
paste your cookie):

```bash
curl -s -X POST https://<your-domain>/api/api-keys \
  -H 'Content-Type: application/json' \
  -H 'Cookie: session_id=<your-session-jwt>' \
  -d '{"name":"ci-key"}'
```

Response (the `key` field is shown this once only):

```json
{
  "data": {
    "key": { "id": "...", "name": "ci-key", "key": "api_sk_..." },
    "warning": "Store this key now. It cannot be retrieved again."
  }
}
```

Then call a product route with the key. The template ships the middleware
(`requireAuthOrApiKey`) rather than a demo product route, so substitute one of
your own -- any route mounted with it accepts:

```bash
curl -s https://<your-domain>/api/<your-product-route> \
  -H 'Authorization: Bearer api_sk_...'
```

An invalid or revoked key returns:

```json
{ "error": "Invalid or revoked API key", "code": "UNAUTHORIZED" }
```
