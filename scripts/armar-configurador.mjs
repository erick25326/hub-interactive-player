// Arma el configurador que se publica: configurator/index.html con el reproductor
// compilado (en base64) y el manifiesto SCORM adentro, para la vista previa con el
// reproductor de verdad y el paquete SCORM.
// Lo usan scripts/build-configurator.js (dist/configurator.html, que se publica en
// GitHub Pages) y las pruebas de navegador (con el reproductor que compilan a una
// carpeta temporal): así se prueba exactamente lo que se publica.
export function armarConfigurador({ playerHtml, manifest, configurator }) {
  const playerBase64 = Buffer.from(playerHtml).toString("base64");

  // Build the injection script — uses the hooks already in the configurator:
  // - window.generateConfig() returns the PLAYER_CONFIG (lo que se exporta)
  // - window.generatePreviewConfig() lo mismo + videoUrl del archivo local, sólo para
  //   la vista previa (ver el configurador)
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
    // Escapar "<" como secuencia unicode: un texto de interacción que contenga
    // "</scr"+"ipt>" rompería el HTML generado (mismo hardening que JSON_HEX_TAG
    // en player.php). Doble-doble escape: esto vive dentro de un template
    // literal del build, el script emitido debe decir replace(/</g,'\\u003C').
    var json = JSON.stringify(config).replace(/</g, '\\\\u003C');
    var tag = '<scr'+'ipt>window.PLAYER_CONFIG=' + json + ';</scr'+'ipt>';
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
    // Con un video de la compu, la config de la vista previa trae videoUrl (blob:) y
    // vimeoId vacío: el reproductor lo toma como MP4 directo (nativePlayer.js).
    var config = window.generatePreviewConfig ? window.generatePreviewConfig() : window.generateConfig();
    if (!config || (!config.vimeoId && !config.videoUrl)) { alert('Primero configura el video.'); return; }
    var html = injectConfig(decodeB64UTF8(PLAYER_B64), config);
    var w = window.open('','_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };
})();
</script>`;

  // Inject before the LAST </body> (not one inside JS strings)
  const lastIdx = configurator.lastIndexOf('</body>');
  return configurator.slice(0, lastIdx) + injectedScript + '\n' + configurator.slice(lastIdx);
}
