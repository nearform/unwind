/**
 * Structural fingerprints for incremental updates.
 *
 * Two hashes per file:
 *  - `structural`: a hash of the file's symbol *signatures* (names, params,
 *    methods, definitions, endpoints, exports) with line numbers EXCLUDED, so
 *    moving code around does not look like a change. Drives "did the contract
 *    surface change?".
 *  - `content`: the raw-bytes SHA-1 from the manifest. Distinguishes a COSMETIC
 *    edit (body/comment changed, signatures intact) from a true no-op.
 *
 * The change classifier turns a baseline vs. current fingerprint map into a
 * ChangeSet the orchestrator uses to re-analyze ONLY what moved and to mark
 * affected docs stale.
 */

import { createHash } from "node:crypto";
import type { ManifestFile, ScanManifest } from "../manifest/manifest-schema.js";

export interface FileFingerprint {
  structural: string;
  content: string;
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

/**
 * Build the line-independent structural signature string for a file. Everything
 * is sorted so ordering changes don't register as structural changes.
 */
function structuralSignature(file: ManifestFile): string {
  const s = file.symbols;
  const parts: string[] = [];
  for (const fn of s.functions) {
    parts.push(`fn:${fn.name}(${fn.params.join(",")})${fn.exported ? "+" : ""}`);
  }
  for (const c of s.classes) {
    parts.push(
      `cls:${c.name}{${[...c.methods].sort().join(",")}|${[...c.properties].sort().join(",")}}${c.exported ? "+" : ""}`,
    );
  }
  for (const d of s.definitions) {
    parts.push(`def:${d.kind}:${d.name}(${[...d.fields].sort().join(",")})`);
  }
  for (const e of s.endpoints) {
    parts.push(`ep:${e.method} ${e.path}`);
  }
  for (const e of s.exports) {
    parts.push(`ex:${e.name}${e.isDefault ? "*" : ""}`);
  }
  parts.sort();
  // Include language so a same-name file changing type is structural.
  return `${file.language}\n${parts.join("\n")}`;
}

export function computeFileFingerprint(file: ManifestFile): FileFingerprint {
  return {
    structural: sha1(structuralSignature(file)),
    content: file.contentHash,
  };
}

/** Fingerprint every file in a manifest, keyed by path. */
export function buildFingerprints(manifest: ScanManifest): Record<string, FileFingerprint> {
  const out: Record<string, FileFingerprint> = {};
  for (const f of manifest.files) out[f.path] = computeFileFingerprint(f);
  return out;
}

export type ChangeKind = "added" | "removed" | "structural" | "cosmetic" | "unchanged";

export interface ChangeSet {
  added: string[];
  removed: string[];
  /** Signature surface changed — docs/coverage for these files may be stale. */
  structural: string[];
  /** Body/comments changed but signatures intact — docs likely still valid. */
  cosmetic: string[];
  unchanged: string[];
}

/**
 * Classify every path by comparing a baseline fingerprint map to the current one.
 * Deterministic; pure.
 */
export function classifyChanges(
  baseline: Record<string, FileFingerprint>,
  current: Record<string, FileFingerprint>,
): ChangeSet {
  const set: ChangeSet = { added: [], removed: [], structural: [], cosmetic: [], unchanged: [] };
  const allPaths = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  for (const path of [...allPaths].sort()) {
    const a = baseline[path];
    const b = current[path];
    if (!a && b) set.added.push(path);
    else if (a && !b) set.removed.push(path);
    else if (a && b) {
      if (a.structural !== b.structural) set.structural.push(path);
      else if (a.content !== b.content) set.cosmetic.push(path);
      else set.unchanged.push(path);
    }
  }
  return set;
}

/** True when the change set has anything that warrants re-analysis. */
export function hasActionableChanges(c: ChangeSet): boolean {
  return c.added.length > 0 || c.removed.length > 0 || c.structural.length > 0;
}
