/**
 * Contract detection — populate FileSymbols.definitions (DB tables/entities,
 * enums) and FileSymbols.endpoints (HTTP routes) so coverage and seeding become
 * symbol-grain instead of file-grain.
 *
 * Increment 3. This module owns ALL contract heuristics so the per-language
 * structural extractors stay focused on functions/classes/imports/exports. The
 * tree-sitter plugin calls `detectContracts` after `extractStructure` and merges
 * the result into FileSymbols (and runs the SQL/Prisma path for files that have
 * no grammar at all).
 *
 * Robustness contract: every detector is wrapped so a throw is swallowed and the
 * file simply yields no contracts. An unknown framework yields nothing. Detection
 * is text/regex-first (portable across languages) with an optional tree-sitter
 * pass for Drizzle ORM where the object-key extraction benefits from the AST.
 */

import { extname } from "node:path";
import type { SymbolDefinition, SymbolEndpoint } from "../manifest/manifest-schema.js";
import type { TSNode } from "../structure/extractor-utils.js";

export interface DetectedContracts {
  definitions: SymbolDefinition[];
  endpoints: SymbolEndpoint[];
}

function empty(): DetectedContracts {
  return { definitions: [], endpoints: [] };
}

/** Line (1-based) of a character offset in `content`. */
function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "options", "head", "all"];

// ---------------------------------------------------------------------------
// SQL DDL — CREATE TABLE [schema.]name ( col, col, ... )
// ---------------------------------------------------------------------------

/**
 * Parse `CREATE TABLE` statements. Handles optional `IF NOT EXISTS`, schema
 * qualifiers, and quoted identifiers ("x", `x`, [x]). Column names are the
 * first identifier of each top-level comma-separated entry that is not a table
 * constraint (PRIMARY KEY / FOREIGN KEY / CONSTRAINT / UNIQUE / CHECK ...).
 */
export function detectSqlTables(content: string): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];
  const re =
    /CREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMP(?:ORARY)?\s+|UNLOGGED\s+)*TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?[\w.$]+[`"\]]?)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const rawName = m[1];
    const name = unquoteIdent(stripSchema(rawName));
    if (!name) continue;
    const openParen = m.index + m[0].length - 1;
    const close = matchParen(content, openParen);
    if (close < 0) continue;
    const body = content.slice(openParen + 1, close);
    const fields = sqlColumnNames(body);
    defs.push({
      kind: "table",
      name,
      fields,
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, close),
    });
  }
  return defs;
}

const SQL_CONSTRAINT_KEYWORDS = new Set([
  "primary",
  "foreign",
  "constraint",
  "unique",
  "check",
  "key",
  "index",
  "exclude",
]);

function sqlColumnNames(body: string): string[] {
  const cols: string[] = [];
  for (const entry of splitTopLevel(body)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const firstTok = trimmed.match(/^([`"\[]?[\w$]+[`"\]]?)/);
    if (!firstTok) continue;
    const ident = unquoteIdent(firstTok[1]);
    if (!ident) continue;
    if (SQL_CONSTRAINT_KEYWORDS.has(ident.toLowerCase())) continue;
    cols.push(ident);
  }
  return cols;
}

function stripSchema(raw: string): string {
  // schema.name (each part possibly quoted) -> name
  const parts = raw.split(".");
  return parts[parts.length - 1];
}

