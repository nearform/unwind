#!/usr/bin/env node
// Generates the design-doc diagrams (docs/design/diagrams/*.svg) in the same
// visual language as docs/pipeline.svg: blue = deterministic, orange = LLM,
// grey dashed = artifact, green = human / external, purple = new in destination.
// Static output: no external refs, system sans font. Run: node docs/design/site/diagrams.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'diagrams');

const K = {
  det: { fill: '#EFF6FF', stroke: '#2563EB', title: '#1E3A8A' },
  llm: { fill: '#FFF7ED', stroke: '#EA580C', title: '#9A3412' },
  art: { fill: '#F1F5F9', stroke: '#94A3B8', title: '#334155', dash: '4 3' },
  human: { fill: '#F0FDF4', stroke: '#16A34A', title: '#14532D' },
  src: { fill: '#F8FAFC', stroke: '#CBD5E1', title: '#475569' },
  new: { fill: '#F5F3FF', stroke: '#7C3AED', title: '#4C1D95' },
  lane: { fill: '#FBFCFE', stroke: '#CBD5E1', title: '#475569', dash: '6 4' },
};
const ARROW = { g: '#94A3B8', o: '#EA580C', b: '#2563EB', gr: '#16A34A', p: '#7C3AED' };
const SANS = 'ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let current = '';
const warn = (msg) => console.warn(`  ! ${current}: ${msg}`);
// Rough text-width estimate, used only to flag overflow during generation.
const textW = (s, size, { bold = false, mono = false } = {}) =>
  String(s).length * size * (mono ? 0.61 : bold ? 0.6 : 0.54);

function txt(x, y, s, { size = 11.5, fill = '#475569', weight, anchor = 'start', mono = false, italic = false } = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}"${weight ? ` font-weight="${weight}"` : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${mono ? ` font-family="${MONO}" style="white-space:pre"` : ''}${italic ? ' font-style="italic"' : ''} fill="${fill}">${esc(s)}</text>`;
}

function box({ x, y, w, h, k = 'det', t, s = [], ts = 15, align = 'middle', valign = 'middle', mono = false, thick = false, rx = 10 }) {
  const c = K[k];
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${thick ? 2.6 : 1.6}"${c.dash ? ` stroke-dasharray="${c.dash}"` : ''}/>`;
  const n = s.length;
  const block = (t ? ts : 0) + n * 15 + (t && n ? 3 : 0);
  const top = valign === 'top' ? y + 16 : y + (h - block) / 2;
  const tx = align === 'middle' ? x + w / 2 : x + 14;
  const avail = w - (align === 'middle' ? 12 : 22);
  if (t) {
    if (textW(t, ts, { bold: true }) > avail) warn(`title overflows: "${t}"`);
    out += txt(tx, top + ts * 0.82, t, { size: ts, weight: 700, fill: c.title, anchor: align });
  }
  s.forEach((line, i) => {
    if (textW(line, 11.5, { mono }) > avail) warn(`line overflows: "${line}"`);
    const base = top + (t ? ts + 3 : 0) + 11.5 + i * 15 + (t ? 0 : 1);
    out += txt(tx, base, line, { size: 11.5, fill: '#475569', anchor: align, mono });
  });
  if (block > h - 6) warn(`box too short for content: "${t}"`);
  return out;
}

function arr(pts, { c = 'g', dash = false, w = 1.6 } = {}) {
  const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ');
  return `<path d="${d}" fill="none" stroke="${ARROW[c]}" stroke-width="${w}"${dash ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#m-${c})"/>`;
}

function chip(x, y, label, k = 'det', { w, mono = false } = {}) {
  const c = K[k];
  const width = w ?? Math.ceil(textW(label, 11.5, { mono }) + 22);
  return {
    w: width,
    svg: `<rect x="${x}" y="${y}" width="${width}" height="26" rx="13" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.3"${c.dash ? ` stroke-dasharray="${c.dash}"` : ''}/>` +
      txt(x + width / 2, y + 17.5, label, { size: 11.5, fill: c.title, anchor: 'middle', mono, weight: 600 }),
  };
}

function chips(x, y, labels, k, gap = 8) {
  let cx = x, svg = '';
  for (const l of labels) { const ch = chip(cx, y, l, k); svg += ch.svg; cx += ch.w + gap; }
  return { svg, end: cx - gap };
}

