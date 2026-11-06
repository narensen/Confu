// Sets the desktop app's version, ready for a release:
//   bun run --cwd apps/desktop bump 0.2.0   (or patch | minor | major)
// Then commit, tag and push; the Desktop release workflow builds and publishes
// it, and installed copies pick it up from GitHub Releases.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(file, "utf8"));
const arg = process.argv[2];
const [ma, mi, pa] = pkg.version.split(".").map(Number);
const next = arg === "major" ? `${ma + 1}.0.0` : arg === "minor" ? `${ma}.${mi + 1}.0` : arg === "patch" ? `${ma}.${mi}.${pa + 1}` : arg;
if (!next || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
  console.error("Usage: bun run bump <x.y.z | patch | minor | major>");
  process.exit(1);
}
pkg.version = next;
writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Confu desktop ${next}. Now:
  git commit -am "release: desktop v${next}"
  git tag v${next} && git push && git push --tags`);
