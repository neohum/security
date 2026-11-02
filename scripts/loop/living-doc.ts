// living-doc.ts — Living Documentation generator from automated tests and plan AC-* criteria.
//
// Realizes plans/2026-10-11-발화자-1-0001-문서-역할을-하는-테스트-자동-테스트의-이점-7537.plan.md:
// Extracts executable specifications from test files (test/it/describe blocks),
// cross-references them against AC-* acceptance criteria in plans/*.plan.md,
// flags vague test descriptions ("test1", "works", etc.) and orphan AC items,
// and emits a human-readable Markdown specification (docs/living-spec.md).

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface TestCaseSpec {
  file: string;
  line: number;
  kind: "describe" | "test" | "it";
  title: string;
  acRefs: string[];
  vague: boolean;
  vagueReason?: string;
}

export interface PlanAcSpec {
  planFile: string;
  planSlug: string;
  acId: string;
  description: string;
  line: number;
}

export interface LivingDocOptions {
  rootDir?: string;
  testsDir?: string;
  plansDir?: string;
  outputPath?: string;
}

export interface LivingDocReport {
  generatedAt: string;
  summary: {
    testFilesCount: number;
    totalTestCases: number;
    vagueTestCount: number;
    plansCount: number;
    totalPlanAcCount: number;
    coveredPlanAcCount: number;
    orphanPlanAcCount: number;
    acCoverageRatio: number;
  };
  testSpecs: TestCaseSpec[];
  vagueTests: TestCaseSpec[];
  planAcItems: PlanAcSpec[];
  coveredAcIds: string[];
  orphanAcItems: PlanAcSpec[];
}

const VAGUE_EXACT = new Set([
  "test",
  "test1",
  "test2",
  "test 1",
  "works",
  "it works",
  "should work",
  "basic",
  "basic test",
  "check",
  "todo",
  "fix",
  "temp",
  "sanity",
]);

/**
 * Checks whether a test title is too vague to serve as living documentation.
 */
export function isVagueTestTitle(title: string): { vague: boolean; reason?: string } {
  const normalized = title.trim().toLowerCase();
  if (normalized.length === 0) {
    return { vague: true, reason: "빈 테스트 제목" };
  }
  if (VAGUE_EXACT.has(normalized) || /^test\s*#?\d+$/i.test(normalized)) {
    return { vague: true, reason: `모호한 플레이스홀더 제목 ("${title.trim()}")` };
  }
  if (normalized.length < 6) {
    return { vague: true, reason: `설명력이 부족한 짧은 제목 (${normalized.length}자)` };
  }
  return { vague: false };
}

/**
 * Extracts AC-* identifiers mentioned in a string (e.g., "AC-1", "AC-2-4").
 */
export function extractAcIds(text: string): string[] {
  const matches = text.match(/\bAC-\d+(?:-\d+)?\b/gi) ?? [];
  const unique = new Set(matches.map((m) => m.toUpperCase()));
  return [...unique];
}

/**
 * Parses test/it/describe blocks from a test file's source code.
 */
export function extractTestSpecsFromContent(source: string, filePath = "unknown.test.ts"): TestCaseSpec[] {
  const specs: TestCaseSpec[] = [];
  const lines = source.split(/\r?\n/);
  const pattern = /\b(describe|test|it)\s*\(\s*(["'`])((?:\\.|(?!\2).)*)\2/;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? "";
    const match = pattern.exec(lineText);
    if (!match) continue;

    const kind = match[1] as "describe" | "test" | "it";
    const title = (match[3] ?? "").trim();
    const acRefs = extractAcIds(title);
    const vagueCheck = isVagueTestTitle(title);

    specs.push({
      file: filePath.replace(/\\/g, "/"),
      line: i + 1,
      kind,
      title,
      acRefs,
      vague: vagueCheck.vague,
      vagueReason: vagueCheck.reason,
    });
  }

  return specs;
}

/**
 * Parses AC-* acceptance criteria from a plan markdown file.
 */
export function extractPlanAcFromContent(markdown: string, planPath = "unknown.plan.md"): PlanAcSpec[] {
  const items: PlanAcSpec[] = [];
  const lines = markdown.split(/\r?\n/);
  const normalizedPath = planPath.replace(/\\/g, "/");
  const planSlug = normalizedPath
    .split("/")
    .pop()
    ?.replace(/\.plan\.md$/i, "") ?? "unknown";

  const acLineRe = /^\s*(?:-\s*)?(?:Acceptance:\s*)?`?(AC-\d+(?:-\d+)?)`?\s*:\s*(.+)$/i;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const m = acLineRe.exec(raw);
    if (!m) continue;
    const acId = (m[1] ?? "").toUpperCase();
    const description = (m[2] ?? "").trim();
    items.push({
      planFile: normalizedPath,
      planSlug,
      acId,
      description,
      line: i + 1,
    });
  }

  return items;
}

function walkTestFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTestFiles(full, acc);
    } else if (entry.isFile() && /\.(test|spec)\.[tj]sx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function walkPlanFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".plan.md") && extname(entry.name) === ".md") {
      results.push(join(dir, entry.name));
    }
  }
  return results.sort();
}

