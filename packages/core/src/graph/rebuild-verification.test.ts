import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRebuildVerification,
  endpointKey,
  normalizeEndpointPath,
  normalizeTableName,
  validateRebuildVerification,
  type BuildVerificationInputs,
  type RebuildMapping,
} from "./rebuild-verification.js";
import { emptySymbols, type ManifestFile, type ScanManifest } from "../manifest/manifest-schema.js";
import type { ContractKind, RebuildGraph, RebuildNode, RebuildPriority } from "./rebuild-graph-schema.js";

// --- normalizeEndpointPath: param syntax across frameworks collapses to {} ---

test("path param syntax is normalized identically across frameworks", () => {
  const want = "/users/{}/posts/{}";
  assert.equal(normalizeEndpointPath("/users/:id/posts/:postId"), want); // Express/Hono
  assert.equal(normalizeEndpointPath("/users/{id}/posts/{postId}"), want); // OpenAPI/Spring
  assert.equal(normalizeEndpointPath("/users/<id>/posts/<int:postId>"), want); // Flask
  assert.equal(normalizeEndpointPath("/users/[id]/posts/[postId]"), want); // Next
  assert.equal(normalizeEndpointPath("/users/:id?/posts/:postId"), want); // optional param
});

test("path normalization strips trailing slash and query, preserves static case", () => {
  assert.equal(normalizeEndpointPath("/API/Users/"), "/API/Users");
  assert.equal(normalizeEndpointPath("/users?active=1"), "/users");
  assert.equal(normalizeEndpointPath("/"), "/");
  assert.equal(normalizeEndpointPath("users"), "/users");
});

test("endpointKey uppercases the method", () => {
  assert.equal(endpointKey("get", "/users/:id"), "GET /users/{}");
});

// --- normalizeTableName: snake/camel/pascal collapse; physicalName wins ---

test("table name normalization absorbs snake_case vs camelCase", () => {
  assert.equal(normalizeTableName({ name: "userAccounts" }), "useraccounts");
  assert.equal(normalizeTableName({ name: "user_accounts" }), "useraccounts");
  assert.equal(normalizeTableName({ name: "UserAccounts" }), "useraccounts");
});

test("physicalName is preferred over the code name", () => {
  assert.equal(normalizeTableName({ name: "User", physicalName: "users" }), "users");
});

// --- fixtures -------------------------------------------------------------

function mfile(path: string, layer: ManifestFile["rebuildLayer"], symbols: Partial<ManifestFile["symbols"]>): ManifestFile {
  return {
    path,
    language: "typescript",
    fileCategory: "code",
    sizeLines: 50,
    contentHash: "hash",
    rebuildLayer: layer,
    symbolsExtracted: true,
    symbols: { ...emptySymbols(), ...symbols },
  };
}

function manifest(name: string, files: ManifestFile[]): ScanManifest {
  return {
    version: "1.0.0",
    generatedAt: "2026-06-24T00:00:00.000Z",
    gitCommitHash: null,
    repository: { type: "local", url: `/tmp/${name}`, branch: null, linkFormat: "{path}:{start}-{end}" },
    project: { name, languages: ["typescript"], estimatedComplexity: "small" },
    files,
    importMap: {},
    layerIndex: {},
    stats: { totalFiles: files.length, byLanguage: {}, byCategory: {}, byLayer: {}, symbolsExtractedFiles: files.length },
  };
}

function node(id: string, layer: string, priority: RebuildPriority, contractKind: ContractKind): RebuildNode {
  return {
    id,
    type: contractKind === "db-table" ? "table" : contractKind === "api-endpoint" ? "endpoint" : "file",
    name: id.split(":").slice(2).join(":"),
    filePath: id.split(":")[1],
    layer,
    lineRange: { start: 1, end: 2 },
    rebuild: { priority, contractKind, coverage: "verified", docRef: null, rebuildStatus: "not-started" },
  };
}

function graph(nodes: RebuildNode[]): RebuildGraph {
  return {
    version: "1.0.0",
    generatedAt: "2026-06-24T00:00:00.000Z",
    project: { name: "src", languages: ["typescript"] },
    repository: { linkFormat: "{path}:{start}-{end}", url: null, branch: null },
    layers: [],
    nodes,
    edges: [],
    stats: { nodeCount: nodes.length, edgeCount: 0, layerCount: 0, byNodeType: {}, byEdgeType: {}, byCoverage: {}, byPriority: {}, coveragePct: 0 },
  };
}

