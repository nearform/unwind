#!/usr/bin/env node
/**
 * grill-brief.mjs
 *
 * Emits docs/unwind/.cache/grill-brief.json — the deterministic "risk brief"
 * that grounds the uw-grill pass. Where plan-brief.mjs answers "how big is
 * this?", the grill brief answers "where is the business logic most likely to
 * be wrong, or too thinly specified to rebuild?".
 *
 * It does NOT judge anything. It ranks hotspots into named buckets, each entry
 * carrying the signal that put it there, so an LLM explorer knows where to look
 * and a human can audit why. Deliberately no composite "risk score": weighted
 * floats have unfalsifiable weights and invite sorting instead of thinking.
 * `flagCount` is an integer count of independent boolean conditions, and every
 * increment is a stated fact.
 *
 * Fuses three deterministic inputs (manifest is the only hard dependency):
 *   - scan-manifest.json            (files+symbols, importMap, contracts)
 *   - .cache/coverage/{layer}.json  (what's documented; run verify-coverage.mjs)
 *   - docs/unwind/layers/ ** .md    (tags + doc body shape per item)
 *
 * NOTE: it must NOT read docs-bundle.json — that is written by build-graph.mjs,
 * which runs AFTER uw-plan, so it does not exist at grill time.
 *
 * Usage:
 *   node grill-brief.mjs <projectRoot> [--layers a,b] [outputPath]
 *   node grill-brief.mjs <projectRoot> --merge      # fold specialist findings
 *
 * Exit codes match plan-brief.mjs: 1 bad args, 2 manifest missing.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadCore } from "./_core.mjs";

const core = await loadCore();
const {
  candidatesByLayer,
  extractDocumentedItems,
  docDirsForLayer,
  stemOf,
  testTargetStem,
} = core;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const projectRootArg = argv.find((a) => !a.startsWith("--"));
if (!projectRootArg) {
  process.stderr.write(
    "Usage: node grill-brief.mjs <projectRoot> [--layers a,b] [--merge]\n",
  );
  process.exit(1);
}
const projectRoot = resolve(projectRootArg);
if (!existsSync(projectRoot)) {
  process.stderr.write(`grill-brief: projectRoot does not exist: ${projectRoot}\n`);
  process.exit(1);
}
const MERGE_MODE = argv.includes("--merge");
const layersFilter = (() => {
  const a = argv.find((x) => x.startsWith("--layers="));
  if (!a) return null;
  return new Set(a.slice("--layers=".length).split(",").map((s) => s.trim()).filter(Boolean));
})();

const docsRoot = join(projectRoot, "docs/unwind");
const cacheDir = join(docsRoot, ".cache");
const grillDir = join(cacheDir, "grill");
const manifestPath = join(cacheDir, "scan-manifest.json");
if (!existsSync(manifestPath)) {
  process.stderr.write(
    `grill-brief: scan manifest not found at ${manifestPath}\ngrill-brief: Run scan.mjs first.\n`,
  );
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const files = Array.isArray(manifest.files) ? manifest.files : [];
const fileByPath = new Map(files.map((f) => [f.path, f]));
const linkFormat = manifest.repository?.linkFormat ?? "";

const sourceLink = (path, start, end) =>
  linkFormat
    ? linkFormat.replace("{path}", path).replace("{start}", start).replace("{end}", end)
    : `${path}#L${start}`;

// ---------------------------------------------------------------------------
// --merge : fold specialist findings into grill-findings.json
// ---------------------------------------------------------------------------
if (MERGE_MODE) {
  const byLayerAll = candidatesByLayer(manifest);
  const knownIds = new Set();
  for (const cands of Object.values(byLayerAll)) for (const c of cands) knownIds.add(c.id);

  const raw = [];
  if (existsSync(grillDir)) {
    for (const f of readdirSync(grillDir)) {
      if (!f.endsWith(".json") || f === "seeds") continue;
      const p = join(grillDir, f);
      try {
        const doc = JSON.parse(readFileSync(p, "utf-8"));
        for (const fi of doc.findings ?? []) raw.push(fi);
      } catch {
        process.stderr.write(`grill-brief: ignoring malformed ${f}\n`);
      }
    }
  }

  // Evidence is mandatory. This is the ONLY defence against a subagent
  // inventing a plausible-sounding business flaw and it being mailed to a
  // domain expert with our name on it. No quote, no finding.
  const rejected = [];
  const kept = [];
  const seen = new Set();
  for (const f of raw) {
    const ev = f.evidence ?? {};
    const why = [];
    if (!ev.file) why.push("no evidence.file");
    if (!Number.isFinite(ev.line)) why.push("no evidence.line");
    if (!ev.quote || String(ev.quote).trim() === "") why.push("no evidence.quote");
    if (!f.category) why.push("no category");
    if (f.candidateId && !knownIds.has(f.candidateId)) why.push("candidateId not in manifest");
    if (ev.file && !fileByPath.has(ev.file)) why.push("evidence.file not in manifest");
    if (why.length > 0) {
      rejected.push({ title: f.title ?? "(untitled)", reasons: why });
      continue;
    }
    const dedupe = `${f.category}|${ev.file}|${ev.line}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    kept.push(f);
  }

  // Stable ids: sort by layer order, then category, file, line, so re-runs
  // don't renumber questions an expert may already be answering.
  const LAYER_ORDER = [
    "database", "domain", "service", "api", "messaging",
    "frontend", "tests", "infrastructure", "unassigned",
  ];
  kept.sort((a, b) => {
    const la = LAYER_ORDER.indexOf(a.layer ?? "unassigned");
    const lb = LAYER_ORDER.indexOf(b.layer ?? "unassigned");
    return (
      (la < 0 ? 99 : la) - (lb < 0 ? 99 : lb) ||
      String(a.category).localeCompare(String(b.category)) ||
      String(a.evidence.file).localeCompare(String(b.evidence.file)) ||
      (a.evidence.line ?? 0) - (b.evidence.line ?? 0)
    );
  });

  // Preserve ids (and verdicts) already assigned by a previous pass, so an
  // in-flight questionnaire keeps its numbering.
  const findingsPath = join(cacheDir, "grill-findings.json");
  const priorById = new Map();
  const priorByDedupe = new Map();
  if (existsSync(findingsPath)) {
    try {
      const prior = JSON.parse(readFileSync(findingsPath, "utf-8"));
      for (const f of prior.findings ?? []) {
        priorById.set(f.id, f);
        if (f.evidence) priorByDedupe.set(`${f.category}|${f.evidence.file}|${f.evidence.line}`, f);
      }
    } catch {
      process.stderr.write("grill-brief: ignoring malformed grill-findings.json\n");
    }
  }

  let n = 0;
  const nextId = () => {
    // Skip numbers already taken by findings carried over from a prior pass, so
    // a questionnaire an expert is mid-way through answering never renumbers.
    let id;
    do {
      id = `GQ-${String(++n).padStart(4, "0")}`;
    } while (priorById.has(id));
    return id;
  };
  const findings = kept.map((f) => {
    const dedupe = `${f.category}|${f.evidence.file}|${f.evidence.line}`;
    const prior = priorByDedupe.get(dedupe);
    const mf = fileByPath.get(f.evidence.file);
    return {
      ...f,
      id: prior?.id ?? nextId(),
      // contentHash lets uw-refresh mark a finding stale rather than keep
      // asserting it about code that has since changed.
      contentHash: mf?.contentHash ?? null,
      evidence: {
        ...f.evidence,
        link: f.evidence.link ?? sourceLink(f.evidence.file, f.evidence.line, f.evidence.line),
      },
      verdict: prior?.verdict ?? f.verdict ?? null,
      answeredAt: prior?.answeredAt ?? null,
      notes: prior?.notes ?? null,
    };
  });

  const out = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    total: findings.length,
    openCount: findings.filter((f) => !f.verdict).length,
    rejectedCount: rejected.length,
    findings,
  };
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(findingsPath, JSON.stringify(out, null, 2), "utf-8");
  process.stderr.write(
    `grill-brief --merge: kept=${findings.length} open=${out.openCount} ` +
      `rejected=${rejected.length} (of ${raw.length} raw)\n`,
  );
  for (const r of rejected.slice(0, 10)) {
    process.stderr.write(`  rejected: ${r.title} — ${r.reasons.join(", ")}\n`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Documented items (tags + body shape), per layer
// ---------------------------------------------------------------------------
function walkMd(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc);
    else if (e.name.endsWith(".md") && e.name !== "gaps.md") acc.push(p);
  }
  return acc;
}

const layersRoot = join(docsRoot, "layers");
/** layer -> DocumentedItem[] */
const docItemsByLayer = {};
/** candidateId -> DocumentedItem */
const docById = new Map();
for (const layer of [
  "database", "domain", "service", "api", "messaging",
  "frontend", "tests", "infrastructure", "unassigned",
]) {
  const items = [];
  for (const dir of docDirsForLayer(layer) ?? [layer]) {
    for (const p of walkMd(join(layersRoot, dir))) {
      const rel = p.replace(projectRoot + "/", "");
      for (const it of extractDocumentedItems(readFileSync(p, "utf-8"), rel)) {
        items.push(it);
        if (it.id) docById.set(it.id, it);
      }
    }
  }
  docItemsByLayer[layer] = items;
}

