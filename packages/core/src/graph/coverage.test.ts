import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDocumentedItems, computeLayerCoverage } from "./coverage.js";
import type { Candidate } from "../manifest/candidates.js";

const cand = (id: string, kind: string, name: string): Candidate => ({
  id,
  kind,
  name,
  file: "src/x.java",
  startLine: 1,
  endLine: 2,
});

test("anchored items are recognized at any heading level (## as well as ###)", () => {
  const md = `# Endpoints

## TutorialController [MUST] <!-- id: class:src/x.java:TutorialController -->
prose
### getAll [MUST] <!-- id: function:src/x.java:getAll -->
`;
  const items = extractDocumentedItems(md, "api/endpoints.md");
  const ids = items.map((i) => i.id);
  assert.ok(ids.includes("class:src/x.java:TutorialController"), "h2 anchored class must be an item");
  assert.ok(ids.includes("function:src/x.java:getAll"), "h3 anchored function must be an item");
});

test("un-anchored shallow headings stay section titles, not items", () => {
  const md = `## Route Inventory [MUST]

### Derived methods
`;
  const items = extractDocumentedItems(md, "api/endpoints.md");
  // The h2 section title is dropped; the h3 prose heading is still an (un-anchored) item.
  assert.equal(items.find((i) => i.name === "Route Inventory"), undefined);
  assert.ok(items.find((i) => i.name === "Derived methods"));
});

test("anchor id containing a space (endpoint id) is captured in full", () => {
  const md = `## GET /tutorials [MUST] <!-- id: endpoint:src/x.java:GET /tutorials -->`;
  const [item] = extractDocumentedItems(md, "api/endpoints.md");
  assert.equal(item.id, "endpoint:src/x.java:GET /tutorials");
  assert.equal(item.name, "GET /tutorials");
});

test("a file: candidate is covered when any symbol of that file is documented (no phantom file gap)", () => {
  // A single-class file: documenting the class must cover BOTH the class
  // candidate and the whole-file pseudo-candidate, not leave file: as a gap.
  const candidates = [
    cand("class:src/x.java:TutorialRepository", "class", "TutorialRepository"),
    cand("file:src/x.java:x.java", "file", "x.java"),
  ];
  const md = `## TutorialRepository [MUST] <!-- id: class:src/x.java:TutorialRepository -->`;
  const cov = computeLayerCoverage("database", candidates, extractDocumentedItems(md, "database/repositories.md"));
  assert.equal(cov.covered, 2);
  assert.equal(cov.coveragePct, 100);
  assert.equal(cov.missing.length, 0);
});

test("a file: candidate with NO documented symbol in its file is still a gap", () => {
  const candidates = [cand("file:src/empty.java:empty.java", "file", "empty.java")];
  // A documented symbol from a DIFFERENT file must not cover empty.java.
  const md = `## Other [MUST] <!-- id: class:src/other.java:Other -->`;
  const cov = computeLayerCoverage("infrastructure", candidates, extractDocumentedItems(md, "infrastructure/build.md"));
  assert.equal(cov.covered, 0);
  assert.equal(cov.missing.length, 1);
  assert.equal(cov.missing[0].id, "file:src/empty.java:empty.java");
});

test("endpoints at ## with space-bearing ids now match by id (was the 7/16 bug)", () => {
  const candidates = [
    cand("class:src/x.java:TutorialController", "class", "TutorialController"),
    cand("endpoint:src/x.java:GET /tutorials", "endpoint", "GET /tutorials"),
    cand("endpoint:src/x.java:POST /tutorials", "endpoint", "POST /tutorials"),
  ];
  const md = `## TutorialController [MUST] <!-- id: class:src/x.java:TutorialController -->
## GET /tutorials [MUST] <!-- id: endpoint:src/x.java:GET /tutorials -->
## POST /tutorials [MUST] <!-- id: endpoint:src/x.java:POST /tutorials -->
`;
  const cov = computeLayerCoverage("api", candidates, extractDocumentedItems(md, "api/endpoints.md"));
  assert.equal(cov.covered, 3);
  assert.equal(cov.matchedById, 3);
  assert.equal(cov.coveragePct, 100);
});
