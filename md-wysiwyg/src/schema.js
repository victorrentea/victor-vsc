import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import Italic from '@tiptap/extension-italic';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import Paragraph from '@tiptap/extension-paragraph';
import { Markdown } from '@tiptap/markdown';
import { TaskList, TaskItem, ListItem, OrderedList, ListKeymap } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Placeholder } from '@tiptap/extensions';
import { common, createLowlight } from 'lowlight';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import gherkin from 'highlight.js/lib/languages/gherkin';
import groovy from 'highlight.js/lib/languages/groovy';
import nginx from 'highlight.js/lib/languages/nginx';
import protobuf from 'highlight.js/lib/languages/protobuf';
import powershell from 'highlight.js/lib/languages/powershell';
import { sourceView } from './previewed.js';

const lowlight = createLowlight(common);
lowlight.register({ dockerfile, gherkin, groovy, nginx, protobuf, powershell });

/** Un atribut care ține doar forma din sursă: nu apare în DOM, nu se pierde la serializare. */
const sourceOnly = { default: null, parseHTML: () => null, renderHTML: () => ({}) };

/* Forma din sursă, pentru blocul pe care chiar îl editezi. Restul fișierului nu trece pe aici. */

const delimited = (Mark, tokenSecond, fallback) => Mark.extend({
  addAttributes() {
    return { ...this.parent?.(), delimiter: sourceOnly };
  },
  parseMarkdown: (token, h) => h.applyMark(
    Mark.name,
    h.parseInline(token.tokens || []),
    token.raw?.startsWith(tokenSecond) ? { delimiter: tokenSecond } : undefined,
  ),
  renderMarkdown: (node, h) => {
    const d = node.attrs?.delimiter === tokenSecond ? tokenSecond : fallback;
    return `${d}${h.renderChildren(node)}${d}`;
  },
});

/**
 * Implicit codul exclude orice altă marcă. Dar `**\`x\`**` e Markdown valid, iar ProseMirror
 * recitește din DOM rândul pe care scrii: bold-ul ar dispărea la prima tastă din paragraf.
 */
const CodeWithMarks = Code.extend({ excludes: '' });

const SourceHorizontalRule = HorizontalRule.extend({
  addAttributes() {
    return { ...this.parent?.(), markdown: sourceOnly };
  },
  parseMarkdown: (token, h) => h.createNode('horizontalRule', { markdown: token.raw?.trimEnd() || null }),
  renderMarkdown: node => node.attrs?.markdown || '---',
});

const MARKER = /^\s*([*+-])(?=\s|$)/;

const SourceListItem = ListItem.extend({
  addAttributes() {
    return { ...this.parent?.(), marker: sourceOnly };
  },
  parseMarkdown: (token, h) => {
    const parsed = ListItem.config.parseMarkdown(token, h);
    const marker = MARKER.exec(token.raw || '')?.[1];
    return marker && marker !== '-' && parsed && !Array.isArray(parsed)
      ? { ...parsed, attrs: { ...parsed.attrs, marker } }
      : parsed;
  },
  renderMarkdown: (node, h, ctx) => {
    const text = ListItem.config.renderMarkdown(node, h, ctx);
    if (ctx.parentType === 'orderedList') {
      return ctx.meta?.parentAttrs?.delimiter === ')' ? text.replace(/^(\d+)\. /, '$1) ') : text;
    }
    return node.attrs?.marker ? text.replace(/^- /, `${node.attrs.marker} `) : text;
  },
});

/**
 * Fără tokenizer-ul propriu din Tiptap: el taie din fiecare rând o indentare fixă, deci sub `1. `
 * rămâne un spațiu în plus, iar un bloc de cod dintr-o listă numerotată crește cu un spațiu la
 * fiecare salvare. Lista din `marked` nu are problema asta.
 */
