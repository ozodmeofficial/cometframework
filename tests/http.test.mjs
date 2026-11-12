import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage } from './helpers.mjs';

let srv, browser, page, errors;
const txt = (s) => page.textContent(s);
before(async () => {
  srv = await startServer(); browser = await launch();
  ({ page, errors } = await openPage(browser, srv.url + '/tests/fixtures/http.html'));
});
after(async () => { await browser.close(); srv.close(); });

test('c-get with loading + empty states', async () => {
  await page.waitForSelector('#empty', { state: 'visible' });
  assert.equal(await page.isVisible('#loading'), false);
});

test('c-post form: validation, server 422, success + auto revalidation', async () => {
  await page.fill('#title', 'x');
  await page.click('#submit');
  await page.waitForFunction(() => document.querySelector('#title-err').textContent === 'Title too short');
  await page.fill('#title', 'Buy milk');
  await page.click('#submit');
  await page.waitForSelector('.todo');
  assert.equal(await txt('.todo'), 'Buy milk');
  assert.equal(await page.inputValue('#title'), '', 'c-reset');
  assert.equal(await page.isVisible('#title-err'), false);
  assert.equal(await page.isVisible('#empty'), false);
});

test('reactive URL with debounce', async () => {
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 3);
  await page.fill('#q', 'an');
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 1);
  assert.equal(await txt('.res'), 'banana');
});

test('route params in mock', async () => {
  await page.waitForFunction(() => document.querySelector('#uname').textContent === 'User 7');
});

test('optimistic UI rolls back on error', async () => {
  await page.click('#optbtn');
  assert.equal(await txt('#optn'), '2');
  await page.waitForFunction(() => window.__caught === 'Server exploded');
  assert.equal(await txt('#optn'), '1');
});

test('HTML responses are swapped and initialized', async () => {
  await page.waitForFunction(() => document.querySelector('#swapped')?.textContent === '2');
});

test('$db live queries + persistence', async () => {
  await page.evaluate(async () => { const t = await Comet.db.todos.add({ title: 'Done one', done: true }); });
  await page.waitForFunction(() => document.querySelector('#donecount').textContent === '1');
  const rows = await page.evaluate(() => Comet.db.todos.where('title', 'like', 'MILK').get());
  assert.equal(rows.length, 1);
  assert.ok(rows[0].createdAt);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('c-ready'));
  await page.waitForFunction(() => document.querySelectorAll('.todo').length === 2);
  await page.waitForFunction(() => document.querySelector('#donecount').textContent === '1');
});

test('mock.crud ignores empty filters, applies real ones', async () => {
  const r = await page.evaluate(async () => [
    (await Comet.fetch('/api/todos?done=')).length,
    (await Comet.fetch('/api/todos?done=true')).length,
    (await Comet.fetch('/api/todos?_sort=title&_order=desc'))[0].title,
  ]);
  assert.deepEqual(r, [2, 1, 'Done one']);
});

test('no runtime errors', () => { assert.deepEqual(errors, []); });
