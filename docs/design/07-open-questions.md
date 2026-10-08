# 07 · Open questions

> **In short:** These decisions are deliberately deferred. Each has a recommendation, so we can move forward by default and revisit when the evidence arrives. Comment on them by number.

## 7.1 Naming and prefixes

- **Question:** Are "Rewind" (understand) and "Play" (rebuild) the plugin names, with Unwind as the umbrella brand? Are the skill prefixes `rw-` and `pl-`?
- **Recommendation:** Yes. Keep the `uw-*` names as deprecated aliases for one release.

## 7.2 Recipe language

- **Question:** Should recipes be TS modules plus templates, fully declarative YAML, or both?
- **Recommendation:** **TS modules plus template files** as the main form, because the engine and the first starter target are TS. Offer declarative `recipe.yaml` for simple template-only recipes. Recipes for non-TS targets emit text and are finished by a target-language formatter.

## 7.3 Kit licensing and sharing

- **Question:** How are kits licensed and shared?
- **Recommendation:** Client kits are private repos owned by the client. Starter kits use the same licence as Unwind (MIT). A future public "Recipe Book" index lists starter and community kits only.

## 7.4 Spec and external standards

- **Question:** Should the Spec define its own formats, or embed existing standards?
- **Recommendation:** **Embed.** Use JSON Schema for shapes and OpenAPI-style operations for endpoints, wrapped in Spec nodes that carry id, priority and provenance. This gives import/export to existing tooling for free.

## 7.5 Store timing

- **Question:** When does the `node:sqlite` index arrive?
- **Recommendation:** Only when the App (phase 7) needs multi-repo queries. Until then, files are authoritative.

## 7.6 Interview tool integration

- **Question:** Do we push briefs to the external AI-interview tool via its API, or hand off files?
- **Recommendation:** Start with **file hand-off** (briefs out, responses in), because it needs no credentials and is easy to audit. Add an API adapter once the tool's interface is stable. The brief and response formats ([05b](05b-context-gaps.md)) are the contract either way.

## 7.7 Parity environments

- **Question:** Who provides a runnable legacy sandbox?
- **Recommendation:** Support all three options: a client-provided environment, a Docker recipe produced from the infrastructure layer, and **recorded traffic** as the zero-setup fallback. Never production.

## 7.8 Scenario format

- **Question:** Should scenarios use a custom YAML schema, or reuse an existing one (e.g. OpenAPI Arazzo workflows for API flows)?
- **Recommendation:** **Custom and minimal** (given / when / then / covers), with import/export adapters for Arazzo and HAR. Arazzo is API-only, and scenarios must also cover UI, desktop, CLI and messaging.

## 7.9 Behavioural verification depth

- **Question:** Should `run-tests` (`graph/rebuild-state-schema.ts:31`) be renamed `behavioural`, and how should it combine with structural completeness?
- **Recommendation:** Keep `run-tests` as the stored enum value for compatibility and label it "behavioural" in the UI. Loop termination requires **both** structural completeness % and `[MUST]` parity % to reach their targets.

## 7.10 Id migration

- **Question:** How do we introduce class-qualified, overload-safe ids without breaking existing anchor-id docs?
- **Recommendation:** Emit the new ids alongside the old ones as aliases. Coverage matches on either. A one-time `rw-complete` pass can rewrite anchors.

## 7.11 Optional external tools

- **Question:** Should the plugin bundle SCIP indexers, pyright or Playwright, or discover them?
- **Recommendation:** **Discover, never bundle.** Each tool is optional, its tier or driver is reported when it is missing, and a helper suggests the install command.

## 7.12 Generated code ownership

- **Question:** After hand-off, who owns the generated files, and can a team "eject" from regeneration?
- **Recommendation:** Yes. `unwind play eject <slice>` strips the generator markers and keeps the `@unwind-id` provenance comments, so verification still works. From then on the slice is hand-maintained.
