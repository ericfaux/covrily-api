// jest.config.cjs
// Assumes ts-jest can transpile our ESM TypeScript sources; trade-off is adding Jest tooling
// overhead so we can unit test helper utilities without shipping runtime bundlers.

module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  globals: {
    "ts-jest": {
      useESM: true,
      tsconfig: "./tsconfig.json",
    },
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
};
