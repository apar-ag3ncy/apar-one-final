// No-op shim for the `server-only` package in the vitest jsdom env.
// In production this package throws when imported from a client module;
// in unit tests we exercise server modules directly.
export {};
