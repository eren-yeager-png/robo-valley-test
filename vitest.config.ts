import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node", // UI tests opt in with: // @vitest-environment jsdom
    testTimeout: 30000,
    hookTimeout: 60000,
    setupFiles: ["tests/setup.ts"],
    // Deterministic and safe. DATABASE_URL is an unroutable placeholder that overrides anything in the shell
    // (tests/setup.ts enforces it and blocks real pg connections); tests use the in-process PGlite database.
    // Resend is only ever a mocked module.
    env: {
      DATABASE_URL: "postgresql://tests-only:tests-only@127.0.0.1:1/never_connects",
      OTP_PROVIDER: "mock",
      MOCK_OTP: "true",
      RESEND_API_KEY: "",
      SESSION_SECRET: "unit-test-secret-unit-test-secret-1234",
    },
  },
});