// Coverage reports (optional).
const coverageDir = join(cacheDir, "coverage");
const coverageByLayer = {};
if (existsSync(coverageDir)) {
  for (const f of readdirSync(coverageDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const c = JSON.parse(readFileSync(join(coverageDir, f), "utf-8"));
      coverageByLayer[c.layer] = c;
    } catch {
      process.stderr.write(`grill-brief: ignoring malformed coverage/${f}\n`);
    }
  }
}
const missingIds = new Set();
for (const c of Object.values(coverageByLayer)) {
  for (const m of c.missing ?? []) missingIds.add(m.id);
}

// ---------------------------------------------------------------------------
// Signal 1: test linkage — and whether we're allowed to trust it.
//
// `tested_by` is a FILENAME-STEM CONVENTION, not a fact: it matches foo.test.ts
// to foo.ts. A repo using feature-named suites or a mirrored tree will look
// almost entirely untested. So measure how well the convention holds here, and
// if it barely holds, suppress the whole untested bucket rather than emit a wall
// of false positives. Never report a category the signal cannot support.
// ---------------------------------------------------------------------------
const testFiles = files.filter((f) => f.rebuildLayer === "tests");
const sourceByStem = new Map();
for (const f of files) {
  if (f.rebuildLayer === "tests") continue;
  const s = stemOf(f.path);
  if (sourceByStem.has(s)) sourceByStem.get(s).push(f.path);
  else sourceByStem.set(s, [f.path]);
}
const testedFiles = new Set();
let matchedTestFiles = 0;
for (const t of testFiles) {
  const target = testTargetStem(t.path);
  if (!target) continue;
  const hits = sourceByStem.get(target);
  if (!hits) continue;
  matchedTestFiles++;
  for (const h of hits) testedFiles.add(h);
}
const testStemMatchPct =
  testFiles.length === 0 ? 0 : Math.round((matchedTestFiles / testFiles.length) * 1000) / 10;
