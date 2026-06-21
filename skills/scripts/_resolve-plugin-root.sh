#!/usr/bin/env bash
# _resolve-plugin-root.sh
#
# Sourced by Unwind skills before invoking node scripts. Resolves UNWIND_PLUGIN_ROOT
# across install layouts (env override, symlinked plugin caches, local clone) and
# lazily builds @unwind/core on first use. Exits non-zero if the deterministic
# core is unavailable so the caller can fall back to legacy pure-LLM behavior.
#
# Usage:
#   source "$(dirname "$0")/_resolve-plugin-root.sh"
#   ensure_unwind_core   # sets UNWIND_PLUGIN_ROOT, builds if needed

resolve_unwind_plugin_root() {
  # 1. Explicit override (Claude sets CLAUDE_PLUGIN_ROOT for installed plugins).
  if [ -n "${UNWIND_PLUGIN_ROOT:-}" ] && [ -f "${UNWIND_PLUGIN_ROOT}/packages/core/package.json" ]; then
    printf '%s' "${UNWIND_PLUGIN_ROOT}"; return 0
  fi
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/packages/core/package.json" ]; then
    printf '%s' "${CLAUDE_PLUGIN_ROOT}"; return 0
  fi

  # 2. Relative to this script: skills/scripts/ -> plugin root is two up.
  local src="${BASH_SOURCE[0]}"
  # Resolve symlinks (plugin caches symlink the script).
  while [ -h "$src" ]; do
    local dir
    dir="$(cd -P "$(dirname "$src")" >/dev/null 2>&1 && pwd)"
    src="$(readlink "$src")"
    [[ "$src" != /* ]] && src="$dir/$src"
  done
  local script_dir
  script_dir="$(cd -P "$(dirname "$src")" >/dev/null 2>&1 && pwd)"
  local candidate
  candidate="$(cd "$script_dir/../.." >/dev/null 2>&1 && pwd)"
  if [ -f "$candidate/packages/core/package.json" ]; then
    printf '%s' "$candidate"; return 0
  fi

  return 1
}

ensure_unwind_core() {
  UNWIND_PLUGIN_ROOT="$(resolve_unwind_plugin_root)" || {
    echo "unwind: could not locate plugin root (packages/core not found)." >&2
    return 2
  }
  export UNWIND_PLUGIN_ROOT

  if [ -f "$UNWIND_PLUGIN_ROOT/packages/core/dist/index.js" ]; then
    return 0
  fi

  echo "unwind: building @unwind/core (first run)..." >&2
  if command -v pnpm >/dev/null 2>&1; then
    ( cd "$UNWIND_PLUGIN_ROOT" && pnpm install >&2 && pnpm build >&2 )
  elif command -v npm >/dev/null 2>&1; then
    ( cd "$UNWIND_PLUGIN_ROOT" && npm install >&2 && npm run build >&2 )
  else
    echo "unwind: neither pnpm nor npm found; cannot build core." >&2
    return 2
  fi

  if [ ! -f "$UNWIND_PLUGIN_ROOT/packages/core/dist/index.js" ]; then
    echo "unwind: core build did not produce dist/index.js." >&2
    return 2
  fi
}
