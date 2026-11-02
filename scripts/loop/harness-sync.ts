#!/usr/bin/env node
// harness-sync.ts — Automated Multi-Agent Harness Synchronization & Propagation Engine.
// Supports both pulling updates into downstream projects and propagating from create-agent-harness.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// When in template/scripts/loop/, REPO_ROOT is 3 levels up; when in scripts/loop/, 2 levels up.
const REPO_ROOT = existsSync(resolve(HERE, "../../bin/create.ts"))
  ? resolve(HERE, "../..")
  : resolve(HERE, "../../..");

export interface SyncOptions {
  cwd?: string;
  sourcePath?: string;
  targetProjects?: string[];
  createPr?: boolean;
  autoMerge?: boolean;
  skipTests?: boolean;
  forcePropagate?: boolean;
}

export interface SyncReport {
  project: string;
  previousVersion: string;
  newVersion: string;
  success: boolean;
  prUrl?: string;
  error?: string;
}

function run(cmd: string, args: string[], cwd = process.cwd()): { ok: boolean; out: string; code: number } {
  try {
    const res = spawnSync(cmd, args, { cwd, encoding: "utf8", windowsHide: true, env: { ...process.env, ALLOW_PUSH: "1" } });
    const out = ((res.stdout || "") + (res.stderr || "")).trim();
    return { ok: res.status === 0, out, code: res.status ?? 1 };
  } catch (err: any) {
    return { ok: false, out: err.message || String(err), code: 1 };
  }
}

function readJsonFile(path: string): Record<string, any> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Detects the create-agent-harness source repository location.
 */
export function findHarnessSource(startDir = process.cwd()): string | null {
  const sourceJson = readJsonFile(join(startDir, ".harness", "source.json"));
  if (sourceJson?.sourcePath && existsSync(join(sourceJson.sourcePath, "bin", "create.ts"))) {
    return sourceJson.sourcePath;
  }

  // Check well-known local paths
  const candidates = [
    resolve(startDir, "../create-agent-harness"),
    resolve(startDir, "../../works/create-agent-harness"),
    "/Users/nm/works/create-agent-harness",
    resolve(process.env.HOME || "", "works/create-agent-harness"),
  ];

  for (const cand of candidates) {
    if (existsSync(join(cand, "bin", "create.ts"))) {
      return cand;
    }
  }

  return null;
}

/**
 * Discovers downstream projects from configuration or workspace directories.
 */
