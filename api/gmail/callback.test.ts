// PATH: api/gmail/callback.test.ts
// Assumes Gmail callback handler can be exercised with stubbed modules; trade-off is wiring custom
// spies instead of Jest automocks so we can verify state validation logic without bundling runtime deps.
import test, { mock } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";

process.env.SUPABASE_URL = "http://example.com";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.GMAIL_CLIENT_ID = "client";
process.env.GMAIL_CLIENT_SECRET = "secret";
process.env.GMAIL_REDIRECT_URI = "https://example.com/callback";

const require = createRequire(import.meta.url);

const gmailModulePath = require.resolve("../../lib/gmail.js");
const exchangeCodeForTokensSpy = mock.fn(async (_code: string): Promise<any> => {
  throw new Error("exchangeCodeForTokens not stubbed");
});

require.cache[gmailModulePath] = {
  id: gmailModulePath,
  filename: gmailModulePath,
  loaded: true,
  exports: {
    exchangeCodeForTokens: exchangeCodeForTokensSpy,
  },
} as any;

const { supabaseAdmin } = await import("../../lib/supabase-admin.js");
(supabaseAdmin as any).from = () => ({
  select: () => ({
    eq: () => ({
      maybeSingle: async () => ({ data: null, error: null }),
    }),
  }),
  upsert: async () => ({ error: null }),
});

const { default: handler } = await import("./callback.js");

function resetSpies() {
  exchangeCodeForTokensSpy.mock.resetCalls();
  exchangeCodeForTokensSpy.mock.mockImplementation(async (_code: string): Promise<any> => {
    throw new Error("exchangeCodeForTokens not stubbed");
  });
}

function createMockResponse() {
  const record: {
    statusCode: number | null;
    body: any;
    redirect: { code: number; location: string } | null;
  } = {
    statusCode: null,
    body: null,
    redirect: null,
  };

  const res: any = {
    status(code: number) {
      record.statusCode = code;
      return {
        send(body: any) {
          record.body = body;
          return res;
        },
      };
    },
    redirect(code: number, location: string) {
      record.redirect = { code, location };
      return res;
    },
  };

  return { res, record };
}

function encodeState(payload: any): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

test("returns 400 when state parameter is missing", async () => {
  resetSpies();
  const { res, record } = createMockResponse();
  const req: any = { query: { code: "abc" } };

  await handler(req, res);

  assert.strictEqual(record.statusCode, 400);
  assert.strictEqual(record.body, "Missing or invalid state");
  assert.strictEqual(exchangeCodeForTokensSpy.mock.callCount(), 0);
});

test("returns 400 when state cannot be decoded", async () => {
  resetSpies();
  const { res, record } = createMockResponse();
  const req: any = { query: { code: "abc", state: "%%%" } };

  await handler(req, res);

  assert.strictEqual(record.statusCode, 400);
  assert.strictEqual(record.body, "Missing or invalid state");
  assert.strictEqual(exchangeCodeForTokensSpy.mock.callCount(), 0);
});

test("returns 400 when state omits user", async () => {
  resetSpies();
  const { res, record } = createMockResponse();
  const req: any = { query: { code: "abc", state: encodeState({}) } };

  await handler(req, res);

  assert.strictEqual(record.statusCode, 400);
  assert.strictEqual(record.body, "Missing or invalid state");
  assert.strictEqual(exchangeCodeForTokensSpy.mock.callCount(), 0);
});