function run(inputs: Omit<BuildVerificationInputs, never>): ReturnType<typeof buildRebuildVerification> {
  return buildRebuildVerification(inputs, "2026-06-24T00:00:00.000Z");
}

// --- buildRebuildVerification --------------------------------------------

test("a mapped table whose fields all carry over is equivalent", () => {
  const srcM = manifest("src", [
    mfile("src/db.ts", "database", { definitions: [{ name: "users", kind: "table", fields: ["id", "email", "orgId"], startLine: 1, endLine: 10 }] }),
  ]);
  const tgtM = manifest("tgt", [
    mfile("src/schema/users.ts", "database", { definitions: [{ name: "users", kind: "table", fields: ["id", "email", "org_id"], startLine: 1, endLine: 10 }] }),
  ]);
  const g = graph([node("table:src/db.ts:users", "database", "MUST", "db-table")]);
  const mappings: RebuildMapping[] = [
    { sourceId: "table:src/db.ts:users", targetFiles: ["src/schema/users.ts"], targetIds: ["table:src/schema/users.ts:users"] },
  ];
  const v = run({ sourceGraph: g, sourceManifest: srcM, targetManifest: tgtM, mappings });
  const n = v.nodes[0];
  assert.equal(n.rebuiltState, "equivalent"); // orgId ≡ org_id under norm()
  assert.equal(v.stats.completenessPct, 100);
  assert.equal(v.stats.totalMust, 1);
});

test("a mapped table missing a source field is divergent", () => {
  const srcM = manifest("src", [
    mfile("src/db.ts", "database", { definitions: [{ name: "users", kind: "table", fields: ["id", "email", "orgId"], startLine: 1, endLine: 10 }] }),
  ]);
  const tgtM = manifest("tgt", [
    mfile("src/schema/users.ts", "database", { definitions: [{ name: "users", kind: "table", fields: ["id", "email"], startLine: 1, endLine: 10 }] }),
  ]);
  const g = graph([node("table:src/db.ts:users", "database", "MUST", "db-table")]);
  const mappings: RebuildMapping[] = [
    { sourceId: "table:src/db.ts:users", targetFiles: ["src/schema/users.ts"], targetIds: ["table:src/schema/users.ts:users"] },
  ];
  const v = run({ sourceGraph: g, sourceManifest: srcM, targetManifest: tgtM, mappings });
  assert.equal(v.nodes[0].rebuiltState, "divergent");
  assert.deepEqual(v.nodes[0].diff?.missingFields, ["orgId"]);
  assert.equal(v.stats.completenessPct, 0); // divergent does not count toward completeness
});

test("an endpoint matching after param rename is equivalent", () => {
  const srcM = manifest("src", [
    mfile("src/api.ts", "api", { endpoints: [{ method: "GET", path: "/users/:userId", startLine: 1, endLine: 5 }] }),
  ]);
  const tgtM = manifest("tgt", [
    mfile("src/routes.ts", "api", { endpoints: [{ method: "GET", path: "/users/{id}", startLine: 1, endLine: 5 }] }),
  ]);
  const g = graph([node("endpoint:src/api.ts:GET /users/:userId", "api", "MUST", "api-endpoint")]);
  const mappings: RebuildMapping[] = [
    { sourceId: "endpoint:src/api.ts:GET /users/:userId", targetFiles: ["src/routes.ts"], targetIds: ["endpoint:src/routes.ts:GET /users/{id}"] },
  ];
  const v = run({ sourceGraph: g, sourceManifest: srcM, targetManifest: tgtM, mappings });
  assert.equal(v.nodes[0].rebuiltState, "equivalent");
  assert.equal(v.nodes[0].diff?.methodMatch, true);
  assert.equal(v.nodes[0].diff?.pathMatch, true);
});

test("apiStyleChanged falls back to structural present, not equivalent", () => {
  const srcM = manifest("src", [
    mfile("src/api.ts", "api", { endpoints: [{ method: "GET", path: "/users", startLine: 1, endLine: 5 }] }),
  ]);
  const tgtM = manifest("tgt", [
    mfile("src/trpc.ts", "api", { endpoints: [{ method: "POST", path: "/trpc/users.list", startLine: 1, endLine: 5 }] }),
  ]);
  const g = graph([node("endpoint:src/api.ts:GET /users", "api", "MUST", "api-endpoint")]);
  const mappings: RebuildMapping[] = [
    { sourceId: "endpoint:src/api.ts:GET /users", targetFiles: ["src/trpc.ts"], targetIds: ["endpoint:src/trpc.ts:POST /trpc/users.list"] },
  ];
  const v = run({ sourceGraph: g, sourceManifest: srcM, targetManifest: tgtM, mappings, apiStyleChanged: true });
  assert.equal(v.nodes[0].rebuiltState, "present");
  assert.equal(v.stats.completenessPct, 100); // present counts toward completeness
});