const SourceOrderedList = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), delimiter: sourceOnly };
  },
  markdownTokenizer: { name: 'orderedList', level: 'block', start: () => -1, tokenize: () => undefined },
  parseMarkdown: (token, h) => {
    if (token.type !== 'list' || !token.ordered) return [];
    const attrs = {};
    if (token.start && token.start !== 1) attrs.start = token.start;
    if (/^ {0,3}\d{1,9}\)/.test(token.raw || '')) attrs.delimiter = ')';
    return { type: 'orderedList', attrs, content: h.parseChildren(token.items || []) };
  },
});

/* Noduri fără echivalent în Tiptap: HTML, definiții de link-uri, formule. */

const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes() {
    return { kind: { default: 'html' } };
  },
  parseHTML: () => [{ tag: 'pre[data-raw-block]', preserveWhitespace: 'full' }],
  renderHTML: ({ HTMLAttributes }) => ['pre', mergeAttributes(HTMLAttributes, { 'data-raw-block': '' }), ['code', 0]],
  renderMarkdown: node => (node.content || []).map(t => t.text).join(''),
  addNodeView: () => sourceView({ preview: 'html', label: node => (node.attrs.kind === 'def' ? 'link reference' : 'HTML') }),
});

const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes() {
    return { delimiter: sourceOnly };
  },
  parseHTML: () => [{ tag: 'pre[data-math-block]', preserveWhitespace: 'full' }],
  renderHTML: ({ HTMLAttributes }) => ['pre', mergeAttributes(HTMLAttributes, { 'data-math-block': '' }), ['code', 0]],
  markdownTokenizer: {
    name: 'mathBlock',
    level: 'block',
    start: src => src.search(/^(?:\$\$|\\\[)/m),
    tokenize: src => {
      const match = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src) || /^\\\[([\s\S]+?)\\\][ \t]*(?:\n|$)/.exec(src);
      if (!match) return undefined;
      return { type: 'mathBlock', raw: match[0], text: match[1].trim(), delimiter: match[0].startsWith('$') ? null : 'brackets' };
    },
  },
  parseMarkdown: (token, h) => h.createNode('mathBlock', { delimiter: token.delimiter }, token.text ? [{ type: 'text', text: token.text }] : []),
  renderMarkdown: node => {
    const latex = (node.content || []).map(t => t.text).join('');
    return node.attrs?.delimiter === 'brackets' ? `\\[\n${latex}\n\\]` : `$$\n${latex}\n$$`;
  },
  addNodeView: () => sourceView({ preview: 'math', label: () => 'LaTeX' }),
});

const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { latex: { default: '', parseHTML: el => el.getAttribute('data-latex'), renderHTML: a => ({ 'data-latex': a.latex }) } };
  },
  parseHTML: () => [{ tag: 'span[data-latex]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'math-inline' })],
  markdownTokenizer: {
    name: 'mathInline',
    level: 'inline',
    start: src => src.indexOf('$'),
    // Regula din Pandoc: `$5 și $10` rămâne text. Fără spațiu lângă delimitatori, fără cifră după.
    tokenize: src => {
      const match = /^\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?![\d$])/.exec(src);
      return match ? { type: 'mathInline', raw: match[0], text: match[1] } : undefined;
    },
  },
  parseMarkdown: (token, h) => h.createNode('mathInline', { latex: token.text }),
  renderMarkdown: node => `$${node.attrs?.latex ?? ''}$`,
  addNodeView: () => ({ node, HTMLAttributes }) => {
    const dom = document.createElement('span');
    dom.className = 'math-inline';
    dom.setAttribute('data-latex', node.attrs.latex);
    window.__mdw.renderMath(dom, node.attrs.latex, false);
    return { dom };
  },
});

const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return sourceView({
      preview: node => (node.attrs.language === 'mermaid' ? 'mermaid' : null),
      languageInput: true,
    });
  },
}).configure({ lowlight, defaultLanguage: 'plaintext', enableTabIndentation: true, tabSize: 2 });

/** Imaginile rămân cu calea din sursă; doar DOM-ul primește URL-ul pe care îl poate încărca. */
const SourceImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: el => el.getAttribute('data-src') || el.getAttribute('src'),
        renderHTML: a => ({ src: window.__mdw.resolveUrl(a.src), 'data-src': a.src }),
      },
    };
  },
}).configure({ inline: true });

