/**
 * C# structural extractor (ported natively, MIT, from Understand-Anything).
 * Classes/interfaces -> classes; methods/constructors -> functions; properties
 * and fields -> properties; `public` marks exports. Walks namespaces.
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
  for (const param of findChildren(paramsNode, "parameter")) {
    const nameNode = param.childForFieldName("name");
    if (nameNode) params.push(nameNode.text);
  }
  return params;
}

function hasModifier(node: TSNode, modifier: string): boolean {
  for (const mod of findChildren(node, "modifier")) {
    for (let i = 0; i < mod.childCount; i++) {
      const child = mod.child(i);
      if (child && child.text === modifier) return true;
    }
    if (mod.text === modifier) return true;
  }
  return false;
}

function lastComponent(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1];
}

export class CSharpExtractor implements LanguageExtractor {
  readonly languageIds = ["csharp"];

  extractStructure(rootNode: TSNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];
    this.walk(rootNode, functions, classes, imports, exports);
    return { functions, classes, imports, exports };
  }

  /** Recurse through compilation unit + namespaces (block and file-scoped). */
  private walk(
    node: TSNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      switch (child.type) {
        case "using_directive":
          this.extractUsing(child, imports);
          break;
        case "namespace_declaration": {
          const body = child.childForFieldName("body");
          if (body) this.walk(body, functions, classes, imports, exports);
          break;
        }
        case "file_scoped_namespace_declaration":
          // Declarations are siblings at the root; the outer loop covers them.
          break;
        case "class_declaration":
          this.extractClass(child, functions, classes, exports);
          break;
        case "interface_declaration":
          this.extractInterface(child, classes, exports);
          break;
      }
    }
  }

  private extractUsing(node: TSNode, imports: StructuralAnalysis["imports"]): void {
    const qualifiedName = findChild(node, "qualified_name");
    const identifier = findChild(node, "identifier");
    const source = qualifiedName ? qualifiedName.text : identifier ? identifier.text : null;
    if (!source) return;
    imports.push({ source, specifiers: [lastComponent(source)], lineNumber: node.startPosition.row + 1 });
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
      for (const propNode of findChildren(body, "property_declaration")) {
        const p = propNode.childForFieldName("name");
        if (p) properties.push(p.text);
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
      switch (child.type) {
        case "method_declaration":
        case "constructor_declaration": {
          const nameNode = child.childForFieldName("name");
          if (!nameNode) break;
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
          break;
        }
        case "property_declaration": {
          const nameNode = child.childForFieldName("name");
          if (nameNode) {
            properties.push(nameNode.text);
            if (hasModifier(child, "public")) {
              exports.push({ name: nameNode.text, lineNumber: child.startPosition.row + 1 });
            }
          }
          break;
        }
        case "field_declaration": {
          const varDecl = findChild(child, "variable_declaration");
          if (!varDecl) break;
          for (const decl of findChildren(varDecl, "variable_declarator")) {
            const nameNode = findChild(decl, "identifier");
            if (nameNode) {
              properties.push(nameNode.text);
              if (hasModifier(child, "public")) {
                exports.push({ name: nameNode.text, lineNumber: child.startPosition.row + 1 });
              }
            }
          }
          break;
        }
      }
    }
  }
}
