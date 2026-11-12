/* Comet website — app setup. Everything here is plain Comet API. */
(() => {
  const L = (uz, ru, en) => ({ uz, ru, en });

  /* ───────── i18n + config ───────── */
  Comet.i18n({ langs: ['uz', 'ru', 'en'], default: 'en', load: 'locales/{lang}.json' });
  Comet.config({ title: '%s — Comet' });

  /* ───────── Docs navigation ───────── */
  const DOCS = [
    { group: L('Boshlash', 'Начало', 'Getting started'), items: [
      { slug: 'docs', title: L('Kirish', 'Введение', 'Introduction'), k: 'intro why about' },
      { slug: 'docs/installation', title: L("O'rnatish", 'Установка', 'Installation'), k: 'cdn script install setup' },
      { slug: 'docs/quick-start', title: L('Tez start', 'Быстрый старт', 'Quick start'), k: 'tutorial first app' },
    ] },
    { group: L('Asoslar', 'Основы', 'Essentials'), items: [
      { slug: 'docs/templating', title: L('Shablonlar', 'Шаблоны', 'Templating'), k: 'interpolation c-text c-html c-if c-for c-show bind class style' },
      { slug: 'docs/state', title: L('Holat va reaktivlik', 'Состояние и реактивность', 'State & reactivity'), k: 'c-data store persist watch computed' },
      { slug: 'docs/events', title: L('Hodisalar', 'События', 'Events'), k: 'c-on @click modifiers emit hotkey' },
      { slug: 'docs/forms', title: L('Formalar', 'Формы', 'Forms'), k: 'c-model validation c-post errors' },
    ] },
    { group: L('Ilova qurish', 'Приложения', 'Building apps'), items: [
      { slug: 'docs/routing', title: L('Router va sahifalar', 'Роутер и страницы', 'Routing & pages'), k: 'spa router c-view layouts params prefetch' },
      { slug: 'docs/http', title: L("HTTP so'rovlar", 'HTTP-запросы', 'HTTP & data fetching'), k: 'c-get c-post fetch api loading cache' },
      { slug: 'docs/components', title: L('Komponentlar', 'Компоненты', 'Components'), k: 'component props slots template' },
      { slug: 'docs/database', title: L("Ma'lumotlar bazasi ($db)", 'База данных ($db)', 'Database ($db)'), k: 'orm indexeddb db live query model' },
      { slug: 'docs/mock-api', title: L('Mock backend', 'Mock-бэкенд', 'Mock backend'), k: 'mock api crud fake server' },
      { slug: 'docs/realtime', title: L('Real vaqt', 'Реальное время', 'Realtime'), k: 'c-live websocket sse broadcast' },
    ] },
    { group: L('Interfeys', 'Интерфейс', 'UI & UX'), items: [
      { slug: 'docs/i18n', title: L('Tarjima (i18n)', 'Переводы (i18n)', 'Internationalization'), k: 'i18n translate lang fmt' },
      { slug: 'docs/theming', title: L('Dark mode va CSS', 'Тёмная тема и CSS', 'Dark mode & CSS'), k: 'theme dark tailwind css bootstrap' },
      { slug: 'docs/animations', title: L('Animatsiyalar', 'Анимации', 'Animations'), k: 'transition reveal stagger view transitions' },
      { slug: 'docs/utilities', title: L('Yordamchilar', 'Утилиты', 'Utilities'), k: 'ref teleport copy intersect lazy include toast' },
    ] },
    { group: L("Ma'lumotnoma", 'Справочник', 'Reference'), items: [
      { slug: 'docs/directives', title: L('Barcha direktivalar', 'Все директивы', 'All directives'), k: 'cheatsheet reference attributes' },
      { slug: 'docs/api', title: L('JavaScript API', 'JavaScript API', 'JavaScript API'), k: 'api reference Comet' },
      { slug: 'docs/devtools', title: L('Devtools', 'Devtools', 'Devtools'), k: 'debug inspector' },
      { slug: 'docs/deploy', title: L('Deploy', 'Деплой', 'Deployment'), k: 'netlify vercel nginx github pages' },
      { slug: 'docs/comparison', title: L('Taqqoslash va tezlik', 'Сравнение и скорость', 'Comparison & performance'), k: 'react vue svelte benchmark' },
    ] },
  ];
  const flat = [];
  DOCS.forEach((g) => g.items.forEach((it) => flat.push({ ...it, group: g.group })));
  const extra = [
    { slug: 'examples', title: L('Misollar', 'Примеры', 'Examples'), group: L('Sayt', 'Сайт', 'Site'), k: 'examples demo todo chat crud' },
    { slug: 'roadmap', title: L('Roadmap', 'Roadmap', 'Roadmap'), group: L('Sayt', 'Сайт', 'Site'), k: 'roadmap server orm ssg' },
    { slug: '', title: L('Bosh sahifa', 'Главная', 'Home'), group: L('Sayt', 'Сайт', 'Site'), k: 'home landing' },
  ];

  Comet.store('docs', {
    groups: DOCS,
    toc: [],
    get index() { const p = Comet.router.route.path.replace(/^\//, ''); return flat.findIndex((x) => x.slug === p); },
    get prev() { return this.index > 0 ? flat[this.index - 1] : null; },
    get next() { return this.index > -1 && this.index < flat.length - 1 ? flat[this.index + 1] : null; },
  });
  Comet.store('ui', { palette: false });

  Comet.data('palette', () => ({
    q: '',
    i: 0,
    get results() {
      const lang = Comet.lang || 'en';
      const q = this.q.toLowerCase().trim();
      const all = [...flat, ...extra];
      const hit = (x) => [x.title[lang], x.title.en, x.group[lang], x.k, x.slug].join(' ').toLowerCase().includes(q);
      return (q ? all.filter(hit) : all).slice(0, 14);
    },
    move(d) { const n = this.results.length; if (n) this.i = (this.i + d + n) % n; },
    go(it) {
      it = it || this.results[this.i];
      if (!it) return;
      Comet.store('ui').palette = false;
      this.q = ''; this.i = 0;
      Comet.navigate(it.slug || './');
    },
  }));

  const updateToc = () => {
    const art = document.querySelector('.docs-main');
    const docs = Comet.store('docs');
    docs.toc = art ? [...art.querySelectorAll('h2[id]')].map((h) => ({ id: h.id, text: h.innerText.trim() })) : [];
  };
  document.addEventListener('comet:navigate', updateToc);
  document.addEventListener('comet:lang', () => setTimeout(updateToc));


  /* ───────── Landing: feature list ───────── */
  const F = (code, uz, ru, en) => ({ code, t: L(uz[0], ru[0], en[0]), d: L(uz[1], ru[1], en[1]) });
  Comet.store('site', { features: [
    F('<script>', ['Bitta script tegi', "npm, bundler va build yo'q. CDN'dan ulang va yozishni boshlang."], ['Один тег script', 'Без npm, бандлера и сборки. Подключите CDN и пишите.'], ['One script tag', 'No npm, no bundler, no build step. Add the CDN and start writing.']),
    F('{{ expr }}', ['Interpolatsiya', "Matnda ham, atributlarda ham ifodalar — avtomatik yangilanadi."], ['Интерполяция', 'Выражения в тексте и атрибутах — обновляются сами.'], ['Interpolation', 'Expressions in text and attributes, updated automatically.']),
    F('c-data', ['Lokal holat', "HTML ichida reaktiv obyekt. Getterlar computed bo'lib ishlaydi."], ['Локальное состояние', 'Реактивный объект прямо в HTML. Геттеры — это computed.'], ['Local state', 'A reactive object right in HTML. Getters work as computed values.']),
    F('c-for', ["Kalitli ro'yxatlar", "Faqat o'zgargan qatorlar yangilanadi, DOM qayta ishlatiladi."], ['Списки с ключами', 'Обновляются только изменённые строки, DOM переиспользуется.'], ['Keyed lists', 'Only changed rows update; DOM nodes are reused and moved.']),
    F('c-if / c-else', ['Shartli render', 'c-else-if zanjirlari va animatsiyali chiqish/kirish.'], ['Условный рендер', 'Цепочки c-else-if и анимации входа/выхода.'], ['Conditionals', 'c-else-if chains with enter/leave transitions.']),
    F('c-model', ["Ikki tomonlama bog'lash", 'input, checkbox, radio, select — .number .trim .debounce bilan.'], ['Двусторонняя привязка', 'input, checkbox, radio, select — с .number .trim .debounce.'], ['Two-way binding', 'Inputs, checkboxes, radios, selects — with .number .trim .debounce.']),
    F('@click.outside', ['Hodisa modifikatorlari', '.prevent .stop .once .outside .window .enter .esc .debounce…'], ['Модификаторы событий', '.prevent .stop .once .outside .window .enter .esc .debounce…'], ['Event modifiers', '.prevent .stop .once .outside .window .enter .esc .debounce…']),
    F('c-view', ['Fayl asosidagi router', "/about → pages/about.html. Avtomatik SPA, sahifa qayta yuklanmaydi."], ['Файловый роутер', '/about → pages/about.html. Автоматический SPA без перезагрузок.'], ['File-based router', '/about → pages/about.html. Automatic SPA, no full reloads.']),
    F('c-layout', ['Ichma-ich layoutlar', "Docs sidebar kabi qismlar sahifalar orasida saqlanib qoladi."], ['Вложенные лейауты', 'Сайдбар и прочее сохраняются между страницами.'], ['Nested layouts', 'Sidebars and shells persist while pages swap inside.']),
    F('prefetch', ['Hover prefetch', "Sichqoncha havolaga borganda sahifa oldindan yuklanadi."], ['Prefetch при наведении', 'Страница загружается, пока курсор над ссылкой.'], ['Hover prefetch', 'Pages load while the cursor is still on the link.']),
    F('View Transitions', ["Sahifa o'tish animatsiyasi", "Brauzerning View Transitions API'si — avtomatik."], ['Анимации переходов', 'View Transitions API браузера — автоматически.'], ['Page transitions', 'Native View Transitions between pages, out of the box.']),
    F('c-get', ["HTML ichida HTTP", "So'rov, loading, error va empty holatlari — bitta atributda."], ['HTTP прямо в HTML', 'Запрос, loading, error и empty — одним атрибутом.'], ['HTTP in HTML', 'Request, loading, error and empty states — one attribute.']),
    F('?q={{ q }}', ['Reaktiv URL', "Qiymat o'zgarsa qayta so'raladi. Eskirgan javoblar e'tiborsiz qoldiriladi."], ['Реактивные URL', 'Меняется значение — новый запрос. Устаревшие ответы игнорируются.'], ['Reactive URLs', 'Refetch when values change. Stale responses are ignored.']),
    F('c-post', ['Formalar', "Validatsiya, server xatolari (422) va c-reset — kodsiz."], ['Формы', 'Валидация, ошибки сервера (422) и c-reset — без кода.'], ['Forms', 'Validation, server errors (422) and c-reset — without JS.']),
    F('c-optimistic', ['Optimistik UI', "Natija darhol ko'rinadi, xato bo'lsa avtomatik orqaga qaytadi."], ['Оптимистичный UI', 'Результат сразу, при ошибке — автоматический откат.'], ['Optimistic UI', 'Show the result instantly; auto-rollback on failure.']),
    F('smart sync', ['Aqlli sinxronlash', "POST /api/todos dan keyin barcha c-get=\"/api/todos\" o'zi yangilanadi."], ['Умная синхронизация', 'После POST /api/todos все c-get="/api/todos" обновятся сами.'], ['Smart sync', 'After POST /api/todos every c-get="/api/todos" refreshes itself.']),
    F('c-target', ['HTML almashtirish', "Serverdan HTML keladimi? Kerakli joyga qo'yiladi (htmx uslubida)."], ['Замена HTML', 'Сервер вернул HTML? Он встанет куда нужно (как в htmx).'], ['HTML swaps', 'Server returns HTML? It is swapped where you point (htmx-style).']),
    F('c-poll', ['Polling va triggerlar', "every 5s, intersect, click, change — fon tablarda to'xtaydi."], ['Polling и триггеры', 'every 5s, intersect, click, change — пауза во фоновых вкладках.'], ['Polling & triggers', 'every 5s, intersect, click, change — pauses in background tabs.']),
    F('c-live', ['Real vaqt', 'WebSocket, SSE yoki tablar orasida BroadcastChannel.'], ['Реальное время', 'WebSocket, SSE или BroadcastChannel между вкладками.'], ['Realtime', 'WebSocket, SSE, or BroadcastChannel across tabs.']),
    F('$db', ["O'rnatilgan ORM", "IndexedDB ustida: where, orderBy, limit, modellar, validatsiya."], ['Встроенная ORM', 'Поверх IndexedDB: where, orderBy, limit, модели, валидация.'], ['Built-in ORM', 'On top of IndexedDB: where, orderBy, limit, models, validation.']),
    F('.live()', ["Jonli so'rovlar", "Ma'lumot o'zgarsa UI o'zi yangilanadi — hatto boshqa tabda ham."], ['Живые запросы', 'Данные изменились — UI обновился. Даже в другой вкладке.'], ['Live queries', 'Data changes, UI updates — even from another tab.']),
    F('Comet.mock', ['Mock backend', "Backend tayyor bo'lmasa ham API'ni brauzerda e'lon qiling."], ['Mock-бэкенд', 'Объявите API прямо в браузере, пока бэкенда нет.'], ['Mock backend', 'Declare your API in the browser before the backend exists.']),
    F('mock.crud()', ['Bir qatorda REST', "GET, POST, PUT, PATCH, DELETE — filtrlar, saralash, sahifalash bilan."], ['REST одной строкой', 'GET, POST, PUT, PATCH, DELETE — с фильтрами, сортировкой, пагинацией.'], ['REST in one line', 'GET, POST, PUT, PATCH, DELETE — with filters, sort and paging.']),
    F('<user-card>', ['HTML komponentlar', "Alohida .html fayl, props, slotlar, lazy yuklash."], ['HTML-компоненты', 'Отдельный .html файл, props, слоты, ленивая загрузка.'], ['HTML components', 'A separate .html file with props, slots and lazy loading.']),
    F('<style scoped>', ['Scoped CSS', 'Komponent uslublari faqat uning ichida ishlaydi.'], ['Scoped CSS', 'Стили компонента действуют только внутри него.'], ['Scoped CSS', 'Component styles stay inside the component.']),
    F('$store', ['Global store', "Bir nechta komponent bitta holatni ulashadi."], ['Глобальный store', 'Общее состояние для любых частей страницы.'], ['Global stores', 'Shared state for any part of the page.']),
    F('c-persist', ['Avto saqlash', "localStorage bilan sinxron, tablar orasida ham."], ['Автосохранение', 'Синхронизация с localStorage, в том числе между вкладками.'], ['Persistence', 'Synced to localStorage — and across tabs.']),
    F('$t · c-lang', ['i18n', "Tarjimalar, ko'plik shakllari, til avtoaniqlanishi."], ['i18n', 'Переводы, плюрализация, автоопределение языка.'], ['i18n', 'Translations, plurals, automatic language detection.']),
    F('$fmt', ['Formatlash', "Son, valyuta, sana, \"3 daqiqa oldin\" — joriy tilda."], ['Форматирование', 'Числа, валюты, даты, «3 минуты назад» — на текущем языке.'], ['Formatting', 'Numbers, currency, dates, "3 minutes ago" — in the current language.']),
    F('$theme', ['Avto dark mode', "Tizim sozlamasiga ergashadi, Tailwind dark: bilan mos."], ['Авто тёмная тема', 'Следует системе, совместима с dark: в Tailwind.'], ['Auto dark mode', 'Follows the OS and works with Tailwind dark: classes.']),
    F('c-transition', ['Animatsiyalar', 'fade, slide, scale, blur yoki o‘zingizning CSS klasslaringiz.'], ['Анимации', 'fade, slide, scale, blur или ваши CSS-классы.'], ['Transitions', 'fade, slide, scale, blur — or your own CSS classes.']),
    F('c-reveal', ['Scroll animatsiyalari', "Element ko'rinishga kirganda chiroyli paydo bo'ladi. c-stagger bilan ketma-ket."], ['Анимации при скролле', 'Плавное появление при прокрутке. c-stagger — по очереди.'], ['Scroll reveal', 'Elements animate in as they scroll into view. c-stagger for sequences.']),
    F('c-hotkey', ['Klaviatura', 'c-hotkey="mod+k" — Mac va Windows uchun.'], ['Горячие клавиши', 'c-hotkey="mod+k" — для Mac и Windows.'], ['Hotkeys', 'c-hotkey="mod+k" — works on Mac and Windows.']),
    F('c-copy', ['Nusxalash', 'Bir atribut bilan clipboardga nusxa.'], ['Копирование', 'Копирование в буфер одним атрибутом.'], ['Copy', 'Copy to clipboard with one attribute.']),
    F('c-teleport', ['Teleport', "Modal va tooltiplarni body'ga ko'chiring."], ['Телепорт', 'Перенос модалок и подсказок в body.'], ['Teleport', 'Move modals and tooltips to body.']),
    F('c-lazy', ['Lazy render', "Og'ir bloklar faqat ko'ringanda ishga tushadi."], ['Ленивый рендер', 'Тяжёлые блоки запускаются, только когда видны.'], ['Lazy rendering', 'Heavy sections initialize only when visible.']),
    F('$toast', ['Bildirishnomalar', "$toast('Saqlandi!') — tayyor."], ['Уведомления', "$toast('Сохранено!') — готово."], ['Toasts', "$toast('Saved!') — done."]),
    F('Devtools', ['Devtools', 'Alt+Shift+D: holat, so‘rovlar, router, unumdorlik.'], ['Devtools', 'Alt+Shift+D: состояние, запросы, роутер, производительность.'], ['Devtools', 'Alt+Shift+D: state, network, router and performance.']),
    F('vanilla JS', ['Oddiy JS bilan', "innerHTML orqali qo'shilgan c-* elementlar ham avtomatik ishlaydi."], ['Дружит с vanilla JS', 'Элементы с c-*, вставленные через innerHTML, оживают сами.'], ['Vanilla-friendly', 'c-* markup inserted by any script comes alive automatically.']),
    F('Tailwind', ['Har qanday CSS', "Light DOM: Tailwind, Bootstrap, oddiy CSS — o'zgarishsiz."], ['Любой CSS', 'Light DOM: Tailwind, Bootstrap, обычный CSS — как есть.'], ['Any CSS', 'Light DOM: Tailwind, Bootstrap, plain CSS — untouched.']),
  ] });

  /* ───────── Syntax highlighter (tiny, no deps) ───────── */
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const span = (c, t) => `<span class="tk-${c}">${esc(t)}</span>`;
  const JS_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|\b(const|let|var|function|return|if|else|for|of|in|new|await|async|export|default|import|from|class|extends|this|true|false|null|undefined|typeof|try|catch|throw|while)\b|\b(\d+(?:\.\d+)?)\b|(\$?[A-Za-z_][\w$]*)(?=\s*\()|(\$[A-Za-z_]\w*)/g;
  function hlJS(src) {
    let out = '', last = 0, m;
    JS_RE.lastIndex = 0;
    while ((m = JS_RE.exec(src))) {
      out += esc(src.slice(last, m.index));
      out += span(m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'kw' : m[4] ? 'num' : m[5] ? 'fn' : 'dir', m[0]);
      last = JS_RE.lastIndex;
    }
    return out + esc(src.slice(last));
  }
  function hlTag(tag) {
    const m = tag.match(/^(<\/?)([\w:-]+)([\s\S]*?)(\/?>)$/);
    if (!m) return esc(tag);
    let out = span('pun', m[1]) + span('tag', m[2]);
    out += m[3].replace(/([^\s=]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s>]+)?|(\s+)/g, (all, name, eq, val, ws) => {
      if (ws) return ws;
      if (!name) return esc(all);
      const dir = /^(c-|@|:)/.test(name);
      let r = span(dir ? 'dir' : 'attr', name);
      if (eq) r += span('pun', eq.trim());
      if (val) r += dir && val.length > 2 ? span('pun', val[0]) + hlJS(val.slice(1, -1)) + span('pun', val[0]) : span('str', val);
      return r;
    });
    return out + span('pun', m[4]);
  }
  const HTML_RE = /<!--[\s\S]*?-->|<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>|<\/?[a-zA-Z][\w:-]*(?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|\{\{[\s\S]*?\}\}/g;
  function hlHTML(src) {
    let out = '', last = 0, m;
    HTML_RE.lastIndex = 0;
    while ((m = HTML_RE.exec(src))) {
      out += esc(src.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('<!--')) out += span('com', t);
      else if (t.startsWith('{{')) out += span('int', t);
      else if (m[1]) {
        const open = t.slice(0, t.indexOf('>') + 1);
        const inner = m[3];
        const close = `</${m[1]}>`;
        const plain = /type=["']?(text\/plain|comet\/routes|application\/json)/.test(m[2]);
        out += hlTag(open) + (m[1] === 'script' && !plain ? hlJS(inner) : esc(inner)) + hlTag(close);
      } else out += hlTag(t);
      last = HTML_RE.lastIndex;
    }
    return out + esc(src.slice(last));
  }
  function hlBash(src) { return src.split('\n').map((l) => (l.trim().startsWith('#') ? span('com', l) : esc(l).replace(/^(\s*)(\w[\w-]*)/, (_, s, c) => s + `<span class="tk-fn">${c}</span>`))).join('\n'); }
  function dedent(s) {
    s = s.replace(/^\n+|\s+$/g, '');
    const ind = Math.min(...s.split('\n').filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
    return s.split('\n').map((l) => l.slice(ind)).join('\n');
  }
  const highlight = (src, lang) => (lang === 'js' || lang === 'json' ? hlJS(src) : lang === 'bash' ? hlBash(src) : lang === 'css' || lang === 'text' ? esc(src) : hlHTML(src));
  const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

  // <div c-code="html" data-file="index.html"><script type="text/plain"> … </script></div>
  Comet.directive('code', ({ el, value, skip, cleanup }) => {
    const src = el.querySelector('script[type="text/plain"]');
    if (!src) return;
    const code = dedent(src.textContent).replace(/<\\\/script>/g, '</script>');
    const lang = value || 'html';
    const file = el.getAttribute('data-file') || lang;
    el.classList.add('code');
    el.setAttribute('c-pre', '');
    el.innerHTML = `<div class="code-head"><span class="file">${esc(file)}</span><button class="copy-btn" type="button" aria-label="Copy code">${ICON_COPY}<span class="no">copy</span><span class="ok">copied ✓</span></button></div><pre><code>${highlight(code, lang)}</code></pre>`;
    const btn = el.querySelector('.copy-btn');
    let t;
    const onClick = () => {
      navigator.clipboard && navigator.clipboard.writeText(code);
      btn.classList.add('c-copied');
      clearTimeout(t); t = setTimeout(() => btn.classList.remove('c-copied'), 1500);
    };
    btn.addEventListener('click', onClick);
    cleanup(() => btn.removeEventListener('click', onClick));
    skip();
  });

  // Pointer-following glow for cards: <div class="card" c-spotlight>
  Comet.directive('spotlight', ({ el, cleanup }) => {
    const move = (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', e.clientX - r.left + 'px');
      el.style.setProperty('--my', e.clientY - r.top + 'px');
    };
    el.addEventListener('pointermove', move, { passive: true });
    cleanup(() => el.removeEventListener('pointermove', move));
  });

  /* ───────── Demo backend (runs 100% in the browser) ───────── */
  Comet.mock.delay([140, 420]);
  Comet.db.model('demo_todos', {
    defaults: { done: false },
    timestamps: true,
    validate: { title: (v) => (v && String(v).trim().length > 1) || 'Min 2 characters' },
  });
  Comet.mock.crud('/api/todos', 'demo_todos');

  Comet.db.model('demo_users', {
    defaults: { role: 'viewer' },
    timestamps: true,
    validate: {
      name: (v) => (v && v.trim().length >= 2) || 'Name is required',
      email: (v) => /^\S+@\S+\.\S+$/.test(v || '') || 'Valid email required',
    },
  });
  Comet.mock.crud('/api/users', 'demo_users');
  Comet.db.seed('demo_users', [
    { name: 'Aziza Karimova', email: 'aziza@example.com', role: 'admin' },
    { name: 'Timur Rashidov', email: 'timur@example.com', role: 'editor' },
    { name: 'Elena Petrova', email: 'elena@example.com', role: 'viewer' },
    { name: 'Jasur Aliyev', email: 'jasur@example.com', role: 'editor' },
  ]);

  const CITIES = [
    ['Tashkent', 'Toshkent'], ['Samarkand', 'Samarqand'], ['Bukhara', 'Buxoro'], ['Khiva', 'Xorazm'], ['Namangan', 'Namangan'],
    ['Andijan', 'Andijon'], ['Fergana', "Farg'ona"], ['Kokand', "Farg'ona"], ['Margilan', "Farg'ona"], ['Nukus', "Qoraqalpog'iston"],
    ['Qarshi', 'Qashqadaryo'], ['Shahrisabz', 'Qashqadaryo'], ['Termez', 'Surxondaryo'], ['Jizzakh', 'Jizzax'], ['Navoi', 'Navoiy'],
    ['Urgench', 'Xorazm'], ['Gulistan', 'Sirdaryo'], ['Chirchiq', 'Toshkent'], ['Angren', 'Toshkent'], ['Denov', 'Surxondaryo'],
  ].map(([name, region], i) => ({ id: i + 1, name, region }));
  Comet.mock({
    'GET /api/cities': ({ query }) => {
      const q = (query.q || '').toLowerCase();
      return CITIES.filter((c) => !q || c.name.toLowerCase().includes(q) || c.region.toLowerCase().includes(q)).slice(0, 6);
    },
    'GET /api/time': () => ({ now: new Date().toISOString() }),
    'GET /api/fragment': () => `<div class="callout"><b>⚡</b><p>This HTML came from <code>/api/fragment</code> and was swapped in by <code>c-get</code>. Server time: {{ $fmt.time(Date.now(), { timeStyle: 'medium' }) }}</p></div>`,
    'POST /api/newsletter': ({ body }) => {
      if (!/^\S+@\S+\.\S+$/.test(body.email || '')) Comet.mock.error(422, { message: 'Invalid email', errors: { email: 'Please enter a valid email' } });
      return { ok: true };
    },
  });

  /* ───────── Live benchmark: Comet vs. hand-written vanilla DOM ───────── */
  const A = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
  const C = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'white', 'black', 'orange'];
  const N = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];
  let seq = 1;
  const rnd = (a) => a[(Math.random() * a.length) | 0];
  const build = (n) => Array.from({ length: n }, () => ({ id: seq++, label: `${rnd(A)} ${rnd(C)} ${rnd(N)}` }));
  const raf = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r)));

  Comet.data('bench', () => ({
    rows: [],
    running: false,
    results: [],
    async measure(name, fnComet, fnVanilla) {
      const box = document.getElementById('bench-vanilla');
      // warm-up + measure 3 runs each, take the median
      const med = (a) => a.sort((x, y) => x - y)[1];
      const tc = [], tv = [];
      for (let i = 0; i < 3; i++) {
        this.rows = []; box.textContent = ''; await this.$nextTick(); await raf();
        let t0 = performance.now(); fnComet(); await this.$nextTick(); void document.body.offsetHeight; tc.push(performance.now() - t0);
        await raf();
        t0 = performance.now(); fnVanilla(box); void document.body.offsetHeight; tv.push(performance.now() - t0);
        await raf();
      }
      return { name, comet: med(tc), vanilla: med(tv) };
    },
    async run() {
      if (this.running) return;
      this.running = true;
      this.results = [];
      const vanillaCreate = (box, data) => {
        const frag = document.createDocumentFragment();
        for (const r of data) {
          const tr = document.createElement('tr');
          const a = document.createElement('td'); a.textContent = r.id;
          const b = document.createElement('td'); b.textContent = r.label;
          tr.append(a, b); frag.appendChild(tr);
        }
        box.appendChild(frag);
      };
      const r1 = await this.measure('1,000 rows', () => { this.rows = build(1000); }, (box) => vanillaCreate(box, build(1000)));
      this.results.push(r1);
      const r2 = await this.measure('10,000 rows', () => { this.rows = build(10000); }, (box) => vanillaCreate(box, build(10000)));
      this.results.push(r2);
      // partial update: every 10th row of 1,000
      const box = document.getElementById('bench-vanilla');
      const tc = [], tv = [];
      for (let i = 0; i < 3; i++) {
        this.rows = build(1000); box.textContent = ''; vanillaCreate(box, build(1000));
        await this.$nextTick(); await raf();
        let t0 = performance.now();
        for (let j = 0; j < this.rows.length; j += 10) this.rows[j].label += ' !!!';
        await this.$nextTick(); void document.body.offsetHeight; tc.push(performance.now() - t0);
        t0 = performance.now();
        const trs = box.children;
        for (let j = 0; j < trs.length; j += 10) trs[j].lastChild.textContent += ' !!!';
        void document.body.offsetHeight; tv.push(performance.now() - t0);
        await raf();
      }
      const med = (a) => a.sort((x, y) => x - y)[1];
      this.results.push({ name: 'update every 10th', comet: med(tc), vanilla: med(tv) });
      this.rows = []; box.textContent = '';
      this.running = false;
    },
    width(r, key) { const max = Math.max(r.comet, r.vanilla) || 1; return Math.max(4, (r[key] / max) * 100) + '%'; },
  }));
})();