export function discoverDownstreamProjects(harnessRoot: string): string[] {
  const listFile = join(harnessRoot, ".harness", "downstream.json");
  const configured = readJsonFile(listFile);
  if (Array.isArray(configured?.projects)) {
    return configured.projects.filter((p: string) => existsSync(join(p, ".harness-version.json")));
  }

  // Auto-discover sibling directories under parent directory
  const parent = resolve(harnessRoot, "..");
  const candidates: string[] = [];
  if (existsSync(parent)) {
    try {
      const entries = readdirSync(parent, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory() && ent.name !== "create-agent-harness") {
          const dirPath = join(parent, ent.name);
          if (existsSync(join(dirPath, ".harness-version.json"))) {
            candidates.push(dirPath);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return [...new Set(candidates)].filter((p) => existsSync(join(p, ".harness-version.json")));
}

/**
 * Selectively stages harness-managed files only, preserving any user modifications
 * in application code or user documentation under docs/.
 */
export function stageHarnessFiles(targetDir: string): boolean {
  const isGit = existsSync(join(targetDir, ".git")) || (run("git", ["rev-parse", "--show-toplevel"], targetDir).out.trim() === targetDir);
  if (!isGit) return false;

  const harnessPatterns = [
    ".harness-version.json",
    ".harness",
    ".agents",
    ".claude",
    ".codex",
    "AGENTS.md",
    "CLAUDE.md",
    "scripts/loop",
    "scripts/knowledge",
    "scripts/release",
    "scripts/metrics",
    "scripts/visual-inspector",
    "hooks",
    "docs/HARNESS.md",
    "docs/AUTONOMOUS_LOOP.md",
    "docs/AUTONOMY.md",
    "docs/PLAN_DOCS.md",
    "docs/behavior-specs.md",
    "docs/jev-decision-layer.md",
    "docs/image-prompts.md",
    "docs/image-prompts.json",
    "docs/harness-conventions.md",
    "docs/harness-gates.md",
    "docs/harness-loop.md",
    "docs/harness-roles.md",
    "docs/rules-agent-roles.md",
    "docs/rules-loop-safety.md",
    ".mcp.json",
    "Dockerfile.sandbox",
    ".dockerignore",
    "dagger.json",
  ];
  run("git", ["add", "-u", "Dockerfile"], targetDir);
  for (const pat of harnessPatterns) {
    if (existsSync(join(targetDir, pat))) {
      run("git", ["add", pat], targetDir);
    }
  }
  const staged = run("git", ["diff", "--cached", "--name-only"], targetDir).out.trim();
  return Boolean(staged);
}

/**
 * Performs an automated non-destructive harness update on a single target project.
 * By default, updates are applied locally on-demand when an agent starts in that project
 * without creating automatic GitHub PRs or squash merges.
 */
export async function updateProject(targetDir: string, options: SyncOptions = {}): Promise<SyncReport> {
  const report: SyncReport = {
    project: targetDir,
    previousVersion: "unknown",
    newVersion: "unknown",
    success: false,
  };

  const stampBefore = readJsonFile(join(targetDir, ".harness-version.json"));
  report.previousVersion = stampBefore?.version || "unknown";

  const harnessSource = options.sourcePath || findHarnessSource(targetDir);
  if (!harnessSource) {
    report.error = "create-agent-harness 소스 경로를 찾을 수 없습니다.";
    return report;
  }

  console.log(`\n🔄 [Harness Sync] 대상 프로젝트: ${targetDir}`);
  console.log(`   하네스 소스: ${harnessSource} (현재 버전: v${report.previousVersion})`);

  // 1. Pull latest create-agent-harness source if it is a git repo
  const pullRes = run("git", ["pull", "--ff-only"], harnessSource);
  if (pullRes.ok) {
    console.log(`   ✓ create-agent-harness 최신 커밋 풀 완료`);
  }

  // 2. Execute non-destructive create-agent-harness --update
  const createScript = join(harnessSource, "bin", "create.ts");
  const updateRes = run(process.execPath, [createScript, targetDir, "--update", "--no-install", "--no-github"], targetDir);
  if (!updateRes.ok) {
    report.error = `하네스 템플릿 업데이트 실패: ${updateRes.out}`;
    return report;
  }
  console.log(`   ✓ 템플릿 갱신 및 파일 병합 완료 (로컬 온디맨드 적용)`);

  const stampAfter = readJsonFile(join(targetDir, ".harness-version.json"));
  report.newVersion = stampAfter?.version || report.previousVersion;

  report.success = true;
  return report;
}

/**
 * Legacy git sync helper. Disabled by default so session-start and harness updates
 * never trigger unsolicited GitHub main merge activity across projects.
 */
export function syncProjectGit(targetDir: string, options: { harnessVersion?: string; createPr?: boolean } = {}): { success: boolean; prUrl?: string; error?: string } {
  if (!options.createPr && process.env.HARNESS_ALLOW_GIT_SYNC_PR !== "1") {
    return { success: true };
  }
  const isGit = existsSync(join(targetDir, ".git")) || (run("git", ["rev-parse", "--show-toplevel"], targetDir).out.trim() === targetDir);
  if (!isGit) return { success: true };

  return { success: true };
}

/**
 * Fleet-wide propagation is disabled by default to prevent continuous GitHub main merge noise.
 * Instead, each project updates lazily when an agent is launched in that project (hooks/session-start.ts).
 */
export async function propagateAll(options: SyncOptions = {}): Promise<SyncReport[]> {
  if (!options.forcePropagate) {
    console.log(`\nℹ️ [Harness Sync] 전체 프로젝트 일괄 전파(propagate) 및 자동 GitHub PR 머지가 비활성화되었습니다.`);
    console.log(`   create-agent-harness 업데이트는 각 프로젝트에서 에이전트를 실행할 때(hooks/session-start.ts 또는 'ca update')`);
    console.log(`   해당 프로젝트에 한해 비파괴(--update) 방식으로 자동 적용됩니다.\n`);
    return [];
  }

  const harnessRoot = options.sourcePath || REPO_ROOT;
  const targets = options.targetProjects || discoverDownstreamProjects(harnessRoot);
  const reports: SyncReport[] = [];

  for (const target of targets) {
    try {
      const rep = await updateProject(target, { ...options, createPr: false, sourcePath: harnessRoot });
      reports.push(rep);
    } catch (err: any) {
      reports.push({
        project: target,
        previousVersion: "unknown",
        newVersion: "unknown",
        success: false,
        error: err.message || String(err),
      });
    }
  }

  return reports;
}

export function runHarnessSyncCli(): number {
  const args = process.argv.slice(2);
  const mode = args[0] || "sync";

  if (mode === "sync-git") {
    // No-op: automatic background git PR sync on session start is disabled.
    return 0;
  }

  if (mode === "update" || mode === "single") {
    const targetDir = args[1] && !args[1].startsWith("-") ? args[1] : process.cwd();
    updateProject(targetDir, { createPr: false })
      .then((rep) => process.exit(rep.success ? 0 : 1))
      .catch((err) => {
        console.error("Update failed:", err);
        process.exit(1);
      });
    return 0;
  }

  if (mode === "propagate" || mode === "distribute") {
    propagateAll({ forcePropagate: args.includes("--force-propagate"), createPr: false })
      .then((reports) => {
        const allOk = reports.every((r) => r.success);
        process.exit(allOk ? 0 : 1);
      })
      .catch((err) => {
        console.error("Propagate failed:", err);
        process.exit(1);
      });
    return 0;
  }

  if (mode === "check" || mode === "status") {
    const src = findHarnessSource();
    console.log(`Harness Source: ${src || "Not Found"}`);
    if (src) {
      const targets = discoverDownstreamProjects(src);
      console.log(`Downstream Projects (${targets.length}):\n${targets.map((t) => `  - ${t}`).join("\n")}`);
    }
    return 0;
  }

  // Default: sync current project locally without PR
  updateProject(process.cwd(), { createPr: false })
    .then((rep) => {
      process.exit(rep.success ? 0 : 1);
    })
    .catch((err) => {
      console.error("Update failed:", err);
      process.exit(1);
    });

  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runHarnessSyncCli();
}