// Below ~20% the convention clearly isn't in use here.
const testConventionReliable = testFiles.length > 0 && testStemMatchPct >= 20;

// ---------------------------------------------------------------------------
// Signal 2: import graph (fan-in). Same computation as plan-brief.mjs.
// ---------------------------------------------------------------------------
const importMap = manifest.importMap && typeof manifest.importMap === "object" ? manifest.importMap : {};
const indegree = new Map();
for (const targets of Object.values(importMap)) {
  for (const t of targets || []) indegree.set(t, (indegree.get(t) || 0) + 1);
}
// A symbol re-exported from the package's public surface is reachable from
// OUTSIDE the repo, so zero internal fan-in says nothing about it. Libraries are
// almost entirely this, and without the check every export looks orphaned.
const exportedNames = new Set();
for (const f of files) {
  for (const e of f.symbols?.exports ?? []) {
    if (e?.name) exportedNames.add(`${f.path}::${e.name}`);
  }
  for (const fn of f.symbols?.functions ?? []) {
    if (fn?.exported && fn.name) exportedNames.add(`${f.path}::${fn.name}`);
  }
  for (const cl of f.symbols?.classes ?? []) {
    if (cl?.exported && cl.name) exportedNames.add(`${f.path}::${cl.name}`);
  }
}

