/**
 * Deterministic coverage diff — the headline capability.
 *
 * Replaces the subjective "LLM compares docs to source" verification with pure
 * set arithmetic: manifest candidate ids (ground truth) vs documented ids.
 *
 * Documented items are enumerated from markdown headings. Each item SHOULD carry
 * an explicit anchor id (`### users [MUST] <!-- id: table:src/db.ts:users -->`).
 * When the anchor is absent we fall back to fuzzy matching on the heading name,
 * and report how many matched each way so id-convention drift is visible.
 */

import type { Candidate } from "../manifest/candidates.js";

export interface DocumentedItem {
  heading: string;
  /** Name with the [MUST]/[SHOULD]/[DON'T] tag and anchor stripped. */
  name: string;
  tag: "MUST" | "SHOULD" | "DON'T" | null;
  /** Explicit anchor id if present. */
  id: string | null;
  sourceFile: string;
}

// Documented items are h3+ (`###`); `#`/`##` are layer/section titles, not items
// (see analysis-principles.md heading convention).
const HEADING_RE = /^#{3,6}\s+(.+?)\s*$/;
const ANCHOR_RE = /<!--\s*id:\s*([^\s]+)\s*-->/;
const TAG_RE = /\[(MUST|SHOULD|DON'T)\]/;

/** Parse documented items from one markdown file. */
export function extractDocumentedItems(markdown: string, sourceFile: string): DocumentedItem[] {
  const items: DocumentedItem[] = [];
  for (const line of markdown.split("\n")) {
    const h = line.match(HEADING_RE);
    if (!h) continue;
    const raw = h[1];
    const anchor = raw.match(ANCHOR_RE);
    const tagM = raw.match(TAG_RE);
    const name = raw
      .replace(ANCHOR_RE, "")
      .replace(TAG_RE, "")
      .replace(/`/g, "")
      .trim();
    if (!name) continue;
    items.push({
      heading: raw,
      name,
      tag: tagM ? (tagM[1] as DocumentedItem["tag"]) : null,
      id: anchor ? anchor[1] : null,
      sourceFile,
    });
  }
  return items;
}

export interface MissingItem {
  id: string;
  kind: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
}

export interface LayerCoverage {
  layer: string;
  total: number;
  covered: number;
  coveragePct: number;
  /** Candidate ids with no documented match. */
  missing: MissingItem[];
  /** Documented headings that matched no candidate (agent-added; informational). */
  extra: string[];
  matchedById: number;
  matchedByFuzzy: number;
}

/** Normalize a name for fuzzy comparison. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Diff the candidate set for a layer against the documented items.
 * Matching: explicit id first, then fuzzy by normalized name.
 */
export function computeLayerCoverage(
  layer: string,
  candidates: Candidate[],
  documented: DocumentedItem[],
): LayerCoverage {
  const docById = new Map<string, DocumentedItem>();
  const docByName = new Map<string, DocumentedItem[]>();
  for (const d of documented) {
    if (d.id) docById.set(d.id, d);
    const key = norm(d.name);
    const bucket = docByName.get(key);
    if (bucket) bucket.push(d);
    else docByName.set(key, [d]);
  }

  const matchedDocs = new Set<DocumentedItem>();
  const missing: MissingItem[] = [];
  let covered = 0;
  let matchedById = 0;
  let matchedByFuzzy = 0;

  for (const c of candidates) {
    let match: DocumentedItem | undefined = docById.get(c.id);
    if (match) {
      matchedById++;
    } else {
      const byName = docByName.get(norm(c.name));
      if (byName && byName.length > 0) {
        match = byName.find((d) => !matchedDocs.has(d)) ?? byName[0];
        matchedByFuzzy++;
      }
    }
    if (match) {
      covered++;
      matchedDocs.add(match);
    } else {
      missing.push({ id: c.id, kind: c.kind, name: c.name, file: c.file, startLine: c.startLine, endLine: c.endLine });
    }
  }

  const extra = documented.filter((d) => !matchedDocs.has(d)).map((d) => `${d.heading} (${d.sourceFile})`);
  const total = candidates.length;
  const coveragePct = total === 0 ? 100 : Math.round((covered / total) * 1000) / 10;

  return { layer, total, covered, coveragePct, missing, extra, matchedById, matchedByFuzzy };
}
