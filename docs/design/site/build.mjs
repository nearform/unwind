#!/usr/bin/env node
// Builds the shareable HTML version of docs/design/*.md into docs/design/site/public/.
// The markdown stays the source of truth; this renders it into one long page with a
// sticky TOC, inlines the diagrams/*.svg, self-hosts fonts, and makes zero external
// requests. No new dependencies: react / react-dom/server / react-markdown / remark-gfm
// are resolved from packages/dashboard (run `pnpm install` first if they're missing).
//
//   node docs/design/site/build.mjs          → docs/design/site/public/
//   cd docs/design/site && npx wrangler deploy
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const SITE = dirname(fileURLToPath(import.meta.url));
const DESIGN = resolve(SITE, '..');
const REPO = resolve(DESIGN, '..', '..');
const DASHBOARD = join(REPO, 'packages', 'dashboard');
const OUT = join(SITE, 'public');

const DOCS = [
  'README.md',
  '01-review-openrewrite.md',
  '02-architecture.md',
  '03-target-kits-and-recipes.md',
  '04-semantic-model.md',
  '05-behaviour-parity.md',
  '05b-context-gaps.md',
  '06-roadmap.md',
  '07-open-questions.md',
];

// ── dependencies (borrowed from the dashboard workspace) ─────────────────────
const req = createRequire(join(DASHBOARD, 'package.json'));
let React, renderToStaticMarkup, Markdown, remarkGfm;
try {
  React = req('react');
  ({ renderToStaticMarkup } = req('react-dom/server'));
  Markdown = (await import(pathToFileURL(req.resolve('react-markdown')).href)).default;
  remarkGfm = (await import(pathToFileURL(req.resolve('remark-gfm')).href)).default;
} catch (err) {
  console.error('Could not load react / react-markdown / remark-gfm from packages/dashboard.');
  console.error('Run `pnpm install` at the repo root, then retry.\n', err.message);
  process.exit(1);
}
const h = React.createElement;

// ── helpers ──────────────────────────────────────────────────────────────────
const docKey = (file) => (file === 'README.md' ? 'overview' : file.replace(/\.md$/, ''));
const slug = (s) => s.toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const hastText = (node) =>
  node.type === 'text' ? node.value : (node.children || []).map(hastText).join('');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Map a markdown link to the in-page anchor it should point at.