const degrees = [...indegree.values()].sort((a, b) => a - b);
const pct = (arr, p) => (arr.length === 0 ? 0 : arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]);
// Relative, not absolute: a hub in a 30-file service is not a hub in a monorepo.
const hubIndegreeMin = Math.max(3, pct(degrees, 0.9));

// ---------------------------------------------------------------------------
// Signal 3: thin docs. Threshold is the 25th percentile of [MUST] body length
// IN THIS REPO — hardcoding "under 200 chars is thin" would itself be a magic
// constant, which would be a poor look for a skill that hunts magic constants.
// ---------------------------------------------------------------------------
const allMustItems = [];
/** Rule-shaped [MUST]s outside the test layers — the population thin-spec is about. */
const ruleMustItems = [];
for (const [layer, items] of Object.entries(docItemsByLayer)) {
  for (const it of items) {
    if (it.tag !== "MUST") continue;
    allMustItems.push(it);
    // A test case documented in one line is correctly documented, and a test is
    // not a business rule to be rebuilt. Including them drags the percentile to
    // the floor and floods the bucket (223 of 239 on one real repo).
    if (layer !== "tests" && !String(it.id ?? "").startsWith("file:")) ruleMustItems.push(it);
  }
}
const mustBodyLens = ruleMustItems.map((i) => i.bodyLines ?? 0).sort((a, b) => a - b);
const thinBodyLines = Math.max(2, pct(mustBodyLens, 0.25));

// ---------------------------------------------------------------------------
// Signal 4: tenant fields, derived from the data model rather than guessed.
// A field appearing on 3+ tables and named like a tenant key IS the tenant key.
// ---------------------------------------------------------------------------
const TENANT_RE = /^(org|organisation|organization|tenant|account|workspace|company|customer)_?id$/i;
const fieldTableCount = new Map();
for (const f of files) {
  for (const d of f.symbols?.definitions ?? []) {
    if (d.kind === "db-ddl") continue;
    for (const fld of d.fields ?? []) {
      const name = typeof fld === "string" ? fld : fld?.name;
      if (!name) continue;
      fieldTableCount.set(name, (fieldTableCount.get(name) ?? 0) + 1);
    }
  }
}
const tenantFields = [...fieldTableCount.entries()]
  .filter(([n, c]) => c >= 3 && TENANT_RE.test(n))
  .map(([n]) => n);

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------
const byLayer = candidatesByLayer(manifest);
const ENTRY_CATEGORIES = new Set(["infra", "script", "config"]);

const buckets = {
  thinMusts: [],
  untestedMusts: [],
  orphanMusts: [],
  dataModelMismatches: [],
  duplicateNames: [],
  tenancyCandidates: [],
  hubs: [],
  oversizedSymbols: [],
  unassignedCode: [],
  staleDocs: [],
};

/** candidateId -> Set of flag names (the flagCount denominator). */
const flags = new Map();
const addFlag = (id, flag) => {
  if (!flags.has(id)) flags.set(id, new Set());
  flags.get(id).add(flag);
};