test("an unmapped MUST node is missing; a stub-claimed node is claimed", () => {
  const srcM = manifest("src", [
    mfile("src/db.ts", "database", { definitions: [{ name: "users", kind: "table", fields: ["id"], startLine: 1, endLine: 10 }] }),
    mfile("src/svc.ts", "service", { functions: [{ name: "calc", startLine: 1, endLine: 5, params: [], exported: true }] }),
  ]);
  const tgtM = manifest("tgt", []); // target scan contains nothing
  const g = graph([
    node("table:src/db.ts:users", "database", "MUST", "db-table"),
    node("function:src/svc.ts:calc", "service", "MUST", null),
  ]);
  const mappings: RebuildMapping[] = [
    // users is claimed but absent from target scan; calc is not mapped at all.
    { sourceId: "table:src/db.ts:users", targetFiles: ["x.ts"], targetIds: ["table:x.ts:users"] },
  ];
  const v = run({ sourceGraph: g, sourceManifest: srcM, targetManifest: tgtM, mappings });
  const byId = Object.fromEntries(v.nodes.map((n) => [n.sourceId, n.rebuiltState]));
  assert.equal(byId["table:src/db.ts:users"], "claimed");
  assert.equal(byId["function:src/svc.ts:calc"], "missing");
  assert.equal(v.stats.completenessPct, 0);
  assert.equal(v.stats.totalMust, 2);
});

test("DON'T-priority nodes are excluded and not counted in totalMust", () => {
  const srcM = manifest("src", [
    mfile("src/legacy.ts", "service", { functions: [{ name: "legacy", startLine: 1, endLine: 5, params: [], exported: true }] }),
  ]);
  const tgtM = manifest("tgt", []);
  const g = graph([node("function:src/legacy.ts:legacy", "service", "DON'T", null)]);
  const v = run({ sourceGraph: g, sourceManifest: srcM, targetManifest: tgtM, mappings: [] });
  assert.equal(v.nodes[0].rebuiltState, "excluded");
  assert.equal(v.stats.totalMust, 0);
  assert.equal(v.stats.completenessPct, 100); // nothing required → vacuously complete
});

test("a non-contract node that exists in the target scan is present", () => {
  const srcM = manifest("src", [
    mfile("src/svc.ts", "service", { functions: [{ name: "calc", startLine: 1, endLine: 5, params: [], exported: true }] }),
  ]);
  const tgtM = manifest("tgt", [
    mfile("src/services/calc.ts", "service", { functions: [{ name: "calc", startLine: 1, endLine: 5, params: [], exported: true }] }),
  ]);
  const g = graph([node("function:src/svc.ts:calc", "service", "MUST", null)]);
  const mappings: RebuildMapping[] = [
    { sourceId: "function:src/svc.ts:calc", targetFiles: ["src/services/calc.ts"], targetIds: ["function:src/services/calc.ts:calc"] },
  ];
  const v = run({ sourceGraph: g, sourceManifest: srcM, targetManifest: tgtM, mappings });
  assert.equal(v.nodes[0].rebuiltState, "present");
  assert.ok(v.edges.some((e) => e.targetId === "function:src/services/calc.ts:calc"));
});

test("the produced graph validates", () => {
  const srcM = manifest("src", [mfile("src/db.ts", "database", { definitions: [{ name: "users", kind: "table", fields: ["id"], startLine: 1, endLine: 2 }] })]);
  const tgtM = manifest("tgt", [mfile("s/u.ts", "database", { definitions: [{ name: "users", kind: "table", fields: ["id"], startLine: 1, endLine: 2 }] })]);
  const g = graph([node("table:src/db.ts:users", "database", "MUST", "db-table")]);
  const v = run({
    sourceGraph: g,
    sourceManifest: srcM,
    targetManifest: tgtM,
    mappings: [{ sourceId: "table:src/db.ts:users", targetFiles: ["s/u.ts"], targetIds: ["table:s/u.ts:users"] }],
  });
  assert.deepEqual(validateRebuildVerification(v), []);
});
