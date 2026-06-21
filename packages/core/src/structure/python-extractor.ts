/**
 * Python structural extractor (ported natively, MIT, from Understand-Anything).
 * Python has no export syntax, so top-level defs are treated as exports.
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
  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;
    switch (child.type) {
      case "identifier":
        if (child.text !== "self" && child.text !== "cls") params.push(child.text);
        break;
      case "typed_parameter":
      case "default_parameter":
      case "typed_default_parameter": {
        const ident = findChild(child, "identifier");
        if (ident && ident.text !== "self" && ident.text !== "cls") params.push(ident.text);
        break;
      }
      case "list_splat_pattern": {
        const ident = findChild(child, "identifier");
        if (ident) params.push("*" + ident.text);
        break;
      }
      case "dictionary_splat_pattern": {
        const ident = findChild(child, "identifier");
        if (ident) params.push("**" + ident.text);
        break;
      }
    }
  }
  return params;
}

function unwrapDecorated(node: TSNode): TSNode {
  if (node.type === "decorated_definition") {
    const inner =
      findChild(node, "function_definition") ?? findChild(node, "class_definition");
    if (inner) return inner;
  }
  return node;
}

export class PythonExtractor implements LanguageExtractor {
  readonly languageIds = ["python"];

  extractStructure(rootNode: TSNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      const inner = unwrapDecorated(node);
      switch (inner.type) {
        case "function_definition":
          this.extractFunction(inner, functions);
          this.addExport(inner, node, exports);
          break;
        case "class_definition":
          this.extractClass(inner, classes);
          this.addExport(inner, node, exports);
          break;
        case "import_statement":
          this.extractImport(inner, imports);
          break;
        case "import_from_statement":
          this.extractFromImport(inner, imports);
          break;
      }
    }
    return { functions, classes, imports, exports };
  }

  private extractFunction(node: TSNode, functions: StructuralAnalysis["functions"]): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const params = extractParams(node.childForFieldName("parameters") ?? null);
    functions.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params,
    });
  }

  private extractClass(node: TSNode, classes: StructuralAnalysis["classes"]): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const methods: string[] = [];
    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const member = body.child(i);
        if (!member) continue;
        const innerMember = unwrapDecorated(member);
        if (innerMember.type === "function_definition") {
          const methodName = innerMember.childForFieldName("name");
          if (methodName) methods.push(methodName.text);
        }
        if (member.type === "expression_statement") {
          const assignment = findChild(member, "assignment");
          if (assignment) {
            const typeNode = findChild(assignment, "type");
            const nameIdent = findChild(assignment, "identifier");
            if (typeNode && nameIdent) properties.push(nameIdent.text);
          }
        }
      }
    }
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    });
  }

  private extractImport(node: TSNode, imports: StructuralAnalysis["imports"]): void {
    const dottedNames = findChildren(node, "dotted_name");
    const aliasedImports = findChildren(node, "aliased_import");
    for (const dn of dottedNames) {
      imports.push({ source: dn.text, specifiers: [dn.text], lineNumber: node.startPosition.row + 1 });
    }
    for (const ai of aliasedImports) {
      const dottedName = findChild(ai, "dotted_name");
      const alias = ai.children.find((c) => c && c.type === "identifier");
      if (dottedName) {
        imports.push({
          source: dottedName.text,
          specifiers: [alias ? alias.text : dottedName.text],
          lineNumber: node.startPosition.row + 1,
        });
      }
    }
  }

  private extractFromImport(node: TSNode, imports: StructuralAnalysis["imports"]): void {
    const moduleNode = node.childForFieldName("module_name");
    const source = moduleNode ? moduleNode.text : "";
    const moduleNodeId = moduleNode?.id;
    const specifiers: string[] = [];
    for (const dn of findChildren(node, "dotted_name")) {
      if (dn.id === moduleNodeId) continue;
      specifiers.push(dn.text);
    }
    for (const ai of findChildren(node, "aliased_import")) {
      const alias = ai.children.find((c) => c && c.type === "identifier");
      if (alias) specifiers.push(alias.text);
    }
    if (findChild(node, "wildcard_import")) specifiers.push("*");
    imports.push({ source, specifiers, lineNumber: node.startPosition.row + 1 });
  }

  private addExport(inner: TSNode, outer: TSNode, exports: StructuralAnalysis["exports"]): void {
    const nameNode = inner.childForFieldName("name");
    if (nameNode) exports.push({ name: nameNode.text, lineNumber: outer.startPosition.row + 1 });
  }
}
