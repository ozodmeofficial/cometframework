import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage } from './helpers.mjs';

let srv, browser, page, errors;
const txt = (s) => page.textContent(s);
before(async () => { srv = await startServer(); browser = await launch(); ({ page, errors } = await openPage(browser, srv.url + '/tests/fixtures/core.html')); });
after(async () => { await browser.close(); srv.close(); });

test('interpolation, getters, methods', async () => {
  assert.equal(await txt('#c1'), '1');
  assert.equal(await txt('#c2'), '2');
  await page.click('#inc');
  assert.equal(await txt('#c1'), '2');
  assert.equal(await txt('#c2'), '4');
  assert.equal(await page.getAttribute('#lnk', 'href'), '/x/2');
});

test('c-if / c-else-if / c-else, c-show, :class', async () => {
  assert.equal(await page.$('#ifa'), null);
  assert.ok(await page.$('#ifb'));
  assert.equal(await page.isVisible('#show'), false);
  await page.click('#inc2');
  assert.ok(await page.$('#ifc'));
  assert.equal(await page.isVisible('#show'), true);
  assert.equal(await page.getAttribute('#cls', 'class'), 'base on');
});

test('nested scope writes to parent', async () => {
  await page.click('#parentset');
  assert.equal(await txt('#loc'), 'L-100');
  assert.equal(await txt('#c1'), '100');
});

test('c-for keyed: add, reverse, delete, edit', async () => {
  const items = () => page.$$eval('#list li', (els) => els.map((e) => e.textContent));
  assert.deepEqual(await items(), ['0:a', '1:b', '2:c']);
  const firstNode = await page.$('#list li[data-id="1"]');
  await page.click('#add');
  assert.deepEqual(await items(), ['0:a', '1:b', '2:c', '3:n']);
  await page.click('#rev');
  assert.deepEqual(await items(), ['0:n', '1:c', '2:b', '3:a']);
  assert.equal(await firstNode.evaluate((e) => e.isConnected && e.textContent), '3:a', 'keyed node is reused');
  await page.click('#del');
  assert.deepEqual(await items(), ['0:c', '1:b', '2:a']);
  await page.click('#edit');
  assert.deepEqual(await items(), ['0:Z', '1:b', '2:a']);
  assert.equal(await txt('#n'), '3');
  assert.deepEqual(await page.$$eval('.num', (e) => e.map((x) => x.textContent)), ['1', '2', '3']);
});

test('c-model variants', async () => {
  await page.fill('#name', 'Bob');
  assert.equal(await txt('#name-out'), 'Bob');
  await page.check('#agree');
  assert.equal(await txt('#agree-out'), 'true');
  const tags = await page.$$('.tag');
  assert.equal(await tags[0].isChecked(), true);
  await tags[1].check();
  assert.equal(await txt('#tags-out'), 'x,y');
  assert.equal(await page.isChecked('#rb'), true);
  await page.fill('#age', '42');
  assert.equal(await txt('#age-out'), 'number');
  assert.equal(await page.inputValue('#size'), 'm');
});

test('events: key modifiers, outside, $emit', async () => {
  await page.focus('#key');
  await page.keyboard.press('a');
  await page.keyboard.press('Enter');
  assert.equal(await txt('#k'), '1');
  await page.click('#k');
  assert.equal(await txt('#out'), 'true');
  await page.click('#emit');
  assert.equal(await txt('#got'), 'pong');
});

test('components: props, slots, fallthrough, emit', async () => {
  assert.equal(await page.$('ui-card'), null, 'host replaced');
  assert.equal(await txt('#card1 .ct'), 'Static (1)');
  assert.equal(await page.getAttribute('#card1', 'class'), 'card extra');
  assert.equal(await txt('#card1 .slotp'), 'Hello slot');
  assert.equal(await txt('#card1 footer'), 'custom-foot');
  await page.click('#card1 .cb');
  assert.equal(await txt('#card1 .ct'), 'Static (2)');
});

test('refs, c-pre, store with persist', async () => {
  await page.click('#refbtn');
  assert.equal(await txt('#refout'), 'hi');
  assert.equal(await txt('#pre'), '{{ untouched }}');
  await page.click('#stadd');
  assert.equal(await txt('#st'), '1');
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(() => localStorage.getItem('comet:store:cart')), '{"items":["x"]}');
});

test('vanilla JS injected HTML is auto-initialized', async () => {
  await page.evaluate(() => document.querySelector('#counter').insertAdjacentHTML('beforeend', '<b id="inj">{{ count * 2 }}</b>'));
  await page.waitForSelector('#inj');
  await page.waitForFunction(() => document.querySelector('#inj').textContent === '200');
});

test('no runtime errors', () => { assert.deepEqual(errors, []); });
