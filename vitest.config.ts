import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node", // UI tests opt in with: // @vitest-environment jsdom
    testTimeout: 20000,
    // Deterministic and safe: tests use the mock provider; Resend is only ever a mocked module.
    env: { OTP_PROVIDER: "mock", MOCK_OTP: "true", RESEND_API_KEY: "", SESSION_SECRET: "unit-test-secret-unit-test-secret-1234" },
  },
});
