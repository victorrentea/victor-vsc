/**
 * Fidelitatea față de sursă: ce-a rămas neatins rămâne octet cu octet.
 *
 * Cursor reconstruiește tot fișierul din document la fiecare modificare și repară pe bucăți
 * ce se pierde (markerul de listă, `__` vs `**`, `***` vs `---`). Un singur cuvânt schimbat
 * îți poate rescrie tot fișierul în diff. Aici documentul se ține ca o listă de „bucăți”:
 * o bucată = sursa unui bloc de pe nivelul de sus (cu spațiile de după el) + nodurile
 * ProseMirror în care s-a parsat. La salvare, doar blocurile care nu mai sunt identice cu
 * nodurile lor se serializează; restul își pun sursa înapoi neschimbată.
 *
 * ProseMirror refolosește obiectele nodurilor neatinse, deci `eq` e O(1) pentru ele.
 */

const blank = raw => /^\s*$/.test(raw);

/** Tokenii de nivel de sus, sau null dacă lexerul a pierdut text din sursă. */
export function lexTopLevel(manager, source) {
  const lexer = manager.createLexer();
  manager.activeParseLexer = lexer;
  const tokens = lexer.lex(source);
  return { tokens, lexer, intact: tokens.map(t => t.raw).join('') === source };
}

/** Cele două feluri de blocuri pe care Markdown-ul le are, dar ProseMirror nu. */
function rawNode(token) {
  return {
    type: 'rawBlock',
    attrs: { kind: token.type },
    content: [{ type: 'text', text: token.raw.replace(/\s+$/, '') }],
  };
}

/** Nodurile unui token. Nu pierde niciodată un token: ce nu se înțelege devine bloc brut. */
function nodesOf(manager, token) {
  if (token.type === 'html' || token.type === 'def') return [rawNode(token)];
  const nodes = manager.parseTokens([token]).filter(Boolean);
  return nodes.length ? nodes : [rawNode(token)];
}

/**
 * Sursa → bucăți. `lead` e ce stă înaintea primului bloc (rânduri goale), iar `tail` sunt
 * spațiile de la capătul fișierului, ca editarea ultimului bloc să nu le schimbe.
 */
export function toChunks(manager, source) {
  const { tokens, intact } = lexTopLevel(manager, source);
  const tail = /\s*$/.exec(source)[0];
  try {
    if (!intact) throw new Error('lexer lost text');
    const chunks = [];
    let lead = '';
    for (const token of tokens) {
      if (blank(token.raw)) {
        if (chunks.length) chunks[chunks.length - 1].raw += token.raw;
        else lead += token.raw;
        continue;
      }
      chunks.push({ raw: token.raw, json: nodesOf(manager, token), token });
    }
    return { lead, chunks, tail };
  } catch (_) {
    // Plasa de siguranță: o singură bucată, deci prima editare serializează tot.
    const doc = manager.parse(source);
    return { lead: '', chunks: [{ raw: source, json: doc.content || [], token: null }], tail };
  } finally {
    manager.activeParseLexer = null;
  }
}

/**
 * Leagă bucățile de nodurile reale din document, după ce PM a construit documentul.
 * PM mai adaugă la coadă un paragraf gol, ca să ai unde pune cursorul după un tabel; în fișier
 * n-are sursă, deci devine o bucată vidă.
 */
export function bind(chunks, doc) {
  const total = chunks.reduce((n, c) => n + c.json.length, 0);
  if (total > doc.childCount) return false;
  for (let i = total; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type.name !== 'paragraph' || node.childCount) return false;
    chunks.push({ raw: '', json: [node.toJSON()], token: null });
  }
  let at = 0;
  for (const chunk of chunks) {
    chunk.nodes = [];
    for (let i = 0; i < chunk.json.length; i++) chunk.nodes.push(doc.child(at++));
  }
  return true;
}

const matchesAt = (chunk, doc, at) =>
  at + chunk.nodes.length <= doc.childCount && chunk.nodes.every((n, i) => n.eq(doc.child(at + i)));

const keyOf = node => JSON.stringify(node.toJSON());

const isBlankParagraph = node => node.type.name === 'paragraph' && node.childCount === 0;

/**
 * Cât din capete a rămas la fel. Sufixul se oprește unde începe prefixul, ca nodurile
 * identice (două rânduri goale la rând, de exemplu) să nu fie numărate de două ori.
 */
function stableEnds(chunks, doc) {
  let head = 0, at = 0;
  while (head < chunks.length && matchesAt(chunks[head], doc, at)) {
    at += chunks[head].nodes.length;
    head++;
  }
  let tail = 0, end = doc.childCount;
  while (tail < chunks.length - head) {
    const chunk = chunks[chunks.length - 1 - tail];
    const start = end - chunk.nodes.length;
    if (start < at || !matchesAt(chunk, doc, start)) break;
    end = start;
    tail++;
  }
  return { head, tail, from: at, to: end };
}

