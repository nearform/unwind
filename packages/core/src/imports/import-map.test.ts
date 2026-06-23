import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImportMap, type ImportMapFile } from "./import-map.js";

function file(
  path: string,
  language: string,
  sources: string[],
): ImportMapFile {
  return {
    path,
    language,
    symbols: {
      imports: sources.map((source) => ({ source, specifiers: ["X"], line: 1 })),
    },
  };
}

test("JS/TS resolves relative specifiers and drops bare packages", () => {
  const files = [
    file("src/a.ts", "typescript", ["./b", "react", "./missing"]),
    file("src/b.ts", "typescript", []),
  ];
  const map = buildImportMap(files);
  assert.deepEqual(map["src/a.ts"], ["src/b.ts"]);
  assert.equal(map["src/b.ts"], undefined); // no edges -> absent
});

test("JS/TS rewrites NodeNext .js specifier to the .ts file on disk", () => {
  const files = [
    file("src/a.ts", "typescript", ["./b.js"]),
    file("src/b.ts", "typescript", []),
  ];
  assert.deepEqual(buildImportMap(files)["src/a.ts"], ["src/b.ts"]);
});

test("Java resolves fully-qualified types via package-path convention, drops externals", () => {
  const base = "src/main/java/com/app";
  const files = [
    file(`${base}/api/UserController.java`, "java", [
      "com.app.model.User",
      "com.app.repo.UserRepository",
      "org.springframework.web.bind.annotation.RestController",
      "java.util.List",
    ]),
    file(`${base}/model/User.java`, "java", []),
    file(`${base}/repo/UserRepository.java`, "java", ["com.app.model.User"]),
  ];
  const map = buildImportMap(files);
  assert.deepEqual(map[`${base}/api/UserController.java`], [
    `${base}/model/User.java`,
    `${base}/repo/UserRepository.java`,
  ]);
  assert.deepEqual(map[`${base}/repo/UserRepository.java`], [
    `${base}/model/User.java`,
  ]);
});

test("Java wildcard import resolves to every file in the package", () => {
  const base = "src/main/java/com/app";
  const files = [
    file(`${base}/api/Ctl.java`, "java", ["com.app.model"]), // `import com.app.model.*`
    file(`${base}/model/User.java`, "java", []),
    file(`${base}/model/Post.java`, "java", []),
  ];
  assert.deepEqual(buildImportMap(files)[`${base}/api/Ctl.java`], [
    `${base}/model/Post.java`,
    `${base}/model/User.java`,
  ]);
});

test("Python resolves absolute dotted modules and relative imports", () => {
  const files = [
    file("app/api/routes.py", "python", ["app.models", ".helpers", "requests"]),
    file("app/models.py", "python", []),
    file("app/api/helpers.py", "python", []),
  ];
  const map = buildImportMap(files);
  assert.deepEqual(map["app/api/routes.py"], [
    "app/api/helpers.py",
    "app/models.py",
  ]);
});

test("languages without a resolver (Rust/C#) produce no edges, not a crash", () => {
  const files = [
    file("src/main.rs", "rust", ["crate::lib"]),
    file("src/lib.rs", "rust", []),
  ];
  assert.deepEqual(buildImportMap(files), {});
});
