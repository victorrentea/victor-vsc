// Webview-ul editorului WYSIWYG: un singur bundle, plus KaTeX și Mermaid copiate lângă el
// ca să se încarce doar când un document chiar le cere. Rezultatul stă în `media/` și se
// comite, ca `vsce package` să nu aibă nevoie de `node_modules`-ul de aici.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const out = '../media/md-wysiwyg';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: !process.argv.includes('--dev'),
  sourcemap: false,
  legalComments: 'none',
  outfile: `${out}/editor.js`,
});

cpSync('src/editor.css', `${out}/editor.css`);
cpSync('node_modules/mermaid/dist/mermaid.min.js', `${out}/mermaid.min.js`);
cpSync('node_modules/katex/dist/katex.min.js', `${out}/katex.min.js`);
cpSync('node_modules/katex/dist/katex.min.css', `${out}/katex.min.css`);
cpSync('node_modules/katex/dist/fonts', `${out}/fonts`, {
  recursive: true,
  filter: f => !/\.(ttf|woff)$/.test(f),      // woff2 ajunge pentru Electron
});
