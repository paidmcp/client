import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json",
);
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

export const version: string = pkg.version;
