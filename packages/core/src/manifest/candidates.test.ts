import { test } from "node:test";
import assert from "node:assert/strict";
import { fileCandidates } from "./candidates.js";
import { emptySymbols, type ManifestFile } from "./manifest-schema.js";

function fileWith(partial: Partial<ManifestFile["symbols"]>): ManifestFile {
  return {
    path: "src/lib.rs",
    language: "rust",
    fileCategory: "code",
    sizeLines: 100,
    contentHash: "deadbeef",
    rebuildLayer: "service",
    symbolsExtracted: true,
    symbols: { ...emptySymbols(), ...partial },
  } as ManifestFile;
}

test("fileCandidates dedupes same-id symbols within one file", () => {
  // Two `new` fns (different impl blocks) and two inline `GET /test` apps all
  // collapse to one id each — the join key can't disambiguate them.
  const file = fileWith({
    functions: [
      { name: "new", startLine: 10, endLine: 12, params: [], exported: true },
      { name: "new", startLine: 40, endLine: 42, params: [], exported: true },
    ],
    endpoints: [
      { method: "GET", path: "/test", startLine: 5, endLine: 6 },
      { method: "GET", path: "/test", startLine: 50, endLine: 51 },
    ],
  });

  const ids = fileCandidates(file).map((c) => c.id);
  const unique = new Set(ids);
  assert.equal(ids.length, unique.size, `duplicate ids leaked: ${ids.join(", ")}`);
  assert.ok(ids.includes("function:src/lib.rs:new"));
  assert.ok(ids.includes("endpoint:src/lib.rs:GET /test"));
  // First (earliest) occurrence wins.
  const fn = fileCandidates(file).find((c) => c.id === "function:src/lib.rs:new");
  assert.equal(fn?.startLine, 10);
});

test("fileCandidates keeps distinct names", () => {
  const file = fileWith({
    functions: [
      { name: "start", startLine: 1, endLine: 2, params: [], exported: true },
      { name: "stop", startLine: 3, endLine: 4, params: [], exported: true },
    ],
  });
  const ids = fileCandidates(file).map((c) => c.id);
  assert.ok(ids.includes("function:src/lib.rs:start"));
  assert.ok(ids.includes("function:src/lib.rs:stop"));
});