const layerOf = new Map();
for (const [layer, cands] of Object.entries(byLayer)) {
  for (const c of cands) layerOf.set(c.id, layer);
}

for (const [layer, cands] of Object.entries(byLayer)) {
  if (layersFilter && !layersFilter.has(layer)) continue;
  for (const c of cands) {
    const doc = docById.get(c.id);
    const isMust = doc?.tag === "MUST";
    const mf = fileByPath.get(c.file);

    // A `file:` candidate is a CONTAINER — its heading introduces the symbols
    // documented beneath it, so a short body is correct, not thin. Rule-shaped
    // signals (thin-spec, orphan) only make sense on the symbols themselves.
    const isRule = c.kind !== "file";

    if (isMust && isRule && layer !== "tests") {
      const bodyLines = doc.bodyLines ?? 0;
      const hasShape = doc.hasCodeBlock || doc.hasTable;
      if (!hasShape && bodyLines <= thinBodyLines) {
        addFlag(c.id, "thin-spec");
        buckets.thinMusts.push({
          id: c.id, name: c.name, layer, file: c.file,
          bodyLines, docRef: doc.sourceFile, docLine: doc.line ?? null,
        });
      }
    }

    if (isMust) {
      if (testConventionReliable && !testedFiles.has(c.file) && layer !== "tests") {
        addFlag(c.id, "untested");
        buckets.untestedMusts.push({ id: c.id, name: c.name, layer, file: c.file });
      }
      const fanIn = indegree.get(c.file) ?? 0;
      const isEndpoint = (mf?.symbols?.endpoints ?? []).length > 0;
      const isEntry = ENTRY_CATEGORIES.has(mf?.fileCategory);
      if (
        isRule &&
        fanIn === 0 &&
        !isEndpoint &&
        !isEntry &&
        !exportedNames.has(`${c.file}::${c.name}`) &&
        layer !== "tests" &&
        layer !== "infrastructure"
      ) {
        // Low confidence by construction: DI, reflection and dynamic
        // registration all defeat it. Kept because it is the only zero-cost
        // deterministic CORRECTNESS signal available — the specialist confirms.
        addFlag(c.id, "orphan");
        buckets.orphanMusts.push({
          id: c.id, name: c.name, layer, file: c.file, confidence: "low",
        });
      }
      if (fanIn >= hubIndegreeMin) addFlag(c.id, "hub");
    }

    if (c.endLine - c.startLine >= 120 && (c.kind === "function" || c.kind === "class")) {
      addFlag(c.id, "oversized");
      buckets.oversizedSymbols.push({
        id: c.id, name: c.name, layer, file: c.file,
        lines: c.endLine - c.startLine,
      });
    }

    if (isMust && tenantFields.length > 0 && (layer === "database" || layer === "service")) {
      const fn = (mf?.symbols?.functions ?? []).find((x) => x.name === c.name);
      if (fn) {
        const params = (fn.params ?? []).join(" ").toLowerCase();
        const missing = tenantFields.find((t) => !params.includes(t.toLowerCase()));
        if (missing && tenantFields.some((t) => params.includes(t.toLowerCase())) === false) {
          addFlag(c.id, "tenancy");
          buckets.tenancyCandidates.push({
            id: c.id, name: c.name, layer, file: c.file,
            params: fn.params ?? [], missingTenantField: missing,
          });
        }
      }
    }

    if (doc && missingIds.has(c.id)) {
      buckets.staleDocs.push({ id: c.id, name: c.name, layer, file: c.file });
    }
  }
}

// Duplicate symbol names — the logic-drift candidate.
const nameToIds = new Map();
for (const [layer, cands] of Object.entries(byLayer)) {
  for (const c of cands) {
    if (c.kind !== "function" && c.kind !== "class") continue;
    const k = c.name.toLowerCase();
    if (!nameToIds.has(k)) nameToIds.set(k, []);
    nameToIds.get(k).push({ id: c.id, file: c.file, layer });
  }
}
for (const [name, entries] of nameToIds) {
  const distinctFiles = new Set(entries.map((e) => e.file));
  if (distinctFiles.size < 2) continue;
  // Only interesting when at least one side is a documented [MUST].
  if (!entries.some((e) => docById.get(e.id)?.tag === "MUST")) continue;
  for (const e of entries) addFlag(e.id, "duplicate-name");
  buckets.duplicateNames.push({ name, entries });
}

