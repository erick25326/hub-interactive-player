import { execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

console.log("1/3 Building player with Vite...");
execSync("npx vite build", { cwd: root, stdio: "inherit" });

const distHtml = resolve(root, "dist", "index.html");
const manifest = resolve(root, "scorm", "imsmanifest.xml");

if (!existsSync(distHtml)) {
  console.error("ERROR: dist/index.html not found. Build failed?");
  process.exit(1);
}
if (!existsSync(manifest)) {
  console.error("ERROR: scorm/imsmanifest.xml not found.");
  process.exit(1);
}

const outDir = resolve(root, "dist");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const outPath = resolve(outDir, "scorm-package.zip");
console.log("2/3 Creating SCORM package...");

const output = createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });

archive.on("error", (err) => { throw err; });
archive.on("warning", (err) => {
  if (err.code !== "ENOENT") throw err;
});

output.on("close", () => {
  const size = (archive.pointer() / 1024).toFixed(1);
  console.log(`3/3 Done! SCORM package: dist/scorm-package.zip (${size} KB)`);
  console.log("\nPara usar en Moodle:");
  console.log("  1. Ir a tu curso → Agregar actividad → SCORM");
  console.log("  2. Subir dist/scorm-package.zip");
  console.log("  3. Guardar y mostrar");
});

archive.pipe(output);
archive.file(manifest, { name: "imsmanifest.xml" });
archive.file(distHtml, { name: "index.html" });
archive.finalize();
