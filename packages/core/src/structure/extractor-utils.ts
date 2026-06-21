/**
 * Shared tree-sitter AST helpers + the internal structural-analysis shape that
 * language extractors emit. Kept separate from the manifest's FileSymbols so the
 * extractors stay close to the tree-sitter node model; `toFileSymbols` maps the
 * two.
 */

export type TSNode = import("web-tree-sitter").Node;

export interface RawFunction {
  name: string;
  lineRange: [number, number];
  params: string[];
}

export interface RawClass {
  name: string;
  lineRange: [number, number];
  methods: string[];
  properties: string[];
}

export interface RawImport {
  source: string;
  specifiers: string[];
  lineNumber: number;
}

export interface RawExport {
  name: string;
  lineNumber: number;
  isDefault?: boolean;
}

export interface StructuralAnalysis {
  functions: RawFunction[];
  classes: RawClass[];
  imports: RawImport[];
  exports: RawExport[];
}

export interface LanguageExtractor {
  languageIds: string[];
  extractStructure(rootNode: TSNode): StructuralAnalysis;
}

/** Extract the unquoted string value from a string-like node. */
export function getStringValue(node: TSNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === "string_fragment") return child.text;
  }
  return node.text.replace(/^['"`]|['"`]$/g, "");
}

/** First child of a given type, or null. */
export function findChild(node: TSNode, type: string): TSNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) return child;
  }
  return null;
}

/** All children of a given type. */
export function findChildren(node: TSNode, type: string): TSNode[] {
  const out: TSNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) out.push(child);
  }
  return out;
}
