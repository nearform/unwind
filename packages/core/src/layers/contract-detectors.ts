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
import {
  findChild,
  findChildren,
  getStringValue,
  type TSNode,
} from "../structure/extractor-utils.js";

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
      origin: "sql",
      source: "sql",
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
    // @@map("physical_name") overrides the table name in the database.
    const mapM = kind === "table" ? body.match(/@@map\(\s*['"]([^'"]+)['"]\s*\)/) : null;
    defs.push({
      kind,
      name,
      fields,
      origin: "code",
      source: "prisma",
      ...(mapM ? { physicalName: mapM[1] } : {}),
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
      origin: "code",
      source: "drizzle",
      ...(tableName ? { physicalName: tableName } : {}),
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
    const stringArg = m[3];
    const name = stringArg || m[1];
    const open = m.index + m[0].length - 1;
    const close = matchBrace(content, open);
    const body = close > 0 ? content.slice(open + 1, close) : "";
    const fields = jsObjectTopLevelKeys(body);
    defs.push({
      kind: "table",
      name,
      fields,
      origin: "code",
      source: "drizzle",
      ...(stringArg ? { physicalName: stringArg } : {}),
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
// Java entities — @Entity (JPA), @Document (Spring Data MongoDB), @Table, @Node.
// Tree-sitter AST is the primary path (robust); regex is a no-grammar fallback.
// ---------------------------------------------------------------------------

/** Class-level annotations that mark a persisted entity, and their framework source. */
const JAVA_ENTITY_ANNOTATIONS: Record<string, string> = {
  Entity: "jpa",
  Document: "spring-data-mongo",
  Table: "spring-data",
  Node: "spring-data-neo4j",
};

/** AST-based detection (preferred). Walks class_declaration nodes for entity annotations. */
export function detectJavaEntitiesFromTree(root: TSNode): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];
  walk(root, (node) => {
    if (node.type !== "class_declaration") return;
    const modifiers = findChild(node, "modifiers");
    if (!modifiers) return;

    const present = new Map<string, TSNode>();
    for (let i = 0; i < modifiers.childCount; i++) {
      const child = modifiers.child(i);
      if (!child) continue;
      if (child.type !== "annotation" && child.type !== "marker_annotation") continue;
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const simple = lastDotComponent(nameNode.text);
      if (simple in JAVA_ENTITY_ANNOTATIONS) present.set(simple, child);
    }
    if (present.size === 0) return;

    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    // Source by precedence; physical name from @Document(collection=) / @Table(name=).
    let source = "jpa";
    let physicalName: string | undefined;
    for (const key of ["Document", "Node", "Entity", "Table"]) {
      if (present.has(key)) {
        source = JAVA_ENTITY_ANNOTATIONS[key];
        break;
      }
    }
    if (present.has("Document")) physicalName = annotationString(present.get("Document")!, "collection");
    if (!physicalName && present.has("Table")) physicalName = annotationString(present.get("Table")!, "name");

    defs.push({
      kind: "table",
      name: nameNode.text,
      fields: javaEntityFields(node.childForFieldName("body")),
      origin: "code",
      source,
      ...(physicalName ? { physicalName } : {}),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  });
  return defs;
}

/** Last dotted component of an annotation name (jakarta.persistence.Entity -> Entity). */
function lastDotComponent(text: string): string {
  const parts = text.split(".");
  return parts[parts.length - 1];
}

/** Read a string argument from an annotation: named (key = "x") or first positional. */
function annotationString(ann: TSNode, key: string): string | undefined {
  const args = ann.childForFieldName("arguments");
  if (!args) return undefined;
  for (const pair of findChildren(args, "element_value_pair")) {
    const k = pair.childForFieldName("key");
    const v = pair.childForFieldName("value");
    if (k && v && k.text === key && v.type === "string_literal") return getStringValue(v);
  }
  for (let i = 0; i < args.childCount; i++) {
    const c = args.child(i);
    if (c && c.type === "string_literal") return getStringValue(c);
  }
  return undefined;
}

/** Instance field names from a class body (field_declaration -> variable_declarator). */
function javaEntityFields(body: TSNode | null | undefined): string[] {
  if (!body) return [];
  const fields: string[] = [];
  for (const fd of findChildren(body, "field_declaration")) {
    for (const decl of findChildren(fd, "variable_declarator")) {
      const nameNode = decl.childForFieldName("name");
      if (nameNode) fields.push(nameNode.text);
    }
  }
  return fields;
}

/** Regex fallback used only when no tree-sitter grammar is available for the file. */
export function detectJpaEntities(content: string): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];
  // @Entity / @Document / @Node (optionally @Table(name="..")) preceding a class.
  const re =
    /@(?:Entity|Document|Node)\b[^\n]*(?:\n(?:\s*@[^\n]*\n)*)?\s*(?:public\s+|final\s+|abstract\s+)*class\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    const collM = m[0].match(/@Document\s*\([^)]*collection\s*=\s*["']([^"']+)["']/);
    const tableM = m[0].match(/@Table\s*\([^)]*name\s*=\s*["']([^"']+)["']/);
    const physicalName = collM?.[1] ?? tableM?.[1];
    defs.push({
      kind: "table",
      name,
      fields: [],
      origin: "code",
      source: m[0].includes("@Document") ? "spring-data-mongo" : "jpa",
      ...(physicalName ? { physicalName } : {}),
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, m.index + m[0].length),
    });
  }
  return defs;
}

