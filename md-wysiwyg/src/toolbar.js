/**
 * Bara plutitoare de peste selecție (`formattingToolbar` din Cursor), bara de tabel și mica fereastră
 * de link. Fără Floating UI: totul se poziționează `fixed` din `coordsAtPos`, iar la scroll se ascunde.
 */
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
};

const MARKS = [
  ['B', 'Bold ⌘B', e => e.chain().focus().toggleBold().run(), e => e.isActive('bold'), 'mdw-bar__bold'],
  ['I', 'Italic ⌘I', e => e.chain().focus().toggleItalic().run(), e => e.isActive('italic'), 'mdw-bar__italic'],
  ['S', 'Strikethrough', e => e.chain().focus().toggleStrike().run(), e => e.isActive('strike'), 'mdw-bar__strike'],
  ['</>', 'Inline code ⌘E', e => e.chain().focus().toggleCode().run(), e => e.isActive('code')],
];

const BLOCKS = [
  ['H1', 'Heading 1', e => e.chain().focus().toggleHeading({ level: 1 }).run(), e => e.isActive('heading', { level: 1 })],
  ['H2', 'Heading 2', e => e.chain().focus().toggleHeading({ level: 2 }).run(), e => e.isActive('heading', { level: 2 })],
  ['H3', 'Heading 3', e => e.chain().focus().toggleHeading({ level: 3 }).run(), e => e.isActive('heading', { level: 3 })],
  ['•', 'Bulleted list', e => e.chain().focus().toggleBulletList().run(), e => e.isActive('bulletList')],
  ['1.', 'Numbered list', e => e.chain().focus().toggleOrderedList().run(), e => e.isActive('orderedList')],
  ['☐', 'Task list', e => e.chain().focus().toggleTaskList().run(), e => e.isActive('taskList')],
  ['❝', 'Quote', e => e.chain().focus().toggleBlockquote().run(), e => e.isActive('blockquote')],
];

const TABLE = [
  ['+ row', 'Add row below', e => e.chain().focus().addRowAfter().run()],
  ['+ col', 'Add column to the right', e => e.chain().focus().addColumnAfter().run()],
  ['− row', 'Delete row', e => e.chain().focus().deleteRow().run()],
  ['− col', 'Delete column', e => e.chain().focus().deleteColumn().run()],
  ['✕ table', 'Delete table', e => e.chain().focus().deleteTable().run()],
];

function button(editor, [text, title, run, active, cls], buttons) {
  const node = el('button', `mdw-bar__btn ${cls || ''}`, text);
  node.title = title;
  // mousedown ar muta focusul din editor și selecția ar dispărea înainte de click.
  node.addEventListener('mousedown', event => event.preventDefault());
  node.addEventListener('click', () => run(editor));
  buttons.push({ node, active });
  return node;
}

let popover = null;
function closePopover() {
  popover?.remove();
  popover = null;
}

/** Linkul de sub cursor, cu limitele lui, sau null. */
function linkRange(editor) {
  const { state } = editor;
  const type = state.schema.marks.link;
  const { $from } = state.selection;
  if (!$from.marks().some(m => m.type === type) && !$from.nodeAfter?.marks.some(m => m.type === type)) return null;
  const parent = $from.parent;
  const offset = $from.parentOffset;
  let from = null, to = null, pos = 0, href = null;
  parent.forEach(child => {
    const start = pos;
    pos += child.nodeSize;
    const mark = child.marks.find(m => m.type === type);
    if (mark && start <= offset && offset <= pos && from === null) {
      href = mark.attrs.href; from = start; to = pos;
    }
  });
  if (from === null) return null;
  // Link pe mai multe bucăți de text (o parte bold, de exemplu).
  const base = $from.start();
  let extended = 0;
  parent.forEach(child => {
    if (extended >= to && child.marks.some(m => m.type === type && m.attrs.href === href)) to = extended + child.nodeSize;
    extended += child.nodeSize;
  });
  return { href, from: base + from, to: base + to };
}

