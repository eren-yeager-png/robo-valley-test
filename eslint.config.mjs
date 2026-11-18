import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// Standard Next.js flat config (see node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md).
const eslintConfig = defineConfig([
  ...nextVitals,
  // frontend/ holds the WordPress theme/plugins (third-party and plain browser scripts), not the Next.js app.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "frontend/**"]),
]);

export default eslintConfig;