// ---------------------------------------------------------------------------
// TypeORM — class annotated @Entity (TypeScript/JavaScript)
// ---------------------------------------------------------------------------

const TYPEORM_COL_DECORATORS =
  "Column|PrimaryColumn|PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn|ObjectIdColumn|ManyToOne|OneToMany|ManyToMany|OneToOne|JoinColumn";

export function detectTypeOrmEntities(content: string): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];
  // @Entity, @Entity('name'), or @Entity({ name: 'name' }) immediately before a class.
  const re =
    /@Entity\s*(?:\(\s*(?:['"`]([^'"`]+)['"`]|\{[^}]*?name\s*:\s*['"`]([^'"`]+)['"`][^}]*?\})?\s*\))?[ \t]*(?:\r?\n(?:\s*@[^\n]*\r?\n)*)?\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const physical = m[1] || m[2];
    const name = m[3];
    if (!name) continue;
    const brace = content.indexOf("{", m.index + m[0].length - name.length);
    const fields =
      brace >= 0 ? typeOrmFields(content.slice(brace + 1, matchBrace(content, brace))) : [];
    defs.push({
      kind: "table",
      name,
      fields,
      origin: "code",
      source: "typeorm",
      ...(physical ? { physicalName: physical } : {}),
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, m.index + m[0].length),
    });
  }
  return defs;
}

function typeOrmFields(body: string): string[] {
  const fields: string[] = [];
  const re = new RegExp(
    `@(?:${TYPEORM_COL_DECORATORS})\\b\\s*(?:\\([\\s\\S]*?\\))?\\s*(?:\\r?\\n\\s*)?(\\w+)`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (!fields.includes(m[1])) fields.push(m[1]);
  }
  return fields;
}

// ---------------------------------------------------------------------------
// SQLAlchemy — declarative `class X(Base)` + imperative `Table("x", ...)` (Python)
// ---------------------------------------------------------------------------

export function detectSqlAlchemyModels(content: string): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];

  // Declarative: class Foo(Base): / class Foo(db.Model): with __tablename__.
  const classRe = /^[ \t]*class\s+(\w+)\s*\(([^)]*)\)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(content)) !== null) {
    const bases = m[2];
    if (!/\b(Base|db\.Model|DeclarativeBase|Model)\b/.test(bases)) continue;
    const name = m[1];
    const body = pythonBlockBody(content, classRe.lastIndex);
    const tableM = body.match(/__tablename__\s*=\s*['"]([^'"]+)['"]/);
    const fields = sqlAlchemyFields(body);
    defs.push({
      kind: "table",
      name,
      fields,
      origin: "code",
      source: "sqlalchemy",
      ...(tableM ? { physicalName: tableM[1] } : {}),
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, classRe.lastIndex),
    });
  }

  // Imperative: foo = Table("name", metadata, Column(...), ...)
  const tableRe = /\b(\w+)\s*=\s*Table\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = tableRe.exec(content)) !== null) {
    defs.push({
      kind: "table",
      name: m[1],
      fields: [],
      origin: "code",
      source: "sqlalchemy",
      physicalName: m[2],
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, m.index),
    });
  }

  return defs;
}