function unquoteIdent(raw: string): string {
  return raw.replace(/^[`"\[]/, "").replace(/[`"\]]$/, "").trim();
}

/** Split on top-level commas, respecting nested parens and quotes. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** Index of the matching ')' for the '(' at `openIndex`, or -1. */
function matchParen(s: string, openIndex: number): number {
  let depth = 0;
  let quote = "";
  for (let i = openIndex; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Prisma — model X { ... }  /  enum X { ... }
// ---------------------------------------------------------------------------

export function detectPrismaModels(content: string): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];
  const re = /\b(model|enum)\s+([A-Za-z_]\w*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const kind = m[1] === "model" ? "table" : "enum";
    const name = m[2];
    const open = m.index + m[0].length - 1;
    const close = matchBrace(content, open);
    if (close < 0) continue;
    const body = content.slice(open + 1, close);
    const fields =
      kind === "table"
        ? prismaModelFields(body)
        : prismaEnumValues(body);
    defs.push({
      kind,
      name,
      fields,
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, close),
    });
  }
  return defs;
}

function prismaModelFields(body: string): string[] {
  const fields: string[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("@@")) continue;
    const m = t.match(/^([A-Za-z_]\w*)\s+/);
    if (m) fields.push(m[1]);
  }
  return fields;
}

function prismaEnumValues(body: string): string[] {
  const vals: string[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("@@")) continue;
    const m = t.match(/^([A-Za-z_]\w*)/);
    if (m) vals.push(m[1]);
  }
  return vals;
}

