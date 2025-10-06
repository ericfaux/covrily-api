// PATH: lib/__tests__/gmail.test.ts
// Assumes Gmail helper functions can run with mocked Supabase/fetch; trade-off is manually wiring
// stubs for each call sequence to verify refresh flows without pulling in heavier mock frameworks.
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

describe("ensureAccessToken", () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  beforeEach(() => {
    process.env.SUPABASE_URL = "http://example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.GMAIL_CLIENT_ID = "client";
    process.env.GMAIL_CLIENT_SECRET = "secret";
    process.env.GMAIL_REDIRECT_URI = "https://example.com/callback";
    jest.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("returns cached token when not expired", async () => {
    globalThis.fetch = jest.fn(() => Promise.resolve(new Response())) as any;
    const { ensureAccessToken } = await import("../gmail.js");
    const { supabaseAdmin } = await import("../supabase-admin.js");

    (supabaseAdmin as any).from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              refresh_token: "refresh",
              access_token: "token",
              access_token_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            },
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    });

    const result = await ensureAccessToken("user-1");
    expect(result.accessToken).toBe("token");
    expect((globalThis.fetch as any)).not.toHaveBeenCalled();
  });

  test("refreshes when expired", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "new-token", expires_in: 3600, scope: "scope1 scope2" }),
      text: async () => "",
    }));
    globalThis.fetch = fetchMock as any;

    const { ensureAccessToken } = await import("../gmail.js");
    const { supabaseAdmin } = await import("../supabase-admin.js");

    const updateSpy = jest.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });

    (supabaseAdmin as any).from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              refresh_token: "refresh",
              access_token: "old-token",
              access_token_expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
            },
            error: null,
          }),
        }),
      }),
      update: updateSpy,
    });

    const result = await ensureAccessToken("user-2");
    expect(result.accessToken).toBe("new-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  test("throws reauthorize when refresh token missing", async () => {
    globalThis.fetch = jest.fn(() => Promise.resolve(new Response())) as any;
    const { ensureAccessToken, ReauthorizeNeeded } = await import("../gmail.js");
    const { supabaseAdmin } = await import("../supabase-admin.js");

    (supabaseAdmin as any).from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { refresh_token: null }, error: null }),
        }),
      }),
    });

    await expect(ensureAccessToken("user-3")).rejects.toBeInstanceOf(ReauthorizeNeeded);
  });
});
