// Build: minify src/comet.js -> dist/, copy into the website, generate 404.html (SPA fallback for GitHub Pages)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';

mkdirSync('dist', { recursive: true });
copyFileSync('src/comet.js', 'dist/comet.js');
await build({
  entryPoints: ['src/comet.js'],
  outfile: 'dist/comet.min.js',
  minify: true,
  target: ['es2020'],
  legalComments: 'inline',
  logLevel: 'warning',
});
const min = readFileSync('dist/comet.min.js');
const gz = gzipSync(min, { level: 9 }).length;
const br = brotliCompressSync(min).length;
const size = { raw: min.length, gzip: gz, brotli: br, version: JSON.parse(readFileSync('package.json')).version };
writeFileSync('dist/size.json', JSON.stringify(size, null, 2) + '\n');
mkdirSync('site/assets', { recursive: true });
copyFileSync('dist/comet.min.js', 'site/assets/comet.min.js');
writeFileSync('site/assets/size.json', JSON.stringify(size) + '\n');
// GitHub Pages serves 404.html for unknown paths -> same shell = SPA deep links work
copyFileSync('site/index.html', 'site/404.html');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`comet.min.js  ${kb(size.raw)}  ·  gzip ${kb(gz)}  ·  brotli ${kb(br)}`);
