import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRebuildLayer,
  classifyTestKind,
  docDirsForLayer,
  primaryDocDir,
  type LayerEvidence,
} from "./rebuild-layer-map.js";

const code = (extra: Partial<LayerEvidence> = {}): LayerEvidence => ({
  language: "java",
  fileCategory: "code",
  ...extra,
});

test("doc-dir helpers: layer name and folder differ, tests fans out, unknown falls back", () => {
  // The mismatch that caused false-0% coverage: layer name != folder name.
  assert.equal(primaryDocDir("domain"), "domain-model");
  assert.equal(primaryDocDir("service"), "service-layer");
  assert.equal(primaryDocDir("api"), "api");
  // tests fans out to three specialist folders; verify-coverage unions them.
  assert.deepEqual(docDirsForLayer("tests"), ["unit-tests", "integration-tests", "e2e-tests"]);
  assert.equal(primaryDocDir("tests"), "unit-tests");
  assert.equal(primaryDocDir("infrastructure"), "infrastructure");
  // Unknown layer falls back to its own name (no crash).
  assert.deepEqual(docDirsForLayer("mystery"), ["mystery"]);
});

test("classifyTestKind splits the tests layer into unit/integration/e2e folders", () => {
  // e2e wins on tool/dir markers.
  assert.equal(classifyTestKind("e2e/checkout.spec.ts"), "e2e-tests");
  assert.equal(classifyTestKind("cypress/integration/login.cy.ts"), "e2e-tests");
  assert.equal(classifyTestKind("tests/app.e2e.spec.ts"), "e2e-tests");
  // integration markers: dir segment, Java failsafe suffix, integration/contract token.
  assert.equal(classifyTestKind("src/integration/UserApiTest.java"), "integration-tests");
  assert.equal(classifyTestKind("src/test/java/com/app/UserServiceIT.java"), "integration-tests");
  assert.equal(classifyTestKind("test/it/repo_test.go"), "integration-tests");
  assert.equal(classifyTestKind("tests/user.integration.test.ts"), "integration-tests");
  // unit is the default, and lookalikes don't false-positive.
  assert.equal(classifyTestKind("src/__tests__/user.test.ts"), "unit-tests");
  assert.equal(classifyTestKind("test/audit.test.ts"), "unit-tests"); // not integration via "IT"
  assert.equal(classifyTestKind("test/UserService.test.java"), "unit-tests");
});

test("program entrypoint routes to infrastructure, not unassigned", () => {
  assert.equal(
    classifyRebuildLayer("src/main/java/com/app/Application.java", code({ hasEntrypoint: true })),
    "infrastructure",
  );
  // Without the entrypoint signal the same file is unassigned.
  assert.equal(
    classifyRebuildLayer("src/main/java/com/app/Application.java", code()),
    "unassigned",
  );
});

test("non-code categories get a deterministic home (never unassigned)", () => {
  assert.equal(classifyRebuildLayer("README.md", { language: "markdown", fileCategory: "docs" }), "infrastructure");
  assert.equal(classifyRebuildLayer("pom.xml", { language: "xml", fileCategory: "config" }), "infrastructure");
  assert.equal(classifyRebuildLayer("scripts/deploy.sh", { language: "shell", fileCategory: "script" }), "infrastructure");
  assert.equal(classifyRebuildLayer("ui/theme.css", { language: "css", fileCategory: "markup" }), "frontend");
  assert.equal(classifyRebuildLayer("schema.sql", { language: "sql", fileCategory: "data" }), "database");
});

test("config keeps directory context when it sits in a meaningful layer dir", () => {
  // A drizzle migration snapshot under db/ stays database, not infrastructure.
  assert.equal(
    classifyRebuildLayer("src/db/migrations/meta/0000_snapshot.json", { language: "json", fileCategory: "config" }),
    "database",
  );
  // A bare project config with no directory signal falls back to infrastructure.
  assert.equal(
    classifyRebuildLayer("tsconfig.json", { language: "json", fileCategory: "config" }),
    "infrastructure",
  );
});

test("genuinely ambiguous code still reaches unassigned for adjudication", () => {
  assert.equal(classifyRebuildLayer("src/lib/helpers.ts", code({ language: "typescript" })), "unassigned");
});