const LEGEND = {
  det: 'deterministic (engine / CLI)', llm: 'LLM agent', art: 'artifact', human: 'human / external', new: 'new in destination',
};
function svgDoc(name, title, W, H, body, legend = ['det', 'llm', 'art']) {
  let lg = '', lx = 24;
  for (const k of legend) {
    const c = K[k];
    lg += `<rect x="${lx}" y="44" width="14" height="14" rx="4" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"${c.dash ? ' stroke-dasharray="3 2"' : ''}/>`;
    lg += txt(lx + 20, 55.5, LEGEND[k], { size: 12, fill: '#475569' });
    lx += 20 + textW(LEGEND[k], 12) + 26;
  }
  const markers = Object.entries(ARROW).map(([id, col]) =>
    `<marker id="m-${id}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9 z" fill="${col}"/></marker>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}" role="img" aria-labelledby="t-${name}">` +
    `<title id="t-${name}">${esc(title)}</title><defs>${markers}</defs>` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>` +
    txt(24, 30, title, { size: 20, weight: 700, fill: '#0F172A' }) + lg + body + `</svg>\n`;
  writeFileSync(join(OUT, `${name}.svg`), svg);
  console.log(`wrote diagrams/${name}.svg`);
}

function laneLabel(x, y, s, fill = '#475569') {
  return txt(x, y, s, { size: 12.5, weight: 700, fill });
}

const D = {};

// ── 01 Big picture ────────────────────────────────────────────────────────────
D['01-big-picture'] = () => {
  current = '01';
  let b = '';
  // Rewind lane (runs locally, per slice)
  b += box({ x: 16, y: 76, w: 1008, h: 128, k: 'lane' });
  b += laneLabel(32, 96, 'REWIND · understand the source', '#1E3A8A');
  b += chip(276, 82, 'per slice · runs locally via the CLI', 'new').svg;
  b += box({ x: 32, y: 112, w: 170, h: 70, k: 'src', t: 'Source repo', s: ['any language · git'] });
  b += box({ x: 240, y: 112, w: 220, h: 70, k: 'det', t: 'Semantic Model', s: ['typed facts · ids · edges', 'tree-sitter + compilers'] });
  b += box({ x: 498, y: 112, w: 240, h: 70, k: 'llm', t: 'Layer docs + grill', s: ['tagged [MUST] / [SHOULD] / [DON\'T]', 'coverage = manifest − docs'] });
  b += box({ x: 776, y: 112, w: 232, h: 70, k: 'det', t: 'rw-spec (compile)', s: ['model + docs → Spec fragment'] });
  b += arr([[202, 147], [238, 147]]) + arr([[460, 147], [496, 147]]) + arr([[738, 147], [774, 147]]);
  // Server backbone
  b += arr([[892, 182], [892, 230]], { c: 'p' });
  b += txt(882, 222, 'push artifacts per slice', { size: 11.5, fill: '#4C1D95', anchor: 'end' });
  b += box({ x: 16, y: 232, w: 1008, h: 80, k: 'new', thick: true, t: 'UNWIND SERVER · shared backbone from day 0', s: ['slices + owners · artifacts in git · state + index in SQLite · basic UI · token auth', 'converges slice fragments into one project Spec · tracks progress per slice', 'artifacts only: source code never leaves the developer\'s machine'] });
  // Spec + side loops
  b += arr([[520, 312], [520, 342]], { c: 'p' });
  b += txt(530, 332, 'converged', { size: 11.5, fill: '#4C1D95' });
  b += box({ x: 352, y: 344, w: 336, h: 76, k: 'art', thick: true, t: 'SPEC · stack-neutral typed IR', s: ['entities · endpoints · events · operations', 'scenarios · priorities · provenance'] });
  b += box({ x: 32, y: 340, w: 270, h: 84, k: 'human', t: 'Context gaps', s: ['agents find what code can\'t say', '→ interview briefs → stakeholders', '→ answers enrich the Spec'] });
  b += arr([[352, 366], [304, 366]], { c: 'gr' }) + arr([[304, 400], [350, 400]], { c: 'gr' });
  b += box({ x: 738, y: 340, w: 270, h: 84, k: 'det', t: 'Behaviour parity', s: ['scenarios run vs legacy → goldens', 'replay vs target → parity %', 'observations enrich the Spec'] });
  b += arr([[688, 366], [736, 366]], { c: 'b' }) + arr([[736, 400], [690, 400]], { c: 'b' });
  // Play lane (per slice)
  b += box({ x: 16, y: 454, w: 1008, h: 176, k: 'lane' });
  b += laneLabel(32, 474, 'PLAY · rebuild in the target stack', '#9A3412');
  b += chip(600, 460, 'per slice · ordered by seams', 'new').svg;
  b += arr([[520, 420], [520, 440], [300, 440], [300, 490]]);
  b += box({ x: 32, y: 492, w: 178, h: 70, k: 'human', t: 'Target Kit', s: ['client recipe book', '(own git repo)'] });
  b += box({ x: 236, y: 492, w: 158, h: 70, k: 'llm', t: 'Plan', s: ['choose / tailor Kit', 'phasing · risk'] });
  b += box({ x: 420, y: 492, w: 182, h: 70, k: 'det', t: 'Generate', s: ['recipes → code + holes', 'correct by construction'] });
  b += box({ x: 628, y: 492, w: 168, h: 70, k: 'llm', t: 'Fill holes', s: ['business logic only'] });
  b += box({ x: 822, y: 492, w: 186, h: 70, k: 'det', thick: true, t: 'Verify', s: ['re-scan target − Spec', 'MUST completeness %'] });
  b += arr([[210, 527], [234, 527]], { c: 'gr' }) + arr([[394, 527], [418, 527]]) + arr([[602, 527], [626, 527]]) + arr([[796, 527], [820, 527]]);
  b += arr([[915, 562], [915, 598], [511, 598], [511, 564]], { c: 'o', dash: true });
  b += txt(713, 616, 'gaps → regenerate / refill until verified (loop mode)', { size: 11.5, fill: '#9A3412', anchor: 'middle' });
  // Verify results back to the server
  b += arr([[1008, 510], [1044, 510], [1044, 272], [1026, 272]], { c: 'p' });
  b += txt(1036, 446, 'push verify results', { size: 11.5, fill: '#4C1D95', anchor: 'end' });
  // Target
  b += box({ x: 560, y: 656, w: 448, h: 50, k: 'src', t: 'Target repo · new stack', s: ['generated structure + filled holes + native parity tests'] });
  b += arr([[712, 630], [712, 654]]);
  b += txt(32, 688, 'Surfaces: unwind CLI (does the work, next to the code) · Unwind Server UI · MCP adapter later', { size: 12, fill: '#64748B' });
  svgDoc('01-big-picture', 'Unwind destination: Server · Rewind → Spec → Play', 1064, 724, b, ['det', 'llm', 'art', 'human', 'new']);
};

// ── 02 Today vs destination ───────────────────────────────────────────────────
D['02-today-vs-destination'] = () => {
  current = '02';
  let b = '';
  b += box({ x: 24, y: 80, w: 340, h: 860, k: 'lane' });
  b += laneLabel(40, 102, 'TODAY · one plugin (uw-*), single user');
  b += box({ x: 520, y: 80, w: 496, h: 382, k: 'lane' });
  b += laneLabel(536, 102, 'REWIND plugin (rw-*) · per slice', '#1E3A8A');
  b += box({ x: 520, y: 506, w: 496, h: 296, k: 'lane' });
  b += laneLabel(536, 528, 'PLAY plugin (pl-*) · per slice', '#9A3412');
  b += box({ x: 520, y: 816, w: 496, h: 124, k: 'lane' });
  b += laneLabel(536, 838, 'SHARED · server + surfaces (day 0)', '#4C1D95');
  const L = (y, k, t, s) => box({ x: 40, y, w: 308, h: 40, k, t, s: s ? [s] : [], ts: 13.5 });
  const R = (y, k, t, s) => box({ x: 536, y, w: 464, h: 40, k, t, s: s ? [s] : [], ts: 13.5 });
  const rows = [
    [116, ['det', 'uw-scan', 'scan.mjs · seed-layers.mjs'], ['det', 'rw-scan', '+ Semantic Model tiers (types, calls)']],
    [164, ['llm', 'uw-analyze-*', 'layer specialists'], ['llm', 'rw-analyze-*', 'unchanged · tagged docs']],
    [212, ['det', 'uw-verify · uw-complete', 'manifest − docs'], ['det', 'rw-verify · rw-complete', 'unchanged']],
    [260, ['llm', 'uw-grill', 'hotspots · questionnaires'], ['llm', 'rw-grill', 'questionnaires → context gaps']],
    [308, null, ['new', 'rw-spec', 'compile the stack-neutral Spec']],
    [356, null, ['new', 'rw-context-gaps', 'interview briefs · ingest answers']],
    [404, null, ['new', 'rw-observe', 'scenarios vs legacy → goldens']],
    [542, null, ['new', 'pl-kit', 'mine · test · version Target Kits']],
    [590, ['llm', 'uw-plan', 'free-text stack decisions'], ['llm', 'pl-plan', 'choose / tailor a Kit (typed profile)']],
    [638, null, ['new', 'pl-generate', 'recipes + blueprints → code + holes']],
    [686, ['llm', 'uw-build · uw-build-layer', 'LLM writes every line'], ['llm', 'pl-build-layer', 'fills holes only']],
    [734, ['det', 'merge-rebuild-map · verify-rebuild', 'names + fields'], ['det', 'pl-verify · pl-parity', '+ types · holes · behaviour']],
    [850, ['art', 'local docs/unwind/ only', 'no shared state · no slices'], ['new', 'Unwind Server (unwind serve)', 'slices · git + SQLite · UI · token auth · convergence']],
    [894, ['det', 'uw-graph · uw-dashboard · uw-publish', 'scripts in skills/scripts'], ['det', 'unwind CLI · MCP adapter', 'one engine; skills shell out; CLI pushes']],
  ];
  for (const [y, l, r] of rows) {
    if (l) b += L(y, ...l);
    b += R(y, ...r);
    if (l) b += arr([[348, y + 20], [534, y + 20]], { dash: true });
  }
  b += `<line x1="520" y1="484" x2="1016" y2="484" stroke="#334155" stroke-width="2" stroke-dasharray="8 5"/>`;
  b += txt(768, 478, 'SPEC — the only Rewind → Play contract', { size: 12.5, weight: 700, fill: '#334155', anchor: 'middle' });
  b += txt(434, 500, 'renamed /', { size: 11.5, fill: '#64748B', anchor: 'middle' });
  b += txt(434, 515, 'evolved', { size: 11.5, fill: '#64748B', anchor: 'middle' });
  svgDoc('02-today-vs-destination', 'Today vs destination: Server + the Rewind / Play split', 1040, 960, b, ['det', 'llm', 'art', 'new']);
};

// ── 03 Concept transfer ───────────────────────────────────────────────────────
D['03-concept-transfer'] = () => {
  current = '03';
  const rows = [
    ['LST (typed, lossless)', 'Semantic Model (typed + bound, not lossless)', 'det', 'Rewind'],
    ['LST artifacts · mass ingest', 'Model Store (per-commit, multi-repo)', 'det', 'Store'],
    ['Search recipes + data tables', 'Detector recipes → typed fact tables', 'det', 'Rewind'],
    ['Prethink context files', 'Spec + tagged layer docs', 'art', 'Rewind → Spec'],
    ['Visitor / ScanningRecipe', 'Target recipe (scan → generate → edit)', 'det', 'Play'],
    ['Declarative YAML recipe', 'Blueprint (whole service / module)', 'human', 'Kit'],
    ['Recipe marketplace / BOM', 'Recipe Book · Target Kit (per client)', 'human', 'Kit repo'],
    ['Preconditions', 'appliesTo(spec node, kit profile)', 'det', 'Play'],
    ['RewriteTest before / after', 'Golden fixtures + idempotence run', 'det', 'Kit'],
    ['JavaTemplate / Refaster', 'Templates mined from exemplar code', 'llm', 'Kit'],
    ['Moddy · learn_recipe', 'Exemplar → recipe promotion', 'llm', 'Play / Kit'],
    ['Moderne MCP server', 'unwind mcp (adapter over the CLI)', 'det', 'MCP'],
    ['Markers (SearchResult)', 'Holes (@unwind-hole) + provenance', 'new', 'Play'],
  ];
  let b = '';
  b += txt(40, 92, 'OpenRewrite / Moderne', { size: 13, weight: 700, fill: '#334155' });
  b += txt(450, 92, 'Unwind destination concept', { size: 13, weight: 700, fill: '#334155' });
  b += txt(870, 92, 'lives in', { size: 13, weight: 700, fill: '#334155' });
  rows.forEach(([l, r, k, where], i) => {
    const y = 104 + i * 42;
    b += box({ x: 40, y, w: 330, h: 34, k: 'src', s: [l], align: 'start' });
    b += arr([[372, y + 17], [446, y + 17]]);
    b += box({ x: 450, y, w: 400, h: 34, k, s: [r], align: 'start' });
    b += chip(870, y + 4, where, 'art', { w: 130 }).svg;
  });
  b += txt(40, 672, 'Copied as concepts only: no Moderne / OpenRewrite code or runtime dependency (MSAL & proprietary licensing).', { size: 12, fill: '#64748B' });
  svgDoc('03-concept-transfer', 'Concept transfer: OpenRewrite / Moderne → Unwind', 1024, 696, b, ['det', 'llm', 'art', 'human', 'new']);
};

// ── 04 Semantic tiers ─────────────────────────────────────────────────────────
D['04-semantic-tiers'] = () => {
  current = '04';
  let b = '';
  const tiers = [
    [96, 'T2 · compiler-accurate (where it runs in Node)', ['TS compiler API: ts.createProgram + TypeChecker', 'pyright (npm) for Python, optional', 'types · symbol binding · calls · handler binding']],
    [236, 'T1 · index-based (optional external tools)', ['SCIP indexers: scip-java · scip-dotnet · scip-python', 'external binaries, Apache-2.0', 'definitions · references · signatures']],
    [376, 'T0 · tree-sitter (always available)', ['today\'s tier: ts/js · python · rust · java · c#', '+ syntactic types · DDL column types', '+ route-prefix composition from the AST']],
  ];
  for (const [y, t, s] of tiers) b += box({ x: 32, y, w: 520, h: 100, k: 'det', t, s, ts: 14.5, align: 'start' });
  b += arr([[150, 196], [150, 234]], { c: 'o' }) + txt(162, 220, 'not available → fall back', { size: 11.5, fill: '#9A3412' });
  b += arr([[150, 336], [150, 374]], { c: 'o' }) + txt(162, 360, 'not available → fall back', { size: 11.5, fill: '#9A3412' });
  b += box({ x: 632, y: 96, w: 352, h: 64, k: 'art', thick: true, t: 'Semantic Model', s: ['scan-manifest.json + additive typed fields'] });
  b += arr([[552, 146], [630, 128]]) + arr([[552, 286], [600, 286], [600, 140], [630, 140]]) + arr([[552, 426], [612, 426], [612, 152], [630, 152]]);
  b += box({ x: 632, y: 196, w: 352, h: 214, k: 'src', align: 'start', valign: 'top', t: 'New facts (all additive)', ts: 13.5, s: [
    'field · param · return types', 'inheritance (extends / implements)', 'decorators / annotations as data',
    'calls · reads · writes · derives_from edges', 'endpoint → handler binding + full path', 'column types · keys · FKs · relations',
    'config / env surface', 'messaging producers / consumers', 'class-qualified, overload-safe ids',
    'body-aware fingerprints (incremental)', 'tier provenance on every fact',
  ] });
  b += txt(32, 512, 'Not copied from the LST: lossless formatting. Unwind never edits the source, so whitespace fidelity buys nothing.', { size: 12, fill: '#64748B' });
  svgDoc('04-semantic-tiers', 'Semantic Model tiers (LST-inspired, graceful fallback)', 1010, 536, b, ['det', 'art']);
};

// ── 05 Kit anatomy ────────────────────────────────────────────────────────────
D['05-kit-anatomy'] = () => {
  current = '05';
  let b = '';
  b += box({ x: 24, y: 80, w: 380, h: 362, k: 'human', align: 'start', valign: 'top', mono: true, t: 'client-kit/  (own git repo)', ts: 14, s: [
    'kit.yaml          name · version · extends',
    'profile.yaml      runtime · framework · orm …',
    'conventions.yaml  naming · layout · errors',
    'type-map.yaml     neutral → target types',
    'recipes/',
    '  entity-drizzle-table/',
    '    recipe.ts',
    '    templates/',
    '    fixtures/spec.json',
    '    fixtures/expected/**',
    'blueprints/',
    '  crud-service.yaml',
    'exemplars/        mined-from provenance',
  ] });
  // Recipe contract
  b += laneLabel(440, 96, 'Recipe contract (ScanningRecipe-style)', '#1E3A8A');
  const steps = [['appliesTo', 'precondition'], ['scan', 'accumulate over Spec'], ['generate', 'per node → files'], ['edit', 'shared files (AST)']];
  steps.forEach(([t, s], i) => {
    const x = 440 + i * 162;
    b += box({ x, y: 108, w: 140, h: 60, k: 'det', t, s: [s], ts: 14 });
    if (i) b += arr([[x - 22, 138], [x - 2, 138]]);
  });
  b += box({ x: 440, y: 196, w: 626, h: 50, k: 'art', t: 'outputs: target files · rebuild-map entries · holes', s: ['pure · deterministic · idempotent · never clobbers filled holes'] });
  b += arr([[753, 168], [753, 194]]);
  // Blueprint
  b += laneLabel(440, 286, 'Blueprint = declarative composition of recipes', '#14532D');
  b += box({ x: 440, y: 298, w: 626, h: 144, k: 'human' });
  b += txt(456, 320, 'blueprints/crud-service.yaml  (crud-service@hono-drizzle-zod)', { size: 13, weight: 700, fill: K.human.title, mono: true });
  const c1 = chips(456, 334, ['scaffold', 'entity → drizzle-table', 'entity → zod-schema', 'entity → repository'], 'det');
  const c2 = chips(456, 368, ['endpoint → hono-route', 'route-registry (edit)', 'endpoint → test'], 'det');
  const c3 = chips(456, 402, ['options: pagination=cursor', 'ids=uuidv7'], 'art');
  b += c1.svg + c2.svg + c3.svg;
  if (Math.max(c1.end, c2.end, c3.end) > 1058) warn('chips overflow blueprint');
  b += arr([[404, 260], [438, 260]], { c: 'gr' }) + txt(408, 250, 'loads', { size: 11, fill: '#14532D' });
  b += txt(24, 478, 'Kits inherit (extends: starter/hono-drizzle-zod) · each rebuild pins kit@version in rebuild-state.json', { size: 12, fill: '#64748B' });
  svgDoc('05-kit-anatomy', 'Target Kit anatomy: recipes and blueprints', 1090, 500, b, ['det', 'art', 'human']);
};

// ── 06 Kit mining ─────────────────────────────────────────────────────────────
D['06-kit-mining'] = () => {
  current = '06';
  let b = '';
  const r1 = [
    ['src', 'Reference app', ['client golden-path service']],
    ['det', 'Rewind', ['Semantic Model + Spec', 'of the reference app']],
    ['det', 'pl-kit mine', ['profile · conventions', 'type-map (from facts)']],
    ['llm', 'Exemplar selection', ['best entity / route / test', 'per blueprint slot']],
  ];
  r1.forEach(([k, t, s], i) => {
    const x = 32 + i * 256;
    b += box({ x, y: 92, w: 220, h: 72, k, t, s });
    if (i) b += arr([[x - 36, 128], [x - 2, 128]]);
  });
  const r2 = [
    ['human', 'Versioned Kit', ['git tag kit@1.2.0', 'pinned per rebuild']],
    ['det', 'Golden tests', ['spec fragment → expected', 'idempotence run']],
    ['det', 'Regenerate gate', ['recipe(fragment) ≡ exemplar ?', 'via the verifier']],
    ['llm', 'Parameterize', ['exemplar → template', '+ recipe.ts']],
  ];
  r2.forEach(([k, t, s], i) => {
    const x = 32 + i * 256;
    b += box({ x, y: 244, w: 220, h: 72, k, t, s, thick: t === 'Regenerate gate' });
    if (i) b += arr([[x - 2, 280], [x - 34, 280]]);
  });
  b += arr([[910, 164], [910, 242]]);
  b += arr([[654, 316], [654, 352], [878, 352], [878, 318]], { c: 'o', dash: true });
  b += txt(766, 370, 'fail → re-parameterize', { size: 11.5, fill: '#9A3412', anchor: 'middle' });
  b += txt(527, 272, 'pass', { size: 11.5, fill: '#1E3A8A', anchor: 'middle' });
  b += box({ x: 32, y: 392, w: 990, h: 70, k: 'src', align: 'start', t: 'Secondary authoring paths', ts: 13, s: ['hand-authored recipes (TS + templates) · in-flight promotion: the LLM builds the first instance', 'during a rebuild, which is promoted to a recipe that generates the remaining N'] });
  svgDoc('06-kit-mining', 'Kit mining: from a reference app to a versioned recipe book', 1054, 486, b, ['det', 'llm', 'human']);
};

// ── 07 Play loop ──────────────────────────────────────────────────────────────
D['07-play-loop'] = () => {
  current = '07';
  let b = '';
  b += box({ x: 32, y: 84, w: 190, h: 56, k: 'art', t: 'Spec', s: ['MUST / SHOULD nodes'] });
  b += box({ x: 248, y: 84, w: 190, h: 56, k: 'human', t: 'Target Kit', s: ['pinned kit@version'] });
  b += box({ x: 32, y: 176, w: 406, h: 62, k: 'det', t: 'Generate (blueprint)', s: ['recipes: scan → generate → edit'] });
  b += arr([[127, 140], [127, 174]]) + arr([[343, 140], [343, 174]], { c: 'gr' });
  b += box({ x: 32, y: 270, w: 406, h: 56, k: 'art', t: 'Target code with holes', s: ['structure correct by construction'] });
  b += box({ x: 32, y: 358, w: 406, h: 56, k: 'llm', t: 'LLM fills holes', s: ['business logic only · keeps @unwind-id'] });
  b += box({ x: 32, y: 446, w: 406, h: 62, k: 'det', thick: true, t: 'Verify', s: ['structure + types · unfilled hole = claimed'] });
  b += box({ x: 32, y: 540, w: 406, h: 50, k: 'art', t: 'MUST completeness ≥ target ?', s: ['yes → done · no → loop'] });
  b += arr([[235, 238], [235, 268]]) + arr([[235, 326], [235, 356]]) + arr([[235, 414], [235, 444]]) + arr([[235, 508], [235, 538]]);
  b += arr([[438, 565], [462, 565], [462, 207], [440, 207]], { c: 'o', dash: true });
  b += txt(470, 392, 'loop', { size: 11.5, fill: '#9A3412' });
  // Code card
  const code = [
    ['// generated: endpoint→hono-route (hono-drizzle-zod@1.0.0)', '#64748B'],
    ['app.post(\'/orders\',', '#0F172A'],
    ['  zValidator(\'json\', OrderCreate),', '#0F172A'],
    ['  async (c) => {', '#0F172A'],
    ['    const input = c.req.valid(\'json\')', '#0F172A'],
    ['    // @unwind-hole id=operation:src/orders/service.ts:placeOrder', '#9A3412'],
    ['    //   kind=operation doc=layers/service/orders.md#placeorder', '#9A3412'],
    ['    throw new NotImplemented(\'placeOrder\')', '#9A3412'],
    ['    // @unwind-end', '#9A3412'],
    ['  })', '#0F172A'],
  ];
  b += `<rect x="520" y="140" width="580" height="${code.length * 20 + 44}" rx="10" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.6"/>`;
  b += txt(536, 162, 'src/routes/orders.ts', { size: 12, weight: 700, fill: '#334155', mono: true });
  b += `<rect x="528" y="${170 + 5 * 20 + 1}" width="564" height="${4 * 20}" rx="6" fill="#FFF7ED" stroke="#EA580C" stroke-width="1.2" stroke-dasharray="4 3"/>`;
  code.forEach(([line, fill], i) => {
    if (textW(line, 11.5, { mono: true }) > 560) warn(`code overflows: ${line}`);
    b += txt(536, 184 + i * 20, line, { size: 11.5, fill, mono: true });
  });
  b += arr([[700, 112], [700, 136]], { c: 'b' });
  b += txt(708, 106, 'method · path · schema exact → verifies as equivalent', { size: 11.5, fill: '#1E3A8A' });
  b += arr([[800, 400], [800, 374]], { c: 'o' });
  b += txt(808, 414, 'only this region is written by the LLM', { size: 11.5, fill: '#9A3412' });
  b += txt(520, 450, 'Regeneration rewrites generator-owned code but preserves', { size: 12, fill: '#64748B' });
  b += txt(520, 466, 'filled holes, so the loop is safe to re-run.', { size: 12, fill: '#64748B' });
  svgDoc('07-play-loop', 'Play build loop: generate → holes → fill → verify', 1124, 612, b, ['det', 'llm', 'art', 'human']);
};

// ── 08 Behaviour parity ───────────────────────────────────────────────────────
D['08-behaviour-parity'] = () => {
  current = '08';
  let b = '';
  b += box({ x: 40, y: 84, w: 190, h: 64, k: 'art', thick: true, t: 'Spec', s: ['endpoints · entities · rules'] });
  b += box({ x: 270, y: 84, w: 320, h: 64, k: 'llm', t: 'Scenario generation', s: ['Spec · MUST rules · grill · legacy tests', 'recorded traffic (HAR / proxy / UI)'] });
  b += box({ x: 630, y: 84, w: 390, h: 64, k: 'art', t: 'Scenarios', s: ['given · when · then (or record) · covers: [ids]'] });
  b += arr([[230, 116], [268, 116]]) + arr([[590, 116], [628, 116]]);
  b += box({ x: 40, y: 184, w: 980, h: 76, k: 'lane' });
  b += laneLabel(56, 204, 'Boundary drivers (pluggable; each degrades to "manual / not runnable")', '#1E3A8A');
  b += chips(56, 218, ['HTTP / API', 'DB state snapshots', 'Browser: Playwright + agent recording', 'Desktop: computer-use (best-effort)', 'CLI / batch', 'Messaging'], 'det').svg;
  b += arr([[825, 148], [825, 182]]);
  // Legacy branch
  b += box({ x: 40, y: 300, w: 220, h: 62, k: 'src', t: 'Legacy app', s: ['sandbox only, never prod'] });
  b += box({ x: 290, y: 300, w: 230, h: 62, k: 'art', t: 'Goldens', s: ['responses · DB side-effects'] });
  b += box({ x: 40, y: 400, w: 480, h: 62, k: 'llm', t: 'rw-observe: enrich the Spec', s: ['provenance "observed" · disagreements → grill questions'] });
  b += arr([[150, 260], [150, 298]]) + arr([[260, 331], [288, 331]]) + arr([[405, 362], [405, 398]]);
  b += arr([[40, 431], [22, 431], [22, 116], [38, 116]], { c: 'o', dash: true });
  // Target branch
  b += box({ x: 580, y: 300, w: 200, h: 62, k: 'src', t: 'Target app', s: ['rebuilt service'] });
  b += box({ x: 810, y: 300, w: 210, h: 62, k: 'det', t: 'Normalize + map', s: ['scrub ids / time · vs goldens'] });
  b += box({ x: 580, y: 400, w: 440, h: 62, k: 'art', thick: true, t: 'Parity report', s: ['parity % over [MUST] scenarios → loop termination signal'] });
  b += arr([[680, 260], [680, 298]]) + arr([[780, 331], [808, 331]]) + arr([[915, 362], [915, 398]]);
  b += txt(40, 496, 'Kit recipes also emit the scenarios as native target tests (e.g. vitest + supertest), so parity becomes the rebuilt repo\'s regression suite.', { size: 12, fill: '#64748B' });
  b += txt(40, 514, 'Legacy can\'t run? Scenarios stay as Spec acceptance criteria; goldens come from domain experts via the questions/ flow.', { size: 12, fill: '#64748B' });
  svgDoc('08-behaviour-parity', 'Behaviour parity: the same scenarios against legacy and rebuild', 1044, 536, b, ['det', 'llm', 'art']);
};

// ── 09 Context gaps ───────────────────────────────────────────────────────────
D['09-context-gaps'] = () => {
  current = '09';
  let b = '';
  b += laneLabel(32, 92, 'Signals', '#334155');
  const ins = ['Spec + layer docs', 'grill findings', 'parity observations', 'git: churn · authors · TODO'];
  ins.forEach((s, i) => {
    b += box({ x: 32, y: 104 + i * 48, w: 220, h: 38, k: 'art', s: [s] });
    b += arr([[252, 123 + i * 48], [284, 123 + i * 48], [284, 176], [298, 176]]);
  });
  b += box({ x: 300, y: 140, w: 240, h: 72, k: 'llm', t: 'rw-context-gaps', s: ['agents classify gaps', 'with evidence'] });
  b += box({ x: 590, y: 96, w: 230, h: 50, k: 'det', t: 'Settled in-run', s: ['answerable from code'] });
  b += box({ x: 590, y: 176, w: 230, h: 72, k: 'art', t: 'Gap register', s: ['who-can-answer · priority', 'linked Spec ids'] });
  b += arr([[540, 160], [565, 160], [565, 121], [588, 121]]) + arr([[540, 196], [565, 196], [565, 212], [588, 212]]);
  b += box({ x: 870, y: 96, w: 230, h: 210, k: 'art', align: 'start', valign: 'top', t: 'Routed interview briefs', ts: 13.5, s: ['business stakeholders', 'end users (per persona)', 'existing developers', 'ops / support', 'compliance', '— each brief: context · goals ·', 'questions + probes · who to ask'] });
  b += arr([[820, 212], [868, 212]]);
  b += box({ x: 870, y: 350, w: 230, h: 72, k: 'human', thick: true, t: 'Interview tool', s: ['your AI-interview tool', 'or humans: method open'] });
  b += box({ x: 590, y: 350, w: 230, h: 72, k: 'art', t: 'Responses', s: ['interviews/responses/*', 'gap id → answer · role'] });
  b += box({ x: 300, y: 350, w: 240, h: 72, k: 'llm', t: 'context-ingest', s: ['map answers → gaps', 'provenance interview:role:date'] });
  b += box({ x: 32, y: 350, w: 220, h: 72, k: 'art', thick: true, t: 'Spec, enriched', s: ['rationale · retags · new', 'scenarios · conflicts shown'] });
  b += arr([[985, 306], [985, 348]], { c: 'gr' }) + arr([[870, 386], [822, 386]], { c: 'gr' }) + arr([[590, 386], [542, 386]]) + arr([[300, 386], [254, 386]]);
  b += txt(32, 462, 'Context coverage = share of [MUST] Spec nodes with no open high-priority gap, reported next to doc coverage and parity %.', { size: 12, fill: '#64748B' });
  b += txt(32, 480, 'The grill\'s checkbox questionnaires (questions/) become one audience-specific output of this round: one ingest path, not two.', { size: 12, fill: '#64748B' });
  svgDoc('09-context-gaps', 'Context gaps: ask the people who know what the code can\'t say', 1124, 502, b, ['det', 'llm', 'art', 'human']);
};

// ── 10 Surfaces ───────────────────────────────────────────────────────────────
D['10-surfaces'] = () => {
  current = '10';
  let b = '';
  const cols = [
    [40, 'skills (rw-*, pl-*) · CI · humans', 'any agent via Bash', 'unwind CLI · PRIMARY', ['does the work · --json · offline-first'], true, 'det'],
    [390, 'team · reviewers · leads', 'browser (basic UI)', 'unwind serve · DAY 0', ['system of record · slices · UI'], true, 'new'],
    [740, 'MCP clients', 'non-CLI agents', 'unwind mcp · later', ['stdio adapter, 1:1 with CLI / API'], false, 'det'],
  ];
  for (const [x, c1, c2, t, s, thick, k] of cols) {
    b += box({ x, y: 84, w: 320, h: 56, k: 'src', s: [c1, c2] });
    b += arr([[x + 160, 140], [x + 160, 172]]);
    b += box({ x, y: 174, w: 320, h: 60, k, t, s, thick });
    b += arr([[x + 160, 234], [x + 160, 276]]);
  }
  b += arr([[360, 196], [388, 196]], { c: 'p' });
  b += txt(374, 190, 'push', { size: 10.5, fill: '#4C1D95', anchor: 'middle' });
  b += arr([[388, 214], [362, 214]], { c: 'p' });
  b += txt(374, 228, 'pull', { size: 10.5, fill: '#4C1D95', anchor: 'middle' });
  b += box({ x: 40, y: 278, w: 1020, h: 82, k: 'det', thick: true, t: '@unwind/engine', ts: 17, s: ['model · rewind (scan, detectors, spec, observe, context-gaps) · play (kits, recipes, generate, verify, parity) · slices'] });
  b += arr([[200, 360], [200, 398]]) + arr([[550, 360], [550, 398]], { c: 'p' }) + arr([[880, 360], [880, 398]], { c: 'p' });
  b += box({ x: 40, y: 400, w: 320, h: 56, k: 'art', t: 'local docs/unwind/', s: ['working copy · works offline'] });
  b += box({ x: 390, y: 400, w: 320, h: 56, k: 'art', t: 'project git repo', s: ['server · artifacts · full history'] });
  b += box({ x: 740, y: 400, w: 320, h: 56, k: 'art', t: 'node:sqlite', s: ['auth · slices · metrics · index'] });
  b += txt(40, 492, 'The CLI does the work next to the code; the server stores, merges, indexes and shows it. MCP and HTTP add no logic of their own.', { size: 12, fill: '#64748B' });
  svgDoc('10-surfaces', 'Surfaces: one engine, CLI-first, shared server from day 0', 1100, 512, b, ['det', 'new', 'art']);
};

// ── 11 Roadmap ────────────────────────────────────────────────────────────────
D['11-roadmap'] = () => {
  current = '11';
  const P = [
    ['0', 'Design', 'design doc set + HTML site', 'reviewed and agreed', 'art'],
    ['1', 'Shared model + Spec v1', '@unwind/model · rw-spec · typed stack profile', 'drizzle-cube → valid Spec, typed entities + endpoints', 'det'],
    ['2', 'CLI + Server MVP + split', 'unwind CLI · serve (Hono, git, sqlite) · tokens · push/pull · slices', 'team pushes ≥3 slices to one server; board shows them; 409 path works', 'new'],
    ['3', 'Kits + recipe engine + starter kit', 'kit schema · scan/generate/edit runtime · holes · hono-drizzle-zod', 'db + api slices generate, compile, verify equivalent; re-run = no diff', 'new'],
    ['4', 'Semantic Model T0 / T2', 'TS compiler tier · calls/handler/reads/writes · detector registry', 'TS sources fully typed; verifier diffs field types', 'det'],
    ['5', 'Kit mining', 'pl-kit mine · exemplar → recipe · regenerate gate · versioning', 'kit mined from repo A rebuilds repo B in house style', 'new'],
    ['5b', 'Behaviour parity', 'scenarios · HTTP + DB drivers · rw-observe · pl-parity', 'API scenarios recorded on legacy, replayed on rebuild → parity %', 'new'],
    ['5c', 'Context gaps', 'gap register · routed briefs · response adapter · context-ingest', 'briefs for ≥3 audiences; answers ingested with provenance', 'new'],
    ['5d', 'Slice convergence + Play by slice', 'merge fragments · uncovered/overlaps/conflicts/seams · strangler order', '100% convergence; one slice rebuilt + verified via seam adapters', 'new'],
    ['6', 'MCP adapter', 'unwind mcp, 1:1 with the CLI / API', 'non-Claude agents get identical results', 'det'],
    ['7', 'App depth + portfolio', 'metrics over time · conflict UX · answers in UI · Recipe Book', 'portfolio across N projects; kits browsable / editable', 'det'],
    ['8', 'Breadth', 'SCIP tier (Java / C# / Python) · Spring + FastAPI kits · blueprints', '≥3 typed source languages · ≥3 starter kits', 'det'],
  ];
  let b = `<line x1="62" y1="96" x2="62" y2="${96 + (P.length - 1) * 66}" stroke="#CBD5E1" stroke-width="3"/>`;
  P.forEach(([n, t, builds, exit, k], i) => {
    const y = 96 + i * 66;
    const c = K[k];
    b += `<circle cx="62" cy="${y}" r="17" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2"${c.dash ? ' stroke-dasharray="3 2"' : ''}/>`;
    b += txt(62, y + 4.5, n, { size: 12.5, weight: 700, fill: c.title, anchor: 'middle' });
    b += txt(96, y - 6, `Phase ${n} · ${t}`, { size: 14, weight: 700, fill: '#0F172A' });
    b += txt(96, y + 11, `builds: ${builds}`, { size: 11.5, fill: '#475569' });
    b += txt(96, y + 27, `exit: ${exit}`, { size: 11.5, fill: '#15803D' });
  });
  svgDoc('11-roadmap', 'Roadmap: each phase shippable, graceful fallback kept', 720, 96 + (P.length - 1) * 66 + 52, b, ['det', 'new', 'art']);
};

// ── 12 Server ─────────────────────────────────────────────────────────────────
D['12-server'] = () => {
  current = '12';
  let b = '';
  // left: developer machines (code stays here)
  b += `<rect x="16" y="76" width="400" height="404" rx="10" fill="#FBFCFE" stroke="#CBD5E1" stroke-width="1.6" stroke-dasharray="6 4"/>`;
  b += laneLabel(32, 96, 'DEVELOPER MACHINES · CI', '#1E3A8A');
  b += box({ x: 32, y: 112, w: 368, h: 56, k: 'src', t: 'Source repo', s: ['code never leaves this boundary'] });
  b += arr([[216, 168], [216, 190]]);
  b += box({ x: 32, y: 192, w: 368, h: 70, k: 'llm', t: 'Skills + agents (rw-* / pl-*)', s: ['analyze · grill · fill holes', 'call the CLI via Bash'] });
  b += arr([[216, 262], [216, 284]]);
  b += box({ x: 32, y: 286, w: 368, h: 70, k: 'det', thick: true, t: 'unwind CLI', s: ['scan · spec · generate · verify', 'login · push · pull · status'] });
  b += arr([[216, 356], [216, 378]]);
  b += box({ x: 32, y: 380, w: 368, h: 84, k: 'art', t: 'docs/unwind/ (working copy)', s: ['~/.config/unwind/credentials.json (0600)', 'secret scrub + allow-list before push'] });
  // boundary
  b += `<line x1="478" y1="130" x2="478" y2="476" stroke="#DC2626" stroke-width="2" stroke-dasharray="7 5"/>`;
  b += txt(478, 98, 'artifacts only', { size: 12, weight: 700, fill: '#B91C1C', anchor: 'middle' });
  b += txt(478, 114, 'no source code', { size: 11.5, fill: '#B91C1C', anchor: 'middle' });
  b += arr([[400, 310], [538, 310]], { c: 'p', w: 2 });
  b += `<rect x="460" y="290" width="36" height="16" fill="#ffffff"/><rect x="462" y="342" width="32" height="16" fill="#ffffff"/><rect x="434" y="378" width="88" height="17" fill="#ffffff"/>`;
  b += txt(478, 302, 'push', { size: 11, fill: '#4C1D95', anchor: 'middle' });
  b += arr([[538, 338], [402, 338]], { c: 'p', w: 2 });
  b += txt(478, 354, 'pull', { size: 11, fill: '#4C1D95', anchor: 'middle' });
  b += txt(478, 390, 'Bearer uwt_…', { size: 11, fill: '#475569', anchor: 'middle', mono: true });
  // right: server
  b += `<rect x="540" y="76" width="544" height="404" rx="10" fill="#F5F3FF" stroke="#7C3AED" stroke-width="1.8"/>`;
  b += laneLabel(556, 96, 'UNWIND SERVER · one Docker image · unwind serve', '#4C1D95');
  b += box({ x: 556, y: 112, w: 246, h: 70, k: 'new', t: 'Hono API', s: ['zod-validated · token auth', 'hono/client types → CLI + UI'] });
  b += box({ x: 822, y: 112, w: 246, h: 70, k: 'new', t: 'UI (React + Vite)', s: ['TanStack Query · daisyUI', 'slice board · docs · graph'] });
  b += box({ x: 556, y: 206, w: 512, h: 64, k: 'det', t: 'Engine: convergence · metrics · indexing', s: ['merge slice Spec fragments · uncovered / overlaps / conflicts / seams'] });
  b += arr([[679, 182], [679, 204]]) + arr([[945, 182], [945, 204]]);
  b += arr([[679, 270], [679, 300]]) + arr([[945, 270], [945, 300]]);
  b += box({ x: 556, y: 302, w: 246, h: 96, k: 'art', t: 'git: repos/<project>.git', s: ['docs · Spec · findings · briefs', 'commit per push, by owner', 'optional mirror to GitHub'] });
  b += box({ x: 822, y: 302, w: 246, h: 96, k: 'art', t: 'node:sqlite (Drizzle)', s: ['users · hashed tokens · slices', 'runs · metrics · FTS5 search', 'index rebuildable from git'] });
  b += box({ x: 556, y: 416, w: 512, h: 48, k: 'human', s: ['Team in the browser: leads, reviewers, experts (token login)'] });
  b += txt(24, 510, 'TLS / SSO via a reverse proxy later. Backup = copy the /data volume. The server never needs repository access.', { size: 12, fill: '#64748B' });
  svgDoc('12-server', 'Unwind Server: shared system of record, code stays local', 1100, 530, b, ['det', 'llm', 'art', 'human', 'new']);
};

// ── 13 Slices ─────────────────────────────────────────────────────────────────
D['13-slices'] = () => {
  current = '13';
  let b = '';
  b += box({ x: 24, y: 84, w: 210, h: 260, k: 'src', t: 'Codebase', s: [] , valign: 'top'});
  const sl = [['orders', 'dana, sam'], ['billing', 'lee'], ['catalog', 'agent + kim'], ['auth', 'ravi']];
  sl.forEach(([n, o], i) => {
    const y = 128 + i * 52;
    b += box({ x: 40, y, w: 178, h: 42, k: 'new', s: [`${n} · ${o}`], rx: 8 });
  });
  b += txt(129, 338, 'proposed from import graph', { size: 10.5, fill: '#64748B', anchor: 'middle' });
  sl.forEach((_, i) => { const y = 149 + i * 52; b += arr([[218, y], [266, y]]); });
  b += `<rect x="268" y="84" width="236" height="260" rx="10" fill="#FBFCFE" stroke="#CBD5E1" stroke-width="1.6" stroke-dasharray="6 4"/>`;
  b += laneLabel(280, 104, 'PARALLEL REWIND', '#9A3412');
  sl.forEach(([n], i) => {
    const y = 128 + i * 52;
    b += box({ x: 280, y, w: 212, h: 42, k: 'llm', s: [`${n}: analyze → grill → frag`], rx: 8 });
  });
  sl.forEach((_, i) => { const y = 149 + i * 52; b += arr([[492, y], [540, 214]], { c: 'o' }); });
  b += box({ x: 542, y: 120, w: 250, h: 188, k: 'det', thick: true, t: 'Convergence', s: ['merge fragments by candidate id', '', 'uncovered: ids in no slice', 'overlaps: id in 2+ slices', 'conflicts: same id, differs', 'seams: cross-slice edges', '', 'convergence % → 100'] });
  b += arr([[792, 214], [830, 214]]);
  b += box({ x: 832, y: 166, w: 244, h: 96, k: 'art', thick: true, t: 'Project Spec', s: ['spec/project.spec.json', 'seams = interface contracts', 'converged at 100%'] });
  // Play row
  b += `<rect x="24" y="378" width="1052" height="128" rx="10" fill="#FBFCFE" stroke="#CBD5E1" stroke-width="1.6" stroke-dasharray="6 4"/>`;
  b += laneLabel(40, 398, 'PLAY BY SLICE · strangler order from the seam graph', '#4C1D95');
  b += arr([[954, 262], [954, 300], [954, 300], [954, 376]]);
  const ps = [['auth', 'cut-over'], ['catalog', 'verified'], ['orders', 'filling'], ['billing', 'planned']];
  ps.forEach(([n, st], i) => {
    const x = 40 + i * 232;
    b += box({ x, y: 414, w: 200, h: 72, k: i < 2 ? 'det' : 'new', t: n, s: [st, i ? 'seams: adapters → legacy' : 'no upstream seams'] });
    if (i < ps.length - 1) b += arr([[x + 200, 450], [x + 230, 450]], { c: 'p' });
  });
  b += txt(24, 536, 'Rewind states: proposed → claimed → analyzing → covered → grilled → spec-ready → accepted. Play: planned → generating → filling → verified → cut-over.', { size: 12, fill: '#64748B' });
  svgDoc('13-slices', 'Slices: parallel analysis, convergence, Play by slice', 1100, 556, b, ['det', 'llm', 'art', 'new']);
};

// ── 14 Comparison with code-modernization ────────────────────────────────────
D['14-compare-code-modernization'] = () => {
  current = '14';
  const W = 1180, LX = 24, RX = 826, BW = 330, BH = 46, Y0 = 112, STEP = 58;
  const yc = (i) => Y0 + i * STEP + BH / 2;
  let b = '';
  b += laneLabel(LX, 96, 'code-modernization (Anthropic · Apache-2.0)', '#14532D');
  b += laneLabel(RX, 96, 'Unwind destination', '#1E3A8A');
  const left = [
    ['human', 'modernize', 'INTENT.md captured once'],
    ['human', 'preflight', '5 human questions · toolchain proof'],
    ['llm', 'assess', 'scc/cloc · 3 parallel agents'],
    ['llm', 'map', 'topology.json · LLM-written parser'],
    ['llm', 'extract-rules', 'RULE cards · referee · P0 panel'],
    ['human', 'review', 'SME confirms / wrong / discuss'],
    ['human', 'brief', 'phases · Behavior Contract · approval'],
    ['llm', 'uplift / transform / reimagine', 'pilot → PLAYBOOK → fan-out'],
    ['det', 'verify', 'proof pack · canary · fresh inputs'],
    ['llm', 'harden', 'security findings · patch'],
  ];
  const right = [
    ['new', 'rw-start', 'front door · status + next command'],
    ['det', 'scan', 'tree-sitter manifest · candidate ids'],
    ['llm', 'analyze', 'layer docs tagged [MUST]/[SHOULD]/[DON\'T]'],
    ['det', 'coverage', 'manifest − docs → loop to 100%'],
    ['llm', 'grill', 'hotspots · evidence-quoted verdicts'],
    ['human', 'context gaps', 'routed stakeholder interviews'],
    ['art', 'rw-spec → Spec', 'stack-neutral typed IR'],
    ['new', 'Server + slices', 'push · converge · seams'],
    ['det', 'Play · kits + holes', 'recipes generate · LLM fills holes'],
    ['det', 'verify', 'structural diff + behaviour parity'],
  ];
  const col = (x, items) => items.forEach(([k, t, s], i) => {
    const y = Y0 + i * STEP;
    b += box({ x, y, w: BW, h: BH, k, t, s: [s], ts: 13, align: 'start', rx: 8 });
    if (i < items.length - 1) b += arr([[x + 30, y + BH], [x + 30, y + STEP - 2]]);
  });
  col(LX, left);
  col(RX, right);
  // Borrow arrows: left box right edge → right box left edge, label on white background
  const borrow = (li, ri, label) => {
    const y1 = yc(li), y2 = yc(ri), x1 = LX + BW, x2 = RX;
    b += arr([[x1, y1], [x1 + 50, y1], [x2 - 50, y2], [x2 - 2, y2]], { c: 'p', dash: true });
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const tw = textW(label, 11.5, { bold: true }) + 14;
    b += `<rect x="${mx - tw / 2}" y="${my - 12}" width="${tw}" height="18" rx="4" fill="#ffffff" stroke="#DDD6FE" stroke-width="1"/>`;
    b += txt(mx, my + 1.5, label, { size: 11.5, weight: 600, fill: '#4C1D95', anchor: 'middle' });
  };
  borrow(1, 0, 'preflight + INTENT → rw-start');
  borrow(4, 6, 'rule cards + referee panel → Spec operations');
  borrow(7, 8, 'pilot → playbook → circuit breaker → Play loop');
  borrow(8, 9, 'proof pack · canary · fresh inputs → parity');
  // Cross-cutting banner
  const by = Y0 + 10 * STEP + 6;
  b += box({ x: LX, y: by, w: W - 2 * LX, h: 46, k: 'new', t: 'untrusted-content discipline + secrets quarantine → every Unwind agent, uw-publish and Server ingest', ts: 13 });
  b += arr([[LX + BW / 2, Y0 + 9 * STEP + BH], [LX + BW / 2, by - 2]], { c: 'p', dash: true });
  b += arr([[RX + BW / 2, by], [RX + BW / 2, Y0 + 9 * STEP + BH + 2]], { c: 'p', dash: true });
  b += txt(LX, by + 74, 'Dashed purple = an idea Unwind borrows (see 01b §1b.8). Unwind keeps its own deterministic spine: scan, candidate ids, coverage by set arithmetic.', { size: 12, fill: '#64748B' });
  svgDoc('14-compare-code-modernization', 'code-modernization vs Unwind: what we borrow', W, by + 96, b, ['det', 'llm', 'art', 'human', 'new']);
};

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
for (const [name, fn] of Object.entries(D)) if (!only.length || only.some((o) => name.startsWith(o))) fn();
