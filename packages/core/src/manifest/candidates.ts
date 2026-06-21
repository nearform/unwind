/**
 * Candidate generation — the canonical set of "items a layer specialist must
 * document". Both the manifest's layerIndex and the seed lists derive from this
 * single function so their ids never diverge from what the coverage diff checks.
 */

import { basename } from "node:path";
import { symbolId, type ManifestFile, type ScanManifest } from "./manifest-schema.js";

export interface Candidate {
  id: string;
  kind: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
}

/**
 * The candidate items for a single file. Symbol-grain when structural
 * extraction ran (definitions, endpoints, classes, exported functions); always
 * includes a file-level candidate so empty-symbol files still register coverage.
 */
export function fileCandidates(file: ManifestFile): Candidate[] {
  const out: Candidate[] = [];
  const s = file.symbols;
  for (const d of s.definitions) {
    out.push({ id: symbolId(d.kind, file.path, d.name), kind: d.kind, name: d.name, file: file.path, startLine: d.startLine, endLine: d.endLine });
  }
  for (const e of s.endpoints) {
    const name = `${e.method} ${e.path}`;
    out.push({ id: symbolId("endpoint", file.path, name), kind: "endpoint", name, file: file.path, startLine: e.startLine, endLine: e.endLine });
  }
  for (const c of s.classes) {
    out.push({ id: symbolId("class", file.path, c.name), kind: "class", name: c.name, file: file.path, startLine: c.startLine, endLine: c.endLine });
  }
  for (const fn of s.functions) {
    if (fn.exported) {
      out.push({ id: symbolId("function", file.path, fn.name), kind: "function", name: fn.name, file: file.path, startLine: fn.startLine, endLine: fn.endLine });
    }
  }
  // File-level candidate is always present.
  out.push({ id: symbolId("file", file.path, basename(file.path)), kind: "file", name: basename(file.path), file: file.path, startLine: 1, endLine: file.sizeLines });
  return out;
}

/** All candidate items grouped by rebuild layer. */
export function candidatesByLayer(manifest: ScanManifest): Record<string, Candidate[]> {
  const byLayer: Record<string, Candidate[]> = {};
  for (const file of manifest.files) {
    (byLayer[file.rebuildLayer] ??= []).push(...fileCandidates(file));
  }
  return byLayer;
}

/** Render a source link from the repository link format. */
export function sourceLink(linkFormat: string, path: string, start: number, end: number): string {
  return linkFormat
    .replace("{path}", path)
    .replace("{start}", String(start))
    .replace("{end}", String(end));
}
