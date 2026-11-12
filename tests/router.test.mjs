import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage } from './helpers.mjs';

let srv, browser, page, errors;
const base = '/tests/fixtures/app/';
const h = () => page.textContent('#h');
before(async () => {
  srv = await startServer(undefined, [base]); browser = await launch();
  ({ page, errors } = await openPage(browser, srv.url + base));
});
after(async () => { await browser.close(); srv.close(); });

test('initial page, i18n, component file with scoped style', async () => {
  await page.waitForSelector('#h');
  assert.equal(await h(), 'Home page');
  assert.equal(await page.title(), 'Home · App');
  assert.equal(await page.textContent('#hello'), 'Hello, Ann!');
  await page.waitForSelector('.badge');
  assert.equal(await page.textContent('.badge'), 'Zed · hi Zed');
  assert.equal(await page.$eval('.badge', (e) => getComputedStyle(e).color), 'rgb(255, 0, 0)');
  assert.ok(await page.getAttribute('#home', 'class'), 'cur');
});

test('SPA navigation without reload + scripts run + active link', async () => {
  await page.evaluate(() => { window.__marker = 1; });
  await page.click('#about');
  await page.waitForFunction(() => document.querySelector('#h').textContent === 'About 5');
  assert.equal(new URL(page.url()).pathname, base + 'about');
  assert.equal(await page.evaluate(() => window.__marker), 1, 'no full reload');
  assert.equal(await page.evaluate(() => window.__aboutRan), 1);
  assert.equal(await page.getAttribute('#about', 'class'), 'cur');
  assert.equal(await page.getAttribute('#home', 'class'), '');
  assert.equal(await page.title(), 'About · App');
});

test('dynamic route params', async () => {
  await page.click('#u5');
  await page.waitForFunction(() => document.querySelector('#h').textContent === 'User 5');
});

test('layouts persist between pages', async () => {
  await page.click('#docs');
  await page.waitForFunction(() => document.querySelector('#h')?.textContent === 'Intro');
  assert.ok(await page.$('#side'));
  await page.click('#docs2');
  await page.waitForFunction(() => document.querySelector('#h').textContent === 'Next');
  assert.equal(await page.evaluate(() => window.__layoutInits), 1);
});

test('back button + 404 page', async () => {
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#h').textContent === 'Intro');
  await page.click('#missing');
  await page.waitForFunction(() => document.querySelector('#h').textContent === 'Custom 404');
});

test('deep link loads directly', async () => {
  await page.goto(srv.url + base + 'users/9');
  await page.waitForFunction(() => document.querySelector('#h')?.textContent === 'User 9');
});

test('language switch updates text + c-lang', async () => {
  assert.equal(await page.isVisible('#langen'), true);
  await page.click('#uz');
  await page.waitForFunction(() => document.querySelector('#hello').textContent === 'Salom, Ann!');
  assert.equal(await page.isVisible('#langen'), false);
  assert.equal(await page.isVisible('#languz'), true);
});

test('no runtime errors', () => { assert.deepEqual(errors.filter((e) => !/404/.test(e)), []); });
