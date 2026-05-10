import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(__dirname, "../../api-zod/src/index.ts");

writeFileSync(indexPath, 'export * from "./generated/api";\n');
console.log("Patched lib/api-zod/src/index.ts → export * from \"./generated/api\"");