// ORM <-> SQL field-set disagreement. dataModelLinks already pairs them.
const defById = new Map();
for (const f of files) {
  for (const d of f.symbols?.definitions ?? []) {
    const fieldNames = (d.fields ?? []).map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean);
    defById.set(`${d.kind === "db-ddl" ? "table" : "table"}:${f.path}:${d.name}`, {
      name: d.name, file: f.path, fields: fieldNames,
    });
  }
}
for (const link of manifest.dataModelLinks ?? []) {
  const a = defById.get(link.codeId);
  const b = defById.get(link.sqlId);
  if (!a || !b) continue;
  const an = new Set(a.fields.map((x) => x.toLowerCase().replace(/_/g, "")));
  const bn = new Set(b.fields.map((x) => x.toLowerCase().replace(/_/g, "")));
  const onlyCode = [...an].filter((x) => !bn.has(x));
  const onlySql = [...bn].filter((x) => !an.has(x));
  if (onlyCode.length === 0 && onlySql.length === 0) continue;
  addFlag(link.codeId, "model-mismatch");
  buckets.dataModelMismatches.push({
    codeId: link.codeId, sqlId: link.sqlId, table: a.name,
    onlyInCode: onlyCode, onlyInSql: onlySql,
  });
}

buckets.hubs = [...indegree.entries()]
  .filter(([, d]) => d >= hubIndegreeMin)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .map(([file, dependents]) => ({
    file,
    dependents,
    mustCount: (byLayer[fileByPath.get(file)?.rebuildLayer] ?? [])
      .filter((c) => c.file === file && docById.get(c.id)?.tag === "MUST").length,
  }));

buckets.unassignedCode = files
  .filter((f) => f.rebuildLayer === "unassigned" && f.fileCategory === "code")
  .map((f) => ({ file: f.path, sizeLines: f.sizeLines }));

buckets.oversizedSymbols.sort((a, b) => b.lines - a.lines);
buckets.oversizedSymbols = buckets.oversizedSymbols.slice(0, 25);

// ---------------------------------------------------------------------------
// Per-layer view + hotspots ranked by flagCount (not a weighted score).
// ---------------------------------------------------------------------------
// Business logic lives in these five; the rest yield only readiness findings
// that are already fully machine-computed, so they don't need a source-reading
// subagent. Five specialists instead of ten.
const DEEP_LAYERS = new Set(["database", "domain", "service", "api", "messaging"]);
const LAYER_ORDER = [
  "database", "domain", "service", "api", "messaging",
  "frontend", "tests", "infrastructure", "unassigned",
];

