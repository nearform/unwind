import { test } from "node:test";
import assert from "node:assert/strict";
import { TreeSitterPlugin } from "../structure/tree-sitter-plugin.js";

// One initialized plugin (loads WASM grammars) shared across the AST endpoint tests.
const pluginReady = (async () => {
  const p = new TreeSitterPlugin();
  await p.init();
  return p;
})();

function endpoints(plugin: TreeSitterPlugin, path: string, src: string): string[] {
  const syms = plugin.analyze(path, src);
  assert.ok(syms, `expected symbols for ${path}`);
  return syms.endpoints.map((e) => `${e.method} ${e.path}`).sort();
}

test("Java Spring annotations are detected from the AST", async () => {
  const plugin = await pluginReady;
  const src = `package com.app.api;
@RestController
@RequestMapping("/api")
public class TutorialController {
  @GetMapping("/tutorials")
  public java.util.List<Tutorial> all() { return null; }
  @PostMapping
  public Tutorial create(@RequestBody Tutorial t) { return t; }
  @DeleteMapping("/tutorials/{id}")
  public void remove(@PathVariable String id) {}
}`;
  // Class-level @RequestMapping("/api") is a base path, not a standalone endpoint.
  const eps = endpoints(plugin, "com/app/api/TutorialController.java", src);
  assert.deepEqual(eps, ["DELETE /tutorials/{id}", "GET /tutorials", "POST "]);
});

test("a Spring mapping written inside a string is NOT a false endpoint", async () => {
  const plugin = await pluginReady;
  // The regex detector would match this string literal; the AST detector must not.
  const src = `package com.app;
public class Doc {
  String usage = "use @GetMapping(\\"/fake\\") on your method";
}`;
  assert.deepEqual(endpoints(plugin, "com/app/Doc.java", src), []);
});

test("TS NestJS verb decorators are endpoints; @Controller is not", async () => {
  const plugin = await pluginReady;
  const src = `@Controller('cats')
export class CatsController {
  @Get(':id')
  findOne() {}
  @Post()
  create() {}
}`;
  assert.deepEqual(endpoints(plugin, "cats.controller.ts", src), ["GET :id", "POST "]);
});

test("Python FastAPI/Flask route decorators are detected from the AST", async () => {
  const plugin = await pluginReady;
  const src = `@app.get("/items")
def list_items():
    return []

@router.post("/items")
def create_item():
    return {}
`;
  assert.deepEqual(endpoints(plugin, "api/items.py", src), ["GET /items", "POST /items"]);
});