/** Lines of a Python suite (indented block) following a `:` at `fromIndex`. */
function pythonBlockBody(content: string, fromIndex: number): string {
  const lines = content.slice(fromIndex).split("\n");
  const out: string[] = [];
  let baseIndent: number | null = null;
  for (const line of lines) {
    if (line.trim() === "") {
      out.push(line);
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (baseIndent === null) {
      baseIndent = indent;
    } else if (indent < baseIndent) {
      break;
    }
    out.push(line);
  }
  return out.join("\n");
}

function sqlAlchemyFields(body: string): string[] {
  const fields: string[] = [];
  // name = Column(...)  /  name: Mapped[...] = mapped_column(...)
  const re = /^[ \t]*(\w+)\s*(?::[^=\n]+)?=\s*(?:Column|mapped_column|relationship)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1] !== "__tablename__" && !fields.includes(m[1])) fields.push(m[1]);
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Mongoose — new Schema({...}) (TypeScript/JavaScript)
// ---------------------------------------------------------------------------

export function detectMongooseModels(content: string): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];
  const seen = new Set<string>();

  const push = (name: string, fields: string[], physicalName: string | null, index: number, close: number) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    defs.push({
      kind: "table",
      name,
      fields,
      origin: "code",
      source: "mongoose",
      ...(physicalName ? { physicalName } : {}),
      startLine: lineAt(content, index),
      endLine: lineAt(content, close < 0 ? index : close),
    });
  };

  // model("name", schemaIdent) — map the schema variable to its model name. The
  // model name is the entity; the string is the physical collection seed.
  const identToModel = new Map<string, string>();
  const modelRefRe = /\b(?:mongoose\.)?model\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
  let mm: RegExpExecArray | null;
  while ((mm = modelRefRe.exec(content)) !== null) identToModel.set(mm[2], mm[1]);

  // Inline: model("name", new? mongoose.Schema({ ... })) — no intermediate variable.
  const inlineRe =
    /\b(?:mongoose\.)?model\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:new\s+)?(?:mongoose\.)?Schema(?:<[^>]*>)?\s*\(\s*\{/g;
  const inlineSchemaIdx = new Set<number>();
  while ((mm = inlineRe.exec(content)) !== null) {
    const open = mm.index + mm[0].length - 1;
    const close = matchBrace(content, open);
    if (close < 0) continue;
    inlineSchemaIdx.add(open);
    push(entityName(mm[1]), jsObjectTopLevelKeys(content.slice(open + 1, close)), mm[1], mm.index, close);
  }

  // Assigned / standalone: [const|let|var X =] new? mongoose.Schema({ ... }).
  // `new` is optional — Mongoose allows `mongoose.Schema(...)` without it.
  const schemaRe =
    /(?:(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*)?(?:new\s+)?(?:mongoose\.)?Schema(?:<[^>]*>)?\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = schemaRe.exec(content)) !== null) {
    const open = m.index + m[0].length - 1;
    if (inlineSchemaIdx.has(open)) continue; // already handled as inline model()
    const close = matchBrace(content, open);
    if (close < 0) continue;
    const fields = jsObjectTopLevelKeys(content.slice(open + 1, close));
    const varName = m[1];
    let name: string;
    let physicalName: string | null = null;
    if (varName && identToModel.has(varName)) {
      physicalName = identToModel.get(varName)!;
      name = entityName(physicalName);
    } else if (varName) {
      name = varName.replace(/Schema$/, "") || varName;
    } else {
      continue; // a bare Schema({...}) with no name and no model() — skip (noise)
    }
    push(name, fields, physicalName, m.index, close);
  }

  return defs;
}

