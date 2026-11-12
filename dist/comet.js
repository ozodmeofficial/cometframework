/*!
 * Comet Framework v0.1.0
 * The build-free web framework. One <script> tag — reactivity, SPA router,
 * HTTP-in-HTML, components, local database, mock API, i18n and more.
 * (c) 2026 Comet contributors · MIT License
 * https://github.com/ozodmeofficial/cometframework
 */
(function (global) {
  'use strict';

  const VERSION = '0.1.0';
  const doc = global.document;
  const html = doc.documentElement;
  const script = doc.currentScript;
  const ObjProto = Object.prototype;
  const toStr = ObjProto.toString;

  /* ──────────────────────────────────────────────────────────────────────
   * Utilities
   * ──────────────────────────────────────────────────────────────────── */
  const isObj = (v) => v !== null && typeof v === 'object';
  const isFn = (v) => typeof v === 'function';
  const hasOwn = (o, k) => ObjProto.hasOwnProperty.call(o, k);
  const camelize = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const display = (v) => (v == null ? '' : isObj(v) ? safeJSON(v) : String(v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reducedMotion = () => global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function safeJSON(v, space) {
    const seen = new WeakSet();
    try {
      return JSON.stringify(v, (k, val) => {
        if (isObj(val)) {
          if (val instanceof Node) return `<${val.nodeName.toLowerCase()}>`;
          if (seen.has(val)) return '[circular]';
          seen.add(val);
        }
        return isFn(val) ? undefined : val;
      }, space);
    } catch (e) { return String(v); }
  }

  function parseTime(s, def = 0) {
    if (s == null || s === '') return def;
    if (typeof s === 'number') return s;
    const m = String(s).trim().match(/^([\d.]+)\s*(ms|s|m)?$/);
    if (!m) return def;
    const n = parseFloat(m[1]);
    return m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60000 : n;
  }

  function debounce(fn, ms) {
    let t;
    const d = function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    d.cancel = () => clearTimeout(t);
    return d;
  }

  function throttle(fn, ms) {
    let last = 0;
    return function (...a) { const n = Date.now(); if (n - last >= ms) { last = n; fn.apply(this, a); } };
  }

  function getPath(obj, path) {
    if (!path) return obj;
    let cur = obj;
    for (const p of String(path).split('.')) { if (cur == null) return undefined; cur = cur[p]; }
    return cur;
  }

  const warned = new Set();
  function warn(msg, el, err) {
    const key = msg + (err && err.message);
    devlog('errors', { msg, err: err ? String(err.message || err) : '', time: Date.now() });
    if (warned.has(key)) return;
    warned.add(key);
    console.warn('[Comet] ' + msg, ...(el ? [el] : []), ...(err ? [err] : []));
  }

  function emit(target, name, detail) {
    target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  const storage = {
    get(key, session) {
      try { const v = (session ? sessionStorage : localStorage).getItem(key); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; }
    },
    set(key, val, session) {
      try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(val)); } catch (e) { /* storage unavailable */ }
    },
  };

  /* ──────────────────────────────────────────────────────────────────────
   * Devtools log (ring buffers, cheap)
   * ──────────────────────────────────────────────────────────────────── */
  const devdata = { net: [], nav: [], errors: [], scopes: [] };
  const devState = { open: false, dirty: true };
  function devlog(kind, entry) {
    const arr = devdata[kind];
    if (!arr) return;
    arr.push(entry);
    if (arr.length > 150) arr.shift();
    if (devState.open) devState.dirty = true;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Reactivity — fine-grained, proxy based, batched in microtasks
   * ──────────────────────────────────────────────────────────────────── */
  const RAW = Symbol('raw');
  const ITER = Symbol('iterate');
  const SKIP = Symbol('skip');
  const targetMap = new WeakMap();
  const proxyMap = new WeakMap();
  const stats = { effects: 0, runs: 0, mountMs: 0, startMs: 0 };
  let activeEffect = null;
  let shouldTrack = true;

  function reactive(t) {
    if (!isObj(t) || t[RAW]) return t;
    const tag = toStr.call(t);
    if ((tag !== '[object Object]' && tag !== '[object Array]') || t[SKIP] || Object.isFrozen(t)) return t;
    let p = proxyMap.get(t);
    if (!p) { p = new Proxy(t, handlers); proxyMap.set(t, p); }
    return p;
  }
  const toRaw = (v) => (v && v[RAW]) || v;
  const markRaw = (v) => { if (isObj(v)) Object.defineProperty(v, SKIP, { value: true }); return v; };

  function findOwner(t, k) {
    let o = t;
    while (o && o !== ObjProto) { if (hasOwn(o, k)) return o; o = Object.getPrototypeOf(o); }
    return t;
  }

  const arrayInstr = {};
  ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'].forEach((m) => {
    arrayInstr[m] = function (...args) {
      const prev = shouldTrack; shouldTrack = false;
      try { return Array.prototype[m].apply(this, args); } finally { shouldTrack = prev; }
    };
  });
  ['includes', 'indexOf', 'lastIndexOf'].forEach((m) => {
    arrayInstr[m] = function (...args) {
      const raw = toRaw(this);
      track(raw, ITER);
      const r = Array.prototype[m].apply(raw, args);
      return r === -1 || r === false ? Array.prototype[m].apply(raw, args.map(toRaw)) : r;
    };
  });

  const handlers = {
    get(t, k, r) {
      if (k === RAW) return t;
      const isArr = Array.isArray(t);
      if (isArr && hasOwn(arrayInstr, k)) return arrayInstr[k];
      const v = Reflect.get(t, k, r);
      if (typeof k === 'symbol') return v;
      if (isArr) track(t, k === 'length' ? ITER : k);
      else track(findOwner(t, k), k);
      return isObj(v) ? reactive(v) : v;
    },
    set(t, k, v, r) {
      if (typeof k === 'symbol') return Reflect.set(t, k, v, r);
      const isArr = Array.isArray(t);
      if (!isArr && !hasOwn(t, k)) {
        const owner = findOwner(t, k);
        if (owner !== t) { reactive(owner)[k] = v; return true; }
      }
      const had = isArr ? (k === 'length' || Number(k) < t.length) : hasOwn(t, k);
      const old = t[k];
      const raw = toRaw(v);
      const ok = Reflect.set(t, k, raw, r);
      if (toRaw(r) !== t) return ok;
      if (!had) { trigger(t, k); trigger(t, ITER); }
      else if (old !== raw && !(old !== old && raw !== raw)) {
        trigger(t, k);
        if (isArr && k === 'length') trigger(t, ITER);
      }
      return ok;
    },
    deleteProperty(t, k) {
      const had = hasOwn(t, k);
      const ok = Reflect.deleteProperty(t, k);
      if (had && ok) { trigger(t, k); trigger(t, ITER); }
      return ok;
    },
    ownKeys(t) { track(t, ITER); return Reflect.ownKeys(t); },
  };

  function track(t, k) {
    if (!activeEffect || !shouldTrack) return;
    let m = targetMap.get(t);
    if (!m) targetMap.set(t, (m = new Map()));
    let d = m.get(k);
    if (!d) m.set(k, (d = new Set()));
    if (!d.has(activeEffect)) { d.add(activeEffect); activeEffect.deps.push(d); }
  }

  function trigger(t, k) {
    const m = targetMap.get(t);
    const d = m && m.get(k);
    if (!d) return;
    for (const e of [...d]) {
      if (e === activeEffect) continue;
      if (e.scheduler) e.scheduler(e); else queueJob(e);
    }
  }

  const queue = new Set();
  const ticks = [];
  let pending = false;
  function queueJob(job) {
    queue.add(job);
    if (!pending) { pending = true; queueMicrotask(flush); }
  }
  function flush() {
    pending = false;
    let guard = 0;
    while (queue.size) {
      const jobs = [...queue].sort((a, b) => a.id - b.id);
      queue.clear();
      for (const j of jobs) if (j.active) j();
      if (++guard > 200) { warn('Possible infinite update loop detected'); queue.clear(); break; }
    }
    if (ticks.length) ticks.splice(0).forEach((f) => f());
  }
  function nextTick(fn) {
    return new Promise((res) => {
      ticks.push(() => { if (fn) fn(); res(); });
      if (!pending) { pending = true; queueMicrotask(flush); }
    });
  }

  let effectId = 0;
  function effect(fn, opts = {}) {
    const e = () => {
      if (!e.active) return;
      cleanupDeps(e);
      const prev = activeEffect, prevT = shouldTrack;
      activeEffect = e; shouldTrack = true;
      stats.runs++;
      try { return fn(); } catch (err) { warn('Effect error', null, err); } finally { activeEffect = prev; shouldTrack = prevT; }
    };
    e.id = ++effectId;
    e.deps = [];
    e.active = true;
    e.scheduler = opts.scheduler;
    e.stop = () => { if (e.active) { cleanupDeps(e); e.active = false; stats.effects--; } };
    stats.effects++;
    onCleanup(e.stop);
    if (!opts.lazy) e();
    return e;
  }
  function cleanupDeps(e) { for (const d of e.deps) d.delete(e); e.deps.length = 0; }

  function untrack(fn) {
    const prev = activeEffect; activeEffect = null;
    try { return fn(); } finally { activeEffect = prev; }
  }

  function traverse(v, seen = new Set()) {
    if (!isObj(v) || seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) traverse(v[i], seen); }
    else for (const k of Object.keys(v)) traverse(v[k], seen);
    return v;
  }

  function watch(getter, cb, opts = {}) {
    let first = true, old;
    return effect(() => {
      const v = getter();
      if (opts.deep !== false) traverse(v);
      if (first) {
        first = false; old = v;
        if (opts.immediate) untrack(() => cb(v, undefined));
        return;
      }
      const o = old; old = v;
      untrack(() => cb(v, o));
    });
  }

  function computed(getter) {
    const state = reactive({ value: undefined });
    effect(() => { state.value = getter(); });
    return state;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Lifecycle contexts — every mounted block owns its cleanups
   * ──────────────────────────────────────────────────────────────────── */
  let currentCtx = null;
  class Ctx {
    constructor(parent) {
      this.c = []; this.kids = new Set(); this.parent = parent; this.dead = false;
      if (parent) parent.kids.add(this);
    }
    destroy() {
      if (this.dead) return;
      this.dead = true;
      for (const k of [...this.kids]) k.destroy();
      this.kids.clear();
      for (const f of this.c) { try { f(); } catch (e) { warn('Cleanup error', null, e); } }
      this.c.length = 0;
      if (this.parent) this.parent.kids.delete(this);
    }
  }
  function onCleanup(fn) { if (currentCtx) currentCtx.c.push(fn); }
  function withCtx(ctx, fn) {
    const prev = currentCtx; currentCtx = ctx;
    try { return fn(); } finally { currentCtx = prev; }
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Expressions
   * ──────────────────────────────────────────────────────────────────── */
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const PARAMS = ['$s', '$el', '$event', '$emit', '$dispatch'];
  const fnCache = new Map();
  const noop = () => {};

  function compile(exp) {
    let f = fnCache.get(exp);
    if (f) return f;
    try { f = new Function(...PARAMS, `with($s){return (${exp}\n)}`); }
    catch (e) { warn(`Invalid expression: ${exp}`, null, e); f = noop; }
    fnCache.set(exp, f);
    return f;
  }

  function compileHandler(exp) {
    const key = '\0h' + exp;
    let f = fnCache.get(key);
    if (f) return f;
    const Ctor = /\bawait\b/.test(exp) ? AsyncFunction : Function;
    try {
      f = new Ctor(...PARAMS, `with($s){const __r=(${exp}\n);return typeof __r==='function'?__r.call($s,$event):__r}`);
    } catch (e) {
      try { f = new Ctor(...PARAMS, `with($s){${exp}\n}`); }
      catch (e2) { warn(`Invalid handler: ${exp}`, null, e2); f = noop; }
    }
    fnCache.set(key, f);
    return f;
  }

  function compileSetter(exp) {
    const key = '\0s' + exp;
    let f = fnCache.get(key);
    if (!f) {
      try { f = new Function('$s', '$v', `with($s){(${exp})=$v}`); }
      catch (e) { warn(`c-model needs an assignable expression: ${exp}`); f = noop; }
      fnCache.set(key, f);
    }
    return f;
  }

  function emitter(el) {
    return el.__c_emit || (el.__c_emit = (name, detail) => emit(el, name, detail));
  }

  function evaluate(scope, exp, el, event) {
    try { return compile(exp)(scope, el, event, emitter(el || html), emitter(el || html)); }
    catch (e) { warn(`Error in expression "${exp}"`, el, e); }
  }

  function run(scope, exp, el, event) {
    try {
      const r = compileHandler(exp)(scope, el, event, emitter(el || html), emitter(el || html));
      if (r && isFn(r.then)) r.catch((e) => warn(`Error in handler "${exp}"`, el, e));
      return r;
    } catch (e) { warn(`Error in handler "${exp}"`, el, e); }
  }

  const TPL_RE = /\{\{([\s\S]+?)\}\}/g;
  function parseTpl(str) {
    const parts = [];
    let last = 0, m;
    TPL_RE.lastIndex = 0;
    while ((m = TPL_RE.exec(str))) {
      if (m.index > last) parts.push(str.slice(last, m.index));
      parts.push({ e: m[1].trim() });
      last = m.index + m[0].length;
    }
    if (last < str.length) parts.push(str.slice(last));
    return parts;
  }
  function renderTpl(parts, scope, el, enc) {
    let out = '';
    for (const p of parts) {
      if (typeof p === 'string') out += p;
      else { const v = display(evaluate(scope, p.e, el)); out += enc ? encodeURIComponent(v) : v; }
    }
    return out;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Scopes
   * ──────────────────────────────────────────────────────────────────── */
  const ROOT = Object.create(null);
  const rootScope = reactive(ROOT);
  defineHidden(ROOT, '$refs', {});

  function defineHidden(obj, key, value) {
    Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: false });
  }

  function createScope(parent, data) {
    const raw = Object.create(toRaw(parent || rootScope));
    if (data) {
      if (data[RAW]) {
        // Existing reactive object (e.g. a store) — forward properties so they stay linked.
        const src = data;
        for (const k of Object.keys(toRaw(src))) {
          Object.defineProperty(raw, k, { get: () => src[k], set: (v) => { src[k] = v; }, enumerable: true, configurable: true });
        }
      } else {
        Object.defineProperties(raw, Object.getOwnPropertyDescriptors(data));
      }
    }
    return reactive(raw);
  }

  function findScope(el) {
    while (el) { if (el.__c_scope) return el.__c_scope; el = el.parentElement; }
    return rootScope;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Walker
   * ──────────────────────────────────────────────────────────────────── */
  const processed = new WeakSet();
  const directives = Object.create(null);
  const SKIP_DIRS = new Set(['data', 'for', 'if', 'else', 'else-if', 'key', 'as', 'trigger', 'then', 'catch', 'target', 'swap', 'confirm',
    'optimistic', 'debounce', 'poll', 'cache', 'headers', 'body', 'reset', 'redirect', 'select', 'persist', 'init', 'ignore', 'pre', 'view',
    'component', 'props', 'sync', 'validate', 'message', 'layout', 'outlet', 'live', 'get', 'post', 'put', 'patch', 'delete', 'lazy', 'app', 'max']);
  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

  function walk(node, scope) {
    const type = node.nodeType;
    if (type === 3) {
      if (!processed.has(node) && node.data.indexOf('{{') > -1) interpolateText(node, scope);
      return node.nextSibling;
    }
    if (type !== 1) return node.nextSibling;
    const el = node;
    const next = el.nextSibling;
    if (processed.has(el)) return next;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return next;
    if (el.hasAttribute('c-ignore')) return next;
    if (el.hasAttribute('c-pre')) { markTree(el); return next; }
    if (el.hasAttribute('c-lazy') && tag !== 'IMG' && tag !== 'IFRAME') return deferLazy(el, scope, next);
    processed.add(el);

    let a;
    if ((a = el.getAttribute('c-for')) != null) return dirFor(el, a, scope, next);
    if ((a = el.getAttribute('c-if')) != null) return dirIf(el, a, scope, next);
    if (tag === 'TEMPLATE') {
      if ((a = el.getAttribute('c-component')) != null) registerInline(a, el);
      return next;
    }
    if (tag === 'C-INCLUDE') return includeTag(el, scope, next);
    const name = tag.toLowerCase();
    if (name.indexOf('-') > 0 && (components.has(name) || (config.components && !customElements.get(name) && autoComponent(name)))) {
      return mountComponent(el, scope, next);
    }

    let init = null;
    if ((a = el.getAttribute('c-data')) != null) { const r = dirData(el, a, scope); scope = r.scope; init = r.init; }
    for (const m of HTTP_METHODS) {
      if (el.hasAttribute('c-' + m)) { scope = dirHttp(el, m, scope); break; }
    }
    if (el.hasAttribute('c-live')) scope = dirLive(el, scope);

    processAttrs(el, scope);

    if (!el.hasAttribute('c-view') && !el.__c_skipChildren) {
      let c = el.firstChild;
      while (c) c = walk(c, scope);
    }
    if ((a = el.getAttribute('c-init')) != null) run(scope, a, el);
    if (init) init();
    return next;
  }

  function markTree(el) {
    processed.add(el);
    const w = doc.createTreeWalker(el, 5);
    while (w.nextNode()) processed.add(w.currentNode);
  }

  function parseName(name) {
    if (name[0] === '@' || name[0] === ':') {
      const p = name.slice(1).split('.');
      return { dir: name[0] === '@' ? 'on' : 'bind', arg: p[0], mods: p.slice(1) };
    }
    const body = name.slice(2);
    const ci = body.indexOf(':');
    const head = (ci < 0 ? body : body.slice(0, ci)).split('.');
    if (ci < 0) return { dir: head[0], arg: '', mods: head.slice(1) };
    const ap = body.slice(ci + 1).split('.');
    return { dir: head[0], arg: ap[0], mods: head.slice(1).concat(ap.slice(1)) };
  }

  function modNum(mods, name, def) {
    const i = mods.indexOf(name);
    if (i < 0) return null;
    const n = mods[i + 1];
    return n && /^\d/.test(n) ? parseTime(n) : def;
  }

  function processAttrs(el, scope) {
    const attrs = el.attributes;
    const list = [];
    for (let i = 0; i < attrs.length; i++) list.push(attrs[i]);
    for (const attr of list) {
      const name = attr.name, value = attr.value;
      const c0 = name[0];
      if (c0 === '@' || c0 === ':' || (c0 === 'c' && name[1] === '-')) {
        const p = parseName(name);
        if (SKIP_DIRS.has(p.dir)) continue;
        const fn = directives[p.dir];
        if (fn) {
          try { fn({ el, value, arg: p.arg, mods: p.mods, scope, name, evaluate: () => evaluate(scope, value, el), effect, cleanup: onCleanup }); }
          catch (e) { warn(`Directive ${name} failed`, el, e); }
        }
      } else if (value.indexOf('{{') > -1) {
        const parts = parseTpl(value);
        effect(() => setAttr(el, name, renderTpl(parts, scope, el)));
      }
    }
  }

  function interpolateText(node, scope) {
    processed.add(node);
    const parts = parseTpl(node.data);
    const el = node.parentNode;
    effect(() => {
      const v = renderTpl(parts, scope, el);
      if (node.data !== v) node.data = v;
    });
  }

  function mount(el, scope) {
    const ctx = new Ctx(rootCtx);
    withCtx(ctx, () => walk(el, scope || findScope(el.parentElement)));
    return ctx;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Blocks (used by c-if / c-for)
   * ──────────────────────────────────────────────────────────────────── */
  function createBlock(tplEl, scope, parentCtx) {
    const ctx = new Ctx(parentCtx);
    const frag = doc.createDocumentFragment();
    const isTpl = tplEl.tagName === 'TEMPLATE';
    if (isTpl) frag.appendChild(tplEl.content.cloneNode(true));
    else frag.appendChild(tplEl.cloneNode(true));
    const multi = isTpl || tplEl.hasAttribute('c-if') || tplEl.hasAttribute('c-for');
    let start, end;
    if (multi) {
      start = doc.createComment(''); end = doc.createComment('');
      frag.insertBefore(start, frag.firstChild); frag.appendChild(end);
    } else { start = end = frag.firstChild; }
    withCtx(ctx, () => {
      let c = frag.firstChild;
      while (c) c = walk(c, scope);
    });
    for (let n = frag.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && !n.__c_scope) n.__c_scope = scope;
    return { ctx, scope, start, end, frag };
  }
  function blockNodes(b) {
    const out = [];
    let n = b.start;
    while (n) { out.push(n); if (n === b.end) break; n = n.nextSibling; }
    return out;
  }
  function insertBlock(b, ref) {
    const parent = ref.parentNode;
    if (b.frag && b.frag.firstChild) { parent.insertBefore(b.frag, ref); b.frag = null; return; }
    for (const n of blockNodes(b)) parent.insertBefore(n, ref);
  }
  function removeBlock(b, transition) {
    b.ctx.destroy();
    const nodes = blockNodes(b);
    if (transition) {
      for (const n of nodes) {
        if (n.nodeType === 1) leave(n, transition, () => n.remove());
        else n.remove();
      }
    } else for (const n of nodes) n.remove();
  }

  /* ──────────────────────────────────────────────────────────────────────
   * c-if / c-else-if / c-else
   * ──────────────────────────────────────────────────────────────────── */
  function dirIf(el, exp, scope, next) {
    const ctx = currentCtx;
    const branches = [{ exp, el }];
    let sib = el.nextElementSibling;
    while (sib) {
      let e;
      if ((e = sib.getAttribute('c-else-if')) != null) branches.push({ exp: e, el: sib });
      else if (sib.hasAttribute('c-else')) branches.push({ exp: null, el: sib });
      else break;
      const n = sib.nextElementSibling;
      if (next === sib) next = sib.nextSibling;
      processed.add(sib);
      sib.remove();
      sib = n;
      if (branches[branches.length - 1].exp === null) break;
    }
    const anchor = doc.createComment('c-if');
    el.replaceWith(anchor);
    for (const b of branches) { b.el.removeAttribute('c-if'); b.el.removeAttribute('c-else-if'); b.el.removeAttribute('c-else'); }
    const tr = transitionName(el);
    let current = -2, block = null, first = true;
    effect(() => {
      let idx = -1;
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        if (b.exp == null || evaluate(scope, b.exp, el)) { idx = i; break; }
      }
      if (idx === current) return;
      untrack(() => {
        if (block) removeBlock(block, tr && !first ? tr : null);
        block = null;
        current = idx;
        if (idx >= 0) {
          block = createBlock(branches[idx].el, scope, ctx);
          const nodes = blockNodes(block);
          insertBlock(block, anchor);
          if (tr && !first) for (const n of nodes) if (n.nodeType === 1) enter(n, tr);
        }
      });
      first = false;
    });
    return next;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * c-for — keyed list rendering with block reuse
   * ──────────────────────────────────────────────────────────────────── */
  const FOR_RE = /^\s*(?:\(([^)]*)\)|([\w$]+))\s+(?:in|of)\s+([\s\S]+?)\s*$/;
  function dirFor(el, exp, scope, next) {
    const ctx = currentCtx;
    const m = exp.match(FOR_RE);
    if (!m) { warn(`Invalid c-for: "${exp}"`, el); return next; }
    const vars = (m[1] || m[2]).split(',').map((s) => s.trim());
    const itemVar = vars[0], idxVar = vars[1], thirdVar = vars[2];
    const srcExp = m[3];
    const keyExp = el.getAttribute('c-key') || el.getAttribute(':key');
    const anchor = doc.createComment('c-for');
    el.replaceWith(anchor);
    el.removeAttribute('c-for'); el.removeAttribute('c-key'); el.removeAttribute(':key');
    const keyScope = keyExp ? createScope(scope, {}) : null;
    let blocks = new Map();

    effect(() => {
      const src = evaluate(scope, srcExp, el);
      const items = [];
      if (typeof src === 'number') { for (let i = 0; i < src; i++) items.push([i + 1, i, i]); }
      else if (Array.isArray(src)) { for (let i = 0; i < src.length; i++) items.push([src[i], i, i]); }
      else if (isObj(src)) { let i = 0; for (const k of Object.keys(src)) { items.push([src[k], k, i]); i++; } }
      untrack(() => update(items, Array.isArray(src) || typeof src === 'number'));
    });

    function update(items, isList) {
      const next = new Map();
      const order = [];
      for (const [item, k, i] of items) {
        const vals = { [itemVar]: item };
        if (idxVar) vals[idxVar] = k;
        if (thirdVar) vals[thirdVar] = i;
        let key;
        if (keyExp) {
          const kr = toRaw(keyScope);
          for (const v in vals) defineHidden(kr, v, vals[v]);
          key = evaluate(keyScope, keyExp, el);
        } else key = isList ? i : k;
        if (next.has(key)) { warn(`Duplicate c-key "${key}" in c-for`, el); key = key + '\0' + i; }
        let b = blocks.get(key);
        if (b) {
          const sr = toRaw(b.scope);
          for (const v in vals) if (sr[v] !== toRaw(vals[v])) b.scope[v] = vals[v];
          blocks.delete(key);
        } else {
          b = createBlock(el, createScope(scope, vals), ctx);
        }
        next.set(key, b);
        order.push(b);
      }
      for (const b of blocks.values()) removeBlock(b);
      blocks = next;
      let ref = anchor;
      for (let i = order.length - 1; i >= 0; i--) {
        const b = order[i];
        if (b.frag || b.end.nextSibling !== ref) insertBlock(b, ref);
        ref = b.start;
      }
    }
    return next;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * c-data / c-persist
   * ──────────────────────────────────────────────────────────────────── */
  function dirData(el, exp, parent) {
    let data = exp.trim() ? evaluate(parent, exp, el) : {};
    if (isFn(data)) data = data.call(parent);
    if (!isObj(data)) data = {};
    const scope = createScope(parent, data);
    const raw = toRaw(scope);
    defineHidden(raw, '$refs', {});
    defineHidden(raw, '$el', el);
    el.__c_scope = scope;
    devdata.scopes.push({ el, scope });
    if (devdata.scopes.length > 500) devdata.scopes = devdata.scopes.filter((s) => s.el.isConnected);
    if (el.hasAttribute('c-persist') || hasAttrPrefix(el, 'c-persist.')) persistScope(el, scope, exp);
    if (isFn(raw.destroy)) onCleanup(() => scope.destroy());
    const init = isFn(raw.init) ? () => { try { const r = scope.init(); if (r && r.catch) r.catch((e) => warn('init() failed', el, e)); } catch (e) { warn('init() failed', el, e); } } : null;
    return { scope, init };
  }

  function hasAttrPrefix(el, prefix) {
    for (const a of el.attributes) if (a.name.startsWith(prefix)) return a;
    return null;
  }

  function persistScope(el, scope, exp) {
    const attr = el.getAttributeNode('c-persist') || hasAttrPrefix(el, 'c-persist.');
    const session = attr.name.indexOf('.session') > -1;
    const raw = toRaw(scope);
    const keys = Object.keys(raw).filter((k) => !isFn(raw[k]) && Object.getOwnPropertyDescriptor(raw, k).get == null);
    const key = 'comet:' + (attr.value || el.id || hash(exp || ''));
    const saved = storage.get(key, session);
    if (isObj(saved)) for (const k of keys) if (hasOwn(saved, k)) scope[k] = saved[k];
    let first = true;
    effect(() => {
      const snap = {};
      for (const k of keys) snap[k] = traverse(scope[k]);
      if (first) { first = false; return; }
      storage.set(key, snap, session);
    });
    if (!session) {
      const onStorage = (e) => {
        if (e.key !== key || !e.newValue) return;
        try { const v = JSON.parse(e.newValue); for (const k of keys) if (hasOwn(v, k)) scope[k] = v[k]; } catch (err) { /* ignore */ }
      };
      global.addEventListener('storage', onStorage);
      onCleanup(() => global.removeEventListener('storage', onStorage));
    }
  }

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Core directives
   * ──────────────────────────────────────────────────────────────────── */
  directives.text = ({ el, value, scope }) => {
    effect(() => { const v = display(evaluate(scope, value, el)); if (el.textContent !== v) el.textContent = v; });
    el.__c_skipChildren = true;
  };

  directives.html = ({ el, value, scope }) => {
    effect(() => {
      el.innerHTML = display(evaluate(scope, value, el));
      markTree(el);
    });
    el.__c_skipChildren = true;
  };

  directives.show = ({ el, value, scope }) => {
    const orig = el.style.display === 'none' ? '' : el.style.display;
    const tr = transitionName(el);
    let first = true, token = 0;
    effect(() => {
      const v = !!evaluate(scope, value, el);
      untrack(() => {
        const t = ++token;
        if (first || !tr) { el.style.display = v ? orig : 'none'; first = false; return; }
        if (v) { el.style.display = orig; enter(el, tr); }
        else leave(el, tr, () => { if (t === token) el.style.display = 'none'; });
      });
    });
  };

  directives.cloak = ({ el }) => el.removeAttribute('c-cloak');

  directives.ref = ({ el, value, scope }) => {
    const refs = scope.$refs;
    refs[value] = el;
    onCleanup(() => { if (refs[value] === el) delete refs[value]; });
  };

  directives.effect = ({ el, value, scope }) => { effect(() => run(scope, value, el)); };

  directives.focus = ({ el, value, scope }) => {
    effect(() => { if (!value || evaluate(scope, value, el)) nextTick(() => el.focus()); });
  };

  const BOOL_ATTRS = new Set('disabled,hidden,required,readonly,checked,selected,multiple,open,autofocus,novalidate,async,defer,inert,loop,muted,autoplay,controls,playsinline,reversed,allowfullscreen,formnovalidate,ismap,nomodule'.split(','));
  const PROP_ATTRS = new Set(['value', 'checked', 'selected', 'muted', 'indeterminate']);
  const SVG_CAMEL = { viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', gradienttransform: 'gradientTransform', gradientunits: 'gradientUnits', patternunits: 'patternUnits', stddeviation: 'stdDeviation', textlength: 'textLength', markerwidth: 'markerWidth', markerheight: 'markerHeight', refx: 'refX', refy: 'refY' };

  function setAttr(el, name, v) {
    if (PROP_ATTRS.has(name) && name in el) {
      if (name === 'value') { const s = v == null ? '' : String(v); if (el.value !== s) el.value = s; }
      else el[name] = !!v;
      return;
    }
    if (el instanceof SVGElement && SVG_CAMEL[name]) name = SVG_CAMEL[name];
    if (BOOL_ATTRS.has(name)) {
      if (v === false || v == null) el.removeAttribute(name); else el.setAttribute(name, '');
      return;
    }
    if (v === false || v == null) el.removeAttribute(name);
    else el.setAttribute(name, v === true ? 'true' : String(v));
  }

  function normalizeClass(v) {
    const out = new Set();
    const add = (x) => {
      if (!x) return;
      if (typeof x === 'string') x.split(/\s+/).forEach((c) => c && out.add(c));
      else if (Array.isArray(x)) x.forEach(add);
      else if (isObj(x)) for (const k in x) if (x[k]) k.split(/\s+/).forEach((c) => c && out.add(c));
    };
    add(v);
    return out;
  }

  directives.bind = ({ el, arg, value, mods, scope }) => {
    if (!arg) {
      effect(() => {
        const o = evaluate(scope, value, el) || {};
        for (const k in o) {
          if (k[0] === '@' || k.startsWith('on')) continue;
          if (k === 'class') bindClass(el, o[k]);
          else setAttr(el, k, o[k]);
        }
      });
      return;
    }
    if (mods.includes('camel')) arg = camelize(arg);
    if (arg === 'class') {
      let prev = new Set();
      effect(() => {
        const next = normalizeClass(evaluate(scope, value, el));
        for (const c of prev) if (!next.has(c)) el.classList.remove(c);
        for (const c of next) if (!prev.has(c)) el.classList.add(c);
        prev = next;
      });
    } else if (arg === 'style') {
      let prevKeys = [];
      const base = el.getAttribute('style') || '';
      effect(() => {
        const v = evaluate(scope, value, el);
        if (typeof v === 'string') { el.setAttribute('style', base + ';' + v); return; }
        for (const k of prevKeys) if (!v || !(k in v)) el.style.removeProperty(k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
        prevKeys = [];
        if (isObj(v)) for (const k in v) {
          const prop = k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
          el.style.setProperty(prop, v[k] == null ? '' : String(v[k]));
          prevKeys.push(k);
        }
      });
    } else {
      effect(() => setAttr(el, arg, evaluate(scope, value, el)));
    }
  };
  function bindClass(el, v) { for (const c of normalizeClass(v)) el.classList.add(c); }

  const KEYS = { enter: ['Enter'], esc: ['Escape'], escape: ['Escape'], space: [' ', 'Spacebar'], tab: ['Tab'], up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], delete: ['Delete', 'Backspace'], backspace: ['Backspace'], home: ['Home'], end: ['End'], pageup: ['PageUp'], pagedown: ['PageDown'] };
  const EVENT_MODS = new Set(['prevent', 'stop', 'self', 'once', 'capture', 'passive', 'window', 'document', 'outside', 'debounce', 'throttle', 'ctrl', 'shift', 'alt', 'meta', 'cmd', 'camel']);

  directives.on = ({ el, arg, value, mods, scope }) => {
    if (!arg) return;
    let event = mods.includes('camel') ? camelize(arg) : arg;
    let target = el;
    if (mods.includes('window')) target = global;
    else if (mods.includes('document') || mods.includes('outside')) target = doc;
    const keyMods = mods.filter((m) => !EVENT_MODS.has(m) && !/^\d/.test(m));
    const sys = ['ctrl', 'shift', 'alt', 'meta', 'cmd'].filter((m) => mods.includes(m));
    let handler = (e) => {
      if (mods.includes('outside')) {
        if (el.contains(e.target) || !el.isConnected || (el.offsetWidth === 0 && el.offsetHeight === 0)) return;
      }
      if (mods.includes('self') && e.target !== el) return;
      if (e instanceof KeyboardEvent || (e.key !== undefined && e.type.startsWith('key'))) {
        if (keyMods.length && !keyMods.some((k) => (KEYS[k] || [k]).some((x) => x.toLowerCase() === String(e.key).toLowerCase()))) return;
      }
      if (sys.length && !sys.every((m) => (m === 'cmd' ? e.metaKey : e[m + 'Key']))) return;
      if (mods.includes('prevent')) e.preventDefault();
      if (mods.includes('stop')) e.stopPropagation();
      run(scope, value, el, e);
    };
    const db = modNum(mods, 'debounce', 250);
    const th = modNum(mods, 'throttle', 250);
    if (db != null) { const inner = handler; const d = debounce(inner, db); handler = (e) => { if (mods.includes('prevent')) e.preventDefault(); d(e); }; onCleanup(d.cancel); }
    else if (th != null) handler = throttle(handler, th);
    const opts = { capture: mods.includes('capture'), passive: mods.includes('passive'), once: mods.includes('once') };
    target.addEventListener(event, handler, opts);
    onCleanup(() => target.removeEventListener(event, handler, opts));
  };

  directives.model = ({ el, value: exp, mods, scope }) => {
    const setter = compileSetter(exp);
    const set = (v) => { try { setter(scope, v); } catch (e) { warn(`c-model could not assign "${exp}"`, el, e); } };
    const tag = el.tagName, type = (el.type || '').toLowerCase();
    const editable = el.isContentEditable;
    const num = mods.includes('number') || type === 'number' || type === 'range';
    const trim = mods.includes('trim');
    const cast = (v) => {
      if (trim && typeof v === 'string') v = v.trim();
      if (num && v !== '') { const n = parseFloat(v); return isNaN(n) ? v : n; }
      return v;
    };
    const ev = mods.includes('lazy') || tag === 'SELECT' || type === 'checkbox' || type === 'radio' ? 'change' : 'input';
    let composing = false;
    let listener;
    if (type === 'checkbox') {
      listener = () => {
        const cur = evaluate(scope, exp, el);
        if (Array.isArray(cur)) {
          const v = cast(el.value);
          const i = cur.indexOf(v);
          if (el.checked && i < 0) cur.push(v);
          else if (!el.checked && i > -1) cur.splice(i, 1);
        } else set(el.checked);
      };
    } else if (type === 'radio') listener = () => { if (el.checked) set(cast(el.value)); };
    else if (tag === 'SELECT' && el.multiple) listener = () => set([...el.selectedOptions].map((o) => cast(o.value)));
    else if (editable) listener = () => set(el.innerText);
    else listener = () => { if (!composing) set(cast(el.value)); };
    const db = modNum(mods, 'debounce', 300);
    if (db != null) { listener = debounce(listener, db); onCleanup(listener.cancel); }
    const onStart = () => { composing = true; };
    const onEnd = () => { composing = false; el.dispatchEvent(new Event('input')); };
    el.addEventListener(ev, listener);
    el.addEventListener('compositionstart', onStart);
    el.addEventListener('compositionend', onEnd);
    onCleanup(() => { el.removeEventListener(ev, listener); el.removeEventListener('compositionstart', onStart); el.removeEventListener('compositionend', onEnd); });

    effect(() => {
      const v = evaluate(scope, exp, el);
      if (Array.isArray(v)) traverse(v);
      const apply = () => {
        if (type === 'checkbox') el.checked = Array.isArray(v) ? v.includes(cast(el.value)) : !!v;
        else if (type === 'radio') el.checked = v != null && String(v) === el.value;
        else if (tag === 'SELECT') {
          if (el.multiple) for (const o of el.options) o.selected = Array.isArray(v) && v.map(String).includes(o.value);
          else el.value = v == null ? '' : String(v);
        } else if (editable) { if (el.innerText !== display(v)) el.innerText = display(v); }
        else {
          if (doc.activeElement === el && cast(el.value) === v) return;
          const s = v == null ? '' : String(v);
          if (el.value !== s) el.value = s;
        }
      };
      if (tag === 'SELECT') nextTick(apply); else apply();
    });
  };

  directives.teleport = ({ el, value }) => {
    const target = doc.querySelector(value || 'body');
    if (!target) { warn(`c-teleport target not found: ${value}`, el); return; }
    const marker = doc.createComment('c-teleport');
    el.replaceWith(marker);
    target.appendChild(el);
    onCleanup(() => { el.remove(); marker.remove(); });
  };

  directives.copy = ({ el, value, scope }) => {
    let t;
    const onClick = async () => {
      const text = display(evaluate(scope, value, el));
      try { await navigator.clipboard.writeText(text); }
      catch (e) {
        const ta = doc.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        doc.body.appendChild(ta); ta.select(); try { doc.execCommand('copy'); } catch (e2) { /* noop */ } ta.remove();
      }
      el.classList.add('c-copied'); el.setAttribute('data-copied', '');
      clearTimeout(t);
      t = setTimeout(() => { el.classList.remove('c-copied'); el.removeAttribute('data-copied'); }, 1600);
      emit(el, 'copied', { text });
    };
    el.addEventListener('click', onClick);
    onCleanup(() => { el.removeEventListener('click', onClick); clearTimeout(t); });
  };

  function parseCombo(s) {
    const parts = s.toLowerCase().split('+').map((x) => x.trim());
    const key = parts.pop();
    return { key, ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt'), meta: parts.includes('meta') || parts.includes('cmd'), mod: parts.includes('mod') };
  }
  directives.hotkey = ({ el, value }) => {
    const combos = value.split(',').map((s) => parseCombo(s.trim()));
    const isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
    const onKey = (e) => {
      const k = (e.key || '').toLowerCase();
      for (const c of combos) {
        const keyOk = c.key === k || (KEYS[c.key] || []).some((x) => x.toLowerCase() === k) || (c.key.length === 1 && e.code === 'Key' + c.key.toUpperCase());
        const wantCtrl = c.ctrl || (c.mod && !isMac), wantMeta = c.meta || (c.mod && isMac);
        const shiftOk = c.shift === e.shiftKey || (!c.shift && c.key.length === 1 && !/[a-z0-9]/.test(c.key));
        if (keyOk && e.ctrlKey === wantCtrl && e.metaKey === wantMeta && e.altKey === c.alt && shiftOk) {
          const t = e.target;
          if (!c.mod && !c.ctrl && !c.meta && !c.alt && t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
          e.preventDefault();
          if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.focus(); else el.click();
          return;
        }
      }
    };
    doc.addEventListener('keydown', onKey);
    onCleanup(() => doc.removeEventListener('keydown', onKey));
  };

  /* ── Intersection: c-intersect, c-reveal, c-lazy ─────────────────── */
  function observeVisible(el, cb, opts = {}) {
    if (!global.IntersectionObserver) { cb({ isIntersecting: true, target: el }); return noop; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) cb(e, () => io.disconnect());
    }, { threshold: opts.threshold || 0, rootMargin: opts.rootMargin || '0px' });
    io.observe(el);
    const stop = () => io.disconnect();
    onCleanup(stop);
    return stop;
  }

  directives.intersect = ({ el, value, mods, scope }) => {
    const threshold = mods.includes('full') ? 0.99 : mods.includes('half') ? 0.5 : 0;
    const leaveMode = mods.includes('leave');
    observeVisible(el, (e, stop) => {
      if (e.isIntersecting === !leaveMode) {
        run(scope, value, el, e);
        if (mods.includes('once')) stop();
      }
    }, { threshold });
  };

  const REVEAL_T = 'opacity .8s cubic-bezier(.2,.7,.2,1) var(--c-delay,0ms),transform .8s cubic-bezier(.2,.7,.2,1) var(--c-delay,0ms),filter .8s ease var(--c-delay,0ms)';
  function revealOn(el, items, repeat, maxDelay) {
    if (reducedMotion()) { el.classList.add('c-revealed'); return; }
    observeVisible(el, (e, stop) => {
      if (e.isIntersecting) {
        for (const x of items) x.style.transition = REVEAL_T;
        el.classList.add('c-revealed');
        if (!repeat) {
          stop();
          setTimeout(() => { for (const x of items) x.style.transition = ''; }, maxDelay + 900);
        }
      } else if (repeat) el.classList.remove('c-revealed');
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  }
  directives.reveal = ({ el, value, mods }) => {
    const parts = (value || '').trim().split(/\s+/);
    const delay = parseTime(parts.find((p) => /^\d/.test(p)), 0);
    if (delay) el.style.setProperty('--c-delay', delay + 'ms');
    revealOn(el, [el], mods.includes('repeat'), delay);
  };
  directives.stagger = ({ el, value, mods }) => {
    const parts = (value || '').trim().split(/\s+/);
    const step = parseTime(parts.find((p) => /^\d/.test(p)), 80);
    const kids = [...el.children];
    kids.forEach((c, i) => c.style.setProperty('--c-delay', i * step + 'ms'));
    revealOn(el, kids, mods.includes('repeat'), kids.length * step);
  };

  function deferLazy(el, scope, next) {
    const ctx = currentCtx;
    withCtx(ctx, () => observeVisible(el, (e, stop) => {
      if (!e.isIntersecting) return;
      stop();
      el.removeAttribute('c-lazy');
      withCtx(ctx, () => walk(el, scope));
    }, { rootMargin: '200px' }));
    return next;
  }

  /* ── Transitions ─────────────────────────────────────────────────── */
  const PRESETS = ['fade', 'slide-up', 'slide-down', 'scale', 'blur'];
  function transitionName(el) {
    const a = el.getAttribute('c-transition');
    if (a == null) return null;
    const n = a.trim() || 'fade';
    return PRESETS.includes(n) ? 'c-' + n : n;
  }
  function afterTransition(el, cb) {
    const cs = getComputedStyle(el);
    const t = (s) => Math.max(0, ...s.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 1 : 1000) || 0));
    const ms = Math.max(t(cs.transitionDuration) + t(cs.transitionDelay), t(cs.animationDuration) + t(cs.animationDelay));
    if (!ms || reducedMotion()) cb(); else setTimeout(cb, ms + 16);
  }
  function enter(el, n) {
    el.classList.remove(n + '-leave-from', n + '-leave-active', n + '-leave-to');
    el.classList.add(n + '-enter-from', n + '-enter-active');
    void el.offsetHeight;
    requestAnimationFrame(() => {
      el.classList.remove(n + '-enter-from');
      el.classList.add(n + '-enter-to');
      afterTransition(el, () => el.classList.remove(n + '-enter-active', n + '-enter-to'));
    });
  }
  function leave(el, n, done) {
    el.classList.remove(n + '-enter-from', n + '-enter-active', n + '-enter-to');
    el.classList.add(n + '-leave-from', n + '-leave-active');
    void el.offsetHeight;
    requestAnimationFrame(() => {
      el.classList.remove(n + '-leave-from');
      el.classList.add(n + '-leave-to');
      afterTransition(el, () => { el.classList.remove(n + '-leave-active', n + '-leave-to'); done(); });
    });
  }
  directives.transition = noop;

  /* ── Includes ─────────────────────────────────────────────────────── */
  const fragCache = new Map();
  function fetchText(url) {
    let p = fragCache.get(url);
    if (!p) {
      p = global.fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); });
      p.catch(() => fragCache.delete(url));
      fragCache.set(url, p);
    }
    return p;
  }

  function loadInto(el, url, scope, ctxHolder, replace) {
    return fetchText(url).then((text) => {
      if (ctxHolder.ctx) ctxHolder.ctx.destroy();
      const ctx = (ctxHolder.ctx = new Ctx(ctxHolder.parent));
      const tpl = doc.createElement('template');
      tpl.innerHTML = text;
      const nodes = [...tpl.content.childNodes];
      if (replace) el.replaceWith(tpl.content); else el.replaceChildren(tpl.content);
      return runScripts(nodes).then(() => withCtx(ctx, () => { for (const n of nodes) if (n.isConnected || !replace) walk(n, scope); }));
    }).catch((e) => warn(`Could not include ${url}`, el, e));
  }

  directives.include = ({ el, value, mods, scope }) => {
    const parts = parseTpl(value);
    const holder = { ctx: null, parent: currentCtx };
    onCleanup(() => holder.ctx && holder.ctx.destroy());
    const go = () => effect(() => { const url = renderTpl(parts, scope, el); untrack(() => loadInto(el, url, scope, holder, false)); });
    if (mods.includes('lazy')) observeVisible(el, (e, stop) => { if (e.isIntersecting) { stop(); withCtx(holder.parent, go); } });
    else go();
    el.__c_skipChildren = true;
  };

  function includeTag(el, scope, next) {
    processed.add(el);
    const src = el.getAttribute('src');
    if (!src) return next;
    const holder = { ctx: null, parent: currentCtx };
    const go = () => loadInto(el, src, scope, holder, true);
    if (el.hasAttribute('lazy')) observeVisible(el, (e, stop) => { if (e.isIntersecting) { stop(); go(); } });
    else go();
    return next;
  }

  async function runScripts(nodes) {
    const scripts = [];
    for (const n of nodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'SCRIPT') scripts.push(n);
      else scripts.push(...n.querySelectorAll('script'));
    }
    for (const old of scripts) {
      const type = (old.getAttribute('type') || '').trim();
      if (type && !/^(text\/javascript|module|application\/javascript)$/.test(type)) continue;
      if (!old.isConnected) continue;
      const s = doc.createElement('script');
      for (const a of old.attributes) s.setAttribute(a.name, a.value);
      s.textContent = old.textContent;
      const waits = s.src || type === 'module';
      const p = waits ? new Promise((res) => { s.onload = s.onerror = res; setTimeout(res, 4000); }) : null;
      if (s.src) s.async = false;
      old.replaceWith(s);
      if (p) await p;
    }
  }

  /* ── i18n directives ──────────────────────────────────────────────── */
  directives.t = ({ el, value, arg, scope }) => {
    effect(() => {
      const key = value;
      const params = el.hasAttribute('c-t-params') ? evaluate(scope, el.getAttribute('c-t-params'), el) : undefined;
      const s = t(key, params);
      if (arg) el.setAttribute(arg, s); else el.textContent = s;
    });
    if (!arg) el.__c_skipChildren = true;
  };
  directives.lang = noop; // handled by CSS rule (no flash)

  /* ── Active links ─────────────────────────────────────────────────── */
  directives.active = ({ el, value, mods }) => {
    const classes = (value || 'active').split(/\s+/).filter(Boolean);
    effect(() => {
      const cur = router.route.path;
      const href = el.getAttribute('href');
      if (href == null) return;
      const p = toRoutePath(new URL(href, doc.baseURI));
      const on = mods.includes('prefix') || mods.includes('deep') ? (p === '/' ? cur === '/' : cur === p || cur.startsWith(p + '/')) : cur === p;
      for (const c of classes) el.classList.toggle(c, on);
      if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
  };

  /* ── Request state helpers: c-loading, c-error, c-empty, c-loaded ─ */
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && !Array.isArray(v) && Object.keys(v).length === 0);
  function showWhen(el, fn) {
    const orig = el.style.display === 'none' ? '' : el.style.display;
    effect(() => { el.style.display = fn() ? orig : 'none'; });
  }
  directives.loading = ({ el, scope }) => showWhen(el, () => scope.$loading);
  directives.loaded = ({ el, scope }) => showWhen(el, () => !scope.$loading && scope.$loaded && !scope.$error);
  directives.empty = ({ el, scope }) => showWhen(el, () => !scope.$loading && scope.$loaded && !scope.$error && isEmpty(scope.$data));
  directives.error = ({ el, value, scope }) => {
    const fill = !el.firstElementChild && !el.textContent.trim();
    if (value) {
      // field error: c-error="email"
      showWhen(el, () => scope.$errors && scope.$errors[value]);
      if (fill) effect(() => { const e = scope.$errors && scope.$errors[value]; el.textContent = Array.isArray(e) ? e[0] : e || ''; });
    } else {
      showWhen(el, () => scope.$error);
      if (fill) effect(() => { const e = scope.$error; el.textContent = e ? e.message || String(e) : ''; });
    }
    if (fill) el.__c_skipChildren = true;
  };

  /* ──────────────────────────────────────────────────────────────────────
   * HTTP layer — $fetch with mocks, dedupe, cache, interceptors
   * ──────────────────────────────────────────────────────────────────── */
  const http = {
    base: '', headers: {}, credentials: 'same-origin', before: [], after: [],
    cache: new Map(), inflight: new Map(), subscribers: new Set(),
  };

  function resolveUrl(url) {
    url = String(url);
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url;
    if (http.base && url.startsWith('/')) return http.base.replace(/\/$/, '') + url;
    return url;
  }

  class HttpError extends Error {
    constructor(res) {
      const d = res.data;
      super((d && (d.message || d.error)) || `Request failed with status ${res.status}`);
      this.status = res.status; this.data = d; this.response = res;
    }
  }

  async function request(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json, text/html;q=0.9, */*;q=0.8', ...http.headers, ...(opts.headers || {}) };
    let body = opts.body;
    if (body != null && typeof body !== 'string' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams) && !(body instanceof ArrayBuffer)) {
      body = JSON.stringify(toRaw(body));
      headers['Content-Type'] = 'application/json';
    }
    let req = { url: resolveUrl(url), method, headers, body, signal: opts.signal, credentials: opts.credentials || http.credentials };
    for (const f of http.before) { const r = await f(req); if (r) req = r; }
    const key = method + ' ' + req.url;
    const ttl = parseTime(opts.cache, 0);
    if (method === 'GET') {
      const c = http.cache.get(key);
      if (c && c.exp > Date.now()) return c.res;
      if (opts.dedupe !== false && http.inflight.has(key)) return http.inflight.get(key);
    }
    const p = (async () => {
      const t0 = performance.now();
      let res;
      try {
        res = await global.fetch(req.url, { method, headers: req.headers, body: req.body, signal: method === 'GET' && opts.dedupe !== false ? undefined : req.signal, credentials: req.credentials });
      } catch (e) {
        devlog('net', { method, url: req.url, status: 0, ms: Math.round(performance.now() - t0), time: Date.now() });
        throw Object.assign(new Error(e.name === 'AbortError' ? 'Request aborted' : 'Network error — could not reach the server'), { status: 0, cause: e, aborted: e.name === 'AbortError' });
      }
      const ct = res.headers.get('content-type') || '';
      let data = null;
      if (res.status !== 204 && res.status !== 205) {
        const text = await res.text();
        if (ct.includes('json') || (/^\s*[[{]/.test(text) && !ct.includes('html'))) { try { data = JSON.parse(text); } catch (e) { data = text; } }
        else data = text;
      }
      let out = { ok: res.ok, status: res.status, headers: res.headers, data, url: req.url, method, html: ct.includes('html') };
      for (const f of http.after) { const r = await f(out, req); if (r) out = r; }
      devlog('net', { method, url: req.url, status: out.status, ms: Math.round(performance.now() - t0), time: Date.now(), mock: res.__mock });
      if (method === 'GET' && out.ok && ttl) http.cache.set(key, { res: out, exp: Date.now() + ttl });
      if (method !== 'GET' && out.ok) { http.cache.clear(); revalidate(req.url, method); }
      return out;
    })();
    if (method === 'GET') { http.inflight.set(key, p); p.then(() => http.inflight.delete(key), () => http.inflight.delete(key)); }
    return p;
  }

  async function cfetch(url, opts = {}) {
    if (typeof opts === 'string') opts = { method: opts };
    const res = await request(url, opts);
    if (!res.ok) throw new HttpError(res);
    return res.data;
  }
  ['get', 'post', 'put', 'patch', 'delete'].forEach((m) => {
    cfetch[m] = (url, body, opts = {}) => cfetch(url, m === 'get' || m === 'delete' ? { ...(body || {}), method: m } : { ...opts, body, method: m });
  });

  function pathOf(url) { try { return new URL(url, location.href).pathname.replace(/\/$/, ''); } catch (e) { return url; } }
  function revalidate(url, method) {
    const p = pathOf(url);
    const root = method === 'POST' ? p : p.replace(/\/[^/]+$/, '');
    for (const sub of http.subscribers) {
      const sp = pathOf(sub.url());
      if (sp === root || sp === p && method !== 'DELETE') sub.refresh();
    }
  }

  /* ── c-get / c-post / c-put / c-patch / c-delete ─────────────────── */
  function dirHttp(el, m, parent) {
    const method = m.toUpperCase();
    const attr = (n) => el.getAttribute('c-' + n);
    const asName = attr('as');
    const isForm = el.tagName === 'FORM';
    const st = createScope(parent, { $loading: false, $loaded: false, $error: null, $status: 0, $response: null, $errors: {} });
    const raw = toRaw(st);
    let target = st;
    if (asName) {
      const owner = findOwner(toRaw(parent), asName);
      if (owner !== toRaw(parent) || hasOwn(owner, asName)) target = reactive(owner);
      else raw[asName] = null;
    }
    Object.defineProperty(raw, '$data', { get: () => (asName ? target[asName] : st.$response), enumerable: false });
    defineHidden(raw, '$reload', () => send());
    el.__c_scope = st;

    const urlParts = parseTpl(attr(m) || '');
    const renderUrl = () => renderTpl(urlParts, st, el, true);
    const triggerSpec = (attr('trigger') || (isForm ? 'submit' : method !== 'GET' || el.tagName === 'BUTTON' || el.tagName === 'A' ? 'click' : /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? 'change' : 'load')).trim();
    const debounceMs = parseTime(attr('debounce'), 0);
    const cacheTtl = attr('cache');
    const selectPath = attr('select');
    const formEl = isForm ? el : el.closest('form');
    let seq = 0, controller = null;
    let validated = false;

    async function send(evt) {
      const confirmMsg = attr('confirm');
      if (confirmMsg && !global.confirm(confirmMsg)) return;
      const url = untrack(renderUrl);
      let body;
      let finalUrl = url;
      const fieldsForm = isForm ? el : null;
      if (fieldsForm) {
        validated = true;
        if (!validateForm(fieldsForm, st)) return;
      }
      if (el.hasAttribute('c-body')) body = untrack(() => evaluate(st, attr('body'), el));
      else if (fieldsForm) body = formData(fieldsForm);
      else if (el.name && 'value' in el && method !== 'GET') body = { [el.name]: el.value };
      if (method === 'GET' && body && !(body instanceof FormData)) {
        const u = new URL(finalUrl, location.href);
        for (const k in body) if (body[k] != null && body[k] !== '') u.searchParams.set(k, body[k]);
        finalUrl = /^[a-z]+:/i.test(url) ? u.href : u.pathname + u.search;
        body = undefined;
      }
      let snapshot = null;
      const opt = attr('optimistic');
      if (opt) { snapshot = snapshotScopes(st); untrack(() => run(st, opt, el, evt)); }
      const my = ++seq;
      if (controller) controller.abort();
      controller = new AbortController();
      st.$loading = true;
      st.$error = null;
      el.setAttribute('aria-busy', 'true');
      el.classList.add('c-loading');
      emit(el, 'c:before', { url: finalUrl, method });
      try {
        const headers = el.hasAttribute('c-headers') ? untrack(() => evaluate(st, attr('headers'), el)) : undefined;
        const res = await request(finalUrl, { method, body, headers, signal: controller.signal, cache: cacheTtl });
        if (my !== seq) return;
        st.$status = res.status;
        if (!res.ok) throw new HttpError(res);
        let data = res.data;
        if (selectPath) data = getPath(data, selectPath);
        const tsel = attr('target');
        if (typeof data === 'string' && (tsel || (!asName && res.html))) swap(tsel ? (tsel === 'this' ? el : doc.querySelector(tsel)) : el, data, attr('swap') || 'inner', st);
        if (asName) target[asName] = data;
        st.$response = data;
        st.$loaded = true;
        st.$errors = {};
        if (isForm && el.hasAttribute('c-reset')) { el.reset(); validated = false; }
        const then = attr('then');
        if (then) runWith(st, then, el, { $response: data, $status: res.status }, evt);
        const redirect = attr('redirect');
        if (redirect) navigate(renderTpl(parseTpl(redirect), createScope(st, { $response: data }), el));
        emit(el, 'c:success', { data, status: res.status });
      } catch (err) {
        if (my !== seq || err.aborted) return;
        st.$status = err.status || 0;
        st.$error = { message: err.message, status: err.status || 0, data: err.data };
        if (err.data && isObj(err.data.errors)) st.$errors = err.data.errors;
        if (snapshot) restoreScopes(snapshot);
        const c = attr('catch');
        if (c) runWith(st, c, el, { $error: st.$error }, evt);
        else if (method !== 'GET' && !el.querySelector('[c-error]') && !el.hasAttribute('c-error')) toast(st.$error.message, { type: 'error' });
        emit(el, 'c:error', st.$error);
      } finally {
        if (my === seq) {
          st.$loading = false;
          el.removeAttribute('aria-busy');
          el.classList.remove('c-loading');
        }
      }
    }

    const sendD = debounceMs ? debounce(send, debounceMs) : send;
    if (debounceMs) onCleanup(sendD.cancel);
    onCleanup(() => { seq++; if (controller) controller.abort(); });

    for (const tok of triggerSpec.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [kind, arg] = tok.split(/\s+/);
      if (kind === 'load') {
        let first = true;
        effect(() => { renderUrl(); untrack(() => { if (first) { first = false; send(); } else sendD(); }); });
      } else if (kind === 'none' || kind === 'manual') {
        /* only via $reload() */
      } else if (kind === 'intersect') {
        observeVisible(el, (e, stop) => { if (e.isIntersecting) { stop(); send(); } }, { rootMargin: '100px' });
      } else if (kind === 'every') {
        startPoll(parseTime(arg, 5000));
      } else {
        const ev = kind;
        const handler = (e) => {
          if (ev === 'submit' || (ev === 'click' && el.tagName === 'A')) e.preventDefault();
          sendD(e);
        };
        el.addEventListener(ev, handler);
        onCleanup(() => el.removeEventListener(ev, handler));
      }
    }
    const poll = attr('poll');
    if (poll) startPoll(parseTime(poll, 5000));
    function startPoll(ms) {
      const id = setInterval(() => { if (!doc.hidden && el.isConnected) send(); }, ms);
      onCleanup(() => clearInterval(id));
    }
    if (method === 'GET' && attr('sync') !== 'false') {
      const sub = { url: () => untrack(renderUrl), refresh: () => send() };
      http.subscribers.add(sub);
      onCleanup(() => http.subscribers.delete(sub));
    }
    if (isForm) {
      const onInput = (e) => { if (validated && e.target.name) validateField(e.target, st); };
      el.addEventListener('input', onInput);
      el.addEventListener('change', onInput);
      onCleanup(() => { el.removeEventListener('input', onInput); el.removeEventListener('change', onInput); });
      if (el.querySelector('[c-error]:not([c-error=""])')) el.setAttribute('novalidate', '');
    }
    return st;
  }

  function runWith(scope, exp, el, extras, evt) {
    return run(createScope(scope, extras), exp, el, evt);
  }

  function snapshotScopes(scope) {
    const out = [];
    let o = toRaw(scope);
    while (o && o !== ROOT) {
      for (const k of Object.keys(o)) {
        const d = Object.getOwnPropertyDescriptor(o, k);
        if (d.get || isFn(d.value) || k[0] === '$') continue;
        try { out.push([o, k, isObj(d.value) ? JSON.parse(JSON.stringify(d.value)) : d.value]); } catch (e) { /* skip */ }
      }
      o = Object.getPrototypeOf(o);
    }
    return out;
  }
  function restoreScopes(snap) { for (const [o, k, v] of snap) reactive(o)[k] = v; }

  const swapCtx = new WeakMap();
  function swap(target, htmlText, mode, scope) {
    if (!target) return;
    const tpl = doc.createElement('template');
    tpl.innerHTML = htmlText;
    const nodes = [...tpl.content.childNodes];
    const prev = swapCtx.get(target);
    if (prev && (mode === 'inner' || mode === 'outer')) prev.destroy();
    const ctx = new Ctx(rootCtx);
    if (mode === 'outer') target.replaceWith(tpl.content);
    else if (mode === 'append') target.append(tpl.content);
    else if (mode === 'prepend') target.prepend(tpl.content);
    else if (mode === 'before') target.before(tpl.content);
    else if (mode === 'after') target.after(tpl.content);
    else if (mode === 'none') return;
    else target.replaceChildren(tpl.content);
    swapCtx.set(target, ctx);
    runScripts(nodes).then(() => withCtx(ctx, () => nodes.forEach((n) => walk(n, scope))));
  }

  function formData(form) {
    const fd = new FormData(form);
    let hasFile = false;
    for (const [, v] of fd) if (v instanceof File) { hasFile = true; break; }
    if (hasFile) return fd;
    const out = {};
    for (const [k, v] of fd) {
      const field = form.elements[k];
      const f = field && field.length && !field.tagName ? field[0] : field;
      let val = v;
      if (f && (f.type === 'number' || f.type === 'range') && v !== '') val = Number(v);
      else if (f && f.type === 'checkbox' && (!f.hasAttribute('value'))) val = true;
      if (hasOwn(out, k)) out[k] = [].concat(out[k], val); else out[k] = val;
    }
    for (const f of form.querySelectorAll('input[type=checkbox][name]:not([value])')) if (!hasOwn(out, f.name)) out[f.name] = false;
    return out;
  }

  function validateField(f, st) {
    if (!f.name || f.disabled) return true;
    let msg = '';
    if (f.willValidate !== false && f.checkValidity && !f.checkValidity()) msg = f.validationMessage;
    const custom = f.getAttribute('c-validate');
    if (!msg && custom) {
      const r = evaluate(createScope(findScope(f), { $value: f.type === 'checkbox' ? f.checked : f.value, $form: f.form }), custom, f);
      if (r !== true && r !== undefined && r !== null) msg = r === false ? 'Invalid value' : String(r);
    }
    const errs = { ...toRaw(st.$errors) };
    if (msg) errs[f.name] = msg; else delete errs[f.name];
    st.$errors = errs;
    f.toggleAttribute('aria-invalid', !!msg);
    if (msg) f.setAttribute('aria-invalid', 'true');
    f.classList.toggle('c-invalid', !!msg);
    return !msg;
  }
  function validateForm(form, st) {
    let ok = true, firstBad = null;
    for (const f of form.elements) {
      if (!f.name) continue;
      if (!validateField(f, st)) { ok = false; firstBad = firstBad || f; }
    }
    if (!ok) {
      if (!form.hasAttribute('novalidate') && form.reportValidity) form.reportValidity();
      else if (firstBad) firstBad.focus();
    }
    return ok;
  }

  /* ── c-live: SSE, WebSocket, BroadcastChannel ────────────────────── */
  function dirLive(el, parent) {
    const a = el.getAttributeNode('c-live') || hasAttrPrefix(el, 'c-live.');
    const url = a.value;
    const mods = a.name.split('.').slice(1);
    const asName = el.getAttribute('c-as') || '$message';
    const append = mods.includes('append');
    const merge = mods.includes('merge');
    const max = parseInt(el.getAttribute('c-max') || '0', 10);
    const st = createScope(parent, { $connected: false, $message: null });
    const raw = toRaw(st);
    let target = st;
    const owner = findOwner(toRaw(parent), asName);
    if (asName !== '$message') {
      if (owner !== toRaw(parent) || hasOwn(owner, asName)) target = reactive(owner);
      else raw[asName] = append ? [] : null;
    }
    el.__c_scope = st;
    const onMsg = el.getAttribute('c-message');
    const handle = (data) => {
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { /* keep text */ } }
      st.$message = data;
      if (asName !== '$message') {
        if (append) {
          if (!Array.isArray(target[asName])) target[asName] = [];
          target[asName].push(data);
          if (max && target[asName].length > max) target[asName].splice(0, target[asName].length - max);
        } else if (merge && isObj(target[asName])) Object.assign(target[asName], data);
        else target[asName] = data;
      }
      if (onMsg) runWith(st, onMsg, el, { $message: data });
    };
    let conn = null, closed = false, retry = 0;
    const send = (msg) => {
      if (!conn) return;
      if (conn instanceof BroadcastChannel) { conn.postMessage(toRaw(msg)); handle(toRaw(msg)); }
      else if (conn.readyState === 1) conn.send(typeof msg === 'string' ? msg : JSON.stringify(toRaw(msg)));
    };
    defineHidden(raw, '$send', send);
    const connect = () => {
      if (closed) return;
      if (url.startsWith('broadcast:')) {
        conn = new BroadcastChannel(url.slice(10));
        conn.onmessage = (e) => handle(e.data);
        st.$connected = true;
      } else if (/^wss?:/.test(url)) {
        conn = new WebSocket(url);
        conn.onopen = () => { st.$connected = true; retry = 0; };
        conn.onmessage = (e) => handle(e.data);
        conn.onclose = () => { st.$connected = false; if (!closed) setTimeout(connect, Math.min(30000, 500 * 2 ** retry++)); };
      } else {
        conn = new EventSource(resolveUrl(url));
        conn.onopen = () => { st.$connected = true; };
        conn.onmessage = (e) => handle(e.data);
        conn.onerror = () => { st.$connected = false; };
      }
    };
    connect();
    onCleanup(() => { closed = true; if (conn) conn.close(); });
    return st;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Mock API — a fake backend in the browser (also patches window.fetch)
   * ──────────────────────────────────────────────────────────────────── */
  const MOCK = Symbol('mockReply');
  const mocks = [];
  const mockOpts = { delay: 0 };
  let nativeFetch = null;

  function compilePath(p) {
    const keys = [];
    const re = new RegExp('^' + p.replace(/\/$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\$|\*/g, '.*').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    return { re, keys };
  }

  function mock(defs, opts = {}) {
    Object.assign(mockOpts, opts);
    for (const k of Object.keys(defs)) {
      const parts = k.trim().split(/\s+/);
      const method = parts.length > 1 ? parts[0].toUpperCase() : 'GET';
      const path = parts.length > 1 ? parts[1] : parts[0];
      mocks.push({ method, ...compilePath(path), handler: defs[k] });
    }
    if (!nativeFetch) {
      nativeFetch = global.fetch.bind(global);
      global.fetch = async (input, init = {}) => {
        const isReq = typeof Request !== 'undefined' && input instanceof Request;
        const url = isReq ? input.url : String(input);
        const method = (init.method || (isReq ? input.method : 'GET')).toUpperCase();
        let body = init.body;
        if (body === undefined && isReq && method !== 'GET' && method !== 'HEAD') body = await input.clone().text();
        const headers = new Headers(init.headers || (isReq ? input.headers : undefined));
        const r = await mockMatch(url, method, body, headers);
        return r || nativeFetch(input, init);
      };
    }
    return Comet;
  }
  mock.reply = (status, body, headers) => ({ [MOCK]: true, status, body, headers });
  mock.error = (status, body) => { throw mock.reply(status, typeof body === 'string' ? { message: body } : body); };
  mock.delay = (ms) => { mockOpts.delay = ms; };
  mock.clear = () => { mocks.length = 0; };

  async function mockMatch(url, method, body, headers) {
    if (!mocks.length) return null;
    let u;
    try { u = new URL(url, location.href); } catch (e) { return null; }
    if (u.origin !== location.origin && !mockOpts.crossOrigin) return null;
    for (const m of mocks) {
      if (m.method !== method && m.method !== '*' && m.method !== 'ALL') continue;
      const mm = m.re.exec(u.pathname.replace(/\/$/, '') || '/');
      if (!mm) continue;
      const params = {};
      m.keys.forEach((k, i) => { params[k] = decodeURIComponent(mm[i + 1]); });
      const query = Object.fromEntries(u.searchParams);
      let parsed = body;
      if (typeof body === 'string') { try { parsed = JSON.parse(body); } catch (e) { parsed = body; } }
      else if (body instanceof FormData) parsed = Object.fromEntries(body);
      else if (body instanceof URLSearchParams) parsed = Object.fromEntries(body);
      const d = typeof mockOpts.delay === 'function' ? mockOpts.delay() : Array.isArray(mockOpts.delay) ? mockOpts.delay[0] + Math.random() * (mockOpts.delay[1] - mockOpts.delay[0]) : mockOpts.delay;
      if (d) await sleep(d);
      let status = method === 'POST' ? 201 : 200, out, hdrs = { 'content-type': 'application/json' };
      try {
        out = await m.handler({ params, query, body: parsed, method, headers, url: u.href, path: u.pathname });
      } catch (e) {
        if (e && e[MOCK]) out = e;
        else if (e && e.name === 'ValidationError') out = mock.reply(422, { message: e.message, errors: e.errors });
        else out = mock.reply(500, { message: (e && e.message) || 'Mock handler failed' });
      }
      if (out instanceof Response) return out;
      if (out && out[MOCK]) { status = out.status; if (out.headers) Object.assign(hdrs, out.headers); out = out.body; }
      if (out === undefined && status < 300) status = 204;
      let payload = null;
      if (out !== undefined && status !== 204) {
        if (typeof out === 'string' && /^\s*</.test(out)) { payload = out; hdrs['content-type'] = 'text/html'; }
        else payload = JSON.stringify(toRaw(out));
      }
      const res = new Response(payload, { status, headers: hdrs });
      try { Object.defineProperty(res, '__mock', { value: true }); } catch (e) { /* noop */ }
      return res;
    }
    return null;
  }

  function coerce(v) {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null') return null;
    if (v !== '' && !isNaN(v) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }

  mock.crud = (path, tableName, opts = {}) => {
    const base = path.replace(/\/$/, '');
    const table = () => db.table(tableName || base.split('/').pop());
    return mock({
      [`GET ${base}`]: async ({ query }) => {
        let q = table().query();
        const { _sort, _order, _limit, _page, _q, q: search, ...filters } = query;
        for (const k in filters) q = q.where({ [k]: coerce(filters[k]) });
        if (search || _q) q = q.search(search || _q);
        if (_sort) q = q.orderBy(_sort, _order || 'asc');
        if (_limit) { q = q.limit(+_limit); if (_page) q = q.offset((+_page - 1) * +_limit); }
        return q.get();
      },
      [`GET ${base}/:id`]: async ({ params }) => (await table().find(params.id)) || mock.error(404, 'Not found'),
      [`POST ${base}`]: ({ body }) => table().add(body || {}),
      [`PUT ${base}/:id`]: async ({ params, body }) => (await table().find(params.id) ? table().put({ ...body, id: normId(params.id) }) : mock.error(404, 'Not found')),
      [`PATCH ${base}/:id`]: async ({ params, body }) => (await table().update(params.id, body || {})) || mock.error(404, 'Not found'),
      [`DELETE ${base}/:id`]: async ({ params }) => { await table().delete(params.id); },
    }, opts);
  };

  /* ──────────────────────────────────────────────────────────────────────
   * $db — a reactive ORM over IndexedDB (in-memory first, persisted)
   * ──────────────────────────────────────────────────────────────────── */
  const models = {};
  const tables = new Map();
  let idbP = null;
  let bc = null;
  const normId = (id) => (typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id);
  const clone = (v) => (global.structuredClone ? structuredClone(toRaw(v)) : JSON.parse(JSON.stringify(v)));

  function idb() {
    if (!idbP) {
      idbP = new Promise((res) => {
        if (!global.indexedDB) return res(null);
        let r;
        try { r = indexedDB.open('comet-db', 1); } catch (e) { return res(null); }
        r.onupgradeneeded = () => { const s = r.result.createObjectStore('rows', { keyPath: 'k' }); s.createIndex('t', 't'); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
        r.onblocked = () => res(null);
      });
    }
    return idbP;
  }

  function channel() {
    if (!bc && global.BroadcastChannel) {
      bc = new BroadcastChannel('comet-db');
      bc.onmessage = (e) => { const t = tables.get(e.data && e.data.table); if (t) t.reload(); };
    }
    return bc;
  }

  class ValidationError extends Error {
    constructor(errors) { super(Object.values(errors)[0] || 'Validation failed'); this.name = 'ValidationError'; this.errors = errors; this.status = 422; }
  }

  class Query {
    constructor(table) { this.t = table; this.f = []; this.s = []; this.lim = Infinity; this.off = 0; }
    where(cond, op, val) {
      const q = this.copy();
      if (isFn(cond)) q.f.push(cond);
      else if (typeof cond === 'string') q.f.push((r) => test(getPath(r, cond), op, val));
      else for (const k in cond) {
        const c = toRaw(cond[k]);
        if (isObj(c) && !Array.isArray(c)) for (const o in c) q.f.push((r) => test(getPath(r, k), o, c[o]));
        else q.f.push((r) => test(getPath(r, k), Array.isArray(c) ? 'in' : '=', c));
      }
      return q;
    }
    search(text, fields) {
      if (!text) return this;
      const needle = String(text).toLowerCase();
      return this.where((r) => (fields || Object.keys(r)).some((k) => { const v = r[k]; return v != null && typeof v !== 'object' && String(v).toLowerCase().includes(needle); }));
    }
    orderBy(field, dir = 'asc') { const q = this.copy(); q.s.push([field, String(dir).toLowerCase() === 'desc' ? -1 : 1]); return q; }
    limit(n) { const q = this.copy(); q.lim = n; return q; }
    offset(n) { const q = this.copy(); q.off = n; return q; }
    page(n, size = 20) { return this.offset((n - 1) * size).limit(size); }
    copy() { const q = new Query(this.t); q.f = [...this.f]; q.s = [...this.s]; q.lim = this.lim; q.off = this.off; return q; }
    run() {
      let rows = [...this.t.rows.values()];
      if (this.f.length) rows = rows.filter((r) => this.f.every((f) => f(r)));
      if (this.s.length) rows.sort((a, b) => {
        for (const [k, d] of this.s) {
          const x = getPath(a, k), y = getPath(b, k);
          if (x === y) continue;
          if (x == null) return 1;
          if (y == null) return -1;
          return (typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : x < y ? -1 : 1) * d;
        }
        return 0;
      });
      return rows.slice(this.off, this.lim === Infinity ? undefined : this.off + this.lim);
    }
    async get() { await this.t.load(); return this.run().map(clone); }
    async first() { await this.t.load(); const r = this.limit(1).run()[0]; return r ? clone(r) : null; }
    async count() { await this.t.load(); return this.run().length; }
    async pluck(field) { return (await this.get()).map((r) => getPath(r, field)); }
    async update(patch) { await this.t.load(); const rows = this.run(); for (const r of rows) await this.t.update(r.id, patch, true); this.t.changed(); return rows.length; }
    async delete() { await this.t.load(); const ids = this.run().map((r) => r.id); for (const id of ids) this.t.rows.delete(id); await this.t.save(ids.map((id) => ['del', id])); this.t.changed(); return ids.length; }
    live() {
      const arr = reactive([]);
      const cache = new Map();
      const refresh = () => {
        const rows = this.run().map((r) => {
          const json = JSON.stringify(r);
          const c = cache.get(r.id);
          if (c && c.json === json) return c.obj;
          const obj = clone(r);
          cache.set(r.id, { json, obj });
          return obj;
        });
        const raw = toRaw(arr);
        if (raw.length === rows.length && raw.every((x, i) => x === rows[i])) return;
        arr.splice(0, arr.length, ...rows);
      };
      const entry = { refresh };
      this.t.lives.add(entry);
      onCleanup(() => this.t.lives.delete(entry));
      this.t.load().then(refresh);
      return arr;
    }
  }
  Query.prototype[SKIP] = true;

  function test(v, op, x) {
    switch (op) {
      case '=': case '==': case 'eq': return x instanceof RegExp ? x.test(v) : v === x || (v != null && x != null && String(v) === String(x) && typeof v !== typeof x && (typeof v === 'number' || typeof x === 'number'));
      case '!=': case 'ne': return v !== x;
      case '>': case 'gt': return v > x;
      case '>=': case 'gte': return v >= x;
      case '<': case 'lt': return v < x;
      case '<=': case 'lte': return v <= x;
      case 'in': return (x || []).includes(v);
      case 'nin': return !(x || []).includes(v);
      case 'contains': return Array.isArray(v) ? v.includes(x) : String(v ?? '').includes(x);
      case 'like': return String(v ?? '').toLowerCase().includes(String(x).toLowerCase());
      case 'startsWith': return String(v ?? '').startsWith(x);
      case 'endsWith': return String(v ?? '').endsWith(x);
      case 'between': return v >= x[0] && v <= x[1];
      case 'exists': return x ? v !== undefined : v === undefined;
      default: return v === x;
    }
  }

  class Table {
    constructor(name) { this.name = name; this.rows = new Map(); this.loaded = null; this.lives = new Set(); this.maxId = 0; this.listeners = new Set(); }
    get model() { return models[this.name] || {}; }
    load() {
      if (!this.loaded) {
        this.loaded = (async () => {
          const d = await idb();
          if (!d) return;
          await new Promise((res) => {
            try {
              const req = d.transaction('rows').objectStore('rows').index('t').getAll(this.name);
              req.onsuccess = () => { for (const r of req.result) { this.rows.set(r.v.id, r.v); if (typeof r.v.id === 'number' && r.v.id > this.maxId) this.maxId = r.v.id; } res(); };
              req.onerror = () => res();
            } catch (e) { res(); }
          });
        })();
      }
      return this.loaded;
    }
    reload() { this.rows.clear(); this.maxId = 0; this.loaded = null; return this.load().then(() => this.changed(false)); }
    async save(ops) {
      const d = await idb();
      if (d) {
        await new Promise((res) => {
          try {
            const tx = d.transaction('rows', 'readwrite');
            const s = tx.objectStore('rows');
            for (const [op, x] of ops) {
              if (op === 'put') s.put({ k: this.name + '\u0000' + x.id, t: this.name, v: toRaw(x) });
              else s.delete(this.name + '\u0000' + x);
            }
            tx.oncomplete = tx.onerror = tx.onabort = () => res();
          } catch (e) { res(); }
        });
      }
      const c = channel();
      if (c) c.postMessage({ table: this.name });
    }
    changed(local = true) {
      for (const l of this.lives) l.refresh();
      for (const fn of this.listeners) fn({ table: this.name, local });
    }
    prepare(row, isNew) {
      const m = this.model;
      if (isNew && m.defaults) for (const k in m.defaults) if (row[k] === undefined) row[k] = isFn(m.defaults[k]) ? m.defaults[k]() : clone(m.defaults[k]);
      if (m.timestamps) { const now = new Date().toISOString(); if (isNew) row.createdAt = row.createdAt || now; row.updatedAt = now; }
      if (m.validate) {
        const errors = {};
        for (const k in m.validate) {
          const r = m.validate[k](row[k], row);
          if (r !== true && r !== undefined && r !== null) errors[k] = r === false ? `${k} is invalid` : String(r);
        }
        if (Object.keys(errors).length) throw new ValidationError(errors);
      }
      return row;
    }
    query() { return new Query(this); }
    where(...a) { return this.query().where(...a); }
    orderBy(...a) { return this.query().orderBy(...a); }
    search(...a) { return this.query().search(...a); }
    limit(n) { return this.query().limit(n); }
    live() { return this.query().live(); }
    all() { return this.query().get(); }
    count() { return this.query().count(); }
    first() { return this.query().first(); }
    async find(id) { await this.load(); const r = this.rows.get(normId(id)); return r ? clone(r) : null; }
    get(id) { return this.find(id); }
    async add(data) {
      await this.load();
      if (Array.isArray(data)) { const out = []; for (const d of data) out.push(await this.add(d)); return out; }
      const row = this.prepare(clone(data || {}), true);
      if (row.id == null) row.id = ++this.maxId; else { row.id = normId(row.id); if (typeof row.id === 'number' && row.id > this.maxId) this.maxId = row.id; }
      this.rows.set(row.id, row);
      this.changed();
      await this.save([['put', row]]);
      return clone(row);
    }
    insert(d) { return this.add(d); }
    create(d) { return this.add(d); }
    async put(data) {
      await this.load();
      const id = normId(data.id);
      if (id == null || !this.rows.has(id)) return this.add(data);
      const row = this.prepare({ ...clone(data), id, createdAt: this.rows.get(id).createdAt }, false);
      this.rows.set(id, row);
      this.changed();
      await this.save([['put', row]]);
      return clone(row);
    }
    async update(id, patch, silent) {
      await this.load();
      id = normId(id);
      const cur = this.rows.get(id);
      if (!cur) return null;
      const p = isFn(patch) ? patch(clone(cur)) : clone(patch);
      const row = this.prepare({ ...cur, ...p, id }, false);
      this.rows.set(id, row);
      if (!silent) this.changed();
      await this.save([['put', row]]);
      return clone(row);
    }
    async delete(id) {
      await this.load();
      id = normId(id);
      const had = this.rows.delete(id);
      if (had) { this.changed(); await this.save([['del', id]]); }
      return had;
    }
    remove(id) { return this.delete(id); }
    async clear() {
      await this.load();
      const ids = [...this.rows.keys()];
      this.rows.clear(); this.maxId = 0;
      this.changed();
      await this.save(ids.map((id) => ['del', id]));
    }
    async seed(rows) { await this.load(); if (this.rows.size === 0) await this.add(rows); return this.all(); }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  }
  Table.prototype[SKIP] = true;

  const dbApi = {
    table(name) { let t = tables.get(name); if (!t) { t = new Table(name); tables.set(name, t); } return t; },
    model(name, def) { models[name] = def || {}; return dbApi.table(name); },
    seed(name, rows) { return dbApi.table(name).seed(rows); },
    async drop(name) { await dbApi.table(name).clear(); },
    tables: () => [...tables.keys()],
    ValidationError,
  };
  const db = new Proxy(dbApi, {
    get(t, k) {
      if (k === SKIP) return true;
      if (typeof k !== 'string' || hasOwn(t, k)) return t[k];
      if (k === 'then' || k === 'toJSON') return undefined;
      return t.table(k);
    },
  });

  /* ──────────────────────────────────────────────────────────────────────
   * Stores
   * ──────────────────────────────────────────────────────────────────── */
  const stores = reactive({});
  function store(name, obj, opts = {}) {
    if (obj === undefined) return stores[name];
    stores[name] = obj;
    const s = stores[name];
    if (opts.persist) {
      const key = 'comet:store:' + name;
      const saved = storage.get(key);
      const raw = toRaw(s);
      const keys = (Array.isArray(opts.persist) ? opts.persist : Object.keys(raw)).filter((k) => !isFn(raw[k]) && !(Object.getOwnPropertyDescriptor(raw, k) || {}).get);
      if (isObj(saved)) for (const k of keys) if (hasOwn(saved, k)) s[k] = saved[k];
      withCtx(null, () => effect(() => { const snap = {}; for (const k of keys) snap[k] = traverse(s[k]); storage.set(key, snap); }));
    }
    if (isFn(toRaw(s).init)) s.init();
    return s;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Router — file-based pages, layouts, prefetch, view transitions
   * ──────────────────────────────────────────────────────────────────── */
  const router = {
    route: reactive({ path: '/', params: {}, query: {}, hash: '', url: '' }),
    routes: [], guards: [], afters: [], view: null, dir: 'pages/', layoutsDir: 'layouts/', base: '/',
    pages: new Map(), pageCtx: null, layoutCtx: null, layoutName: null, outlet: null, token: 0, current: '',
  };

  function computeBase() {
    const b = doc.querySelector('base[href]');
    let p = b ? new URL(b.href, location.href).pathname : config.base || '/';
    if (!p.endsWith('/')) p = p.replace(/[^/]*$/, '');
    return p;
  }

  function toRoutePath(u) {
    let p = u.pathname;
    const base = router.base || '/';
    if (p.startsWith(base)) p = '/' + p.slice(base.length);
    else if (p + '/' === base) p = '/';
    p = p.replace(/\/index(\.html?)?$/, '/').replace(/\.html?$/, '');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    try { p = decodeURI(p); } catch (e) { /* keep */ }
    return p || '/';
  }

  function addRoutes(map) {
    for (const k of Object.keys(map)) router.routes.push({ path: k, file: map[k], ...compilePath(k) });
  }

  function matchRoute(path) {
    for (const r of router.routes) {
      const m = r.re.exec(path);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        const file = typeof r.file === 'string' ? r.file : r.file.file;
        return { files: [file.replace(/^\//, '')], params, explicit: true };
      }
    }
    if (path === '/') return { files: [router.dir + 'index.html'], params: {} };
    const p = path.replace(/^\//, '');
    return { files: [router.dir + p + '.html', router.dir + p + '/index.html'], params: {} };
  }

  function fetchPage(url) {
    let p = router.pages.get(url);
    if (!p) {
      p = (nativeFetch || global.fetch)(url, { headers: { Accept: 'text/html' } }).then((r) => {
        if (!r.ok) throw Object.assign(new Error('Not found'), { status: r.status });
        return r.text();
      });
      router.pages.set(url, p);
      p.catch(() => router.pages.delete(url));
    }
    return p;
  }

  async function loadPage(files) {
    let lastErr;
    for (const f of files) {
      try { return await fetchPage(f); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Not found');
  }

  const progress = {
    el: null, t: null,
    start() {
      clearTimeout(this.t);
      this.t = setTimeout(() => {
        if (!this.el) { this.el = doc.createElement('div'); this.el.id = 'c-progress'; doc.body.appendChild(this.el); }
        this.el.className = 'c-on';
        void this.el.offsetWidth;
        this.el.style.transform = 'scaleX(.75)';
      }, 120);
    },
    done() {
      clearTimeout(this.t);
      if (!this.el || !this.el.className) return;
      this.el.style.transform = 'scaleX(1)';
      setTimeout(() => { this.el.className = ''; this.el.style.transform = 'scaleX(0)'; }, 220);
    },
  };

  function parsePage(text) {
    let title = null, metas = [];
    const isDoc = /<html[\s>]|<!doctype/i.test(text.slice(0, 500));
    const tpl = doc.createElement('template');
    if (isDoc) {
      const d = new DOMParser().parseFromString(text, 'text/html');
      title = d.title || null;
      metas = [...d.querySelectorAll('meta[name], meta[property]')];
      const v = d.querySelector('[c-view]');
      tpl.innerHTML = v ? v.innerHTML : d.body.innerHTML;
    } else tpl.innerHTML = text;
    const frag = tpl.content;
    for (const t of frag.querySelectorAll('title')) { title = t.textContent; t.remove(); }
    for (const m of frag.querySelectorAll('meta[name], meta[property]')) { metas.push(m); m.remove(); }
    let layout = null;
    for (const n of frag.children) { const l = n.getAttribute('c-layout'); if (l != null) { layout = l; break; } }
    return { frag, title, metas, layout };
  }

  function applyHead(title, metas) {
    if (!router.baseTitle) router.baseTitle = doc.title;
    const fmt = config.title;
    doc.title = title ? (fmt ? fmt.replace('%s', title) : title) : router.baseTitle;
    for (const m of metas) {
      const sel = m.hasAttribute('name') ? `meta[name="${m.getAttribute('name')}"]` : `meta[property="${m.getAttribute('property')}"]`;
      let cur = doc.head.querySelector(sel);
      if (!cur) { cur = doc.createElement('meta'); for (const a of m.attributes) if (a.name !== 'content') cur.setAttribute(a.name, a.value); doc.head.appendChild(cur); }
      cur.setAttribute('content', m.getAttribute('content') || '');
    }
  }

  async function renderPage(page) {
    if (router.pageCtx) router.pageCtx.destroy();
    let target = router.view;
    if (page.layout) {
      if (router.layoutName !== page.layout || !router.outlet || !router.outlet.isConnected) {
        if (router.layoutCtx) router.layoutCtx.destroy();
        const ltext = page.layoutHtml;
        const lp = parsePage(ltext);
        const lnodes = [...lp.frag.childNodes];
        router.view.replaceChildren(lp.frag);
        router.layoutCtx = new Ctx(rootCtx);
        await runScripts(lnodes);
        router.outlet = router.view.querySelector('[c-outlet]') || router.view;
        router.outlet.__c_skipChildren = true;
        const ls = findScope(router.view);
        withCtx(router.layoutCtx, () => lnodes.forEach((n) => walk(n, ls)));
        router.layoutName = page.layout;
      }
      target = router.outlet;
    } else if (router.layoutName) {
      if (router.layoutCtx) router.layoutCtx.destroy();
      router.layoutCtx = null; router.layoutName = null; router.outlet = null;
    }
    const nodes = [...page.frag.childNodes];
    target.replaceChildren(page.frag);
    router.pageCtx = new Ctx(rootCtx);
    await runScripts(nodes);
    const ps = findScope(target);
    withCtx(router.pageCtx, () => nodes.forEach((n) => walk(n, ps)));
    applyHead(page.title, page.metas);
  }

  const DEFAULT_404 = '<section style="min-height:50vh;display:grid;place-items:center;text-align:center;font-family:system-ui;padding:4rem 1rem"><div><h1 style="font-size:4rem;margin:0">404</h1><p style="opacity:.7">This page could not be found.</p><a href="./">← Home</a></div></section>';

  async function navigate(href, opts = {}) {
    if (!router.view) { location.href = href; return; }
    if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && router.base !== '/' && !href.startsWith(router.base)) href = router.base + href.slice(1);
    const url = new URL(href, opts.pop || opts.initial ? location.href : doc.baseURI);
    if (url.origin !== location.origin) { location.href = url.href; return; }
    const path = toRoutePath(url);
    const to = { path, params: {}, query: Object.fromEntries(url.searchParams), hash: url.hash, url: url.pathname + url.search + url.hash };
    const from = { ...toRaw(router.route) };
    for (const g of router.guards) {
      const r = await g(to, from);
      if (r === false) { if (opts.pop) history.pushState(history.state, '', from.url); return; }
      if (typeof r === 'string') return navigate(r, { replace: true });
    }
    const token = ++router.token;
    if (!opts.initial && !opts.pop) { try { history.replaceState({ ...(history.state || {}), scroll: global.scrollY }, ''); } catch (e) { /* noop */ } }
    const match = matchRoute(path);
    to.params = match.params;
    progress.start();
    let page, status = 200;
    try { page = parsePage(await loadPage(match.files)); }
    catch (e) {
      status = 404;
      try { page = parsePage(await fetchPage(router.dir + '404.html')); } catch (e2) { page = parsePage(DEFAULT_404); }
    }
    if (page.layout) {
      try { page.layoutHtml = router.layoutName === page.layout && router.outlet && router.outlet.isConnected ? '' : await fetchText(router.layoutsDir + page.layout + '.html'); }
      catch (e) { warn(`Layout "${page.layout}" not found in ${router.layoutsDir}`); page.layout = null; }
    }
    if (token !== router.token) return;
    if (!opts.initial && !opts.pop) history[opts.replace ? 'replaceState' : 'pushState']({ scroll: 0 }, '', url.href);
    router.current = url.pathname + url.search;
    const update = async () => {
      Object.assign(router.route, to, { status });
      await renderPage(page);
    };
    const useVT = doc.startViewTransition && !opts.initial && config.transitions !== false && router.view.getAttribute('c-transition') !== 'none' && !reducedMotion();
    if (useVT) {
      try {
        const vt = doc.startViewTransition(update);
        vt.ready.catch(noop); vt.finished.catch(noop);
        await vt.updateCallbackDone;
      } catch (e) { warn('Navigation render failed', null, e); }
    } else {
      try { await update(); } catch (e) { warn('Navigation render failed', null, e); }
    }
    progress.done();
    if (opts.pop && history.state && history.state.scroll != null) global.scrollTo(0, history.state.scroll);
    else if (to.hash) scrollToHash(to.hash, opts.initial);
    else if (!opts.initial) global.scrollTo(0, 0);
    devlog('nav', { path, status, time: Date.now() });
    for (const f of router.afters) { try { f(to, from); } catch (e) { warn('router.after hook failed', null, e); } }
    emit(doc, 'comet:navigate', { to, from, status });
  }

  function scrollToHash(hash, instant) {
    let id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch (e) { /* noop */ }
    const t = doc.getElementById(id);
    if (t) t.scrollIntoView({ behavior: instant || reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  function linkFrom(e) {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('c-reload') || /\bexternal\b/.test(a.rel || '')) return null;
    if (a.closest('[c-ignore]')) return null;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !(url.pathname + '/').startsWith(router.base)) return null;
    if (/\.[a-z0-9]{1,5}$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) return null;
    return url;
  }

  function startRouter() {
    const view = doc.querySelector('[c-view]');
    if (!view) return;
    router.view = view;
    const dir = view.getAttribute('c-view');
    if (dir) router.dir = dir.endsWith('/') ? dir : dir + '/';
    const ld = view.getAttribute('c-layouts');
    if (ld) router.layoutsDir = ld.endsWith('/') ? ld : ld + '/';
    router.base = computeBase();
    for (const s of doc.querySelectorAll('script[type="comet/routes"]')) {
      try { addRoutes(JSON.parse(s.textContent)); } catch (e) { warn('Invalid comet/routes JSON', s, e); }
    }
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    doc.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const url = linkFrom(e);
      if (!url) return;
      e.preventDefault();
      if (url.pathname + url.search === location.pathname + location.search && url.hash) {
        if (url.hash !== location.hash) history.pushState({ scroll: global.scrollY }, '', url.href);
        router.route.hash = url.hash;
        scrollToHash(url.hash);
        return;
      }
      if (url.href === location.href) return;
      navigate(url.href);
    });
    let hoverT;
    const prefetch = (e) => {
      if (config.prefetch === false || (navigator.connection && navigator.connection.saveData)) return;
      const url = linkFrom(e);
      if (!url) return;
      clearTimeout(hoverT);
      hoverT = setTimeout(() => { const m = matchRoute(toRoutePath(url)); loadPage(m.files).catch(noop); }, e.type === 'touchstart' ? 0 : 65);
    };
    doc.addEventListener('mouseover', prefetch, { passive: true });
    doc.addEventListener('touchstart', prefetch, { passive: true });
    doc.addEventListener('focusin', prefetch);
    global.addEventListener('popstate', () => {
      if (location.pathname + location.search === router.current) {
        router.route.hash = location.hash;
        if (location.hash) scrollToHash(location.hash); else if (history.state && history.state.scroll != null) global.scrollTo(0, history.state.scroll);
        return;
      }
      navigate(location.href, { pop: true });
    });
    return navigate(location.href, { initial: true });
  }

  /* ──────────────────────────────────────────────────────────────────────
   * i18n + formatting
   * ──────────────────────────────────────────────────────────────────── */
  const i18n = {
    state: reactive({ lang: '', v: 0 }),
    messages: {}, langs: [], fallback: null, loader: null, persist: true, configured: false,
  };
  const langStyle = doc.createElement('style');
  langStyle.id = 'c-lang-css';

  function detectLang(langs, def) {
    const saved = storage.get('comet:lang');
    if (saved && (!langs.length || langs.includes(saved))) return saved;
    const nav = (navigator.languages || [navigator.language || '']).map((l) => l.toLowerCase());
    for (const l of nav) {
      const short = l.split('-')[0];
      if (!langs.length) return short;
      if (langs.includes(l)) return l;
      if (langs.includes(short)) return short;
    }
    return def || langs[0] || (html.getAttribute('lang') || 'en');
  }

  async function loadLang(lang) {
    if (i18n.messages[lang] || !i18n.loader) return;
    const src = isFn(i18n.loader) ? i18n.loader(lang) : i18n.loader.replace('{lang}', lang);
    try {
      const data = typeof src === 'string' ? await (nativeFetch || global.fetch)(src).then((r) => r.json()) : await src;
      i18n.messages[lang] = data || {};
    } catch (e) { warn(`Could not load translations for "${lang}"`, null, e); i18n.messages[lang] = {}; }
  }

  async function setLang(lang) {
    await loadLang(lang);
    if (i18n.fallback && i18n.fallback !== lang) await loadLang(i18n.fallback);
    applyLang(lang);
    i18n.state.v++;
    if (i18n.persist) storage.set('comet:lang', lang);
    emit(doc, 'comet:lang', { lang });
  }
  function applyLang(lang) {
    i18n.state.lang = lang;
    html.setAttribute('lang', lang);
    langStyle.textContent = `[c-lang]:not([c-lang~="${lang}"]){display:none!important}`;
  }

  function configureI18n(opts = {}) {
    i18n.configured = true;
    i18n.langs = opts.langs || Object.keys(opts.messages || {});
    i18n.fallback = opts.fallback || opts.default || i18n.langs[0] || null;
    i18n.loader = opts.load || opts.url || null;
    i18n.persist = opts.persist !== false;
    if (opts.messages) Object.assign(i18n.messages, opts.messages);
    const lang = opts.detect === false ? (storage.get('comet:lang') || opts.default || i18n.langs[0]) : detectLang(i18n.langs, opts.default);
    applyLang(lang);
    const p = setLang(lang);
    ready.push(p);
    return p;
  }

  function t(key, params) {
    const lang = i18n.state.lang;
    void i18n.state.v;
    let v = getPath(i18n.messages[lang], key);
    if (v == null && i18n.fallback) v = getPath(i18n.messages[i18n.fallback], key);
    if (v == null) return key;
    if (isObj(v) && params && params.count != null) {
      const rule = new Intl.PluralRules(lang).select(params.count);
      v = v[params.count === 0 && v.zero != null ? 'zero' : rule] ?? v.other ?? '';
    }
    if (typeof v === 'string' && params) v = v.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? params[k] : `{${k}}`));
    return v;
  }

  const fmtCache = new Map();
  function intl(type, opts) {
    const lang = i18n.state.lang || html.lang || undefined;
    const key = type + lang + JSON.stringify(opts || {});
    let f = fmtCache.get(key);
    if (!f) { f = new Intl[type](lang, opts); fmtCache.set(key, f); }
    return f;
  }
  const fmt = {
    number: (n, o) => intl('NumberFormat', o).format(n),
    currency: (n, c = 'USD', o) => intl('NumberFormat', { style: 'currency', currency: c, ...o }).format(n),
    percent: (n, o) => intl('NumberFormat', { style: 'percent', ...o }).format(n),
    compact: (n) => intl('NumberFormat', { notation: 'compact' }).format(n),
    date: (d, o = { dateStyle: 'medium' }) => intl('DateTimeFormat', typeof o === 'string' ? { dateStyle: o } : o).format(new Date(d)),
    time: (d, o = { timeStyle: 'short' }) => intl('DateTimeFormat', o).format(new Date(d)),
    relative(d) {
      const diff = (new Date(d).getTime() - Date.now()) / 1000;
      const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
      for (const [u, s] of units) if (Math.abs(diff) >= s || u === 'second') return intl('RelativeTimeFormat', { numeric: 'auto' }).format(Math.round(diff / s), u);
    },
    list: (arr, o) => intl('ListFormat', o).format(arr),
  };
  markRaw(fmt);

  /* ──────────────────────────────────────────────────────────────────────
   * Theme (auto dark mode)
   * ──────────────────────────────────────────────────────────────────── */
  const mq = global.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const sys = reactive({ dark: !!(mq && mq.matches) });
  if (mq) mq.addEventListener('change', (e) => { sys.dark = e.matches; });
  const theme = reactive({
    mode: storage.get('comet:theme') || 'system',
    get dark() { return this.mode === 'dark' || (this.mode === 'system' && sys.dark); },
    get name() { return this.dark ? 'dark' : 'light'; },
    toggle() { this.mode = this.dark ? 'light' : 'dark'; },
    set(m) { this.mode = m; },
  });
  withCtx(null, () => effect(() => {
    const dark = theme.dark;
    html.classList.toggle('dark', dark);
    html.setAttribute('data-theme', dark ? 'dark' : 'light');
    const m = theme.mode;
    if (m === 'system') { try { localStorage.removeItem('comet:theme'); } catch (e) { /* noop */ } }
    else storage.set('comet:theme', m);
  }));

  /* ──────────────────────────────────────────────────────────────────────
   * Toasts
   * ──────────────────────────────────────────────────────────────────── */
  let toastBox = null;
  function toast(msg, opts = {}) {
    if (typeof opts === 'string') opts = { type: opts };
    if (!doc.body) return noop;
    if (!toastBox || !toastBox.isConnected) {
      toastBox = doc.createElement('div');
      toastBox.id = 'c-toasts';
      toastBox.setAttribute('role', 'status');
      toastBox.setAttribute('aria-live', 'polite');
      doc.body.appendChild(toastBox);
    }
    const el = doc.createElement('div');
    el.className = 'c-toast c-toast-' + (opts.type || 'info');
    el.textContent = msg;
    toastBox.appendChild(el);
    requestAnimationFrame(() => el.classList.add('c-in'));
    const close = () => { el.classList.remove('c-in'); setTimeout(() => el.remove(), 250); };
    el.addEventListener('click', close);
    setTimeout(close, opts.duration || 3200);
    return close;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Components — HTML files or <template c-component>, light DOM, slots
   * ──────────────────────────────────────────────────────────────────── */
  const components = new Map();

  function parseComponent(source) {
    const tpl = doc.createElement('template');
    if (typeof source === 'string') tpl.innerHTML = source;
    else tpl.innerHTML = source.innerHTML;
    const frag = tpl.content;
    let setup = null, style = '', props = null;
    for (const s of [...frag.children]) {
      if (s.tagName === 'SCRIPT') {
        const code = s.textContent.replace(/export\s+default\s+/, 'return ');
        try { setup = new Function('Comet', code)(Comet); } catch (e) { warn('Component script error', null, e); }
        s.remove();
      } else if (s.tagName === 'STYLE') {
        style += s.hasAttribute('scoped') ? '\u0000SCOPED' + s.textContent + '\u0000' : s.textContent;
        s.remove();
      }
    }
    const inner = frag.children.length === 1 && frag.firstElementChild.tagName === 'TEMPLATE' ? frag.firstElementChild : null;
    const markup = doc.createElement('template');
    if (inner) markup.content.appendChild(inner.content.cloneNode(true));
    else markup.content.appendChild(frag.cloneNode(true));
    if (isObj(setup) && setup.props) props = setup.props;
    return { tpl: markup, setup, style, props, ready: true };
  }

  function cloneData(obj) {
    const out = {};
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(obj))) {
      if ('value' in d && isObj(d.value)) { try { d.value = clone(d.value); } catch (e) { /* keep shared */ } }
      Object.defineProperty(out, k, d);
    }
    return out;
  }

  function registerInline(name, el) {
    if (components.has(name) && components.get(name).ready) return;
    const def = parseComponent(el);
    if (el.hasAttribute('c-props')) def.props = el.getAttribute('c-props').split(',').map((s) => s.trim()).filter(Boolean);
    components.set(name, def);
    injectStyle(name, def);
  }

  // Prefix every selector so it only matches the component root or its subtree.
  function scopeCss(css, name) {
    const sel = `[c-s="${name}"]`;
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let out = '', i = 0;
    while (i < css.length) {
      const open = css.indexOf('{', i);
      if (open < 0) { out += css.slice(i); break; }
      const prelude = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      const body = css.slice(open + 1, j - 1);
      if (/^@(media|supports|container|layer)/.test(prelude)) out += `${prelude}{${scopeCss(body, name).replace(/\[c-s="[^"]+"\]/g, sel)}}`;
      else if (prelude[0] === '@') out += `${prelude}{${body}}`;
      else out += prelude.split(/,(?![^(]*\))/).map((x) => {
        x = x.trim();
        const m = x.match(/^(.*?)(::?(?:before|after|placeholder|selection|marker|backdrop)\b.*)$/);
        const base = m ? m[1] || '*' : x, pseudo = m ? m[2] : '';
        if (base === ':root' || base === ':host' || base === ':scope') return sel + pseudo;
        return `${sel}:is(${base})${pseudo},${sel} :is(${base})${pseudo}`;
      }).join(',') + `{${body}}`;
      i = j;
    }
    return out;
  }

  function injectStyle(name, def) {
    if (!def.style || def.styled) return;
    const s = doc.createElement('style');
    s.setAttribute('data-c-component', name);
    s.textContent = def.style.replace(/\u0000SCOPED([\s\S]*?)\u0000/g, (_, css) => scopeCss(css, name));
    doc.head.appendChild(s);
    def.styled = true;
  }

  function component(name, def) {
    name = name.toLowerCase();
    if (typeof def === 'string' && !/^\s*</.test(def)) components.set(name, { url: def, ready: false });
    else if (typeof def === 'string' || (def && def.tagName === 'TEMPLATE')) { const d = parseComponent(def); components.set(name, d); injectStyle(name, d); }
    else if (isObj(def)) {
      const d = parseComponent(def.template || '');
      d.setup = def.setup || def.data || null;
      d.props = def.props || null;
      if (def.style) d.style = def.style;
      components.set(name, d);
      injectStyle(name, d);
    }
    return Comet;
  }

  function autoComponent(name) {
    if (components.has(name)) return true;
    components.set(name, { url: config.components.replace(/\/?$/, '/') + name + '.html', ready: false, auto: true });
    return true;
  }

  function loadComponent(name) {
    const def = components.get(name);
    if (def.ready) return Promise.resolve(def);
    if (!def.loading) {
      def.loading = fetchText(def.url).then((text) => {
        const d = parseComponent(text);
        Object.assign(def, d);
        injectStyle(name, def);
        return def;
      }).catch((e) => { def.failed = true; warn(`Component <${name}> could not be loaded from ${def.url}`, null, e); throw e; });
    }
    return def.loading;
  }

  function mountComponent(host, parentScope, next) {
    processed.add(host);
    const name = host.tagName.toLowerCase();
    const def = components.get(name);
    if (!def.ready) {
      if (def.failed) return next;
      const ctx = currentCtx;
      loadComponent(name).then(() => { if (host.isConnected || host.parentNode) { processed.delete(host); withCtx(ctx, () => walk(host, parentScope)); } }).catch(noop);
      return next;
    }
    const ctx = new Ctx(currentCtx);
    const props = reactive({});
    const declared = Array.isArray(def.props) ? def.props.map(camelize) : isObj(def.props) ? Object.keys(def.props) : null;
    if (isObj(def.props) && !Array.isArray(def.props)) for (const k in def.props) { const d = def.props[k]; props[k] = isObj(d) && 'default' in d ? d.default : isFn(d) ? undefined : d; }
    const fall = [], listeners = [], bindings = [];
    for (const a of [...host.attributes]) {
      const n = a.name;
      if (n[0] === '@' || n.startsWith('c-on:')) { listeners.push(a); continue; }
      if (n[0] === ':' || n.startsWith('c-bind:')) {
        const key = camelize(n.replace(/^(:|c-bind:)/, ''));
        if (!declared || declared.includes(key)) bindings.push([key, a.value]);
        else fall.push(a);
        continue;
      }
      const key = camelize(n);
      if (n.startsWith('c-')) { fall.push(a); continue; }
      if (declared ? declared.includes(key) : !/^(class|style|id|slot)$/.test(n) && !n.startsWith('data-') && !n.startsWith('aria-')) props[key] = a.value === '' ? true : a.value;
      else fall.push(a);
    }
    // slots, rendered with the parent's scope
    const slots = {};
    const children = [...host.childNodes];
    withCtx(ctx, () => {
      for (const c of children) {
        let sname = 'default', nodes = [c];
        if (c.nodeType === 1 && c.hasAttribute('slot')) {
          sname = c.getAttribute('slot');
          if (c.tagName === 'TEMPLATE') nodes = [...c.content.cloneNode(true).childNodes];
        } else if (c.nodeType === 3 && !c.data.trim()) continue;
        const frag = (slots[sname] = slots[sname] || doc.createDocumentFragment());
        for (const n of nodes) frag.appendChild(n);
      }
      for (const k in slots) { let c = slots[k].firstChild; while (c) c = walk(c, parentScope); }
      for (const [key, exp] of bindings) effect(() => { props[key] = evaluate(parentScope, exp, host); });
    });
    let rootEl = null;
    const scope = createScope(rootScope, {});
    const raw = toRaw(scope);
    for (const k of Object.keys(toRaw(props))) {
      Object.defineProperty(raw, k, { get: () => props[k], set: (v) => { props[k] = v; }, enumerable: true, configurable: true });
    }
    defineHidden(raw, '$props', props);
    defineHidden(raw, '$slots', Object.keys(slots).reduce((o, k) => { o[k] = true; return o; }, {}));
    defineHidden(raw, '$refs', {});
    let data = def.setup;
    if (isFn(data)) data = withCtx(ctx, () => data.call(scope, { props, emit: (n, d) => emit(rootEl || host, n, d), slots: raw.$slots }));
    else if (isObj(data)) data = cloneData(data);
    if (isObj(data)) {
      const descs = Object.getOwnPropertyDescriptors(data);
      delete descs.props;
      Object.defineProperties(raw, descs);
    }

    const frag = def.tpl.content.cloneNode(true);
    for (const s of frag.querySelectorAll('slot')) {
      const sn = s.getAttribute('name') || 'default';
      if (slots[sn]) s.replaceWith(slots[sn]);
      else { const f = doc.createDocumentFragment(); while (s.firstChild) f.appendChild(s.firstChild); s.replaceWith(f); }
    }
    const roots = [...frag.childNodes].filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.data.trim()));
    rootEl = roots.length === 1 && roots[0].nodeType === 1 ? roots[0] : null;
    let nodes;
    if (rootEl) {
      for (const a of fall) {
        if (a.name === 'class') rootEl.classList.add(...a.value.split(/\s+/).filter(Boolean));
        else if (a.name === 'style') rootEl.setAttribute('style', (rootEl.getAttribute('style') || '') + ';' + a.value);
        else if (a.name[0] !== ':' && !a.name.startsWith('c-')) rootEl.setAttribute(a.name, a.value);
      }
      if (def.style) rootEl.setAttribute('c-s', name);
      host.replaceWith(frag);
      nodes = [rootEl];
    } else {
      host.replaceChildren(frag);
      host.style.display = 'contents';
      if (def.style) host.setAttribute('c-s', name);
      for (const a of listeners) host.removeAttribute(a.name);
      rootEl = host;
      nodes = [...host.childNodes];
    }
    rootEl.__c_scope = scope;
    withCtx(ctx, () => {
      for (const a of listeners) {
        const p = parseName(a.name.startsWith('c-on:') ? a.name : a.name);
        directives.on({ el: rootEl, arg: p.arg, mods: p.mods, value: a.value, scope: parentScope });
      }
      for (const a of fall) {
        if (a.name[0] === ':' || a.name.startsWith('c-bind:')) { const p = parseName(a.name); directives.bind({ el: rootEl, arg: p.arg, mods: p.mods, value: a.value, scope: parentScope }); }
        else if (a.name.startsWith('c-')) {
          const p = parseName(a.name);
          const fn = directives[p.dir];
          if (fn && !SKIP_DIRS.has(p.dir)) fn({ el: rootEl, value: a.value, arg: p.arg, mods: p.mods, scope: parentScope, name: a.name, evaluate: () => evaluate(parentScope, a.value, rootEl), effect, cleanup: onCleanup });
        }
      }
      if (rootEl === host) processed.add(host);
      for (const n of nodes) walk(n, scope);
      if (isFn(raw.init)) { try { scope.init(); } catch (e) { warn(`<${name}> init() failed`, rootEl, e); } }
      if (isFn(raw.destroy)) onCleanup(() => scope.destroy());
    });
    devdata.scopes.push({ el: rootEl, scope, component: name });
    return next;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Devtools — in-page inspector (Alt+Shift+D, ?comet-devtools)
   * ──────────────────────────────────────────────────────────────────── */
  const devtools = {
    host: null, root: null, tab: 'state', timer: null,
    get open() { return devState.open; },
    toggle(force) {
      devState.open = force != null ? force : !devState.open;
      if (devState.open) this.mount(); else if (this.host) { this.host.remove(); this.host = null; clearInterval(this.timer); }
    },
    mount() {
      if (this.host) return;
      this.host = doc.createElement('comet-devtools');
      this.host.setAttribute('c-ignore', '');
      const sh = this.host.attachShadow({ mode: 'open' });
      sh.innerHTML = `<style>
        :host{all:initial;position:fixed;z-index:2147483646;right:16px;bottom:16px;width:min(440px,calc(100vw - 32px));height:min(520px,70vh);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e6e6f0}
        .w{display:flex;flex-direction:column;height:100%;background:rgba(14,12,26,.92);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.45);overflow:hidden}
        header{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)}
        b{font:600 12px system-ui;background:linear-gradient(90deg,#a78bfa,#22d3ee);-webkit-background-clip:text;color:transparent;margin-right:auto}
        button{all:unset;cursor:pointer;padding:3px 8px;border-radius:7px;color:#b8b8cc}button:hover{background:rgba(255,255,255,.08)}button.on{background:rgba(167,139,250,.2);color:#fff}
        main{flex:1;overflow:auto;padding:8px 10px}
        .row{padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06)}.k{color:#a78bfa}.m{color:#7d7d96}.ok{color:#34d399}.bad{color:#f87171}
        pre{margin:4px 0 0;white-space:pre-wrap;word-break:break-word;color:#cfd3ff}
        .stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}.stat{background:rgba(255,255,255,.04);border-radius:10px;padding:10px}.stat i{display:block;font-style:normal;font-size:20px;color:#fff}
      </style><div class="w"><header><b>☄ Comet devtools</b>${['state', 'network', 'router', 'perf', 'errors'].map((t) => `<button data-t="${t}">${t}</button>`).join('')}<button data-x>✕</button></header><main></main></div>`;
      this.root = sh;
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-x')) return this.toggle(false);
        this.tab = b.dataset.t; devState.dirty = true; this.render();
      });
      sh.addEventListener('mouseover', (e) => {
        const r = e.target.closest('[data-i]');
        const s = r && devdata.scopes[+r.dataset.i];
        if (s && s.el.isConnected) { s.el.style.outline = '2px solid #a78bfa'; setTimeout(() => { s.el.style.outline = ''; }, 900); }
      });
      doc.body.appendChild(this.host);
      this.timer = setInterval(() => this.render(), 700);
      this.render(true);
    },
    render(force) {
      if (!this.root || (!force && !devState.dirty && this.tab !== 'state' && this.tab !== 'perf')) return;
      devState.dirty = false;
      for (const b of this.root.querySelectorAll('button[data-t]')) b.classList.toggle('on', b.dataset.t === this.tab);
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const main = this.root.querySelector('main');
      let h = '';
      if (this.tab === 'state') {
        const st = toRaw(stores);
        if (Object.keys(st).length) h += `<div class="row"><span class="k">$store</span><pre>${esc(safeJSON(st, 2))}</pre></div>`;
        devdata.scopes.forEach((s, i) => {
          if (!s.el.isConnected) return;
          const own = {};
          const raw = toRaw(s.scope);
          for (const k of Object.keys(raw)) { const d = Object.getOwnPropertyDescriptor(raw, k); if (!isFn(d.value)) own[k] = d.get ? '(getter)' : d.value; }
          const label = s.component ? `&lt;${s.component}&gt;` : `&lt;${s.el.tagName.toLowerCase()}${s.el.id ? '#' + s.el.id : ''}&gt; c-data`;
          h += `<div class="row" data-i="${i}"><span class="k">${label}</span><pre>${esc(safeJSON(own, 2))}</pre></div>`;
        });
        if (!h) h = '<p class="m">No reactive scopes on this page.</p>';
      } else if (this.tab === 'network') {
        h = devdata.net.slice().reverse().map((n) => `<div class="row"><span class="${n.status >= 200 && n.status < 400 ? 'ok' : 'bad'}">${n.status || 'ERR'}</span> <span class="k">${n.method}</span> ${esc(n.url)} <span class="m">${n.ms}ms${n.mock ? ' · mock' : ''}</span></div>`).join('') || '<p class="m">No requests yet.</p>';
      } else if (this.tab === 'router') {
        h = `<div class="row"><span class="k">$route</span><pre>${esc(safeJSON(toRaw(router.route), 2))}</pre></div>` + devdata.nav.slice().reverse().map((n) => `<div class="row">${n.status === 200 ? '<span class="ok">200</span>' : '<span class="bad">' + n.status + '</span>'} ${esc(n.path)} <span class="m">${new Date(n.time).toLocaleTimeString()}</span></div>`).join('');
      } else if (this.tab === 'perf') {
        h = `<div class="stats"><div class="stat">startup<i>${stats.startMs.toFixed(1)}ms</i></div><div class="stat">first mount<i>${stats.mountMs.toFixed(1)}ms</i></div><div class="stat">active effects<i>${stats.effects}</i></div><div class="stat">effect runs<i>${stats.runs}</i></div><div class="stat">DOM nodes<i>${doc.getElementsByTagName('*').length}</i></div><div class="stat">version<i>${VERSION}</i></div></div>`;
      } else {
        h = devdata.errors.slice().reverse().map((e) => `<div class="row"><span class="bad">${esc(e.msg)}</span><pre>${esc(e.err)}</pre></div>`).join('') || '<p class="ok">No errors. ✨</p>';
      }
      main.innerHTML = h;
    },
  };

  /* ──────────────────────────────────────────────────────────────────────
   * MutationObserver — vanilla JS can inject HTML with c-* and it works
   * ──────────────────────────────────────────────────────────────────── */
  function observe() {
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1 || processed.has(n) || !n.isConnected || n.tagName === 'COMET-DEVTOOLS') continue;
          if (n.closest('[c-ignore],[c-pre],[c-lazy]')) continue;
          if (!hasDirectives(n)) { continue; }
          n.__c_ctx = mount(n, findScope(n.parentElement));
        }
        for (const n of r.removedNodes) if (n.__c_ctx && !n.isConnected) { n.__c_ctx.destroy(); n.__c_ctx = null; }
      }
    });
    mo.observe(doc.body, { childList: true, subtree: true });
  }
  function hasDirectives(el) {
    const w = doc.createTreeWalker(el, 5);
    let n = el;
    do {
      if (n.nodeType === 3) { if (n.data.indexOf('{{') > -1) return true; continue; }
      for (const a of n.attributes) { const c = a.name[0]; if (c === '@' || c === ':' || a.name.startsWith('c-') || a.value.indexOf('{{') > -1) return true; }
      if (n.tagName.indexOf('-') > 0 && components.has(n.tagName.toLowerCase())) return true;
    } while ((n = w.nextNode()));
    return false;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Built-in CSS (injected once, tiny)
   * ──────────────────────────────────────────────────────────────────── */
  const CSS = `[c-cloak]{display:none!important}
#c-progress{position:fixed;top:0;left:0;right:0;height:2px;z-index:2147483647;background:var(--c-progress,linear-gradient(90deg,#8b5cf6,#22d3ee));transform-origin:0 50%;transform:scaleX(0);opacity:0;pointer-events:none;transition:transform 2s cubic-bezier(.1,.6,.2,1),opacity .25s}
#c-progress.c-on{opacity:1}
:where(.c-js [c-reveal]:not(.c-revealed)),:where(.c-js [c-stagger]:not(.c-revealed)>*){opacity:0;transform:var(--c-from,translateY(24px));filter:var(--c-blur,none)}
[c-reveal^="down"]{--c-from:translateY(-24px)}[c-reveal^="left"]{--c-from:translateX(32px)}[c-reveal^="right"]{--c-from:translateX(-32px)}
[c-reveal^="fade"]{--c-from:none}[c-reveal^="zoom"]{--c-from:scale(.94)}[c-reveal^="blur"]{--c-from:translateY(12px);--c-blur:blur(10px)}
.c-fade-enter-active,.c-fade-leave-active,.c-slide-up-enter-active,.c-slide-up-leave-active,.c-slide-down-enter-active,.c-slide-down-leave-active,.c-scale-enter-active,.c-scale-leave-active,.c-blur-enter-active,.c-blur-leave-active{transition:opacity .22s ease,transform .22s cubic-bezier(.2,.7,.2,1),filter .22s ease}
.c-fade-enter-from,.c-fade-leave-to{opacity:0}
.c-slide-up-enter-from,.c-slide-up-leave-to{opacity:0;transform:translateY(10px)}
.c-slide-down-enter-from,.c-slide-down-leave-to{opacity:0;transform:translateY(-10px)}
.c-scale-enter-from,.c-scale-leave-to{opacity:0;transform:scale(.95)}
.c-blur-enter-from,.c-blur-leave-to{opacity:0;filter:blur(8px)}
#c-toasts{position:fixed;z-index:2147483645;bottom:16px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.c-toast{pointer-events:auto;cursor:pointer;font:500 14px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:12px;color:var(--c-toast-fg,#fff);background:var(--c-toast-bg,rgba(20,18,32,.92));backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;transform:translateY(8px) scale(.98);transition:all .25s cubic-bezier(.2,.7,.2,1)}
.c-toast.c-in{opacity:1;transform:none}.c-toast-success{border-color:rgba(52,211,153,.5)}.c-toast-error{border-color:rgba(248,113,113,.6)}
@media (prefers-reduced-motion:reduce){.c-js [c-reveal],.c-js [c-stagger]>*{transition:none!important;opacity:1!important;transform:none!important;filter:none!important}}`;

  function injectCSS() {
    const s = doc.createElement('style');
    s.id = 'comet-css';
    s.textContent = CSS;
    (doc.head || html).appendChild(s);
    (doc.head || html).appendChild(langStyle);
    html.classList.add('c-js');
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Root magics
   * ──────────────────────────────────────────────────────────────────── */
  function magic(name, getter) {
    Object.defineProperty(ROOT, '$' + name.replace(/^\$/, ''), { get: getter, configurable: true, enumerable: false });
  }
  magic('store', () => stores);
  magic('route', () => router.route);
  magic('db', () => db);
  magic('fetch', () => cfetch);
  magic('nav', () => navigate);
  magic('back', () => () => history.back());
  magic('t', () => t);
  magic('fmt', () => fmt);
  magic('theme', () => theme);
  magic('toast', () => toast);
  magic('nextTick', () => nextTick);
  magic('Comet', () => Comet);
  Object.defineProperty(ROOT, '$lang', { get: () => i18n.state.lang, set: (v) => { setLang(v); }, enumerable: false, configurable: true });
  defineHidden(ROOT, '$watch', function (exp, cb, opts) {
    const scope = this || rootScope;
    const getter = isFn(exp) ? () => exp.call(scope) : () => evaluate(scope, exp, null);
    return withCtx(currentCtx, () => watch(getter, cb.bind(scope), opts)).stop;
  });

  /* ──────────────────────────────────────────────────────────────────────
   * Config, start, public API
   * ──────────────────────────────────────────────────────────────────── */
  const config = { base: null, title: null, prefetch: true, transitions: true, observe: true, components: null };
  const ready = [];
  const rootCtx = new Ctx(null);
  let started = false;

  async function start() {
    if (started) return;
    started = true;
    const t0 = performance.now();
    emit(doc, 'comet:init', { Comet });
    for (const tpl of doc.querySelectorAll('template[c-component]')) registerInline(tpl.getAttribute('c-component'), tpl);
    await Promise.all(ready.splice(0));
    router.base = computeBase();
    const roots = doc.querySelectorAll('[c-app]');
    const m0 = performance.now();
    withCtx(rootCtx, () => { for (const r of roots.length ? roots : [doc.body]) walk(r, rootScope); });
    stats.mountMs = performance.now() - m0;
    if (config.observe !== false) observe();
    const rp = startRouter();
    if (rp) await rp;
    stats.startMs = performance.now() - t0;
    html.classList.add('c-ready');
    emit(doc, 'comet:ready', { Comet, stats: { ...stats } });
    const q = new URLSearchParams(location.search);
    if (q.has('comet-devtools') || (script && script.hasAttribute('data-devtools'))) devtools.toggle(true);
  }

  doc.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); devtools.toggle(); }
  });

  const Comet = {
    version: VERSION,
    start, mount, config(o) { Object.assign(config, o); if (o && o.http) Object.assign(http, o.http); return Comet; },
    reactive, effect: (fn) => withCtx(currentCtx, () => effect(fn)), watch, computed, nextTick, raw: markRaw, toRaw,
    store, stores,
    data(name, factory) { defineHidden(ROOT, name, factory); return Comet; },
    directive(name, fn) { directives[name] = fn; return Comet; },
    magic(name, getter) { magic(name, getter); return Comet; },
    component,
    plugin(fn) { fn(Comet); return Comet; },
    fetch: cfetch, request,
    http: {
      get base() { return http.base; }, set base(v) { http.base = v; },
      headers: http.headers,
      before(fn) { http.before.push(fn); return Comet; },
      after(fn) { http.after.push(fn); return Comet; },
      clearCache() { http.cache.clear(); },
    },
    mock, db,
    i18n: configureI18n, t, fmt,
    get lang() { return i18n.state.lang; }, set lang(v) { setLang(v); },
    setLang,
    theme,
    router: {
      route: router.route,
      before(fn) { router.guards.push(fn); return Comet; },
      after(fn) { router.afters.push(fn); return Comet; },
      routes(map) { addRoutes(map); return Comet; },
      navigate, back: () => history.back(),
      prefetch(path) { const m = matchRoute(path); return loadPage(m.files).catch(noop); },
    },
    routes(map) { addRoutes(map); return Comet; },
    navigate,
    toast,
    devtools: (on) => devtools.toggle(on),
    ready(fn) { if (started) fn(Comet); else doc.addEventListener('comet:ready', () => fn(Comet), { once: true }); return Comet; },
    stats,
    scope: findScope,
    evaluate: (el, exp) => evaluate(findScope(el), exp, el),
  };

  injectCSS();
  global.Comet = Comet;
  if (!(script && script.hasAttribute('data-manual'))) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
    else setTimeout(start);
  }
})(window);