const perLayer = [];
for (const layer of LAYER_ORDER) {
  const cands = byLayer[layer] ?? [];
  if (cands.length === 0) continue;
  if (layersFilter && !layersFilter.has(layer)) continue;
  const items = docItemsByLayer[layer] ?? [];
  const mustCount = items.filter((i) => i.tag === "MUST").length;

  const hotspots = cands
    .map((c) => {
      const fl = [...(flags.get(c.id) ?? [])];
      const doc = docById.get(c.id);
      return {
        id: c.id, name: c.name, kind: c.kind, file: c.file,
        lines: [c.startLine, c.endLine],
        priority: doc?.tag ?? null,
        docRef: doc?.sourceFile ?? null,
        flags: fl,
        flagCount: fl.length,
        indegree: indegree.get(c.file) ?? 0,
        link: sourceLink(c.file, c.startLine, c.endLine),
      };
    })
    .filter((h) => h.flagCount > 0)
    .sort((a, b) => b.flagCount - a.flagCount || b.indegree - a.indegree)
    .slice(0, 40);

  // Hotspots say WHERE the deterministic signals point. But the correctness
  // categories (obsolete rule, magic constant, silent failure) have no
  // deterministic seed at all — they need an actual read of the rules. So a deep
  // specialist also gets the layer's rule-shaped [MUST] surface to work over.
  //
  // Derived from the DOCS, not the candidate list. Specialists routinely
  // document a rule as a sub-heading with no anchor id (`### lazy subscription
  // [MUST]`), so those rules exist in no candidate set — and on a real library
  // repo that is nearly all of them. The docs are the rule surface.
  const candById = new Map(cands.map((c) => [c.id, c]));
  const mustSurface = (docItemsByLayer[layer] ?? [])
    .filter((it) => it.tag === "MUST" && !String(it.id ?? "").startsWith("file:"))
    .map((it) => {
      const c = it.id ? candById.get(it.id) : null;
      return {
        id: it.id ?? null,
        name: it.name,
        kind: c?.kind ?? "documented-rule",
        file: c?.file ?? null,
        lines: c ? [c.startLine, c.endLine] : null,
        docRef: it.sourceFile,
        docLine: it.line ?? null,
        bodyLines: it.bodyLines ?? 0,
        hasCodeBlock: !!it.hasCodeBlock,
        link: c ? sourceLink(c.file, c.startLine, c.endLine) : null,
      };
    });

  perLayer.push({
    layer,
    docDirs: docDirsForLayer(layer) ?? [layer],
    mode: DEEP_LAYERS.has(layer) ? "deep" : "shallow",
    fileCount: files.filter((f) => f.rebuildLayer === layer).length,
    candidateCount: cands.length,
    mustCount,
    coveragePct: coverageByLayer[layer]?.coveragePct ?? null,
    // A budget is not a nicety: without one a specialist returns 80 findings
    // from one layer and blows the orchestrator's context at merge time.
    budget: DEEP_LAYERS.has(layer) ? Math.min(12, Math.max(4, Math.ceil(mustCount / 8))) : 0,
    hotspotCount: hotspots.length,
    hotspots,
    mustSurfaceCount: mustSurface.length,
    mustSurface: DEEP_LAYERS.has(layer) ? mustSurface.slice(0, 120) : [],
  });
}

