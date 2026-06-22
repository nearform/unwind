# Layer Analyst Prompt Template

Use this template when dispatching subagents for layer analysis.

## Template

```
Use unwind:uw-analyze-{LAYER} to analyze this codebase layer.

## Context from Architecture Discovery

**Entry Points:**
{ENTRY_POINTS}

**Initial Observations:**
{OBSERVATIONS_FROM_ARCHITECTURE_MD}

## Dependencies Already Analyzed

{SUMMARIES_FROM_COMPLETED_LAYERS}

## Previous Analysis (if refresh)

{PREVIOUS_LAYER_DOC_CONTENT_OR_NONE}

## Instructions

1. Follow the skill's process exactly
2. Write output to: docs/unwind/layers/{LAYER}.md
3. Use the specified output format
4. Include @cross-cutting markers where relevant
5. If refreshing, add "Changes Since Last Review" section
```

## Variable Substitution

| Variable | Source |
|----------|--------|
| `{LAYER}` | Layer name from YAML (e.g., `database`, `domain-model`) |
| `{ENTRY_POINTS}` | `entry_points` array from architecture.md YAML |
| `{OBSERVATIONS_FROM_ARCHITECTURE_MD}` | Layer section prose from architecture.md |
| `{SUMMARIES_FROM_COMPLETED_LAYERS}` | Key findings from dependency layer docs |
| `{PREVIOUS_LAYER_DOC_CONTENT_OR_NONE}` | Existing layer doc if refreshing, or "None" |
