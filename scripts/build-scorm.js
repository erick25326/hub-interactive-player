import { execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Sin config, el paquete saldría con el video y las interacciones DEMO
// hardcodeadas en DEFAULT_CONFIG (footgun clásico: subirlo a Moodle y ver el
// demo). Exigir un config real: node scripts/build-scorm.js --config mi.json
// (el flujo normal sigue siendo "Descargar SCORM" desde el configurador).
const cfgFlag = process.argv.indexOf("--config");
const cfgPath = cfgFlag > -1 ? process.argv[cfgFlag + 1] : null;
if (!cfgPath) {
  console.error("ERROR: falta el config del video.");
  console.error("Uso: node scripts/build-scorm.js --config <config.json>");
  console.error("(o generá el paquete desde el configurador visual, que inyecta el config solo)");
  process.exit(1);
}
if (!existsSync(resolve(root, cfgPath))) {
  console.error(`ERROR: no existe ${cfgPath}`);
  process.exit(1);
}
const playerConfig = JSON.parse(readFileSync(resolve(root, cfgPath), "utf8"));

console.log("1/3 Building player with Vite...");
execSync("npx vite build", { cwd: root, stdio: "inherit" });

const distHtml = resolve(root, "dist", "index.html");
const manifest = resolve(root, "scorm", "imsmanifest.xml");

if (!existsSync(distHtml)) {
  console.error("ERROR: dist/index.html not found. Build failed?");
  process.exit(1);
}

// Inyectar el PLAYER_CONFIG antes de </head> (mismo patrón que player.php),
// EN MEMORIA — dist/index.html no se toca (lo comparte build-plugin/player.html).
// El < escapa "<" para que un texto con "</script>" no rompa el HTML.
const baseHtml = readFileSync(distHtml, "utf8");
if (!baseHtml.includes("</head>")) {
  console.error("ERROR: dist/index.html sin </head>; no se pudo inyectar el config.");
  process.exit(1);
}
const configJson = JSON.stringify(playerConfig).replace(/</g, "\\u003C");
const injectedHtml = baseHtml.replace(
  "</head>",
  `<script>window.PLAYER_CONFIG = ${configJson};</script>\n</head>`
);
console.log(`   Config inyectado desde ${cfgPath}`);
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
archive.append(injectedHtml, { name: "index.html" });
archive.finalize();
