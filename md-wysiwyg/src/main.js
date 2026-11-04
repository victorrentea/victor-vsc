import { Editor, Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import DOMPurify from 'dompurify';
import { SourceDoc, splitFrontmatter, toLf } from './fidelity.js';
import { codeInnermost, extensions, patchSerializer } from './schema.js';
import { attachToolbar, openLinkPopover, openMathPopover } from './toolbar.js';

const host = window.acquireVsCodeApi();
const boot = JSON.parse(document.getElementById('mdw-boot').textContent);
const root = document.getElementById('mdw-editor');
const frontmatterBox = document.getElementById('mdw-frontmatter');

const FLUSH_MS = 100;           // ca în Cursor: `debounceMs: 100`

/* ---------------------------------------------------------- încărcare leneșă */

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.nonce = boot.nonce;
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    }));
  }
  return loaded.get(src);
}

function renderError(target, error) {
  const pre = document.createElement('pre');
  pre.className = 'mdw-render-error';
  pre.textContent = String(error?.message || error);
  target.replaceChildren(pre);
}

async function renderKatex(target, latex, displayMode) {
  try {
    await loadScript(boot.assets.katex);
    window.katex.render(latex, target, { displayMode, throwOnError: true });
  } catch (error) {
    if (displayMode) renderError(target, error);
    else target.textContent = `$${latex}$`;
  }
}

const isDark = () => !document.body.classList.contains('vscode-light')
  && !document.body.classList.contains('vscode-high-contrast-light');

let mermaidId = 0;
async function renderMermaid(target, source) {
  try {
    await loadScript(boot.assets.mermaid);
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default' });
    const { svg } = await window.mermaid.render(`mdw-mermaid-${++mermaidId}`, source);
    target.innerHTML = svg;
  } catch (error) {
    renderError(target, error);
  }
}

function resolveUrl(src) {
  if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) return src;
  const base = src.startsWith('/') ? boot.rootUri : boot.baseUri;
  try {
    return new URL(src.replace(/^\//, ''), base).href;
  } catch (_) {
    return src;
  }
}

function renderHtml(target, raw) {
  target.innerHTML = DOMPurify.sanitize(raw, { FORBID_TAGS: ['style', 'form', 'input'] });
  for (const img of target.querySelectorAll('img')) img.src = resolveUrl(img.getAttribute('src'));
}

window.__mdw = {
  resolveUrl,
  renderMath: renderKatex,
  renderPreview(target, kind, source) {
    if (kind === 'mermaid') return renderMermaid(target, source);
    if (kind === 'math') return renderKatex(target, source, true);
    return renderHtml(target, source);
  },
};

/* ------------------------------------------------------------------ editor */

let frontmatter = '';
let doc;                        // SourceDoc: legătura document ↔ sursă
let lastSent;                   // textul pe care extensia îl știe de la noi
let applying = false;           // o schimbare care vine din afară nu se trimite înapoi
let flushTimer;

const isBlankParagraph = node => node.type.name === 'paragraph' && node.childCount === 0;

/** Decorațiile `data-line`: ce arată preview-ul vechi la hover, același număr de linie. */
function lineDecorations(state) {
  if (!doc) return DecorationSet.empty;
  const offset = frontmatter.split('\n').length - 1;
  const decorations = [];
  const lines = doc.lines();
  let pos = 0;
  doc.chunks.forEach((chunk, index) => {
    const line = lines[index] + offset;
    let item = 0;
    const rawLines = chunk.raw.split('\n');
    const itemLines = [];
    rawLines.forEach((text, i) => { if (/^\s*(?:[-*+]|\d{1,9}[.)])\s/.test(text)) itemLines.push(line + i); });
    for (const node of chunk.nodes || []) {
      if (!isBlankParagraph(node)) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-line': line + 1 }));
      }
      if (node.type.name === 'bulletList' || node.type.name === 'orderedList' || node.type.name === 'taskList') {
        node.descendants((child, childPos) => {
          if (child.type.name !== 'listItem' && child.type.name !== 'taskItem') return true;
          if (item < itemLines.length) {
            const from = pos + 1 + childPos;
            decorations.push(Decoration.node(from, from + child.nodeSize, { 'data-line': itemLines[item] + 1 }));
          }
          item++;
          return true;
        });
      }
      pos += node.nodeSize;
    }
  });
  return DecorationSet.create(state.doc, decorations);
}

/**
 * Cursorul într-un bloc cu randare ⇒ îi arătăm sursa. Decorație pe nod, nu stare în node view:
 * selecția poate intra în bloc pe orice cale (săgeți, click, undo), iar decorația le prinde pe toate.
 */
function editingDecorations(state) {
  const { $from } = state.selection;
  const decorations = [];
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.spec.code) {
      decorations.push(Decoration.node($from.before(depth), $from.after(depth), { class: 'mdw-source--editing' }));
      break;
    }
  }
  return DecorationSet.create(state.doc, decorations);
}