/**
 * Scans the repository's tests and plans to build a comprehensive Living Documentation report.
 */
export function generateLivingDoc(options: LivingDocOptions = {}): LivingDocReport {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const testsDir = resolve(rootDir, options.testsDir ?? "tests");
  const plansDir = resolve(rootDir, options.plansDir ?? "plans");

  const testFiles = walkTestFiles(testsDir).sort();
  const planFiles = walkPlanFiles(plansDir);

  const testSpecs: TestCaseSpec[] = [];
  const allTestAcIds = new Set<string>();
  const referencedPlanTestFiles = new Set<string>();

  for (const tf of testFiles) {
    const rel = relative(rootDir, tf).replace(/\\/g, "/");
    const content = readFileSync(tf, "utf8");
    const specs = extractTestSpecsFromContent(content, rel);
    testSpecs.push(...specs);
    for (const s of specs) {
      for (const ac of s.acRefs) {
        allTestAcIds.add(ac);
      }
    }
    for (const ac of extractAcIds(content)) {
      allTestAcIds.add(ac);
    }
    referencedPlanTestFiles.add(rel);
  }

  const planAcItems: PlanAcSpec[] = [];
  const coveredAcKeys = new Set<string>();
  const orphanAcItems: PlanAcSpec[] = [];

  for (const pf of planFiles) {
    const rel = relative(rootDir, pf).replace(/\\/g, "/");
    const content = readFileSync(pf, "utf8");
    const items = extractPlanAcFromContent(content, rel);
    planAcItems.push(...items);

    const planMentionsExistingTest = [...referencedPlanTestFiles].some((tf) => content.includes(tf));

    for (const item of items) {
      const key = `${item.planSlug}:${item.acId}`;
      if (allTestAcIds.has(item.acId) || planMentionsExistingTest) {
        coveredAcKeys.add(key);
      } else {
        orphanAcItems.push(item);
      }
    }
  }

  const vagueTests = testSpecs.filter((t) => t.vague);
  const totalPlanAcCount = planAcItems.length;
  const coveredPlanAcCount = coveredAcKeys.size;
  const acCoverageRatio =
    totalPlanAcCount > 0 ? Number((coveredPlanAcCount / totalPlanAcCount).toFixed(2)) : 1;

  const report: LivingDocReport = {
    generatedAt: new Date().toISOString(),
    summary: {
      testFilesCount: testFiles.length,
      totalTestCases: testSpecs.length,
      vagueTestCount: vagueTests.length,
      plansCount: planFiles.length,
      totalPlanAcCount,
      coveredPlanAcCount,
      orphanPlanAcCount: orphanAcItems.length,
      acCoverageRatio,
    },
    testSpecs,
    vagueTests,
    planAcItems,
    coveredAcIds: [...coveredAcKeys],
    orphanAcItems,
  };

  if (options.outputPath) {
    const outFull = resolve(rootDir, options.outputPath);
    mkdirSync(dirname(outFull), { recursive: true });
    writeFileSync(outFull, formatLivingDocMarkdown(report), "utf8");
  }

  return report;
}

/**
 * Formats a LivingDocReport into a structured Markdown specification document.
 */
