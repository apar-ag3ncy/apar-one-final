import '@testing-library/jest-dom/vitest';

// db/client.ts throws at import time if DATABASE_URL is unset. Tests
// that touch any service-layer module transitively import it. Stub a
// URL so the connection pool can be constructed; postgres.js doesn't
// connect until first query so this never reaches a real DB.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
}
