/**
 * Java structural extractor (ported natively, MIT, from Understand-Anything).
 * Classes/interfaces -> classes; methods + constructors -> functions and the
 * containing type's methods; `public` marks exports.
 */

import {
  type LanguageExtractor,
  type StructuralAnalysis,
  type TSNode,
  findChild,
  findChildren,
} from "./extractor-utils.js";

function extractParams(paramsNode: TSNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];
  for (const decl of findChildren(paramsNode, "formal_parameter")) {
    const nameNode = decl.childForFieldName("name");
    if (nameNode) params.push(nameNode.text);
  }
  for (const spread of findChildren(paramsNode, "spread_parameter")) {
    const nameNode = spread.childForFieldName("name");
    if (nameNode) params.push(nameNode.text);
  }
  return params;
}

function hasModifier(node: TSNode, modifier: string): boolean {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return false;
  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i);
    if (child && child.text === modifier) return true;
  }
  return false;
}

function lastComponent(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1];
}

export class JavaExtractor implements LanguageExtractor {
  readonly languageIds = ["java"];

  extractStructure(rootNode: TSNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      switch (node.type) {
        case "import_declaration":
          this.extractImport(node, imports);
          break;
        case "class_declaration":
          this.extractClass(node, functions, classes, exports);
          break;
        case "interface_declaration":
          this.extractInterface(node, classes, exports);
          break;
      }
    }
    return { functions, classes, imports, exports };
  }

  private extractImport(node: TSNode, imports: StructuralAnalysis["imports"]): void {
    const hasAsterisk = findChild(node, "asterisk") !== null;
    const scopedId = findChild(node, "scoped_identifier");
    if (!scopedId) return;
    const fullPath = scopedId.text;
    imports.push({
      source: fullPath,
      specifiers: [hasAsterisk ? "*" : lastComponent(fullPath)],
      lineNumber: node.startPosition.row + 1,
    });
  }

  private extractClass(
    node: TSNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const methods: string[] = [];
    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body) this.extractClassBody(body, methods, properties, functions, exports);
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    });
    if (hasModifier(node, "public")) exports.push({ name: nameNode.text, lineNumber: node.startPosition.row + 1 });
  }

  private extractInterface(
    node: TSNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const methods: string[] = [];
    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body) {
      for (const methodNode of findChildren(body, "method_declaration")) {
        const m = methodNode.childForFieldName("name");
        if (m) methods.push(m.text);
      }
      for (const field of findChildren(body, "constant_declaration")) {
        for (const decl of findChildren(field, "variable_declarator")) {
          const declName = decl.childForFieldName("name");
          if (declName) properties.push(declName.text);
        }
      }
    }
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    });
    if (hasModifier(node, "public")) exports.push({ name: nameNode.text, lineNumber: node.startPosition.row + 1 });
  }

  private extractClassBody(
    body: TSNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;
      if (child.type === "method_declaration" || child.type === "constructor_declaration") {
        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;
        const params = extractParams(child.childForFieldName("parameters") ?? null);
        methods.push(nameNode.text);
        functions.push({
          name: nameNode.text,
          lineRange: [child.startPosition.row + 1, child.endPosition.row + 1],
          params,
        });
        if (hasModifier(child, "public")) {
          exports.push({ name: nameNode.text, lineNumber: child.startPosition.row + 1 });
        }
      } else if (child.type === "field_declaration") {
        for (const decl of findChildren(child, "variable_declarator")) {
          const nameNode = decl.childForFieldName("name");
          if (nameNode) {
            properties.push(nameNode.text);
            if (hasModifier(child, "public")) {
              exports.push({ name: nameNode.text, lineNumber: child.startPosition.row + 1 });
            }
          }
        }
      }
    }
  }
}
