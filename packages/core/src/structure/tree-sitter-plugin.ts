/**
 * Tree-sitter structural extraction plugin.
 *
 * init() is async (loads WASM grammars); analyzeFile() is synchronous so it can
 * be injected as the buildManifest SymbolExtractor. Languages without a loaded
 * grammar degrade gracefully (null result -> empty symbols, file still scanned).
 */

import { createRequire } from "node:module";
import { extname } from "node:path";
import {
  emptySymbols,
  type FileSymbols,
} from "../manifest/manifest-schema.js";
import {
  type LanguageExtractor,
  type StructuralAnalysis,
  type TSNode,
} from "./extractor-utils.js";
import { detectContracts } from "../layers/contract-detectors.js";
import { TypeScriptExtractor } from "./typescript-extractor.js";
import { PythonExtractor } from "./python-extractor.js";
import { RustExtractor } from "./rust-extractor.js";
import { JavaExtractor } from "./java-extractor.js";
import { CSharpExtractor } from "./csharp-extractor.js";

const require = createRequire(import.meta.url);

type TreeSitterParser = import("web-tree-sitter").Parser;
type TreeSitterLanguage = import("web-tree-sitter").Language;

/** Grammar specs: language id -> wasm module path resolvable via require.resolve. */
const GRAMMARS: Record<string, string> = {
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  rust: "tree-sitter-rust/tree-sitter-rust.wasm",
  java: "tree-sitter-java/tree-sitter-java.wasm",
  csharp: "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm",
};

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
};

export class TreeSitterPlugin {
  private ParserClass: (new () => TreeSitterParser) | null = null;
  private languages = new Map<string, TreeSitterLanguage>();
  private extractors = new Map<string, LanguageExtractor>();
  private initialized = false;

  constructor() {
    const all = [
      new TypeScriptExtractor(),
      new PythonExtractor(),
      new RustExtractor(),
      new JavaExtractor(),
      new CSharpExtractor(),
    ];
    for (const ex of all) {
      for (const id of ex.languageIds) this.extractors.set(id, ex);
    }
  }

  /** Load the WASM runtime and all available grammars. Safe to call once. */
  async init(): Promise<void> {
    if (this.initialized) return;
    const mod = await import("web-tree-sitter");
    const ParserCls = mod.Parser;
    const LanguageCls = mod.Language;
    await ParserCls.init();
    this.ParserClass = ParserCls as unknown as new () => TreeSitterParser;

    await Promise.all(
      Object.entries(GRAMMARS).map(async ([id, wasmModule]) => {
        try {
          const wasmPath = require.resolve(wasmModule);
          const lang = await LanguageCls.load(wasmPath);
          this.languages.set(id, lang);
        } catch {
          // Grammar unavailable — language degrades to file-level only.
        }
      }),
    );
    this.initialized = true;
  }

  /** Map a path to a grammar key (tsx is its own grammar). */
  private langKeyFor(filePath: string): string | null {
    const ext = extname(filePath).toLowerCase();
    return EXT_TO_LANG[ext] ?? null;
  }

  /** Extractor for a grammar key (tsx shares the typescript extractor). */
  private extractorFor(langKey: string): LanguageExtractor | null {
    const key = langKey === "tsx" ? "typescript" : langKey;
    return this.extractors.get(key) ?? null;
  }

  /**
   * Synchronously extract symbols for a file. Returns null when no grammar/
   * extractor matched so the caller records empty symbols (symbolsExtracted=false).
   */
  analyze(filePath: string, content: string): FileSymbols | null {
    if (!this.initialized || !this.ParserClass) {
      throw new Error("TreeSitterPlugin.init() must be awaited before analyze()");
    }
    const langKey = this.langKeyFor(filePath);

    // Contract-only languages (SQL, Prisma) have no tree-sitter grammar here,
    // but still produce table/enum definitions via regex. Returning non-null
    // marks the file as symbolsExtracted and flows definitions into candidates.
    if (!langKey) {
      const contracts = safeDetectContracts(filePath, content, null);
      if (contracts.definitions.length > 0 || contracts.endpoints.length > 0) {
        const symbols = emptySymbols();
        symbols.definitions = contracts.definitions;
        symbols.endpoints = contracts.endpoints;
        return symbols;
      }
      return null;
    }

    const lang = this.languages.get(langKey);
    if (!lang) return null;
    const extractor = this.extractorFor(langKey);
    if (!extractor) return null;

    const parser = new this.ParserClass();
    parser.setLanguage(lang);
    let analysis: StructuralAnalysis;
    let symbols: FileSymbols;
    try {
      const tree = parser.parse(content);
      if (!tree) {
        parser.delete();
        return null;
      }
      const root = tree.rootNode as TSNode;
      analysis = extractor.extractStructure(root);
      symbols = toFileSymbols(analysis);
      // Populate definitions/endpoints from the same parsed tree (+ text).
      const contracts = safeDetectContracts(filePath, content, root);
      symbols.definitions = contracts.definitions;
      symbols.endpoints = contracts.endpoints;
      tree.delete();
    } finally {
      parser.delete();
    }
    return symbols;
  }
}

/** Run contract detection without ever throwing into the scan loop. */
function safeDetectContracts(
  filePath: string,
  content: string,
  root: TSNode | null,
): { definitions: FileSymbols["definitions"]; endpoints: FileSymbols["endpoints"] } {
  try {
    return detectContracts(filePath, content, root);
  } catch {
    return { definitions: [], endpoints: [] };
  }
}

/** Map the extractor's StructuralAnalysis to the manifest FileSymbols shape. */
export function toFileSymbols(a: StructuralAnalysis): FileSymbols {
  const symbols = emptySymbols();
  const exportedNames = new Set(a.exports.map((e) => e.name));

  symbols.functions = a.functions.map((fn) => ({
    name: fn.name,
    startLine: fn.lineRange[0],
    endLine: fn.lineRange[1],
    params: fn.params,
    exported: exportedNames.has(fn.name),
  }));
  symbols.classes = a.classes.map((c) => ({
    name: c.name,
    startLine: c.lineRange[0],
    endLine: c.lineRange[1],
    methods: c.methods,
    properties: c.properties,
    exported: exportedNames.has(c.name),
  }));
  symbols.exports = a.exports.map((e) => ({
    name: e.name,
    line: e.lineNumber,
    isDefault: e.isDefault === true,
  }));
  // definitions / endpoints are populated by contract detection (later stage).
  return symbols;
}
