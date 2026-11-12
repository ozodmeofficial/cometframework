<p align="center">
  <img src="site/assets/favicon.svg" width="72" height="72" alt="Comet logo">
</p>

<h1 align="center">Comet</h1>

<p align="center">
  <b>The build-free web framework.</b><br>
  One <code>&lt;script&gt;</code> tag gives you reactivity, an SPA router, HTTP-in-HTML, components,<br>
  a local database, a mock backend, i18n, animations and devtools.
</p>

<p align="center">
  <a href="https://ozodmeofficial.github.io/cometframework/">Website &amp; docs</a> ·
  <a href="https://ozodmeofficial.github.io/cometframework/docs/quick-start">Quick start</a> ·
  <a href="https://ozodmeofficial.github.io/cometframework/examples">Examples</a> ·
  <a href="https://ozodmeofficial.github.io/cometframework/roadmap">Roadmap</a>
</p>

---

```html
<script src="https://cdn.jsdelivr.net/gh/ozodmeofficial/cometframework@main/dist/comet.min.js"></script>

<div c-data="{ name: 'World', count: 0 }">
  <input c-model="name">
  <h2>Hello, {{ name }}!</h2>
  <button @click="count++">Clicked {{ count }} times</button>
</div>
```

No npm, no bundler, no `node_modules`, no config. Save the file, refresh the browser.

## Why Comet

Most of what a typical app needs usually takes a stack of separate packages — a UI library, a router, a data-fetching library, a form library, a state manager, i18n, a mock server. Comet puts all of it into **one file with one consistent HTML syntax**.

| | |
|---|---|
| **Reactivity** | `c-data`, `{{ }}`, `c-if`, `c-for` (keyed), `c-model`, `:class`, `@click.outside` … |
| **SPA router** | `pages/about.html` → `/about`. Layouts, params, prefetch on hover, View Transitions, `<title>`/meta, 404 |
| **HTTP in HTML** | `c-get="/api/users"` with `c-loading` / `c-error` / `c-empty`, reactive URLs, debounce, polling, triggers |
| **Forms** | `c-post` with native + custom validation, server `422` errors mapped to fields, `c-reset`, `c-optimistic` with auto-rollback |
| **Smart sync** | after `POST /api/todos`, every `c-get="/api/todos"` refreshes itself |
| **Local ORM** | `$db.users.where({ age: { gte: 18 } }).orderBy('name').live()` — IndexedDB, models, validation, cross-tab sync |
| **Mock backend** | `Comet.mock.crud('/api/users', 'users')` — a full REST API inside the browser |
| **Components** | `.html` files or `<template c-component>`, props, slots, scoped CSS, light DOM (Tailwind works) |
| **Realtime** | `c-live` over WebSocket, SSE or BroadcastChannel |
| **i18n** | `$t()`, `c-lang` blocks, plurals, `$fmt` (Intl numbers, currency, dates, "3 minutes ago") |
| **UI** | auto dark mode, `c-transition`, `c-reveal`, `c-stagger`, `c-teleport`, `c-hotkey`, `c-copy`, `$toast` |
| **Devtools** | in-page inspector: state, network, router, perf, errors — `Alt+Shift+D` |
| **Plays nice** | Tailwind, Bootstrap, jQuery, vanilla JS (HTML injected by any script is auto-initialized) |

## Install

```html
<!-- latest -->
<script src="https://cdn.jsdelivr.net/gh/ozodmeofficial/cometframework@main/dist/comet.min.js"></script>
<!-- pinned (recommended in production) -->
<script src="https://cdn.jsdelivr.net/gh/ozodmeofficial/cometframework@v0.1.0/dist/comet.min.js"></script>
```

Put it in `<head>` without `defer` — it applies dark mode and `c-cloak` before the first paint.

## A tiny full app

```html
<!-- index.html: the only file that includes the script -->
<script src="https://cdn.jsdelivr.net/gh/ozodmeofficial/cometframework@main/dist/comet.min.js"></script>
<script>
  Comet.db.model('todos', { defaults: { done: false } });
  Comet.mock.crud('/api/todos', 'todos');   // delete when your real API is ready
</script>

<nav><a href="./" c-active="active">Todos</a> <a href="about" c-active="active">About</a></nav>
<main c-view></main>
```

```html
<!-- pages/index.html -->
<title>Todos</title>
<form c-post="/api/todos" c-reset>
  <input name="title" required> <button :disabled="$loading">Add</button>
</form>
<ul c-get="/api/todos" c-as="todos">
  <li c-loading>Loading…</li>
  <li c-empty>Nothing to do 🎉</li>
  <li c-for="t in todos" c-key="t.id">{{ t.title }}</li>
</ul>
```

Serve the folder with any static server (`npx serve -s .`) and you have an SPA with routing, a persistent API, validation and loading states.

## Honest notes

- **Speed.** Comet uses fine-grained reactivity (no virtual DOM) and keyed list diffing. It does **not** make the browser faster than the browser: expect it to be in the same league as other reactive frameworks, not "20× faster than React". The real win is start-up and time-to-first-app. The homepage has a live benchmark against hand-written vanilla DOM code.
- **Size.** The whole thing — router, HTTP layer, ORM, mocks, i18n, devtools — is about 28 KB gzipped (`dist/size.json` has the exact numbers).
- **SEO.** v0.1 renders in the browser. If SEO is critical today, use Astro/Next/Nuxt or write key content statically. Prerendering (`comet build`) is on the roadmap.
- **CSP.** Expressions are compiled with `new Function` (like Alpine.js), so a strict CSP needs `'unsafe-eval'`.
- **`$db`** stores data in each user's own browser. Shared data needs a server — **Comet Server** (same syntax as the mock API) is planned for v0.3.

## Develop

```bash
npm install
npm run dev     # build + serve the website at http://localhost:5173
npm test        # build + Playwright browser tests
```

```
src/comet.js        the framework (single readable file)
dist/               comet.js, comet.min.js, size.json (built)
site/               the website & docs — built with Comet itself, no build step
tests/              browser tests (node:test + Playwright)
scripts/            build, dev server, helpers
```

The website deploys to GitHub Pages from `main` via `.github/workflows/pages.yml`.

## Roadmap

- **v0.1** — core (this release)
- **v0.2** — `comet` CLI, prerender/SSG for SEO, TypeScript types, VS Code extension
- **v0.3** — **Comet Server** for Node.js/Bun: file-based API routes, server ORM (SQLite/Postgres), auth, realtime
- **v1.0** — stable API, plugin registry, streaming SSR

---

**O'zbekcha:** Comet — build talab qilmaydigan web freymwork. Bitta `<script>` tegi orqali reaktivlik, SPA router, HTML ichida HTTP so'rovlar, komponentlar, lokal ORM, mock backend, i18n va devtools beradi. Hujjatlar o'zbek, rus va ingliz tillarida: [saytga o'tish](https://ozodmeofficial.github.io/cometframework/).

**Русский:** Comet — веб-фреймворк без сборки. Один тег `<script>` даёт реактивность, SPA-роутер, HTTP-запросы прямо в HTML, компоненты, локальную ORM, mock-бэкенд, i18n и devtools. Документация на узбекском, русском и английском: [перейти на сайт](https://ozodmeofficial.github.io/cometframework/).

MIT License © 2026 Comet contributors
