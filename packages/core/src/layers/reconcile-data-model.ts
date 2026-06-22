/**
 * reconcile-data-model.ts — make the code-side ORM model the canonical data model
 * and demote matching SQL DDL to a physical contract.
 *
 * Why: a modern repo usually defines its tables in code (Drizzle/Prisma/TypeORM/…)
 * and ships *generated* SQL migrations alongside. Treating both as first-class
 * `table:` candidates double-counts the same logical table — `table:src/db.ts:users`
 * AND `table:drizzle/0001.sql:users` — so 100% coverage means re-documenting every
 * migration. Here we keep the code model canonical and, for each SQL table that
 * matches a code model, rewrite the SQL definition's `kind` to `db-ddl` (so it is no
 * longer a competing coverage target) and record a `DataModelLink`. build-graph
 * turns those links into `contract_of` edges; coverage excludes `db-ddl`.
 *
 * Conservative by construction: a SQL table with no code-model match is left as a
 * canonical `table` (SQL-first projects are unaffected — exactly today's behavior).
 *
 * Cross-file, so it runs once over the whole manifest after symbol extraction.
 */

import { symbolId, type DataModelLink, type ManifestFile } from "../manifest/manifest-schema.js";

export interface ReconcileResult {
  links: DataModelLink[];
}

/** The kind a demoted SQL table definition is rewritten to. */
export const SQL_CONTRACT_KIND = "db-ddl";

interface CodeTable {
  id: string;
  keys: Set<string>;
}

/** Normalize a table name for matching: lowercase, strip non-alphanumeric. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Naive singularize for plural/singular equivalence (users <-> user). */
function singular(s: string): string {
  if (s.endsWith("ies") && s.length > 3) return s.slice(0, -3) + "y";
  if (s.endsWith("ses") && s.length > 3) return s.slice(0, -2);
  if (s.endsWith("s") && !s.endsWith("ss") && s.length > 1) return s.slice(0, -1);
  return s;
}

/** All normalized match keys for a name (raw + singular form). */
function matchKeys(name: string): string[] {
  const n = norm(name);
  const keys = new Set<string>([n, singular(n)]);
  return [...keys].filter(Boolean);
}

/**
 * Reconcile code-side tables with SQL DDL in place.
 *
 * Mutates `files`: SQL `table` definitions that match a code-side table are
 * rewritten to `kind: SQL_CONTRACT_KIND`. Returns the discovered links so the
 * caller can persist them on the manifest.
 */
export function reconcileDataModel(files: ManifestFile[]): ReconcileResult {
  // Index every code-side table by its match keys (name + physicalName, singular forms).
  const codeByKey = new Map<string, CodeTable>();
  for (const f of files) {
    for (const d of f.symbols.definitions) {
      if (d.kind !== "table" || d.origin === "sql") continue;
      // Treat as code-side when explicitly tagged code, or untagged (legacy) but
      // not from a .sql file — origin is the reliable signal post-tagging.
      if (d.origin !== "code") continue;
      const id = symbolId("table", f.path, d.name);
      const entry: CodeTable = { id, keys: new Set() };
      for (const k of matchKeys(d.name)) entry.keys.add(k);
      if (d.physicalName) for (const k of matchKeys(d.physicalName)) entry.keys.add(k);
      for (const k of entry.keys) {
        // First writer wins; ambiguous keys are simply not overwritten.
        if (!codeByKey.has(k)) codeByKey.set(k, entry);
      }
    }
  }

  if (codeByKey.size === 0) return { links: [] };

  const links: DataModelLink[] = [];
  for (const f of files) {
    for (const d of f.symbols.definitions) {
      if (d.kind !== "table" || d.origin !== "sql") continue;
      const match = matchKeys(d.name)
        .map((k) => codeByKey.get(k))
        .find(Boolean);
      if (!match) continue; // unmatched SQL stays a canonical `table`
      const sqlId = symbolId(SQL_CONTRACT_KIND, f.path, d.name);
      // Demote in place: no longer a competing `table` coverage target.
      d.kind = SQL_CONTRACT_KIND;
      links.push({ codeId: match.id, sqlId });
    }
  }

  return { links };
}