const linesKey = new PluginKey('mdwLines');

const Source = Extension.create({
  name: 'mdwSource',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: linesKey,
      state: {
        init: () => DecorationSet.empty,
        // Între două salvări numerele doar se mută odată cu textul; se recalculează când sursa e știută.
        apply: (tr, set, _old, state) => (tr.getMeta(linesKey) ? lineDecorations(state) : set.map(tr.mapping, tr.doc)),
      },
      props: {
        decorations(state) {
          return linesKey.getState(state).add(state.doc, editingDecorations(state).find());
        },
      },
    })];
  },
});

const refreshLines = () => editor.view.dispatch(editor.state.tr.setMeta(linesKey, true).setMeta('addToHistory', false));

function looksLikeMarkdown(text) {
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|\|.*\|)|\*\*|__|\[[^\]]+\]\(|`[^`]+`/.test(text);
}

const editor = new Editor({
  element: root,
  extensions: [...extensions(), Source],
  editable: !boot.readOnly,
  editorProps: {
    attributes: { spellcheck: 'false', class: 'mdw-content' },
    handleClick(view, pos, event) { return onClick(view, pos, event); },
    // ⌘C dă Markdown-ul, nu textul decupat de formatare: e ce vrei într-un prompt sau în alt `.md`.
    clipboardTextSerializer: slice => {
      const content = [];
      slice.content.forEach(node => content.push(node.toJSON()));
      return toMarkdown(content).replace(/\s+$/, '');
    },
    clipboardTextParser(text, context, plain) {
      if (plain || !looksLikeMarkdown(text)) return null;
      const json = editor.markdown.parse(toLf(text));
      const nodes = (json.content || []).map(node => editor.schema.nodeFromJSON(node));
      if (!nodes.length) return null;
      const open = nodes.length === 1 && nodes[0].isTextblock ? 1 : 0;
      return new Slice(Fragment.from(nodes), open, open);
    },
  },
  onUpdate({ transaction }) {
    if (applying || !transaction.docChanged) return;
    scheduleFlush();
  },
});

patchSerializer(editor.markdown);

const toMarkdown = content => editor.markdown.serialize(codeInnermost({ type: 'doc', content }));
const serializeNode = node => toMarkdown([node.toJSON()]).replace(/^\n+/, '');

function currentText() {
  return frontmatter + doc.sync(editor.state.doc);
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (boot.readOnly) return;
  const text = currentText();
  if (text === lastSent) return;
  lastSent = text;
  refreshLines();
  host.postMessage({ type: 'edit', text });
}

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, FLUSH_MS);
}

function showFrontmatter() {
  frontmatterBox.hidden = !frontmatter;
  if (document.activeElement === frontmatterBox) return;
  frontmatterBox.value = frontmatter.replace(/\n$/, '');
  frontmatterBox.style.height = 'auto';
  frontmatterBox.style.height = `${frontmatterBox.scrollHeight + 2}px`;
}

frontmatterBox.addEventListener('input', () => {
  frontmatter = `${frontmatterBox.value}\n`;
  frontmatterBox.style.height = 'auto';
  frontmatterBox.style.height = `${frontmatterBox.scrollHeight + 2}px`;
  scheduleFlush();
});

function load(text) {
  const parts = splitFrontmatter(toLf(text));
  frontmatter = parts.frontmatter;
  doc = new SourceDoc(editor.markdown, serializeNode);
  const json = doc.load(parts.body);
  applying = true;
  // Încărcarea nu trebuie să fie un pas de undo: ⌘Z ar goli fișierul.
  const nodes = json.content.map(node => editor.schema.nodeFromJSON(node));
  const { state } = editor;
  const tr = state.tr.setMeta('addToHistory', false).setMeta('preventUpdate', true);
  if (nodes.length) tr.replaceWith(0, state.doc.content.size, nodes);
  else tr.delete(0, state.doc.content.size);
  editor.view.dispatch(tr);
  doc.bind(editor.state.doc);
  applying = false;
  lastSent = frontmatter + parts.body;
  refreshLines();
  showFrontmatter();
}

/** Fișierul s-a schimbat în afara editorului: doar porțiunea diferită, fără să sară cursorul. */
function rebase(text) {
  const parts = splitFrontmatter(toLf(text));
  if (frontmatter + parts.body === lastSent) return;
  clearTimeout(flushTimer);
  flushTimer = undefined;
  frontmatter = parts.frontmatter;
  const { from, to, json } = doc.rebase(parts.body);
  const state = editor.state;
  const posAt = index => { let pos = 0; for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize; return pos; };
  const nodes = json.map(node => editor.schema.nodeFromJSON(node));
  applying = true;
  const tr = state.tr.replaceWith(posAt(from), posAt(to), nodes).setMeta('addToHistory', false);
  editor.view.dispatch(tr);
  doc.bind(editor.state.doc);
  applying = false;
  lastSent = frontmatter + parts.body;
  refreshLines();
  showFrontmatter();
}

/* ------------------------------------------------------------------- click */

function headingSlug(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
}

function scrollToAnchor(anchor) {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === 'heading' && headingSlug(node.textContent) === anchor) found = pos;
    return true;
  });
  if (found === null) return false;
  const dom = editor.view.nodeDOM(found);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start' });
  return true;
}

export function openHref(href) {
  if (href.startsWith('#')) scrollToAnchor(decodeURIComponent(href.slice(1)));
  else host.postMessage({ type: 'open', href });
}

function onClick(view, pos, event) {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (link) {
    event.preventDefault();
    const href = link.getAttribute('href');
    if (event.metaKey || event.ctrlKey) openHref(href);
    else openLinkPopover(editor, openHref);
    return true;
  }
  const math = event.target instanceof Element ? event.target.closest('.math-inline') : null;
  if (math && editor.isEditable) {
    openMathPopover(editor, view.posAtDOM(math, 0));
    return true;
  }
  return false;
}

/* --------------------------------------------------- tastatură, zoom, hover */

/**
 * Webview-ul trimite fiecare tastă și la VS Code. Combinațiile de mai jos sunt ale editorului:
 * ⌘B ar închide și sidebar-ul, iar ⌘Z ar ajunge la un `execCommand` care nu știe de ProseMirror.
 * Asta se oprește pe `document`: PM (mai jos în arbore) a văzut deja tasta, iar ascultătorul
 * VS Code stă pe `window`, deci nu mai ajunge la el.
 */
const OURS = new Set(['b', 'i', 'k', 'e', 'z', 'y']);
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || !root.contains(event.target)) return;
  const key = event.key.toLowerCase();
  const withShift = event.shiftKey && ['7', '8', '9', 'x', 'b', 'h', 'z', '&', '*', '('].includes(key);
  const withAlt = event.altKey && /^[0-6]$/.test(key);
  if (OURS.has(key) || withShift || withAlt) {
    if (key === 'z' || key === 'y') event.preventDefault();
    event.stopPropagation();
  }
  if (key === 'k' && !event.shiftKey) {
    event.preventDefault();
    openLinkPopover(editor, openHref, { focusInput: true });
  }
});

// Salvarea și ieșirea nu trebuie să prindă textul în fereastra de debounce.
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') flush();
}, true);
window.addEventListener('blur', () => { if (flushTimer) flush(); });
window.addEventListener('pagehide', () => { if (flushTimer) flush(); });

const MIN_ZOOM = 8, MAX_ZOOM = 40;
function applyZoom(px) {
  if (px) document.body.style.setProperty('--mdw-zoom', `${px}px`);
}
window.addEventListener('wheel', event => {
  if (!event.metaKey) return;
  event.preventDefault();
  event.stopPropagation();
  const current = parseFloat(getComputedStyle(root).fontSize) || 14;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + (event.deltaY < 0 ? 1 : -1)));
  applyZoom(next);
  host.postMessage({ type: 'zoom', px: next });
}, { passive: false, capture: true });

const badge = document.createElement('div');
badge.className = 'mdw-line-badge';
document.body.append(badge);
document.addEventListener('mousemove', event => {
  const el = event.target instanceof Element ? event.target.closest('[data-line]') : null;
  badge.hidden = !el;
  if (!el) return;
  badge.textContent = el.getAttribute('data-line');
  badge.style.top = `${el.getBoundingClientRect().top}px`;
});
document.addEventListener('mouseleave', () => { badge.hidden = true; });

/* ---------------------------------------------------------------- mesaje */

function topLine() {
  const blocks = root.querySelectorAll('[data-line]');
  for (const block of blocks) {
    if (block.getBoundingClientRect().bottom > 0) return Number(block.getAttribute('data-line')) - 1;
  }
  return 0;
}

function revealLine(line) {
  let target = null;
  for (const block of root.querySelectorAll('[data-line]')) {
    if (Number(block.getAttribute('data-line')) - 1 > line) break;
    target = block;
  }
  if (target) target.scrollIntoView({ block: 'start' });
}

window.addEventListener('message', ({ data }) => {
  switch (data.type) {
    case 'load': load(data.text); applyZoom(data.zoom); if (data.line) requestAnimationFrame(() => revealLine(data.line)); break;
    case 'external': rebase(data.text); break;
    case 'zoom': applyZoom(data.px); break;
    case 'flush': flush(); host.postMessage({ type: 'flushed', id: data.id }); break;
    case 'reveal': revealLine(data.line); break;
    case 'topLine': host.postMessage({ type: 'topLine', id: data.id, line: topLine() }); break;
  }
});

attachToolbar(editor, openHref);
window.__mdwTest = { editor, flush, toMarkdown, get text() { return currentText(); }, get doc() { return doc; } };
host.postMessage({ type: 'ready' });
