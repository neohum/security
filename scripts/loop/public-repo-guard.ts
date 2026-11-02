// public-repo-guard.ts — isolates harness infrastructure when repository is public.
//
// When a repository is published publicly on GitHub, all agent-harness files
// (agent contracts, autonomous loop scripts, internal plans, evidence, and configs)
// must remain local-only and never be committed or pushed upstream.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, normalize } from "node:path";

export const HARNESS_EXCLUSION_HEADER = "# --- Harness Isolation for Public Repositories ---";

export const HARNESS_EXCLUSION_PATTERNS = [
  "AGENTS.md",
  "CLAUDE.md",
  "rules.md",
  "lat.md",
  "current.md",
  ".harness/",
  ".harness-*",
  ".claude/",
  ".codex/",
  ".agents/",
  "current_tasks/",
  "plans/",
  "evidence/",
  "evals/",
  "scripts/loop/",
  "scripts/ops/",
  "scripts/dev/",
  "scripts/release/",
  "scripts/knowledge/",
  "scripts/planner.ts",
  "scripts/route.ts",
  "scripts/test-fast.ts",
  "scripts/run-and-report.ts",
  "scripts/agent-session.ts",
  "scripts/convert-legal.ts",
  "scripts/env-sync.ts",
  "scripts/install-cli-hooks.ts",
  "scripts/harness-sync.ts",
  "docs/harness-*",
  "docs/AUTONOMOUS_LOOP.md",
  "docs/PLAN_DOCS.md",
  "docs/AUTONOMY.md",
  "docs/rules-*",
  "docs/behavior-specs.md",
  "docs/HARNESS.md",
  "docs/adr/",
  "Dockerfile.sandbox",
];

const HARNESS_PREFIXES = [
  ".harness/",
  ".claude/",
  ".codex/",
  ".agents/",
  "current_tasks/",
  "plans/",
  "evidence/",
  "evals/",
  "scripts/loop/",
  "scripts/ops/",
  "scripts/dev/",
  "scripts/release/",
  "scripts/knowledge/",
  "docs/adr/",
];

const HARNESS_EXACT_FILES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "rules.md",
  "lat.md",
  "current.md",
  "Dockerfile.sandbox",
  "scripts/planner.ts",
  "scripts/route.ts",
  "scripts/test-fast.ts",
  "scripts/run-and-report.ts",
  "scripts/agent-session.ts",
  "scripts/convert-legal.ts",
  "scripts/env-sync.ts",
  "scripts/install-cli-hooks.ts",
  "scripts/harness-sync.ts",
  "docs/AUTONOMOUS_LOOP.md",
  "docs/PLAN_DOCS.md",
  "docs/AUTONOMY.md",
  "docs/behavior-specs.md",
  "docs/HARNESS.md",
]);

export function isHarnessPath(relPath: string): boolean {
  const norm = normalize(relPath).replace(/\\/g, "/").replace(/^\/+/, "");
  if (HARNESS_EXACT_FILES.has(norm)) return true;
  if (norm.startsWith(".harness-") || norm.startsWith(".harness/")) return true;
  if (/^docs\/harness-/.test(norm) || /^docs\/rules-/.test(norm)) return true;
  for (const prefix of HARNESS_PREFIXES) {
    if (norm === prefix.slice(0, -1) || norm.startsWith(prefix)) return true;
  }
  return false;
}

export interface RepoVisibilityResult {
  isGit: boolean;
  hasOrigin: boolean;
  isPublic: boolean;
  repoName?: string;
  source: "gh-cli" | "git-config" | "none";
}

export function checkRepoVisibility(cwd = process.cwd()): RepoVisibilityResult {
  try {
    const isGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd, encoding: "utf8", windowsHide: true,
    }).status === 0;

    if (!isGit) {
      return { isGit: false, hasOrigin: false, isPublic: false, source: "none" };
    }

    // Explicit config check first: git config harness.visibility public|private
    const cfg = spawnSync("git", ["config", "--get", "harness.visibility"], {
      cwd, encoding: "utf8", windowsHide: true,
    });
    if (cfg.status === 0 && cfg.stdout.trim().toLowerCase() === "public") {
      return { isGit: true, hasOrigin: false, isPublic: true, source: "git-config" };
    }

    const originRes = spawnSync("git", ["remote", "get-url", "origin"], {
      cwd, encoding: "utf8", windowsHide: true,
    });
    if (originRes.status !== 0 || !originRes.stdout.trim()) {
      return { isGit: true, hasOrigin: false, isPublic: false, source: "none" };
    }

    // Check visibility via gh CLI
    const ghView = spawnSync("gh", ["repo", "view", "--json", "isPrivate,nameWithOwner"], {
      cwd, encoding: "utf8", windowsHide: true,
    });
    if (ghView.status === 0 && ghView.stdout.trim()) {
      try {
        const data = JSON.parse(ghView.stdout.trim());
        const isPublic = data.isPrivate === false;
        return {
          isGit: true,
          hasOrigin: true,
          isPublic,
          repoName: data.nameWithOwner,
          source: "gh-cli",
        };
      } catch {
        // Fall through
      }
    }

    return { isGit: true, hasOrigin: true, isPublic: false, source: "none" };
  } catch {
    return { isGit: false, hasOrigin: false, isPublic: false, source: "none" };
  }
}

