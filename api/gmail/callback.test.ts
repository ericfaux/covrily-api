// api/gmail/callback.test.ts
// Assumes callback handler interactions can be isolated via module stubs; trade-off is manually
// managing fake Supabase and Gmail helpers so we can assert state validation logic without hitting real services.
import test, { mock } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";

process.env.SUPABASE_URL = "http://example.com";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

const require = createRequire(import.meta.url);

const gmailModulePath = require.resolve("../../lib/gmail.js");
const exchangeCodeForTokensSpy = mock.fn(async (_code: string): Promise<any> => {
  throw new Error("exchangeCodeForTokens not stubbed");
});
const getTokenInfoSpy = mock.fn(async (_token: string): Promise<any> => {
  throw new Error("getTokenInfo not stubbed");
});

require.cache[gmailModulePath] = {
  id: gmailModulePath,
  filename: gmailModulePath,
  loaded: true,
  exports: {
    exchangeCodeForTokens: exchangeCodeForTokensSpy,
    getTokenInfo: getTokenInfoSpy,
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
  getTokenInfoSpy.mock.resetCalls();
  getTokenInfoSpy.mock.mockImplementation(async (_token: string): Promise<any> => {
    throw new Error("getTokenInfo not stubbed");
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

test("returns 400 when state parameter is missing", async () => {
  resetSpies();
  const { res, record } = createMockResponse();
  const req: any = { query: { code: "abc" } };

  await handler(req, res);

  assert.strictEqual(record.statusCode, 400);
  assert.strictEqual(record.body, "Missing or invalid state");
  assert.strictEqual(exchangeCodeForTokensSpy.mock.callCount(), 0);
  assert.strictEqual(getTokenInfoSpy.mock.callCount(), 0);
});

test("returns 400 when state is not valid JSON", async () => {
  resetSpies();
  const { res, record } = createMockResponse();
  const req: any = { query: { code: "abc", state: "not-json" } };

  await handler(req, res);

  assert.strictEqual(record.statusCode, 400);
  assert.strictEqual(record.body, "Missing or invalid state");
  assert.strictEqual(exchangeCodeForTokensSpy.mock.callCount(), 0);
  assert.strictEqual(getTokenInfoSpy.mock.callCount(), 0);
});

test("returns 400 when state omits user", async () => {
  resetSpies();
  const { res, record } = createMockResponse();
  const req: any = { query: { code: "abc", state: JSON.stringify({}) } };

  await handler(req, res);

  assert.strictEqual(record.statusCode, 400);
  assert.strictEqual(record.body, "Missing or invalid state");
  assert.strictEqual(exchangeCodeForTokensSpy.mock.callCount(), 0);
  assert.strictEqual(getTokenInfoSpy.mock.callCount(), 0);
});
