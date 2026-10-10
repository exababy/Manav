'use strict';
/**
 * GitHub Pages için sunucusuz demo sürümünü dist/ klasörüne derler.
 *   npm run build:pages
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

// Tarayıcıda çalışan API
esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'demo/backend.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  outfile: path.join(DIST, 'js/demo-backend.js'),
});

// PDF kütüphanesi ve Türkçe fontlar
fs.mkdirSync(path.join(DIST, 'vendor'), { recursive: true });
fs.copyFileSync(require.resolve('pdfkit/js/pdfkit.standalone.js'), path.join(DIST, 'vendor/pdfkit.standalone.js'));
fs.mkdirSync(path.join(DIST, 'fonts'), { recursive: true });
for (const f of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'LICENSE-DejaVu.txt']) {
  fs.copyFileSync(path.join(ROOT, 'fonts', f), path.join(DIST, 'fonts', f));
}

// index.html: demo arka ucunu uygulamadan önce yükle
const indexFile = path.join(DIST, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
if (!html.includes('<!-- DEMO -->')) throw new Error('index.html içinde <!-- DEMO --> işareti yok');
html = html.replace('<!-- DEMO -->', '<script src="js/demo-backend.js"></script>');
fs.writeFileSync(indexFile, html);

// Service worker: demo dosyalarını da önbelleğe al
const swFile = path.join(DIST, 'sw.js');
let sw = fs.readFileSync(swFile, 'utf8');
sw = sw.replace("'manifest.webmanifest',", "'manifest.webmanifest', 'js/demo-backend.js', 'vendor/pdfkit.standalone.js', 'fonts/DejaVuSans.ttf', 'fonts/DejaVuSans-Bold.ttf',");
sw = sw.replace(/const CACHE = '([^']+)';/, `const CACHE = '$1-demo-${Date.now()}';`);
fs.writeFileSync(swFile, sw);

fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
console.log('Pages demo hazır: dist/');