export function openLinkPopover(editor, openHref, { focusInput = false } = {}) {
  closePopover();
  const { state, view } = editor;
  const range = linkRange(editor);
  if (!range && state.selection.empty) return;

  popover = el('div', 'mdw-popover');
  const input = el('input', 'mdw-popover__input');
  input.placeholder = 'https://… or relative/path.md';
  input.spellcheck = false;
  input.value = range?.href || '';
  popover.append(input);

  const apply = () => {
    const href = input.value.trim();
    const chain = editor.chain().focus();
    if (range) chain.setTextSelection(range);
    if (href) chain.extendMarkRange('link').setLink({ href }).run();
    else chain.unsetLink().run();
    closePopover();
  };

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); apply(); }
    if (event.key === 'Escape') { event.preventDefault(); closePopover(); editor.commands.focus(); }
    event.stopPropagation();
  });

  if (range) {
    const open = el('button', 'mdw-bar__btn', 'Open');
    open.title = 'Open link (⌘-click)';
    open.addEventListener('click', () => { openHref(input.value.trim()); closePopover(); });
    const unlink = el('button', 'mdw-bar__btn', 'Unlink');
    unlink.addEventListener('click', () => {
      editor.chain().focus().setTextSelection(range).unsetLink().run();
      closePopover();
    });
    popover.append(open, unlink);
  }

  document.body.append(popover);
  const at = view.coordsAtPos(range ? range.from : state.selection.from);
  popover.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - popover.offsetWidth - 8))}px`;
  popover.style.top = `${at.bottom + 6}px`;
  if (focusInput || !range) { input.focus(); input.select(); }
}

/** O formulă în text e un nod atomic: se editează aici, fără să-i spargă rândul. */
export function openMathPopover(editor, pos) {
  closePopover();
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== 'mathInline') return;
  popover = el('div', 'mdw-popover');
  const input = el('input', 'mdw-popover__input');
  input.spellcheck = false;
  input.value = node.attrs.latex;
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      const latex = input.value.trim();
      const { tr } = editor.state;
      if (latex) tr.setNodeMarkup(pos, undefined, { latex });
      else tr.delete(pos, pos + node.nodeSize);
      editor.view.dispatch(tr);
    }
    if (event.key === 'Enter' || event.key === 'Escape') { closePopover(); editor.commands.focus(); }
  });
  popover.append(input);
  document.body.append(popover);
  const at = editor.view.coordsAtPos(pos);
  popover.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - popover.offsetWidth - 8))}px`;
  popover.style.top = `${at.bottom + 6}px`;
  input.focus();
}

export function attachToolbar(editor, openHref) {
  const bar = el('div', 'mdw-bar');
  bar.hidden = true;
  const buttons = [];
  for (const def of MARKS) bar.append(button(editor, def, buttons));
  const link = ['Link', 'Link ⌘K', e => openLinkPopover(e, openHref, { focusInput: true }), e => e.isActive('link')];
  bar.append(button(editor, link, buttons), el('span', 'mdw-bar__sep'));
  for (const def of BLOCKS) bar.append(button(editor, def, buttons));

  const tableBar = el('div', 'mdw-bar');
  tableBar.hidden = true;
  for (const def of TABLE) tableBar.append(button(editor, def, []));

  document.body.append(bar, tableBar);

  let dragging = false;

  function place(node, anchor) {
    node.hidden = false;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - node.offsetWidth - 8));
    const above = anchor.top - node.offsetHeight - 8;
    node.style.left = `${left}px`;
    node.style.top = `${above > 4 ? above : anchor.bottom + 8}px`;
  }

  function refresh() {
    const { state, view } = editor;
    const { selection } = state;
    const focused = view.hasFocus() || bar.contains(document.activeElement);

    const inTable = editor.isEditable && focused && editor.isActive('table');
    if (inTable) {
      const dom = view.domAtPos(selection.from).node;
      const table = (dom instanceof Element ? dom : dom.parentElement)?.closest('table');
      if (table) {
        const rect = table.getBoundingClientRect();
        place(tableBar, { left: rect.left, top: rect.top, bottom: rect.bottom });
      }
    } else tableBar.hidden = true;

    const inCode = selection.$from.parent.type.spec.code;
    const show = editor.isEditable && focused && !selection.empty && !inCode && !dragging
      && selection.constructor.name !== 'CellSelection';
    if (!show) { bar.hidden = true; return; }
    for (const { node, active } of buttons) node.classList.toggle('mdw-bar__btn--on', !!active?.(editor));
    const start = view.coordsAtPos(selection.from);
    const end = view.coordsAtPos(selection.to);
    place(bar, { left: Math.min(start.left, end.left), top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) });
  }

  editor.on('selectionUpdate', refresh);
  editor.on('transaction', refresh);
  editor.on('focus', refresh);
  editor.on('blur', () => setTimeout(refresh, 0));

  document.addEventListener('mousedown', event => {
    if (popover && !popover.contains(event.target)) closePopover();
    if (editor.view.dom.contains(event.target)) dragging = true;
  });
  document.addEventListener('mouseup', () => { dragging = false; setTimeout(refresh, 0); });
  window.addEventListener('scroll', () => { refresh(); closePopover(); }, { passive: true, capture: true });
}
