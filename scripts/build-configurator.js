import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { armarConfigurador } from "./armar-configurador.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Step 1: Build the player
console.log("1/3 Building player with Vite...");
execSync("npx vite build", { cwd: root, stdio: "inherit" });

const playerHtml = readFileSync(resolve(root, "dist", "index.html"), "utf-8");
const manifest = readFileSync(resolve(root, "scorm", "imsmanifest.xml"), "utf-8");
const configurator = readFileSync(resolve(root, "configurator", "index.html"), "utf-8");

// Step 2: Embed the player (base64) and the SCORM manifest into the configurator.
// La inyección vive en armar-configurador.mjs: la usan también las pruebas de navegador.
console.log("2/3 Embedding player into configurator...");
const output = armarConfigurador({ playerHtml, manifest, configurator });

console.log("3/3 Writing dist/configurator.html...");
writeFileSync(resolve(root, "dist", "configurator.html"), output, "utf-8");

const size = (Buffer.byteLength(output) / 1024).toFixed(1);
console.log(`Done! Configurator: dist/configurator.html (${size} KB)`);
console.log("\nEl docente abre este archivo en su navegador para crear videos interactivos.");
