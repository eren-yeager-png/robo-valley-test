// ESLint (flat config) with Next.js's own recommended rules, so `npm run lint` works. No extra or stricter rules.
// Only the application and its tests are linted; WordPress files, reference material and one-off scripts are not part of the app.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**", "frontend/**", "reference/**", "docs/**", "db/**", "scripts/**", "wp-content-mu-plugins/**"]),
]);