/* Scrierea înapoi. Tiptap le pune pe toate pe un singur tipar, care strică proza obișnuită. */

/**
 * Doar ce chiar s-ar citi altfel. Implicit Tiptap scrie `snake\\_case`, `a &gt; b` și `\\[x\\]`, adică
 * un diff în fiecare paragraf atins, deși Markdown-ul le lasă pe toate în pace.
 */
export function escapeText(text) {
  return text
    .replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/(^|.)\*(?=(.|$))/gs, (all, before, after) => (/^\s?$/.test(before) && /^\s?$/.test(after) && before && after ? all : `${before}\\*`))
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (all, before) => `${before ?? ''}\\_`)
    .replace(/~~/g, '\\~\\~')
    .replace(/\[(?=[^\]\n]*\][([])/g, '\\[')
    .replace(/<(?=[a-zA-Z/!?])/g, '\\<')
    .replace(/&(?=#?\w+;)/g, '&amp;');
}

/** Un rând de text care ar porni alt bloc dacă ar sta așa în fișier. */
export function escapeLineStarts(markdown) {
  return markdown
    .replace(/^( {0,3})(#{1,6}(?:\s|$)|>|[-+*](?:\s|$)|={3,}\s*$|-{3,}\s*$)/gm, '$1\\$2')
    .replace(/^( {0,3}\d{1,9})([.)])(?=\s|$)/gm, '$1\\$2');
}

/**
 * Codul trebuie să stea înăuntrul celorlalte mărci: `**\`x\`**`, nu `\`**x**\``, unde steluțele ar
 * deveni cod. Serializatorul le deschide în ordinea din schemă și mută spațiile din capete afară
 * din marcă, deci în cazurile astea scriem noi backtick-urile, iar marca de cod dispare.
 */
export function codeInnermost(json) {
  const code = json.type === 'text' && json.marks?.some(m => m.type === 'code');
  if (code && (json.marks.length > 1 || /^\s|\s$/.test(json.text))) {
    const longest = Math.max(0, ...(json.text.match(/`+/g) || []).map(run => run.length));
    const fence = '`'.repeat(longest + 1);
    const pad = /^`|`$/.test(json.text) ? ' ' : '';
    json.text = `${fence}${pad}${json.text}${pad}${fence}`;
    json.literal = true;
    json.marks = json.marks.filter(m => m.type !== 'code');
  }
  json.content?.forEach(codeInnermost);
  return json;
}

const SourceParagraph = Paragraph.extend({
  renderMarkdown(node, h, ctx) {
    return escapeLineStarts(Paragraph.config.renderMarkdown(node, h, ctx));
  },
});

export function patchSerializer(manager) {
  const codeTypes = manager.codeTypes;
  manager.encodeTextForMarkdown = (text, node, parent) => {
    const inCode = codeTypes.has(parent?.type)
      || (node.marks || []).some(m => codeTypes.has(typeof m === 'string' ? m : m.type));
    return inCode || node.literal ? text : escapeText(text);
  };
}

export function extensions() {
  return [
    StarterKit.configure({
      bold: false,
      italic: false,
      horizontalRule: false,
      listItem: false,
      orderedList: false,
      listKeymap: false,
      paragraph: false,
      code: false,
      codeBlock: false,
      underline: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: true },
    }),
    SourceParagraph,
    CodeWithMarks,
    delimited(Bold, '__', '**'),
    delimited(Italic, '_', '*'),
    SourceHorizontalRule,
    SourceListItem,
    SourceOrderedList,
    ListKeymap,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false, renderWrapper: true } }),
    CodeBlock,
    RawBlock,
    MathBlock,
    MathInline,
    SourceImage,
    Placeholder.configure({ placeholder: 'Start writing…' }),
    Markdown.configure({ indentation: { style: 'space', size: 2 } }),
  ];
}
