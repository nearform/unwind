import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileDataModel } from "./reconcile-data-model.js";
import { emptySymbols, type ManifestFile, type SymbolDefinition } from "../manifest/manifest-schema.js";

function file(path: string, defs: SymbolDefinition[]): ManifestFile {
  return {
    path,
    language: path.endsWith(".sql") ? "sql" : "typescript",
    fileCategory: path.endsWith(".sql") ? "data" : "code",
    sizeLines: 50,
    contentHash: "x",
    rebuildLayer: "database",
    symbolsExtracted: true,
    symbols: { ...emptySymbols(), definitions: defs },
  } as ManifestFile;
}

function table(name: string, origin: "code" | "sql", extra: Partial<SymbolDefinition> = {}): SymbolDefinition {
  return { kind: "table", name, fields: [], startLine: 1, endLine: 2, origin, ...extra };
}

test("matching SQL table is demoted to db-ddl and linked", () => {
  const code = file("src/db/schema.ts", [table("users", "code", { physicalName: "users" })]);
  const sql = file("drizzle/0001_init.sql", [table("users", "sql")]);
  const { links } = reconcileDataModel([code, sql]);

  // SQL demoted; code stays canonical.
  assert.equal(sql.symbols.definitions[0].kind, "db-ddl");
  assert.equal(code.symbols.definitions[0].kind, "table");

  assert.equal(links.length, 1);
  assert.equal(links[0].codeId, "table:src/db/schema.ts:users");
  assert.equal(links[0].sqlId, "db-ddl:drizzle/0001_init.sql:users");
});

test("singular/plural and case-insensitive matching", () => {
  const code = file("src/models.ts", [table("UserAccount", "code")]);
  const sql = file("migrations/x.sql", [table("user_accounts", "sql")]);
  const { links } = reconcileDataModel([code, sql]);
  assert.equal(links.length, 1);
  assert.equal(sql.symbols.definitions[0].kind, "db-ddl");
});

test("unmatched SQL stays a canonical table (SQL-first project)", () => {
  const sql = file("schema.sql", [table("legacy_events", "sql")]);
  const { links } = reconcileDataModel([sql]);
  assert.equal(links.length, 0);
  assert.equal(sql.symbols.definitions[0].kind, "table");
});

test("physicalName drives the match when symbol name differs", () => {
  const code = file("src/schema.ts", [table("User", "code", { physicalName: "app_users" })]);
  const sql = file("m.sql", [table("app_users", "sql")]);
  const { links } = reconcileDataModel([code, sql]);
  assert.equal(links.length, 1);
  assert.equal(links[0].codeId, "table:src/schema.ts:User");
});