export function formatLivingDocMarkdown(report: LivingDocReport): string {
  const lines: string[] = [];
  lines.push("# Living Specification (살아있는 테스트 기능 명세서)");
  lines.push("");
  lines.push(`> 자동 생성 시각: \`${report.generatedAt}\``);
  lines.push("> 본 문서는 `tests/**/*.test.ts`의 실행 가능한 테스트 명세와 `plans/*.plan.md`의 수용 기준(`AC-*`)을 교차 분석하여 자동 생성되었습니다.");
  lines.push("");
  lines.push("## 1. 요약 지표 (Executive Summary)");
  lines.push("");
  lines.push("| 항목 | 수치 |");
  lines.push("| :--- | :---: |");
  lines.push(`| 분석된 테스트 파일 수 | ${report.summary.testFilesCount}개 |`);
  lines.push(`| 추출된 실행 가능 명세(Test Cases) | ${report.summary.totalTestCases}건 |`);
  lines.push(`| 모호한 테스트 제목 경고 | ${report.summary.vagueTestCount}건 |`);
  lines.push(`| 분석된 계획서(Plans) 수 | ${report.summary.plansCount}개 |`);
  lines.push(`| 전체 수용 기준(AC-*) 수 | ${report.summary.totalPlanAcCount}건 |`);
  lines.push(`| 테스트 연동 완료 수용 기준 | ${report.summary.coveredPlanAcCount}건 (${Math.round(report.summary.acCoverageRatio * 100)}%) |`);
  lines.push(`| 미연결(고아) 수용 기준 | ${report.summary.orphanPlanAcCount}건 |`);
  lines.push("");

  lines.push("## 2. 테스트 품질 감사 (모호한 명세 및 미연결 AC)");
  lines.push("");
  if (report.vagueTests.length === 0) {
    lines.push("- **모호한 테스트 제목**: 0건 (모든 테스트가 명확한 동작 의도를 기술함)");
  } else {
    lines.push(`- **모호한 테스트 제목 (${report.vagueTests.length}건)**:`);
    for (const v of report.vagueTests.slice(0, 25)) {
      lines.push(`  - \`${v.file}:${v.line}\` — "${v.title}" (${v.vagueReason})`);
    }
  }

  if (report.orphanAcItems.length === 0) {
    lines.push("- **미연결(고아) 수용 기준**: 0건 (모든 계획서의 AC가 테스트 스위트와 연결됨)");
  } else {
    lines.push(`- **미연결(고아) 수용 기준 (${report.orphanAcItems.length}건)**:`);
    for (const o of report.orphanAcItems.slice(0, 25)) {
      lines.push(`  - \`${o.planFile}:${o.line}\` [${o.acId}] — ${o.description}`);
    }
  }
  lines.push("");

  lines.push("## 3. 모듈별 실행 가능 기능 명세 (Executable Specifications by Test Suite)");
  lines.push("");

  const byFile = new Map<string, TestCaseSpec[]>();
  for (const spec of report.testSpecs) {
    const list = byFile.get(spec.file) ?? [];
    list.push(spec);
    byFile.set(spec.file, list);
  }

  for (const [file, specs] of byFile.entries()) {
    lines.push(`### \`${file}\` (${specs.length}건)`);
    for (const s of specs) {
      const acBadge = s.acRefs.length > 0 ? ` **[${s.acRefs.join(", ")}]**` : "";
      lines.push(`- (L${s.line}) ${s.title}${acBadge}`);
    }
    lines.push("");
  }

  return lines.join("\n");
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
  const argv = process.argv.slice(2);
  let outPath = "docs/living-spec.md";
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) outPath = argv[++i]!;
    else if (argv[i] === "--json") asJson = true;
  }
  const report = generateLivingDoc({ outputPath: outPath });
  if (asJson) {
    console.log(JSON.stringify(report.summary, null, 2));
  } else {
    console.log(
      `Living Spec generated at ${outPath}: ${report.summary.totalTestCases} test specs across ${report.summary.testFilesCount} files (AC coverage: ${Math.round(report.summary.acCoverageRatio * 100)}%).`,
    );
  }
}
