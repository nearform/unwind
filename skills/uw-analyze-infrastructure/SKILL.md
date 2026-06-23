---
name: uw-analyze-infrastructure
description: Use when analyzing build/dependency config, runtime configuration, program entrypoints, and deployment/ops assets the rebuild must reproduce
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(mkdir:*, ls:*)
  - Write(docs/unwind/**)
  - Edit(docs/unwind/**)
---

# Analyzing Infrastructure

**Output:** `docs/unwind/layers/infrastructure/` (folder with index.md + section files)

**Principles:** See `analysis-principles.md` - completeness, machine-readable, link to source, no commentary, incremental writes, **anchor-id headings**.

The scanner assigns to `infrastructure` the files that don't belong to a code
layer but the rebuild still depends on: build/dependency manifests, runtime
configuration, program entrypoints/bootstrap, deploy + ops assets, project
scripts, and top-level docs. Document **what the rebuild must reproduce** (the
contract — dependencies, env vars, ports, deploy topology), not how to operate
the current deployment.

## Output Structure

```
docs/unwind/layers/infrastructure/
├── index.md           # Overview + links to sections
├── build.md           # Build system, package manifests, dependencies, scripts
├── configuration.md   # Runtime config: env vars, properties, feature flags
├── entrypoints.md     # Program bootstrap / main / app wiring
└── deployment.md      # Containers, IaC (terraform/k8s/helm), CI/CD, ops
```

Omit a section file if the codebase has nothing for it (note the omission in
`index.md`) — but every seeded candidate must still be documented somewhere.

## Process (Incremental Writes)

**Step 1: Setup**
```bash
mkdir -p docs/unwind/layers/infrastructure/
```
Write an initial `index.md` skeleton listing the sections as _pending_.

**Step 2: build.md** — package/dependency manifests (`package.json`, `pom.xml`,
`build.gradle`, `Cargo.toml`, `*.csproj`, `requirements.txt`, …), the build tool,
and project scripts. Capture the dependency list (name + version) — it's a
rebuild contract. Write immediately, update `index.md`.

**Step 3: configuration.md** — runtime configuration: env vars, `*.properties`,
`*.yaml`/`*.yml` config, `.env` templates, feature flags. Record each setting,
its default, and what it controls. Write immediately, update `index.md`.

**Step 4: entrypoints.md** — the program bootstrap: `main`/`Main`, framework
bootstrap (`@SpringBootApplication`, server `listen`, CLI entry), startup wiring,
and the port(s) the app binds. Write immediately, update `index.md`.

**Step 5: deployment.md** — containers (`Dockerfile`, compose), IaC
(terraform/k8s/helm/CDK), CI/CD pipelines, and ops scripts. Capture the deploy
topology and runtime requirements. Write immediately, update `index.md`.

**Step 6: Finalize index.md** with final counts and a one-paragraph summary.

## Output Format

Use anchor-id headings so coverage is verified mechanically — paste the `id`
from the seed item verbatim:

```markdown
# Infrastructure

## Build & Dependencies

### package.json [MUST] <!-- id: file:package.json:package.json -->

[package.json](https://github.com/owner/repo/blob/main/package.json)

| Dependency | Version | Purpose |
|------------|---------|---------|
| express | ^4.19 | HTTP server |
| drizzle-orm | ^0.30 | Data access |

**Scripts:** `build` → `tsc`, `dev` → `vite`, `test` → `vitest`.

## Configuration

### application.properties [MUST] <!-- id: file:src/main/resources/application.properties:application.properties -->

| Key | Default | Controls |
|-----|---------|----------|
| server.port | 8080 | HTTP listen port |
| spring.data.mongodb.uri | mongodb://localhost/app | Datastore connection |

## Entrypoints

### Application [MUST] <!-- id: class:src/main/java/.../Application.java:Application -->

[Application.java](https://github.com/owner/repo/blob/main/src/main/java/.../Application.java)

Spring Boot bootstrap (`@SpringBootApplication`); `main()` starts the embedded
server on port 8080.

## Deployment

### Dockerfile [SHOULD] <!-- id: file:Dockerfile:Dockerfile -->

Multi-stage build → distroless runtime; exposes 8080.

## Unknowns

- [List anything unclear]
```

## Mandatory Tagging

**Every documented item must carry a [MUST], [SHOULD], or [DON'T] tag in its
heading.** Default categorizations for infrastructure:

- **[MUST]**: dependency manifests, runtime configuration the app reads,
  program entrypoints, deploy topology + runtime requirements (ports, datastore).
- **[SHOULD]**: dev/build scripts, linter/formatter config, CI workflows.
- **[DON'T]**: editor settings, lockfiles (regenerated), generated artifacts.

See `analysis-principles.md` section 9 for full tagging rules and section 16/17
for the anchor-id heading convention.

## Refresh Mode

If `docs/unwind/layers/infrastructure/` exists, compare current state and add a
`## Changes Since Last Review` section to `index.md` rather than overwriting.
