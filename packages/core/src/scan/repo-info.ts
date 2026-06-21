/**
 * Repository info for source linking. Parses `git remote`/`git branch` into the
 * `link_format` Unwind's docs use for every source reference.
 */

import { spawnSync } from "node:child_process";
import type { RepositoryInfo } from "../manifest/manifest-schema.js";

function git(projectRoot: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd: projectRoot, encoding: "utf-8" });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout.trim() || null;
}

/** Parse an SSH or HTTPS remote into a normalized https base URL + host type. */
function parseRemote(remote: string): { type: RepositoryInfo["type"]; url: string } | null {
  let host: string | undefined;
  let path: string | undefined;

  const ssh = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  const https = remote.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) {
    host = ssh[1];
    path = ssh[2];
  } else if (https) {
    host = https[1];
    path = https[2];
  }
  if (!host || !path) return null;

  let type: RepositoryInfo["type"] = "local";
  if (host.includes("github")) type = "github";
  else if (host.includes("gitlab")) type = "gitlab";
  else if (host.includes("bitbucket")) type = "bitbucket";

  return { type, url: `https://${host}/${path}` };
}

export function getRepositoryInfo(projectRoot: string): RepositoryInfo {
  const remote = git(projectRoot, ["remote", "get-url", "origin"]);
  const branch = git(projectRoot, ["branch", "--show-current"]) ?? null;

  if (remote) {
    const parsed = parseRemote(remote);
    if (parsed) {
      const br = branch ?? "main";
      // GitHub/GitLab/Bitbucket all share the /blob/<branch>/<path>#Lx-Ly shape.
      const linkFormat = `${parsed.url}/blob/${br}/{path}#L{start}-L{end}`;
      return { type: parsed.type, url: parsed.url, branch: br, linkFormat };
    }
  }

  // Local fallback: path:start-end.
  return { type: "local", url: null, branch, linkFormat: "{path}:{start}-{end}" };
}

export function getCommitHash(projectRoot: string): string | null {
  return git(projectRoot, ["rev-parse", "HEAD"]);
}