/** Uppercase the first letter so a model string ("tutorial") reads as an entity ("Tutorial"). */
function entityName(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// Sequelize — sequelize.define('x', {...}) + class X extends Model (TS/JS)
// ---------------------------------------------------------------------------

export function detectSequelizeModels(content: string): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];

  // x.define('name', { ... })  (sequelize.define / db.define)
  const defineRe = /\b\w+\.define\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = defineRe.exec(content)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(content, open);
    const fields = close > 0 ? jsObjectTopLevelKeys(content.slice(open + 1, close)) : [];
    defs.push({
      kind: "table",
      name: m[1],
      fields,
      origin: "code",
      source: "sequelize",
      physicalName: m[1],
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, close > 0 ? close : m.index),
    });
  }

  // class Name extends Model { ... }  with optional Name.init({ ... })
  const classRe = /\bclass\s+(\w+)\s+extends\s+Model\b/g;
  while ((m = classRe.exec(content)) !== null) {
    const name = m[1];
    const initRe = new RegExp(`\\b${name}\\.init\\s*\\(\\s*\\{`);
    const initM = initRe.exec(content);
    let fields: string[] = [];
    if (initM) {
      const open = initM.index + initM[0].length - 1;
      const close = matchBrace(content, open);
      if (close > 0) fields = jsObjectTopLevelKeys(content.slice(open + 1, close));
    }
    defs.push({
      kind: "table",
      name,
      fields,
      origin: "code",
      source: "sequelize",
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, m.index + m[0].length),
    });
  }

  return defs;
}

// ---------------------------------------------------------------------------
// Entity Framework Core — DbSet<T> on a DbContext (C#)
// ---------------------------------------------------------------------------

export function detectEfCoreEntities(content: string): SymbolDefinition[] {
  const defs: SymbolDefinition[] = [];
  // public DbSet<Foo> Foos { get; set; }  — the generic type is the entity.
  const re = /\bDbSet\s*<\s*([A-Za-z_]\w*)\s*>/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    defs.push({
      kind: "table",
      name,
      fields: [],
      origin: "code",
      source: "efcore",
      startLine: lineAt(content, m.index),
      endLine: lineAt(content, m.index),
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
const PYTHON_EXTS = new Set([".py", ".pyi"]);
const CSHARP_EXTS = new Set([".cs"]);

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
    // Other TS/JS ORMs are all text/regex-based (no AST needed).
    result.definitions.push(...safe(() => detectTypeOrmEntities(content)));
    result.definitions.push(...safe(() => detectMongooseModels(content)));
    result.definitions.push(...safe(() => detectSequelizeModels(content)));
    result.endpoints.push(...safe(() => detectEndpoints(filePath, content)));
    return dedupeDefinitions(result);
  }

  if (JAVA_EXTS.has(ext)) {
    if (root) {
      result.definitions.push(...safe(() => detectJavaEntitiesFromTree(root)));
    } else {
      result.definitions.push(...safe(() => detectJpaEntities(content)));
    }
    result.endpoints.push(...safe(() => detectEndpoints(filePath, content)));
    return result;
  }

  if (PYTHON_EXTS.has(ext)) {
    result.definitions.push(...safe(() => detectSqlAlchemyModels(content)));
    result.endpoints.push(...safe(() => detectEndpoints(filePath, content)));
    return dedupeDefinitions(result);
  }

  if (CSHARP_EXTS.has(ext)) {
    result.definitions.push(...safe(() => detectEfCoreEntities(content)));
    result.endpoints.push(...safe(() => detectEndpoints(filePath, content)));
    return dedupeDefinitions(result);
  }

  // Other languages (Go, Ruby, ...) — endpoints only (decorator/router).
  result.endpoints.push(...safe(() => detectEndpoints(filePath, content)));
  return result;
}

/**
 * Two ORM detectors can surface the same logical table in one file (e.g. a
 * Sequelize `class X extends Model` plus a `X.init(...)`). Dedupe by (kind,name),
 * keeping the first occurrence so candidate ids never collide downstream.
 */
function dedupeDefinitions(result: DetectedContracts): DetectedContracts {
  const seen = new Set<string>();
  result.definitions = result.definitions.filter((d) => {
    const k = `${d.kind}:${d.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return result;
}
