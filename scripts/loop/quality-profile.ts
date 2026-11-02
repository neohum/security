// quality-profile.ts — resolve required verification lanes from changed paths.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(process.cwd());
const PROFILE = resolve(ROOT, ".harness-quality.json");

export function readProfile(path = PROFILE) {
  if (!existsSync(path)) return { schema: 1, required: [], conditional: [], commands: {} };
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.schema !== 1 || !Array.isArray(value.required) || !Array.isArray(value.conditional) || typeof value.commands !== "object") {
    throw new Error("invalid .harness-quality.json schema");
  }
  return value;
}

/** The `.harness-quality.json` contract: always-required checks plus path-conditional ones. */
export interface QualityProfile {
  schema: number;
  required: string[];
  conditional: Array<{ paths?: string[]; require?: string[] }>;
  commands: Record<string, string>;
}

function patternRegex(pattern: string): RegExp {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "__GLOBSTAR_DIR__")
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__GLOBSTAR_DIR__/g, "(?:.*/)?")
    .replace(/__GLOBSTAR__/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesPath(path: string, pattern: string): boolean {
  return patternRegex(pattern).test(String(path).replace(/\\/g, "/"));
}

export function changedPaths(cwd = ROOT) {
  const unstaged = spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd, encoding: "utf8", windowsHide: true });
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd, encoding: "utf8", windowsHide: true });
  if (unstaged.status !== 0 || untracked.status !== 0) return [];
  return [...new Set(`${unstaged.stdout}\n${untracked.stdout}`.split(/\r?\n/).map((x) => x.trim()).filter(Boolean))];
}

export function requiredChecks(profile: QualityProfile, paths: string[]): string[] {
  const required = new Set(profile.required);
  for (const rule of profile.conditional) {
    const { paths: rulePaths, require: ruleRequire } = rule;
    if (!Array.isArray(rulePaths) || !Array.isArray(ruleRequire)) continue;
    if (paths.some((path) => rulePaths.some((pattern) => matchesPath(path, pattern)))) {
      for (const check of ruleRequire) required.add(check);
    }
  }
  return [...required];
}

/**
 * Executes the React Doctor Tier-1 lint gate for changed or specified React files.
 * Loaded dynamically to keep quality-profile.ts free of external runtime dependencies.
 */
export async function runReactDoctorGate(paths?: string[], cwd = ROOT) {
  const { inspectReactDoctorFiles } = await import("../metrics/rules/react-doctor-rules.ts");
  const targetPaths = paths && paths.length > 0 ? paths : changedPaths(cwd);
  const reactFiles = targetPaths.filter((p) => p.endsWith(".tsx") || p.endsWith(".jsx"));
  const scanTargets = reactFiles.length > 0 ? reactFiles : (targetPaths.length > 0 ? [] : ["src", "app", "pages", "components"]);
  return inspectReactDoctorFiles(scanTargets, cwd);
}

const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return false; }
})();

if (isMainModule) {
  (async () => {
    try {
      const profile = readProfile();
      const paths = changedPaths();
      const required = requiredChecks(profile, paths);
      if (process.argv[2] === "json") {
        console.log(JSON.stringify({ required, paths, commands: profile.commands }));
      } else if (process.argv[2] === "command") {
        console.log(profile.commands[process.argv[3] ?? ""] ?? "");
      } else if (process.argv[2] === "react-doctor") {
        const explicitFiles = process.argv.slice(3).filter((a) => !a.startsWith("-"));
        const res = await runReactDoctorGate(explicitFiles.length > 0 ? explicitFiles : undefined);
        if (!res.passed) {
          console.error(`[REACT DOCTOR GATE] ❌ 치명적 안티패턴 ${res.fatalCount}건 감지 — 커밋 차단 (Fail-closed)`);
          for (const v of res.violations.filter((x: any) => x.severity === "fatal")) {
            console.error(` - [${v.ruleId}] ${v.file}:${v.line}:${v.column}: ${v.message}`);
          }
          process.exit(1);
        } else {
          console.log(`[REACT DOCTOR GATE] ✓ PASS (Score: ${res.score}/100, 파일: ${res.totalFiles}건, 경고: ${res.warnCount}건)`);
          process.exit(0);
        }
      } else {
        console.log(required.join("\n"));
      }
    } catch (error) {
      console.error(`quality profile: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  })();
}