/** Între două blocuri unde ceva s-a schimbat trebuie rând gol, altfel paragrafele se lipesc. */
function endWithBlankLine(text) {
  if (!text || text.endsWith('\n\n')) return text;
  return text.endsWith('\n') ? `${text}\n` : `${text}\n\n`;
}

/**
 * Starea documentului și reconstrucția sursei din el.
 *
 * `serializeNode(node)` întoarce Markdown-ul unui singur nod, fără spații la capete.
 */
export class SourceDoc {
  constructor(manager, serializeNode) {
    this.manager = manager;
    this.serializeNode = serializeNode;
    this.lead = '';
    this.tail = '';
    this.chunks = [];
    this.body = '';
    this.known = new Map();     // nod → sursa lui originală: vezi `remember`
  }

  /**
   * Un bloc poate reveni la forma de la încărcare: undo, sau tăiat și lipit în altă parte. Atunci
   * nu mai e același obiect, dar e același conținut, deci își ia înapoi sursa exactă. Fără asta,
   * ⌘Z ar lăsa fișierul diferit de cum l-ai găsit.
   */
  remember() {
    for (const chunk of this.chunks) {
      if (chunk.nodes?.length === 1) this.known.set(keyOf(chunk.nodes[0]), chunk.raw);
    }
  }

  /** Întoarce conținutul JSON pentru editor. */
  load(body) {
    Object.assign(this, toChunks(this.manager, body));
    this.body = body;
    return { type: 'doc', content: this.chunks.flatMap(c => c.json) };
  }

  bind(doc) {
    if (bind(this.chunks, doc)) { this.remember(); return; }
    // PM a completat documentul (gol, de exemplu): nu se poate lega, deci prima editare
    // serializează tot. Pierdem doar forma, nu și textul.
    this.chunks = [{ raw: this.body, json: [], nodes: [...Array(doc.childCount).keys()].map(i => doc.child(i)) }];
    this.lead = '';
  }

  /** Sursa corespunzătoare documentului curent; actualizează bucățile. */
  sync(doc) {
    const { head, tail, from, to } = stableEnds(this.chunks, doc);
    if (head + tail === this.chunks.length && from === to) return this.body;

    const middle = [];
    for (let i = from; i < to; i++) {
      const node = doc.child(i);
      // Rândul gol pe care îl lași scriind are loc în editor, dar nu și în fișier (`&nbsp;`).
      const known = this.known.get(keyOf(node));
      const text = isBlankParagraph(node) ? '' : this.serializeNode(node).replace(/\s+$/, '');
      middle.push({ raw: known ?? (text && `${text}\n\n`), nodes: [node], json: [] });
    }

    const before = this.chunks.slice(0, head);
    const after = tail ? this.chunks.slice(-tail) : [];
    if (before.length) {
      const last = before[before.length - 1];
      before[before.length - 1] = { ...last, raw: endWithBlankLine(last.raw) };
    }
    this.chunks = [...before, ...middle, ...after];

    // Capătul fișierului e al lui, nu al blocului care se întâmplă să fie ultimul acum.
    const text = (this.lead + this.chunks.map(c => c.raw).join('')).replace(/\s+$/, '');
    this.body = text ? text + this.tail : '';
    return this.body;
  }

  /**
   * Sursa s-a schimbat din afară (alt tab, un agent, git). Se înlocuiește doar porțiunea
   * diferită, ca poziția cursorului și scroll-ul să supraviețuiască.
   */
  rebase(body) {
    const next = toChunks(this.manager, body);
    const prev = this.chunks;
    let head = 0;
    while (head < prev.length && head < next.chunks.length && prev[head].raw === next.chunks[head].raw) head++;
    let tail = 0;
    while (tail < prev.length - head && tail < next.chunks.length - head
      && prev[prev.length - 1 - tail].raw === next.chunks[next.chunks.length - 1 - tail].raw) tail++;

    const from = prev.slice(0, head).reduce((n, c) => n + c.nodes.length, 0);
    const to = prev.slice(0, prev.length - tail).reduce((n, c) => n + c.nodes.length, 0);
    const middle = next.chunks.slice(head, next.chunks.length - tail);

    this.chunks = [...prev.slice(0, head), ...middle, ...(tail ? prev.slice(-tail) : [])];
    this.lead = next.lead;
    this.tail = next.tail;
    this.body = body;
    return { from, to, json: middle.flatMap(c => c.json) };
  }

  /** Linia 0-based din `body` la care începe fiecare bucată. */
  lines() {
    let line = this.lead.split('\n').length - 1;
    return this.chunks.map(chunk => {
      const start = line;
      line += chunk.raw.split('\n').length - 1;
      return start;
    });
  }
}

/** Corp + antet YAML; antetul nu trece niciodată prin parser. */
export function splitFrontmatter(text) {
  const match = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) return { frontmatter: '', body: text };
  return { frontmatter: match[0], body: text.slice(match[0].length) };
}

/** Fișierul e LF în webview; extensia pune la loc EOL-ul documentului. */
export const toLf = text => text.replace(/\r\n?/g, '\n');
