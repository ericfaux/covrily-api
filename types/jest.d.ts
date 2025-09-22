// types/jest.d.ts
// Assumes we only need a sliver of the Jest surface for local type-checking; trade-off is manually
// maintaining these globals until we can install the official @types package.

declare function describe(name: string, fn: () => void | Promise<void>): void;
declare function it(name: string, fn: () => void | Promise<void>): void;

declare interface JestMatchers<T> {
  toBe(expected: T): void;
  toMatch(expected: RegExp): void;
}

declare function expect<T>(actual: T): JestMatchers<T>;
