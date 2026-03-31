import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Step 1: Build the player
console.log("1/3 Building player with Vite...");
execSync("npx vite build", { cwd: root, stdio: "inherit" });

const playerHtml = readFileSync(resolve(root, "dist", "index.html"), "utf-8");
const manifest = readFileSync(resolve(root, "scorm", "imsmanifest.xml"), "utf-8");
const configurator = readFileSync(resolve(root, "configurator", "index.html"), "utf-8");

// Step 2: Encode player HTML as base64
console.log("2/3 Embedding player into configurator...");
const playerBase64 = Buffer.from(playerHtml).toString("base64");

// Build the injection script — uses the hooks already in the configurator:
// - window.generateConfig() returns the PLAYER_CONFIG
// - window.downloadScormReal is called by downloadSCORM() if available
// - window.previewWithPlayer is called by preview() if available
const injectedScript = `
<script>
(function(){
  var PLAYER_B64 = "${playerBase64}";
  var MANIFEST_TPL = ${JSON.stringify(manifest)};

  function decodeB64UTF8(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function injectConfig(html, config) {
    var tag = '<scr'+'ipt>window.PLAYER_CONFIG=' + JSON.stringify(config) + ';</scr'+'ipt>';
    return html.replace('</head>', tag + '</head>');
  }

  window.downloadScormReal = async function() {
    var config = window.generateConfig();
    if (!config || !config.vimeoId) { alert('Primero configura el video.'); return; }
    var html = injectConfig(decodeB64UTF8(PLAYER_B64), config);
    var manifestXml = MANIFEST_TPL.replace(/<title>[^<]*<\\/title>/g,
      '<title>' + (config.title||'Video Interactivo').replace(/[<>&"]/g,'') + '</title>');
    var zip = new JSZip();
    zip.file('index.html', html);
    zip.file('imsmanifest.xml', manifestXml);
    var blob = await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:9}});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (config.title||'video').replace(/[^a-zA-Z0-9 ]/g,'').replace(/\\s+/g,'-').toLowerCase()+'-scorm.zip';
    a.click();
  };

  window.previewWithPlayer = function() {
    var config = window.generateConfig();
    if (!config || !config.vimeoId) { alert('Primero configura el video.'); return; }
    var html = injectConfig(decodeB64UTF8(PLAYER_B64), config);
    var w = window.open('','_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };
})();
</script>`;

// Step 3: Inject before the LAST </body> (not one inside JS strings)
const lastIdx = configurator.lastIndexOf('</body>');
let output = configurator.slice(0, lastIdx) + injectedScript + '\n' + configurator.slice(lastIdx);

console.log("3/3 Writing dist/configurator.html...");
writeFileSync(resolve(root, "dist", "configurator.html"), output, "utf-8");

const size = (Buffer.byteLength(output) / 1024).toFixed(1);
console.log(`Done! Configurator: dist/configurator.html (${size} KB)`);
console.log("\nEl docente abre este archivo en su navegador para crear videos interactivos.");
