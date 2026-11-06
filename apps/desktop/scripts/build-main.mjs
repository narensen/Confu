// Bundles the Electron main process and preload script. Google sign-in for
// Drive sync is baked in from the environment at build time (the "Desktop
// app" OAuth client: its secret isn't secret for installed apps, per Google).
import { build } from "esbuild";

const config = {
  googleClientId: process.env.CONFU_GOOGLE_DESKTOP_CLIENT_ID ?? "",
  googleClientSecret: process.env.CONFU_GOOGLE_DESKTOP_CLIENT_SECRET ?? "",
  googleApiKey: process.env.CONFU_GOOGLE_API_KEY ?? "",
  site: process.env.CONFU_SITE_URL || "https://confu.lol",
};

const common = { bundle: true, platform: "node", target: "node22", format: "cjs", external: ["electron"], logLevel: "warning" };
await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main/main.cjs", define: { CONFU_CONFIG: JSON.stringify(config) } });
await build({ ...common, entryPoints: ["src/main/preload.ts"], outfile: "dist/main/preload.cjs" });
console.log(`main built${config.googleClientId ? " (Google Drive on)" : " (Google Drive off: set CONFU_GOOGLE_DESKTOP_CLIENT_ID)"}`);
