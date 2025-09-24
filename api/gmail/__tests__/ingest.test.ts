// api/gmail/__tests__/ingest.test.ts
// Assumes ingest helpers can be loaded via per-test dynamic imports after seeding Supabase env vars;
// trade-off is importing the module twice to avoid augmenting Jest type stubs while still verifying
// conflict detection and order-id normalization edge cases.

describe("isMissingConflictConstraint", () => {
  it("returns true only for 42P10 errors", async () => {
    process.env.SUPABASE_URL = "http://example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const moduleUnderTest = await import("../ingest.js");
    const { isMissingConflictConstraint } = moduleUnderTest;

    expect(isMissingConflictConstraint({ code: "42P10" })).toBe(true);
    expect(isMissingConflictConstraint({ code: "23505" })).toBe(false);
    expect(isMissingConflictConstraint(null)).toBe(false);
  });
});

describe("normalizeOrderIdValue", () => {
  it("trims IDs and drops placeholder values", async () => {
    process.env.SUPABASE_URL = "http://example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const moduleUnderTest = await import("../ingest.js");
    const { normalizeOrderIdValue } = moduleUnderTest;

    expect(normalizeOrderIdValue(" 12345 ")).toBe("12345");
    expect(normalizeOrderIdValue("-")).toBe(null);
    expect(normalizeOrderIdValue("   " as any)).toBe(null);
    expect(normalizeOrderIdValue(undefined)).toBe(null);
  });
});