function matchBrace(s: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Drizzle ORM — export const x = pgTable("name", { col: ... })
// Tree-sitter when a root node is available, else regex fallback.
// ---------------------------------------------------------------------------

const DRIZZLE_FNS = new Set([
  "pgTable",
  "mysqlTable",
  "sqliteTable",
  "pgView",
  "mysqlView",
  "sqliteView",
]);

export function detectDrizzleFromTree(root: TSNode): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];
  walk(root, (node) => {
    if (node.type !== "call_expression") return;
    const fnNode = node.childForFieldName("function");
    if (!fnNode) return;
    const fnName = fnNode.text;
    if (!DRIZZLE_FNS.has(fnName)) return;
    const args = node.childForFieldName("arguments");
    if (!args) return;
    // first string arg = table name; first object arg = columns
    let tableName: string | null = null;
    let fields: string[] = [];
    for (let i = 0; i < args.childCount; i++) {
      const a = args.child(i);
      if (!a) continue;
      if (tableName === null && (a.type === "string" || a.type === "template_string")) {
        tableName = a.text.replace(/^['"`]|['"`]$/g, "");
      } else if (a.type === "object" && fields.length === 0) {
        fields = objectKeys(a);
      }
    }
    // name: prefer the assigned const name; fall back to the string arg.
    const constName = enclosingConstName(node) ?? tableName;
    const name = tableName ?? constName;
    if (!name) return;
    defs.push({
      kind: "table",
      name,
      fields,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  });
  return defs;
}

function objectKeys(objNode: TSNode): string[] {
  const keys: string[] = [];
  for (let i = 0; i < objNode.childCount; i++) {
    const pair = objNode.child(i);
    if (!pair || pair.type !== "pair") continue;
    const key = pair.childForFieldName("key");
    if (!key) continue;
    keys.push(key.text.replace(/^['"`]|['"`]$/g, ""));
  }
  return keys;
}

/** Walk up from a call_expression to the `const NAME = ...` it initializes. */
function enclosingConstName(node: TSNode): string | null {
  let cur: TSNode | null = node;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (cur.type === "variable_declarator") {
      const nameNode = cur.childForFieldName("name");
      if (nameNode) return nameNode.text;
    }
    cur = cur.parent;
  }
  return null;
}

function walk(node: TSNode, visit: (n: TSNode) => void): void {
  visit(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walk(child, visit);
  }
}

/** Regex fallback for Drizzle when no tree is available (e.g. .js without grammar). */
export function detectDrizzleFromText(content: string): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];
  const re =
    /(?:export\s+)?const\s+(\w+)\s*=\s*(pgTable|mysqlTable|sqliteTable|pgView|mysqlView|sqliteView)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[3] || m[1];
    const open = m.index + m[0].length - 1;
    const close = matchBrace(content, open);
    const body = close > 0 ? content.slice(open + 1, close) : "";
    const fields = jsObjectTopLevelKeys(body);
    defs.push({
      kind: "table",
      name,
      fields,
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, close > 0 ? close : m.index),
    });
  }
  return defs;
}

function jsObjectTopLevelKeys(body: string): string[] {
  const keys: string[] = [];
  for (const entry of splitTopLevelBraces(body)) {
    const m = entry.trim().match(/^['"`]?([A-Za-z_]\w*)['"`]?\s*:/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** Split on top-level commas respecting nested {}, (), [] and quotes. */
function splitTopLevelBraces(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

// ---------------------------------------------------------------------------
// JPA / Hibernate — class annotated @Entity (Java)
// ---------------------------------------------------------------------------

export function detectJpaEntities(content: string): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];
  // @Entity (optionally @Table(name="..")) immediately preceding a class.
  const re =
    /@Entity\b[^\n]*(?:\n(?:\s*@[^\n]*\n)*)?\s*(?:public\s+|final\s+|abstract\s+)*class\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    defs.push({
      kind: "table",
      name,
      fields: [],
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, m.index + m[0].length),
    });
  }
  return defs;
}

// ---------------------------------------------------------------------------
// HTTP endpoints — Express/Hono/Koa/Fastify + decorator frameworks.
// All regex-based so it works regardless of grammar availability.
// ---------------------------------------------------------------------------

export function detectEndpoints(filePath: string, content: string): SymbolEndpoint[] {
  const out: SymbolEndpoint[] = [];
  out.push(...detectRouterEndpoints(content));
  out.push(...detectDecoratorEndpoints(content));
  out.push(...detectFileBasedRoute(filePath, content));
  // Dedupe identical (method,path,startLine).
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.method} ${e.path} ${e.startLine}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** app.get('/x', ...) / router.post('/x') / fastify.route(...) style. */
function detectRouterEndpoints(content: string): SymbolEndpoint[] {
  const out: SymbolEndpoint[] = [];
  const methodAlt = HTTP_METHODS.join("|");
  const re = new RegExp(
    `\\b[\\w$]+\\s*\\.\\s*(${methodAlt})\\s*\\(\\s*(['"\`])([^'"\`]*)\\2`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const method = m[1].toUpperCase();
    const path = m[3];
    if (!path.startsWith("/") && path !== "*") continue;
    out.push({ method, path, startLine: lineAt(content, m.index), endLine: lineAt(content, m.index) });
  }
  return out;
}

/**
 * Decorator-style routes:
 *  - TS NestJS:   @Get('/x') @Post('x')
 *  - Spring:      @GetMapping("/x") @RequestMapping(value="/x", method=...)
 *  - C#:          [HttpGet("/x")] [Route("/x")]
 *  - FastAPI:     @app.get('/x') @router.post('/x')  (handled by router regex too)
 */
function detectDecoratorEndpoints(content: string): SymbolEndpoint[] {
  const out: SymbolEndpoint[] = [];

  // TS/Python decorators: @Get('/x'), @app.get('/x'), @router.post('/x')
  const tsRe =
    /@(?:[\w$]+\.)?(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*(['"`])([^'"`]*)\2/gi;
  let m: RegExpExecArray | null;
  while ((m = tsRe.exec(content)) !== null) {
    out.push({
      method: m[1].toUpperCase(),
      path: m[3],
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, m.index),
    });
  }

  // Spring: @GetMapping("/x"), @PostMapping(value="/x"), @RequestMapping("/x")
  const springRe =
    /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?(['"])([^'"]*)\2/g;
  while ((m = springRe.exec(content)) !== null) {
    const method = m[1] === "Request" ? "ANY" : m[1].toUpperCase();
    out.push({
      method,
      path: m[3],
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, m.index),
    });
  }

  // C#: [HttpGet("x")], [Route("x")]
  const csRe = /\[\s*Http(Get|Post|Put|Delete|Patch)\s*(?:\(\s*(["'])([^"']*)\2\s*\))?/g;
  while ((m = csRe.exec(content)) !== null) {
    out.push({
      method: m[1].toUpperCase(),
      path: m[3] ?? "",
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, m.index),
    });
  }

  return out;
}

/**
 * Next.js (and similar) file-based API routes.
 *  - app/api/**\/route.{ts,js}  -> methods from exported GET/POST/... handlers.
 *  - pages/api/**               -> single route, methods inferred or ANY.
 */
function detectFileBasedRoute(filePath: string, content: string): SymbolEndpoint[] {
  const posix = filePath.split(/[\\/]/).join("/");
  const appMatch = posix.match(/(?:^|\/)app\/(.*\/)?api\/(.*)\/route\.[jt]sx?$/);
  const pagesMatch = posix.match(/(?:^|\/)pages\/api\/(.*)\.[jt]sx?$/);
  if (!appMatch && !pagesMatch) return [];

  let routePath: string;
  if (appMatch) {
    routePath = "/api/" + appMatch[2];
  } else {
    let p = pagesMatch![1];
    p = p.replace(/\/index$/, "");
    routePath = "/api/" + p;
  }
  // Normalize Next dynamic segments [id] -> :id for readability.
  routePath = routePath.replace(/\[\.\.\.(\w+)\]/g, "*").replace(/\[(\w+)\]/g, ":$1");
  routePath = routePath.replace(/\/+$/, "") || "/";

  const methods = exportedHttpHandlers(content);
  const startLine = 1;
  if (methods.length === 0) {
    // pages/api default handler -> ANY; app router with no recognized export -> skip.
    if (pagesMatch) return [{ method: "ANY", path: routePath, startLine, endLine: startLine }];
    return [];
  }
  return methods.map((method) => ({ method, path: routePath, startLine, endLine: startLine }));
}

function exportedHttpHandlers(content: string): string[] {
  const found = new Set<string>();
  // export async function GET(...) / export const POST = ...
  const fnRe =
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/g;
  const constRe = /export\s+const\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(content)) !== null) found.add(m[1]);
  while ((m = constRe.exec(content)) !== null) found.add(m[1]);
  return [...found];
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const SQL_EXTS = new Set([".sql"]);
const PRISMA_EXTS = new Set([".prisma"]);
const TS_JS_EXTS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const JAVA_EXTS = new Set([".java"]);

/**
 * Detect all contracts for a file. `root` is the tree-sitter root node when the
 * file was parsed (used for Drizzle object-key extraction); pass null for files
 * with no grammar (SQL/Prisma) — text heuristics still run.
 *
 * Never throws: each detector is isolated so one bad file cannot crash the scan.
 */
export function detectContracts(
  filePath: string,
  content: string,
  root: TSNode | null,
): DetectedContracts {
  const result = empty();
  const ext = extname(filePath).toLowerCase();

  const safe = <T>(fn: () => T[]): T[] => {
    try {
      return fn();
    } catch {
      return [];
    }
  };

  if (SQL_EXTS.has(ext)) {
    result.definitions.push(...safe(() => detectSqlTables(content)));
    return result; // SQL files have no endpoints.
  }

  if (PRISMA_EXTS.has(ext)) {
    result.definitions.push(...safe(() => detectPrismaModels(content)));
    return result;
  }

  if (TS_JS_EXTS.has(ext)) {
    if (root) {
      result.definitions.push(...safe(() => detectDrizzleFromTree(root)));
    } else {
      result.definitions.push(...safe(() => detectDrizzleFromText(content)));
    }
    result.endpoints.push(...safe(() => detectEndpoints(filePath, content)));
    return result;
  }

  if (JAVA_EXTS.has(ext)) {
    result.definitions.push(...safe(() => detectJpaEntities(content)));
    result.endpoints.push(...safe(() => detectEndpoints(filePath, content)));
    return result;
  }

  // Other languages (Python, C#, Go, ...) — endpoints only (decorator/router).
  result.endpoints.push(...safe(() => detectEndpoints(filePath, content)));
  return result;
}