export function getTrackedHarnessFiles(cwd = process.cwd()): string[] {
  try {
    const out = execFileSync("git", ["ls-files"], {
      cwd, encoding: "utf8", windowsHide: true,
    });
    return out
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && isHarnessPath(f));
  } catch {
    return [];
  }
}

export function getStagedHarnessFiles(cwd = process.cwd()): string[] {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=d"], {
      cwd, encoding: "utf8", windowsHide: true,
    });
    return out
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && isHarnessPath(f));
  } catch {
    return [];
  }
}

export function ensureHarnessGitignore(cwd = process.cwd()): { modified: boolean; path: string } {
  const gitignorePath = resolve(cwd, ".gitignore");
  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf8");
  }

  // Disable any negative un-ignore patterns for .agents/ so all agent files are completely excluded
  let updatedContent = content.replace(/^(!\/?\.agents\/.*)$/gm, "# $1 (disabled for public repository)");

  if (updatedContent.includes(HARNESS_EXCLUSION_HEADER) && updatedContent.includes("AGENTS.md")) {
    if (updatedContent !== content) {
      writeFileSync(gitignorePath, updatedContent, "utf8");
      return { modified: true, path: gitignorePath };
    }
    return { modified: false, path: gitignorePath };
  }

  const block = [
    "",
    HARNESS_EXCLUSION_HEADER,
    "# When a repository is public, all agent-harness infrastructure, internal contracts,",
    "# and autonomous loop artifacts are excluded from Git to keep the public repo clean.",
    ...HARNESS_EXCLUSION_PATTERNS,
    "",
  ].join("\n");

  writeFileSync(gitignorePath, updatedContent ? `${updatedContent.trimEnd()}\n${block}` : block.trimStart(), "utf8");
  return { modified: true, path: gitignorePath };
}

export function untrackHarnessFiles(cwd = process.cwd()): string[] {
  const tracked = getTrackedHarnessFiles(cwd);
  if (tracked.length === 0) return [];

  // Remove tracked harness files from git index (keep files on disk)
  try {
    execFileSync("git", ["rm", "--cached", "-r", "--quiet", "--ignore-unmatch", ...tracked], {
      cwd, windowsHide: true,
    });
  } catch {
    // Best-effort
  }
  return tracked;
}

export interface IsolationResult {
  gitignoreUpdated: boolean;
  untrackedFiles: string[];
  isPublic: boolean;
}

export function applyPublicRepoIsolation(cwd = process.cwd()): IsolationResult {
  const vis = checkRepoVisibility(cwd);
  const { modified } = ensureHarnessGitignore(cwd);
  const untracked = untrackHarnessFiles(cwd);

  return {
    gitignoreUpdated: modified,
    untrackedFiles: untracked,
    isPublic: vis.isPublic,
  };
}

export function scanHarnessLeaks(cwd = process.cwd()): { hasLeaks: boolean; leaks: string[] } {
  const vis = checkRepoVisibility(cwd);
  if (!vis.isPublic) {
    return { hasLeaks: false, leaks: [] };
  }

  const tracked = getTrackedHarnessFiles(cwd);
  const staged = getStagedHarnessFiles(cwd);
  const leakSet = new Set([...tracked, ...staged]);
  const leaks = Array.from(leakSet);

  return {
    hasLeaks: leaks.length > 0,
    leaks,
  };
}

// CLI entrypoint
if (process.argv[1]?.endsWith("public-repo-guard.ts")) {
  const isCheck = process.argv.includes("--check");
  const isApply = process.argv.includes("--apply") || process.argv.includes("--isolate");
  const cwd = process.cwd();

  const vis = checkRepoVisibility(cwd);
  console.log(`\n🛡️ [public-repo-guard] Repository Visibility Check`);
  console.log(`  Git repo : ${vis.isGit ? "Yes" : "No"}`);
  console.log(`  Origin   : ${vis.hasOrigin ? (vis.repoName || "Configured") : "None"}`);
  console.log(`  Public   : ${vis.isPublic ? "YES (Public Repository)" : "No (Private or Local)"}`);

  if (isApply || vis.isPublic) {
    console.log(`\nApplying public repository isolation...`);
    const res = applyPublicRepoIsolation(cwd);
    if (res.gitignoreUpdated) {
      console.log(`  ✓ Updated .gitignore with harness exclusion patterns`);
    }
    if (res.untrackedFiles.length > 0) {
      console.log(`  ✓ Untracked ${res.untrackedFiles.length} harness file(s) from Git index`);
    }
    console.log(`✓ Public repository harness isolation complete.`);
  }

  if (isCheck) {
    const leakCheck = scanHarnessLeaks(cwd);
    if (leakCheck.hasLeaks) {
      console.error(`\n❌ LEAK DETECTED: The following harness files are tracked/staged in a PUBLIC repository:`);
      for (const f of leakCheck.leaks) {
        console.error(`  - ${f}`);
      }
      process.exit(1);
    } else {
      console.log(`\n✓ No harness leaks detected in public repository.`);
    }
  }
}
