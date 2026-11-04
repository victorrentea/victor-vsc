/**
 * Un bloc care are sursă, dar se citește altfel: diagrama Mermaid, formula, HTML-ul brut, plus
 * blocurile de cod obișnuite (acolo „randarea” lipsește, dar eticheta de limbaj e aceeași).
 *
 * Regula e cea din Cursor pentru Mermaid, generalizată: cât timp cursorul e în altă parte vezi
 * rezultatul, iar când intră în bloc vezi sursa. Sursa e editabilă cu tot ce are ProseMirror
 * (undo, selecție peste blocuri), fiindcă rămâne conținutul real al nodului.
 */
const delay = (fn, ms) => {
  let timer;
  const run = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  run.cancel = () => clearTimeout(timer);
  return run;
};

const text = node => node.textContent;

export function sourceView({ preview, label, languageInput }) {
  const previewKind = node => (typeof preview === 'function' ? preview(node) : preview);

  return ({ node, editor, getPos }) => {
    const dom = document.createElement('div');
    dom.className = 'mdw-source';

    const render = document.createElement('div');
    render.className = 'mdw-source__render';
    render.contentEditable = 'false';
    render.addEventListener('mousedown', event => {
      // Un link din HTML-ul randat rămâne link; în rest, click = intră în sursă.
      if (event.target.closest('a')) return;
      event.preventDefault();
      editor.chain().focus().setTextSelection(getPos() + 1).run();
    });

    const head = document.createElement('div');
    head.className = 'mdw-source__head';
    head.contentEditable = 'false';

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    pre.append(code);

    let current = node;
    let input;

    if (languageInput) {
      input = document.createElement('input');
      input.className = 'mdw-source__lang';
      input.placeholder = 'language';
      input.spellcheck = false;
      input.value = node.attrs.language === 'plaintext' ? '' : node.attrs.language || '';
      const commit = () => {
        const language = input.value.trim() || null;
        const pos = getPos();
        if (typeof pos !== 'number' || (language || 'plaintext') === (current.attrs.language || 'plaintext')) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, language }));
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { commit(); event.preventDefault(); editor.commands.focus(); }
      });
      head.append(input);
    } else if (label) {
      const tag = document.createElement('span');
      tag.className = 'mdw-source__label';
      tag.textContent = label(node);
      head.append(tag);
    }

    const copy = document.createElement('button');
    copy.className = 'mdw-source__copy';
    copy.textContent = 'Copy';
    copy.addEventListener('mousedown', event => event.preventDefault());
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(text(current));
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
    });
    head.append(copy);

    dom.append(render, head, pre);

    const draw = delay(() => {
      const kind = previewKind(current);
      dom.classList.toggle('mdw-source--previewed', !!kind);
      if (kind) window.__mdw.renderPreview(render, kind, text(current));
      else render.replaceChildren();
    }, 150);

    const firstKind = previewKind(node);
    dom.classList.toggle('mdw-source--previewed', !!firstKind);
    if (firstKind) window.__mdw.renderPreview(render, firstKind, text(node));

    return {
      dom,
      contentDOM: code,
      update(next) {
        if (next.type !== node.type) return false;
        const changed = text(next) !== text(current) || next.attrs.language !== current.attrs.language;
        current = next;
        code.className = next.attrs.language ? `language-${next.attrs.language}` : '';
        if (input && document.activeElement !== input) {
          input.value = next.attrs.language === 'plaintext' ? '' : next.attrs.language || '';
        }
        if (changed) draw();
        return true;
      },
      stopEvent: event => {
        const target = event.target;
        return target instanceof Element && !!target.closest('.mdw-source__head, .mdw-source__render');
      },
      ignoreMutation: mutation => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        return !target || !code.contains(target);
      },
      destroy() { draw.cancel(); },
    };
  };
}