function rewriteHref(href, currentKey) {
  if (!href) return href;
  const m = href.match(/^(?:\.\/)?([\w.-]+\.md)(#.*)?$/);
  if (m && DOCS.includes(m[1])) {
    const key = docKey(m[1]);
    return m[2] ? `#${key}--${m[2].slice(1)}` : `#${key}`;
  }
  if (href.startsWith('#')) return `#${currentKey}--${href.slice(1)}`;
  return href;
}

const svgSeen = {};
// Inline a diagram, namespacing its ids so several SVGs can share one document.
function inlineSvg(src, alt) {
  const file = join(DESIGN, src);
  if (!existsSync(file)) return `<p class="missing">Missing diagram: ${escHtml(src)}</p>`;
  const base = src.replace(/^.*\//, '').replace(/\.svg$/, '');
  const seen = (svgSeen[base] = (svgSeen[base] || 0) + 1);
  const name = seen > 1 ? `${base}-${seen}` : base;
  const svg = readFileSync(file, 'utf8')
    .replace(/id="m-/g, `id="${name}-m-`)
    .replace(/url\(#m-/g, `url(#${name}-m-`)
    .replace(/(id|aria-labelledby)="t-[\w-]+"/g, `$1="t-${name}"`)
    .replace(/<svg ([^>]*?)width="(\d+)" height="(\d+)"/, '<svg $1data-w="$2" data-h="$3"');
  return `<figure class="diagram" id="fig-${name}"><div class="diagram-card">${svg.trim()}</div>` +
    `<figcaption>${escHtml(alt)}</figcaption></figure>`;
}

// ── render each doc ──────────────────────────────────────────────────────────
const toc = [];
const sections = [];
for (const file of DOCS) {
  const path = join(DESIGN, file);
  if (!existsSync(path)) { console.warn(`  ! skipping missing ${file}`); continue; }
  const key = docKey(file);
  const md = readFileSync(path, 'utf8');
  const entry = { key, title: key, children: [] };
  toc.push(entry);

  const heading = (level) => ({ node, children }) => {
    const text = hastText(node);
    if (level === 1) {
      entry.title = text;
      return h('h1', { id: key }, h('a', { className: 'anchor', href: `#${key}`, 'aria-hidden': 'true' }, '#'), children);
    }
    const id = `${key}--${slug(text)}`;
    if (level === 2) entry.children.push({ id, title: text });
    return h(`h${level}`, { id }, h('a', { className: 'anchor', href: `#${id}`, 'aria-hidden': 'true' }, '#'), children);
  };

  const html = renderToStaticMarkup(
    h(Markdown, {
      remarkPlugins: [remarkGfm],
      components: {
        h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4),
        a: ({ href, children }) => {
          const out = rewriteHref(href, key);
          const external = /^https?:\/\//.test(out);
          return h('a', external ? { href: out, target: '_blank', rel: 'noopener noreferrer' } : { href: out }, children);
        },
        // Diagrams are swapped for inline SVG after rendering (see below).
        img: ({ src, alt }) =>
          /^diagrams\/[\w.-]+\.svg$/.test(src || '')
            ? h('img', { 'data-diagram': src, alt: alt || '' })
            : h('img', { src, alt: alt || '', loading: 'lazy' }),
        table: ({ children }) => h('div', { className: 'table-wrap' }, h('table', null, children)),
      },
    }, md),
  );

  // A diagram alone in a paragraph becomes a <figure> (a figure can't live inside <p>).
  const withDiagrams = html
    .replace(/<p><img data-diagram="([^"]+)" alt="([^"]*)"\/><\/p>/g, (_, src, alt) => inlineSvg(src, unescape(alt)))
    .replace(/<img data-diagram="([^"]+)" alt="([^"]*)"\/>/g, (_, src, alt) => inlineSvg(src, unescape(alt)));
  sections.push(`<section class="doc" data-doc="${key}">${withDiagrams}</section>`);
}

function unescape(s) {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// ── page shell ───────────────────────────────────────────────────────────────
let commit = '';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim(); } catch {}
const built = new Date().toISOString().slice(0, 10);

const tocHtml = toc.map((d) =>
  `<li><a href="#${d.key}" class="toc-doc">${escHtml(d.title)}</a>` +
  (d.children.length ? `<ul>${d.children.map((c) => `<li><a href="#${c.id}">${escHtml(c.title)}</a></li>`).join('')}</ul>` : '') +
  `</li>`).join('');

const themeBoot = `(function(){try{var t=localStorage.getItem('unwind-design-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`;
const pageScript = `
(function(){
  var btn=document.getElementById('theme-toggle');
  function label(){btn.textContent=document.documentElement.dataset.theme==='light'?'Dark theme':'Light theme';}
  label();
  btn.addEventListener('click',function(){
    var next=document.documentElement.dataset.theme==='light'?'dark':'light';
    document.documentElement.dataset.theme=next;
    try{localStorage.setItem('unwind-design-theme',next);}catch(e){}
    label();
  });
  // Highlight the TOC entry for the section in view.
  var links={};document.querySelectorAll('.toc a').forEach(function(a){links[a.getAttribute('href').slice(1)]=a;});
  var heads=[].slice.call(document.querySelectorAll('main h1[id], main h2[id]'));
  var current=null;
  function onScroll(){
    var y=window.scrollY+120, active=null;
    for(var i=0;i<heads.length;i++){if(heads[i].offsetTop<=y)active=heads[i];else break;}
    if(active&&active!==current){
      if(current&&links[current.id])links[current.id].classList.remove('active');
      current=active;var a=links[active.id];
      if(a){a.classList.add('active');var r=a.getBoundingClientRect(),n=document.querySelector('.toc').getBoundingClientRect();if(r.top<n.top||r.bottom>n.bottom)a.scrollIntoView({block:'nearest'});}
    }
  }
  window.addEventListener('scroll',onScroll,{passive:true});onScroll();
})();`;

const page = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unwind design: Rewind · Spec · Play</title>
<meta name="description" content="Destination architecture and roadmap for Unwind: Rewind (understand) → Spec → Play (rebuild) with Target Kits of deterministic recipes.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2300e6a4'/%3E%3Cpath d='M9 10v8a7 7 0 0 0 14 0v-8' stroke='%230a1120' stroke-width='3.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="styles.css">
<script>${themeBoot}</script>
</head>
<body>
<header class="topbar">
  <a class="brand" href="#overview"><span class="logo">U</span> Unwind design <span class="tag">Rewind · Spec · Play</span></a>
  <span class="meta">draft for review · built ${built}${commit ? ` · ${escHtml(commit)}` : ''}</span>
  <button id="theme-toggle" type="button">Light theme</button>
</header>
<div class="layout">
  <nav class="toc" aria-label="Contents"><ul>${tocHtml}</ul></nav>
  <main>${sections.join('\n')}
    <footer class="foot">Generated from <code>docs/design/*.md</code>. The markdown is the source of truth. Cite sections (e.g. §3.4) when commenting.</footer>
  </main>
</div>
<script>${pageScript}</script>
</body>
</html>
`;

const notFound = `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · Unwind design</title><link rel="stylesheet" href="/styles.css"><script>${themeBoot}</script></head><body><main class="notfound"><h1>Not found</h1><p><a href="/">Back to the Unwind design</a></p></main></body></html>\n`;

// ── write output ─────────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'fonts'), { recursive: true });
writeFileSync(join(OUT, 'index.html'), page);
writeFileSync(join(OUT, '404.html'), notFound);
copyFileSync(join(SITE, 'styles.css'), join(OUT, 'styles.css'));

const FONTS = [
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'inter-latin-wght-normal.woff2'],
  ['@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2'],
  ['@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2', 'jetbrains-mono-latin-wght-normal.woff2'],
];
for (const [from, to] of FONTS) {
  const src = join(DASHBOARD, 'node_modules', from);
  if (existsSync(src)) copyFileSync(src, join(OUT, 'fonts', to));
  else console.warn(`  ! font not found (falls back to system fonts): ${from}`);
}

const figures = (page.match(/class="diagram"/g) || []).length;
console.log(`Built ${OUT}/index.html: ${sections.length} docs, ${figures} diagrams, ${toc.reduce((n, d) => n + d.children.length, 0)} TOC sections.`);
