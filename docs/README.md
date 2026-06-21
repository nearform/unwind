# Unwind Documentation

## Overview

This directory contains documentation for the Unwind reverse engineering skills library.

Unwind is a **hybrid** tool: a deterministic scanner (`@unwind/core`, tree-sitter)
builds the verifiable ground truth (`docs/unwind/.cache/scan-manifest.json`) and
LLM specialists add the semantic rebuild documentation. Completeness is verified by
a deterministic `manifest − docs` diff rather than asserted.

## Architecture (engine)

- `packages/core` — `@unwind/core`: file scan, language/category detection,
  rebuild-layer classifier, tree-sitter structural extraction (TS/JS, Python, Rust,
  Java, C#), import map, manifest builder, coverage diff.
- `skills/scripts` — bundled entry points the skills invoke:
  `scan.mjs` (→ scan-manifest.json), `seed-layers.mjs` (→ seeds/), and
  `verify-coverage.mjs` (→ coverage/ + gaps.md). `_resolve-plugin-root.sh`
  resolves the plugin root and lazily builds the core on first use.

The engine is an enhancement: if Node/pnpm/core is unavailable, the skills fall
back to a pure-LLM flow.

## The flow

```
start → scan.mjs → architecture.md
unwinding-codebase → seed-layers.mjs → specialists (seeded) → verify-coverage.mjs → completing → loop to 100%
synthesizing-findings → REBUILD-PLAN.md
```

## Contents

- [Main README](../README.md) - Project overview and installation
- Skills documentation - See individual skill directories under `/skills`

## Guides

*Coming soon:*
- Getting Started Guide
- Skill Development Guide
- Best Practices for Reverse Engineering

## Contributing

See the main README for contribution guidelines.
