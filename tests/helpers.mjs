import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };

export async function startServer(root = resolve('.'), spa = []) {
  const server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(root, p);
    try { const s = await stat(file); if (s.isDirectory()) file = join(file, 'index.html'); await stat(file); }
    catch {
      const app = spa.find((a) => p.startsWith(a));
      if (!app || extname(p)) { res.writeHead(404); return res.end('nf'); }
      file = join(root, app, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'text/plain' });
    res.end(await readFile(file));
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}`, close: () => server.close() };
}

export async function launch() {
  const browser = await chromium.launch();
  return browser;
}

export async function openPage(browser, url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.classList.contains('c-ready'));
  return { page, errors };
}
