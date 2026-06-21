/**
 * Rust structural extractor (ported natively, MIT, from Understand-Anything).
 * Structs/enums/traits map to `classes`; impl methods attach to their type;
 * `pub` visibility marks exports.
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
    if (child.type === "parameter") {
      const pattern = child.childForFieldName("pattern");
      if (pattern) params.push(pattern.text);
    }
  }
  return params;
}

function isPublic(node: TSNode): boolean {
  const visMod = findChild(node, "visibility_modifier");
  return visMod !== null && visMod.text.startsWith("pub");
}

function scopedPath(node: TSNode): { path: string; name: string } {
  if (node.type === "scoped_identifier") {
    const pathNode = node.childForFieldName("path");
    const nameNode = node.childForFieldName("name");
    return { path: pathNode ? pathNode.text : "", name: nameNode ? nameNode.text : "" };
  }
  return { path: "", name: node.text };
}

export class RustExtractor implements LanguageExtractor {
  readonly languageIds = ["rust"];

  extractStructure(rootNode: TSNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];
    const methodsByType = new Map<string, string[]>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      switch (node.type) {
        case "function_item":
          this.extractFunction(node, functions, exports);
          break;
        case "struct_item":
          this.extractStruct(node, classes, exports);
          break;
        case "enum_item":
          this.extractEnum(node, classes, exports);
          break;
        case "trait_item":
          this.extractTrait(node, classes, exports);
          break;
        case "impl_item":
          this.extractImpl(node, functions, exports, methodsByType);
          break;
        case "use_declaration":
          this.extractUse(node, imports);
          break;
      }
    }

    for (const cls of classes) {
      const methods = methodsByType.get(cls.name);
      if (methods) cls.methods.push(...methods);
    }
    return { functions, classes, imports, exports };
  }

  private extractFunction(
    node: TSNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const params = extractParams(node.childForFieldName("parameters") ?? null);
    functions.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params,
    });
    if (isPublic(node)) exports.push({ name: nameNode.text, lineNumber: node.startPosition.row + 1 });
  }

  private extractStruct(
    node: TSNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body && body.type === "field_declaration_list") {
      for (const field of findChildren(body, "field_declaration")) {
        const fieldName = findChild(field, "field_identifier");
        if (fieldName) properties.push(fieldName.text);
      }
    }
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods: [],
      properties,
    });
    if (isPublic(node)) exports.push({ name: nameNode.text, lineNumber: node.startPosition.row + 1 });
  }

  private extractEnum(
    node: TSNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body && body.type === "enum_variant_list") {
      for (const variant of findChildren(body, "enum_variant")) {
        const variantName = variant.childForFieldName("name");
        if (variantName) properties.push(variantName.text);
      }
    }
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods: [],
      properties,
    });
    if (isPublic(node)) exports.push({ name: nameNode.text, lineNumber: node.startPosition.row + 1 });
  }

  private extractTrait(
    node: TSNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const methods: string[] = [];
    const body = findChild(node, "declaration_list");
    if (body) {
      for (const sig of findChildren(body, "function_signature_item")) {
        const sigName = findChild(sig, "identifier");
        if (sigName) methods.push(sigName.text);
      }
      for (const fn of findChildren(body, "function_item")) {
        const fnName = fn.childForFieldName("name");
        if (fnName) methods.push(fnName.text);
      }
    }
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties: [],
    });
    if (isPublic(node)) exports.push({ name: nameNode.text, lineNumber: node.startPosition.row + 1 });
  }

  private extractImpl(
    node: TSNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    methodsByType: Map<string, string[]>,
  ): void {
    const typeNode = node.childForFieldName("type");
    const typeName = typeNode ? typeNode.text : null;
    const body = node.childForFieldName("body");
    if (!body) return;
    for (const fn of findChildren(body, "function_item")) {
      const nameNode = fn.childForFieldName("name");
      if (!nameNode) continue;
      const params = extractParams(fn.childForFieldName("parameters") ?? null);
      functions.push({
        name: nameNode.text,
        lineRange: [fn.startPosition.row + 1, fn.endPosition.row + 1],
        params,
      });
      if (typeName) {
        if (!methodsByType.has(typeName)) methodsByType.set(typeName, []);
        methodsByType.get(typeName)!.push(nameNode.text);
      }
      if (isPublic(fn)) exports.push({ name: nameNode.text, lineNumber: fn.startPosition.row + 1 });
    }
  }

  private extractUse(node: TSNode, imports: StructuralAnalysis["imports"]): void {
    const argument = node.childForFieldName("argument");
    if (!argument) return;
    const line = node.startPosition.row + 1;
    switch (argument.type) {
      case "identifier":
        imports.push({ source: argument.text, specifiers: [argument.text], lineNumber: line });
        break;
      case "scoped_identifier": {
        const { path, name } = scopedPath(argument);
        imports.push({ source: path, specifiers: [name], lineNumber: line });
        break;
      }
      case "scoped_use_list": {
        const pathNode = argument.childForFieldName("path");
        const listNode = argument.childForFieldName("list");
        const source = pathNode ? pathNode.text : "";
        const specifiers: string[] = [];
        if (listNode) {
          for (let j = 0; j < listNode.childCount; j++) {
            const ch = listNode.child(j);
            if (!ch) continue;
            if (ch.type === "self" || ch.type === "identifier" || ch.type === "scoped_identifier") {
              specifiers.push(ch.text);
            }
          }
        }
        imports.push({ source, specifiers, lineNumber: line });
        break;
      }
      case "use_wildcard": {
        const scopedId = findChild(argument, "scoped_identifier");
        imports.push({ source: scopedId ? scopedId.text : "", specifiers: ["*"], lineNumber: line });
        break;
      }
      default:
        imports.push({ source: argument.text, specifiers: [argument.text], lineNumber: line });
        break;
    }
  }
}
