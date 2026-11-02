// plan-domain-router.ts — Detects out-of-scope domain plans in the harness meta-repo
// and generates a safe migration manifest for target downstream repositories.
//
// Realizes Step 4 (AC-2) of plans/2026-10-14-idea-audit-and-master-roadmap.plan.md:
// Identifies plans like `chromebook-virtual-orchestra.plan.md` that target external
// application domains (e.g., Edutech WebAudio/MediaPipe/WebRTC apps) rather than the
// harness core (`scripts/`, `template/`, `studio/`, `tests/`, `evals/`, `docs/`).

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PlanDomainScope = "harness-core" | "external-domain";

export interface PlanDomainRouteEntry {
  planFile: string;
  slug: string;
  scope: PlanDomainScope;
  recommendedTargetProject: string;
  detectedDomainSignals: string[];
  referencedPaths: string[];
  migrationAction: "keep-in-harness" | "migrate-to-target-workspace";
}

export interface PlanDomainManifest {
  generatedAt: string;
  sourceRepo: string;
  totalPlansScanned: number;
  harnessCorePlansCount: number;
  externalDomainPlansCount: number;
  entries: PlanDomainRouteEntry[];
  externalPlans: PlanDomainRouteEntry[];
}

const HARNESS_PATH_PREFIXES = [
  "scripts/",
  "template/",
  "evals/",
  "studio/",
  "bin/",
  "hooks/",
  ".claude/",
  ".agents/",
  ".codex/",
  "AGENTS.md",
  "CLAUDE.md",
  "rules.md",
  ".env.example",
];

interface ExternalDomainRule {
  targetProject: string;
  keywords: RegExp[];
  pathPatterns: RegExp[];
}

const EXTERNAL_DOMAIN_RULES: ExternalDomainRule[] = [
  {
    targetProject: "i-bank",
    keywords: [
      /chromebook-virtual-orchestra/i,
      /WebAudio|AudioWorklet|MediaPipe\s*Hands|합주|오케스트라|리코더|실로폰|칼림바/i,
    ],
    pathPatterns: [
      /^src\/(?:audio|vision|network|ui)\//,
    ],
  },
];

function extractFilesFromPlan(markdown: string): string[] {
  const files = new Set<string>();
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*-\s*\*?\*?Files\*?\*?\s*:\s*(.+)$/i.exec(line);
    if (!m) continue;
    const rawList = m[1] ?? "";
    for (const token of rawList.split(",")) {
      const cleaned = token.replace(/`/g, "").trim();
      if (cleaned) files.add(cleaned);
    }
  }
  return [...files];
}

/**
 * Classifies a single plan markdown content into harness-core or external-domain.
 */
export function classifyPlanDomain(markdown: string, planFile: string): PlanDomainRouteEntry {
  const normalizedFile = planFile.replace(/\\/g, "/");
  const slug = normalizedFile
    .split("/")
    .pop()
    ?.replace(/\.plan\.md$/i, "") ?? "unknown";

  const referencedPaths = extractFilesFromPlan(markdown);
  const signals: string[] = [];
  let recommendedTarget = "create-agent-harness";

  const hasAnyHarnessPath = referencedPaths.some((p) =>
    HARNESS_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix)),
  );

  // Check explicit external domain rules
  for (const rule of EXTERNAL_DOMAIN_RULES) {
    for (const kw of rule.keywords) {
      if (kw.test(markdown) || kw.test(slug)) {
        signals.push(`keyword:${kw.source.slice(0, 32)}`);
        recommendedTarget = rule.targetProject;
      }
    }
    for (const p of referencedPaths) {
      if (rule.pathPatterns.some((re) => re.test(p))) {
        signals.push(`non-harness-path:${p}`);
        recommendedTarget = rule.targetProject;
      }
    }
  }

  // Also check if all referenced paths are outside harness prefixes while having non-empty Files:
  if (referencedPaths.length > 0 && !hasAnyHarnessPath && signals.length === 0) {
    signals.push(`unrecognized-root-paths:${referencedPaths.slice(0, 3).join(",")}`);
    recommendedTarget = "external-app-workspace";
  }

  const isExternal = signals.length > 0 && !hasAnyHarnessPath;

  return {
    planFile: normalizedFile,
    slug,
    scope: isExternal ? "external-domain" : "harness-core",
    recommendedTargetProject: isExternal ? recommendedTarget : "create-agent-harness",
    detectedDomainSignals: signals,
    referencedPaths,
    migrationAction: isExternal ? "migrate-to-target-workspace" : "keep-in-harness",
  };
}

/**
 * Scans all `plans/*.plan.md` files in a repository and outputs a domain routing manifest.
 */
export function buildPlanDomainManifest(options: { rootDir?: string; plansDir?: string } = {}): PlanDomainManifest {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const plansDir = resolve(rootDir, options.plansDir ?? "plans");

  const entries: PlanDomainRouteEntry[] = [];
  if (existsSync(plansDir)) {
    const files = readdirSync(plansDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".plan.md") && extname(e.name) === ".md")
      .map((e) => join(plansDir, e.name))
      .sort();

    for (const fullPath of files) {
      const rel = relative(rootDir, fullPath).replace(/\\/g, "/");
      const content = readFileSync(fullPath, "utf8");
      entries.push(classifyPlanDomain(content, rel));
    }
  }

  const externalPlans = entries.filter((e) => e.scope === "external-domain");
  return {
    generatedAt: new Date().toISOString(),
    sourceRepo: "create-agent-harness",
    totalPlansScanned: entries.length,
    harnessCorePlansCount: entries.length - externalPlans.length,
    externalDomainPlansCount: externalPlans.length,
    entries,
    externalPlans,
  };
}

const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const manifest = buildPlanDomainManifest();
  console.log(JSON.stringify(manifest, null, 2));
}
