#!/usr/bin/env node
/**
 * grill-answers.mjs
 *
 * Pass two of the grill: read the questionnaires that domain experts answered in
 * docs/unwind/questions/*.md and fold their verdicts back into
 * .cache/grill-findings.json.
 *
 * The parse target is a checkbox list WE generated, anchored by an HTML comment
 * carrying the question id and its verdict mapping — not free prose. Each block:
 *
 *   ### GQ-0007 · Is a working day still 8 hours?
 *   ...
 *   - [x] Still correct — rebuild it exactly as is
 *   - [ ] Wrong — the right behaviour is in my notes
 *   **Notes:** they changed to 7.5h in 2021
 *   <!-- grill: {"id":"GQ-0007","verdicts":["preserve","fix-in-rebuild"]} -->
 *
 * The Nth ticked box maps to the Nth entry of `verdicts`. Unticked questions stay
 * open — an unanswered question is reported as unanswered, never guessed.
 *
 * Usage: node grill-answers.mjs <projectRoot> [--apply]
 *   (default is a dry run that reports what would change)
 *
 * Exit codes: 1 bad args, 2 findings file missing.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const projectRootArg = argv.find((a) => !a.startsWith("--"));
if (!projectRootArg) {
  process.stderr.write("Usage: node grill-answers.mjs <projectRoot> [--apply]\n");
  process.exit(1);
}
const projectRoot = resolve(projectRootArg);
const APPLY = argv.includes("--apply");

const docsRoot = join(projectRoot, "docs/unwind");
const questionsDir = join(docsRoot, "questions");
const findingsPath = join(docsRoot, ".cache/grill-findings.json");

if (!existsSync(findingsPath)) {
  process.stderr.write(
    `grill-answers: no findings at ${findingsPath}\ngrill-answers: run the grill pass first.\n`,
  );
  process.exit(2);
}
if (!existsSync(questionsDir)) {
  process.stderr.write(`grill-answers: no questionnaire at ${questionsDir}\n`);
  process.exit(2);
}

const doc = JSON.parse(readFileSync(findingsPath, "utf-8"));
const byId = new Map((doc.findings ?? []).map((f) => [f.id, f]));

const META_RE = /<!--\s*grill:\s*(\{.*?\})\s*-->/;
const TICKED_RE = /^\s*[-*]\s+\[([xX])\]\s+(.*)$/;
const UNTICKED_RE = /^\s*[-*]\s+\[\s\]\s+(.*)$/;
const NOTES_RE = /^\s*\*\*Notes?:?\*\*\s*(.*)$/i;

const answers = [];
const problems = [];

for (const file of readdirSync(questionsDir)) {
  if (!file.endsWith(".md") || file.toLowerCase() === "readme.md") continue;
  const lines = readFileSync(join(questionsDir, file), "utf-8").split("\n");

  // Walk block by block: a block ends at its `<!-- grill: -->` marker, so the
  // marker's options are exactly the boxes seen since the previous marker.
  let ticked = [];
  let optionCount = 0;
  let notes = [];
  let collectingNotes = false;

  for (const line of lines) {
    const meta = line.match(META_RE);
    if (meta) {
      let parsed;
      try {
        parsed = JSON.parse(meta[1]);
      } catch {
        problems.push(`${file}: malformed grill marker`);
        ticked = [];
        optionCount = 0;
        notes = [];
        collectingNotes = false;
        continue;
      }
      const note = notes.join("\n").trim();
      answers.push({
        file,
        id: parsed.id,
        verdicts: parsed.verdicts ?? [],
        ticked,
        optionCount,
        notes: note === "" ? null : note,
      });
      ticked = [];
      optionCount = 0;
      notes = [];
      collectingNotes = false;
      continue;
    }

    const t = line.match(TICKED_RE);
    if (t) {
      ticked.push(optionCount);
      optionCount++;
      collectingNotes = false;
      continue;
    }
    const u = line.match(UNTICKED_RE);
    if (u) {
      optionCount++;
      collectingNotes = false;
      continue;
    }
    const n = line.match(NOTES_RE);
    if (n) {
      collectingNotes = true;
      if (n[1].trim()) notes.push(n[1].trim());
      continue;
    }
    if (collectingNotes) {
      if (/^\s*(#{1,6})\s/.test(line)) collectingNotes = false;
      else if (line.trim() !== "") notes.push(line.trim());
    }
  }
}

let applied = 0;
let stillOpen = 0;
let ambiguous = 0;
let unknown = 0;
const changes = [];

for (const a of answers) {
  const f = byId.get(a.id);
  if (!f) {
    unknown++;
    problems.push(`${a.file}: ${a.id} is not a known finding (stale questionnaire?)`);
    continue;
  }
  if (a.ticked.length === 0) {
    // Notes without a tick still carry knowledge worth keeping.
    if (a.notes && f.notes !== a.notes) {
      changes.push({ id: a.id, verdict: f.verdict, notes: a.notes, noteOnly: true });
    }
    stillOpen++;
    continue;
  }
  if (a.ticked.length > 1) {
    // Never guess between two ticks — an expert ticking two boxes means the
    // question was wrong, and forcing a verdict would bury that.
    ambiguous++;
    problems.push(`${a.file}: ${a.id} has ${a.ticked.length} boxes ticked — left open`);
    stillOpen++;
    continue;
  }
  const verdict = a.verdicts[a.ticked[0]] ?? null;
  if (!verdict) {
    problems.push(`${a.file}: ${a.id} ticked option ${a.ticked[0]} has no verdict mapping`);
    stillOpen++;
    continue;
  }
  changes.push({ id: a.id, verdict, notes: a.notes, from: f.verdict });
  applied++;
}

for (const f of doc.findings ?? []) {
  if (!answers.some((a) => a.id === f.id) && !f.verdict) stillOpen++;
}

if (APPLY) {
  for (const c of changes) {
    const f = byId.get(c.id);
    if (!f) continue;
    if (!c.noteOnly) {
      f.verdict = c.verdict;
      f.answeredAt = new Date().toISOString();
    }
    if (c.notes) f.notes = c.notes;
  }
  doc.openCount = (doc.findings ?? []).filter((f) => !f.verdict).length;
  doc.answersIngestedAt = new Date().toISOString();
  writeFileSync(findingsPath, JSON.stringify(doc, null, 2), "utf-8");
}

process.stderr.write(
  `grill-answers${APPLY ? "" : " (dry run)"}: ` +
    `${applied} answered, ${stillOpen} still open, ${ambiguous} ambiguous, ${unknown} unknown\n`,
);
for (const c of changes.slice(0, 40)) {
  process.stderr.write(
    `  ${c.id}: ${c.noteOnly ? "notes only" : `${c.from ?? "open"} -> ${c.verdict}`}` +
      `${c.notes ? ` — "${c.notes.slice(0, 60)}"` : ""}\n`,
  );
}
for (const p of problems.slice(0, 20)) process.stderr.write(`  ! ${p}\n`);
if (!APPLY && changes.length > 0) {
  process.stderr.write("grill-answers: re-run with --apply to write these verdicts\n");
}

// Emit the verdict worklist so the orchestrator edits docs from a deterministic
// list rather than from its own recollection of the interview.
process.stdout.write(
  JSON.stringify(
    {
      applied,
      stillOpen,
      ambiguous,
      changes: changes.map((c) => {
        const f = byId.get(c.id);
        return {
          id: c.id,
          verdict: c.noteOnly ? (f?.verdict ?? null) : c.verdict,
          notes: c.notes ?? null,
          candidateId: f?.candidateId ?? null,
          category: f?.category ?? null,
          title: f?.title ?? null,
        };
      }),
      problems,
    },
    null,
    2,
  ) + "\n",
);