// ---------------------------------------------------------------------------
// Capability clustering — a deterministic PROPOSAL the operator renames.
// Domain experts think in business capabilities, not in layers: the finance
// owner should get the billing questions and nothing else. Group by endpoint
// path prefix, then by top-level source directory.
// ---------------------------------------------------------------------------
const capBuckets = new Map();
const addCap = (key, entry) => {
  if (!capBuckets.has(key)) capBuckets.set(key, []);
  capBuckets.get(key).push(entry);
};
for (const [layer, cands] of Object.entries(byLayer)) {
  if (!DEEP_LAYERS.has(layer)) continue;
  for (const c of cands) {
    let key = null;
    if (c.kind === "endpoint") {
      const m = String(c.name).match(/\s\/+([A-Za-z0-9_-]+)/);
      if (m) key = m[1].toLowerCase();
    }
    if (!key) {
      // Skip structural directories that carry no business meaning. Without
      // this a monorepo collapses to a single "packages" capability, which is
      // useless for routing questions to an owner.
      const SKIP = new Set([
        ".", "src", "lib", "app", "internal", "pkg", "packages", "apps", "libs",
        "modules", "services", "components", "main", "java", "python",
      ]);
      const parts = c.file
        .split("/")
        .filter((x) => x && !SKIP.has(x.toLowerCase()));
      // Prefer the LAST meaningful directory over the first: in
      // packages/markitdown/src/markitdown/converters/_pdf_converter.py the
      // capability is "converters", not the package name.
      const dirs = parts.slice(0, -1);
      const pick = dirs.length > 0 ? dirs[dirs.length - 1] : parts[0] ?? "core";
      key = pick.replace(/\.[a-z0-9]+$/i, "").replace(/^_+/, "").toLowerCase();
    }
    addCap(key, { id: c.id, layer, file: c.file });
  }
}
const capabilityCandidates = [...capBuckets.entries()]
  .filter(([, v]) => v.length >= 2)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 12)
  .map(([name, members]) => ({
    proposedName: name,
    itemCount: members.length,
    layers: [...new Set(members.map((m) => m.layer))],
    sampleFiles: [...new Set(members.map((m) => m.file))].slice(0, 5),
  }));

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
const brief = {
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  project: {
    name: manifest.project?.name ?? "unknown",
    languages: manifest.project?.languages ?? [],
    totalFiles: manifest.stats?.totalFiles ?? files.length,
  },
  repository: { linkFormat },
  // Gates and thresholds are reported, not hidden, so a reader can audit why an
  // item was flagged — and see when a whole category was suppressed.
  conventions: {
    testFileCount: testFiles.length,
    testStemMatchPct,
    testConventionReliable,
    untestedBucketSuppressed: !testConventionReliable,
    tenantFields,
    hasDataModelLinks: (manifest.dataModelLinks ?? []).length > 0,
  },
  thresholds: {
    thinBodyLines,
    hubIndegreeMin,
    oversizedLines: 120,
  },
  perLayer,
  buckets,
  capabilityCandidates,
  summary: {
    mustTotal: allMustItems.length,
    ruleMustTotal: ruleMustItems.length,
    thinMusts: buckets.thinMusts.length,
    untestedMusts: buckets.untestedMusts.length,
    orphanMusts: buckets.orphanMusts.length,
    dataModelMismatches: buckets.dataModelMismatches.length,
    duplicateNames: buckets.duplicateNames.length,
    tenancyCandidates: buckets.tenancyCandidates.length,
    deepLayers: perLayer.filter((l) => l.mode === "deep").map((l) => l.layer),
  },
};

const outputPath = join(cacheDir, "grill-brief.json");
mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(join(grillDir, "seeds"), { recursive: true });
writeFileSync(outputPath, JSON.stringify(brief, null, 2), "utf-8");

// One seed per deep layer — the specialist's work packet.
for (const l of perLayer) {
  if (l.mode !== "deep") continue;
  writeFileSync(
    join(grillDir, "seeds", `${l.layer}.json`),
    JSON.stringify(
      {
        layer: l.layer,
        docDirs: l.docDirs,
        budget: l.budget,
        thresholds: brief.thresholds,
        conventions: brief.conventions,
        linkFormat,
        hotspots: l.hotspots,
        mustSurface: l.mustSurface,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

process.stderr.write(
  `grill-brief: ${brief.project.name} — ${brief.summary.mustTotal} [MUST] items\n` +
    `grill-brief: thin=${brief.summary.thinMusts} untested=${brief.summary.untestedMusts} ` +
    `orphan=${brief.summary.orphanMusts} mismatch=${brief.summary.dataModelMismatches} ` +
    `dupes=${brief.summary.duplicateNames} tenancy=${brief.summary.tenancyCandidates}\n` +
    `grill-brief: thresholds thinBodyLines=${thinBodyLines} hubIndegreeMin=${hubIndegreeMin}\n`,
);
if (!testConventionReliable) {
  process.stderr.write(
    `grill-brief: untested bucket SUPPRESSED — only ${testStemMatchPct}% of ${testFiles.length} ` +
      `test files follow the stem convention, so the signal can't support the claim\n`,
  );
}
for (const l of perLayer) {
  process.stderr.write(
    `  ${l.layer.padEnd(15)} ${l.mode.padEnd(7)} must=${String(l.mustCount).padStart(4)} ` +
      `hotspots=${String(l.hotspotCount).padStart(3)} budget=${l.budget}\n`,
  );
}
