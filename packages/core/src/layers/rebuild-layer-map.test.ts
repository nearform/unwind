import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRebuildLayer, type LayerEvidence } from "./rebuild-layer-map.js";

const code = (extra: Partial<LayerEvidence> = {}): LayerEvidence => ({
  language: "java",
  fileCategory: "code",
  ...extra,
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
