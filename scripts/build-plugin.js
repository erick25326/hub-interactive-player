import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { createWriteStream } from "fs";
import { resolve, dirname, relative, join } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const modDir = resolve(root, "mod", "ivplayer");

// Step 1: Build the player.
console.log("1/3 Building player with Vite...");
execSync("npx vite build", { cwd: root, stdio: "inherit" });

// Step 2: Copy compiled player to plugin directory.
console.log("2/3 Copying player to plugin...");
const playerHtml = readFileSync(resolve(root, "dist", "index.html"), "utf-8");
writeFileSync(resolve(modDir, "player.html"), playerHtml, "utf-8");

// Step 3: Create ZIP.
console.log("3/3 Creating plugin ZIP...");
const outPath = resolve(root, "dist", "mod_ivplayer.zip");
const output = createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });

archive.on("error", (err) => { throw err; });

output.on("close", () => {
  const size = (archive.pointer() / 1024).toFixed(1);
  console.log(`\nDone! Plugin: dist/mod_ivplayer.zip (${size} KB)`);
  console.log("\nPara instalar en Moodle:");
  console.log("  1. Administracion del Sitio → Plugins → Instalar plugins");
  console.log("  2. Subir dist/mod_ivplayer.zip");
  console.log("  3. Confirmar instalacion");
});

archive.pipe(output);

// Add all files from mod/ivplayer/ into ivplayer/ in the ZIP.
function addDir(dir, zipPath) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const zipEntryPath = join(zipPath, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      addDir(fullPath, zipEntryPath);
    } else {
      archive.file(fullPath, { name: zipEntryPath });
    }
  }
}

addDir(modDir, "ivplayer");
archive.finalize();
