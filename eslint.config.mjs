import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The Next.js app lives in apps/web; the other workspaces are plain TypeScript.
  { settings: { next: { rootDir: "apps/web/" } } },
  globalIgnores([
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    "**/.turbo/**",
    // The desktop app's bundles and packaged installers.
    "apps/desktop/dist/**",
    "apps/desktop/release/**",
  ]),
]);

export default eslintConfig;
