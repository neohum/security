#!/usr/bin/env node
/**
 * korean-typography-audit.ts — Korean Typography & Line-Break Quality Auditor.
 *
 * Enforces the 4 Core Korean Line-Breaking Rules + Anti-Slop Ban across HTML, CSS,
 * JSX/TSX, Vue, and Svelte files (plus runtime DOM getComputedStyle probe support):
 *
 * 1. Banned Pattern (Critical):
 *    - `word-break: break-all` or Tailwind `break-all` on Korean headings, body copy,
 *      cards, or descriptions (causes mid-eojeol syllable splitting like `대한민 / 국`).
 * 2. Body, Cards, Descriptions:
 *    - `word-break: keep-all; overflow-wrap: break-word;` (`break-keep break-words`)
 * 3. Headings, Titles, Banners & Body Paragraphs:
 *    - Headings: `text-wrap: balance;` (`text-balance`)
 *    - Paragraphs: `text-wrap: pretty;` (`text-pretty`)
 * 4. Buttons, Badges, Short Labels:
 *    - `white-space: nowrap;` (`whitespace-nowrap`), or `white-space: pre-line;` for
 *      intentional multi-line breaks.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type KoreanTypoSeverity = "critical" | "serious" | "moderate" | "info";

export interface KoreanTypographyViolation {
  id:
    | "KR-TYPO-BREAK-ALL"
    | "KR-TYPO-KEEP-ALL-MISSING"
    | "KR-TYPO-OVERFLOW-WRAP-MISSING"
    | "KR-TYPO-HEADING-BALANCE-MISSING"
    | "KR-TYPO-BODY-PRETTY-MISSING"
    | "KR-TYPO-NOWRAP-MISSING";
  rule: string;
  severity: KoreanTypoSeverity;
  target: string;
  line?: number;
  snippet: string;
  message: string;
  fixRecommendation: string;
  autoFixCss: string;
}

export interface KoreanTypographyAuditResult {
  passed: boolean;
  score: number;
  hasKoreanContext: boolean;
  violations: KoreanTypographyViolation[];
  summary: {
    critical: number;
    serious: number;
    moderate: number;
    info: number;
  };
  autoFixCssSnippet: string;
  domProbeScript: string;
}

export const KOREAN_TYPOGRAPHY_AUTO_FIX_CSS = `/* 한국어 타이포그래피 4대 줄바꿈 표준 가드 (Auto-Fix CSS) */
body, p, li, .card p, .card li, .field-value {
  word-break: keep-all;
  overflow-wrap: break-word;
  text-wrap: pretty;
}

h1, h2, h3, h4, .plan-title, .hero-title, .step-title {
  word-break: keep-all;
  overflow-wrap: break-word;
  text-wrap: balance;
}

button, .btn, .badge, .chip, .step-num {
  white-space: nowrap;
}

.multiline-copy {
  white-space: pre-line;
  word-break: keep-all;
  overflow-wrap: break-word;
}`;

/**
 * Browser runtime DOM probe script using `window.getComputedStyle` that can be
 * evaluated in Playwright / WebView2 / DevTools to audit live rendered Korean nodes.
 */
export const KOREAN_TYPOGRAPHY_DOM_PROBE_SCRIPT = `(() => {
  const koreanRegex = /[가-힣]/;
  const issues = [];
  const elements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, button, a, span'));
  for (const el of elements) {
    const text = (el.textContent || '').trim();
    if (!koreanRegex.test(text)) continue;
    if (el.closest('pre, code')) continue;
    const style = window.getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    if (style.wordBreak === 'break-all') {
      issues.push({ id: 'KR-TYPO-BREAK-ALL', tag, text: text.slice(0, 40), wordBreak: style.wordBreak });
    }
    if ((tag === 'p' || tag === 'li' || /^h[1-6]$/.test(tag)) && style.wordBreak !== 'keep-all') {
      issues.push({ id: 'KR-TYPO-KEEP-ALL-MISSING', tag, text: text.slice(0, 40), wordBreak: style.wordBreak });
    }
    if ((tag === 'button' || el.classList.contains('badge') || el.classList.contains('btn')) && style.whiteSpace !== 'nowrap' && style.whiteSpace !== 'pre-line') {
      issues.push({ id: 'KR-TYPO-NOWRAP-MISSING', tag, text: text.slice(0, 40), whiteSpace: style.whiteSpace });
    }
  }
  return issues;
})()`;

const HANGUL_REGEX = /[가-힣]/;

function isCodeOrIdentifierSelector(selector: string): boolean {
  return /\b(code|pre|mono|hash|wave-card|token|kbd|samp)\b/i.test(selector);
}

function getLineNumber(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/**
 * Audits an HTML, CSS, or JSX/TSX string for compliance with the 4 Korean
 * typography line-breaking rules and the ban on `word-break: break-all`.
 */
export function auditKoreanTypography(
  content: string,
  targetName = "document.html",
  options: { forceKoreanContext?: boolean } = {},
): KoreanTypographyAuditResult {
  const src = String(content ?? "");
  const hasHangul = HANGUL_REGEX.test(src);
  const hasKoLang = /<html[^>]*\blang=["']ko(?:-KR)?["']/i.test(src);
  const hasKoreanContext = Boolean(options.forceKoreanContext || hasHangul || hasKoLang);

  const violations: KoreanTypographyViolation[] = [];

  if (!hasKoreanContext) {
    return {
      passed: true,
      score: 100,
      hasKoreanContext: false,
      violations: [],
      summary: { critical: 0, serious: 0, moderate: 0, info: 0 },
      autoFixCssSnippet: KOREAN_TYPOGRAPHY_AUTO_FIX_CSS,
      domProbeScript: KOREAN_TYPOGRAPHY_DOM_PROBE_SCRIPT,
    };
  }

  // Extract <style> blocks (or treat entire input as CSS if no HTML tags are present)
  const styleBlocks: Array<{ css: string; offset: number }> = [];
  const styleTagRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleTagRegex.exec(src)) !== null) {
    styleBlocks.push({
      css: styleMatch[1] ?? "",
      offset: (styleMatch.index ?? 0) + styleMatch[0].indexOf(styleMatch[1] ?? ""),
    });
  }
  const isPureCss = extname(targetName) === ".css" || (!/<[a-zA-Z]/.test(src) && /\{[\s\S]*\}/.test(src));
  if (isPureCss) {
    styleBlocks.push({ css: src, offset: 0 });
  }

  const combinedCss = styleBlocks.map((b) => b.css).join("\n");

  // -------------------------------------------------------------------------
  // 1. Check CSS rule blocks for banned `word-break: break-all` on non-code selectors
  // -------------------------------------------------------------------------
  const cssRuleRegex = /([^{}@]+)\{([^}]*)\}/g;
  for (const block of styleBlocks) {
    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = cssRuleRegex.exec(block.css)) !== null) {
      const selector = (ruleMatch[1] ?? "").trim();
      const body = ruleMatch[2] ?? "";
      if (isCodeOrIdentifierSelector(selector)) continue;
      if (/word-break\s*:\s*break-all/i.test(body)) {
        const line = getLineNumber(src, block.offset + (ruleMatch.index ?? 0));
        violations.push({
          id: "KR-TYPO-BREAK-ALL",
          rule: "한국어 본문·헤딩 word-break: break-all 사용 금지 (Slop Gate)",
          severity: "critical",
          target: `${targetName} (${selector})`,
          line,
          snippet: `${selector} { ${body.trim().replace(/\s+/g, " ")} }`,
          message: `CSS 선택자 '${selector}'에 'word-break: break-all'이 선언되어 한국어 어절이 음절 단위로 쪼개집니다.`,
          fixRecommendation:
            "'word-break: break-all'을 제거하고 'word-break: keep-all; overflow-wrap: break-word;'를 적용하세요.",
          autoFixCss: `${selector} {\n  word-break: keep-all;\n  overflow-wrap: break-word;\n}`,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Check inline HTML/JSX elements for `break-all` or `word-break: break-all`
  // -------------------------------------------------------------------------
  const openTagRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)>/g;
  let elMatch: RegExpExecArray | null;
  while ((elMatch = openTagRegex.exec(src)) !== null) {
    const tag = (elMatch[1] ?? "").toLowerCase();
    const attrs = elMatch[2] ?? "";
    if (tag === "code" || tag === "pre" || tag === "script" || tag === "style") continue;
    if (isCodeOrIdentifierSelector(attrs)) continue;

    const line = getLineNumber(src, elMatch.index ?? 0);
    const hasBreakAllAttr =
      /\bbreak-all\b/.test(attrs) || /word-break\s*:\s*break-all/i.test(attrs);

    if (hasBreakAllAttr && (hasHangul || hasKoLang || /^h[1-6]$|^p$|^li$/.test(tag))) {
      violations.push({
        id: "KR-TYPO-BREAK-ALL",
        rule: "한국어 본문·헤딩 word-break: break-all 사용 금지 (Slop Gate)",
        severity: "critical",
        target: `${targetName}:<${tag}>`,
        line,
        snippet: elMatch[0].slice(0, 120),
        message: `<${tag}> 요소에 'break-all'이 적용되어 한글 어절 중간 끊김(대한민 / 국) 현상을 유발합니다.`,
        fixRecommendation:
          "Tailwind 'break-keep break-words' 또는 CSS 'word-break: keep-all; overflow-wrap: break-word;'로 교체하세요.",
        autoFixCss: `${tag} { word-break: keep-all; overflow-wrap: break-word; }`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Global stylesheet / document-level checks when <style> or pure CSS exists
  // -------------------------------------------------------------------------
  const hasGlobalKeepAll =
    /word-break\s*:\s*keep-all/i.test(combinedCss) || /\bbreak-keep\b/.test(src);
  const hasGlobalOverflowWrap =
    /overflow-wrap\s*:\s*(?:break-word|anywhere)/i.test(combinedCss) ||
    /word-wrap\s*:\s*break-word/i.test(combinedCss) ||
    /\bbreak-words\b/.test(src);
  const hasGlobalPretty =
    /text-wrap\s*:\s*pretty/i.test(combinedCss) || /\btext-pretty\b/.test(src);
  const hasGlobalBalance =
    /text-wrap\s*:\s*balance/i.test(combinedCss) || /\btext-balance\b/.test(src);
  const hasGlobalNowrap =
    /white-space\s*:\s*(?:nowrap|pre-line)/i.test(combinedCss) ||
    /\bwhitespace-(?:nowrap|pre-line)\b/.test(src);

  const hasBodyOrParagraph = /<(?:body|p|li)\b/i.test(src) || /\b(?:body|p|li)\s*\{/i.test(combinedCss);
  const hasHeading = /<h[1-6]\b/i.test(src) || /\bh[1-6][^{]*\{/i.test(combinedCss);
  const hasButtonOrBadge =
    /<(?:button|Badge|Chip)\b/i.test(src) ||
    /class(?:Name)?=["'][^"']*\b(?:btn|badge|chip|step-num)\b/i.test(src) ||
    /\.(?:btn|badge|chip|step-num)\s*\{/i.test(combinedCss);

  if (hasBodyOrParagraph && !hasGlobalKeepAll) {
    violations.push({
      id: "KR-TYPO-KEEP-ALL-MISSING",
      rule: "한국어 본문·카드·설명 word-break: keep-all 필수",
      severity: "serious",
      target: targetName,
      snippet: "body, p, li",
      message: "한국어 본문 또는 단락에 'word-break: keep-all'('break-keep') 선언이 누락되어 어절 중간 끊김이 발생할 수 있습니다.",
      fixRecommendation: "body, p, li 또는 텍스트 컨테이너에 'word-break: keep-all; overflow-wrap: break-word;'를 추가하세요.",
      autoFixCss: "body, p, li { word-break: keep-all; overflow-wrap: break-word; }",
    });
  }

  if (hasBodyOrParagraph && !hasGlobalOverflowWrap) {
    violations.push({
      id: "KR-TYPO-OVERFLOW-WRAP-MISSING",
      rule: "한국어 본문·카드·설명 overflow-wrap: break-word 필수",
      severity: "serious",
      target: targetName,
      snippet: "body, p, li",
      message: "'overflow-wrap: break-word'('break-words')가 누락되어 긴 복합어·URL이 컨테이너를 가로로 넘칠 수 있습니다.",
      fixRecommendation: "'word-break: keep-all'과 함께 'overflow-wrap: break-word'를 반드시 쌍으로 선언하세요.",
      autoFixCss: "body, p, li { word-break: keep-all; overflow-wrap: break-word; }",
    });
  }

  if (hasBodyOrParagraph && !hasGlobalPretty) {
    violations.push({
      id: "KR-TYPO-BODY-PRETTY-MISSING",
      rule: "한국어 본문 단락 text-wrap: pretty 권장 (고아 단어 방지)",
      severity: "moderate",
      target: targetName,
      snippet: "body, p, li",
      message: "본문 단락에 'text-wrap: pretty'('text-pretty')가 누락되어 문단 마지막 줄에 한 단어 고아(Orphan word)가 남을 수 있습니다.",
      fixRecommendation: "본문 단락(body, p, li)에 'text-wrap: pretty;'를 적용하세요.",
      autoFixCss: "body, p, li { text-wrap: pretty; }",
    });
  }

  if (hasHeading && !hasGlobalBalance) {
    violations.push({
      id: "KR-TYPO-HEADING-BALANCE-MISSING",
      rule: "한국어 헤딩·타이틀·배너 text-wrap: balance 필수",
      severity: "moderate",
      target: targetName,
      snippet: "h1, h2, h3",
      message: "헤딩 요소에 'text-wrap: balance'('text-balance')가 누락되어 다중 행 제목의 줄 길이가 불균형해질 수 있습니다.",
      fixRecommendation: "헤딩(h1~h4, .plan-title, .hero-title)에 'text-wrap: balance;'를 적용하세요.",
      autoFixCss: "h1, h2, h3, h4 { text-wrap: balance; }",
    });
  }

  if (hasButtonOrBadge && !hasGlobalNowrap) {
    violations.push({
      id: "KR-TYPO-NOWRAP-MISSING",
      rule: "버튼·배지·짧은 라벨 white-space: nowrap 필수",
      severity: "serious",
      target: targetName,
      snippet: "button, .badge, .btn",
      message: "버튼 또는 배지 요소에 'white-space: nowrap'('whitespace-nowrap')이 누락되어 모바일에서 2줄로 꺾일 수 있습니다.",
      fixRecommendation: "버튼·배지·짧은 라벨에 'white-space: nowrap;'(의도된 개행은 'white-space: pre-line;')을 적용하세요.",
      autoFixCss: "button, .btn, .badge, .chip { white-space: nowrap; }",
    });
  }

  // Calculate score (0..100)
  const summary = { critical: 0, serious: 0, moderate: 0, info: 0 };
  let score = 100;
  for (const v of violations) {
    summary[v.severity]++;
    const deduction =
      v.severity === "critical"
        ? 35
        : v.severity === "serious"
          ? 15
          : v.severity === "moderate"
            ? 8
            : 2;
    score = Math.max(0, score - deduction);
  }

  const passed = summary.critical === 0 && summary.serious === 0 && score >= 80;

  return {
    passed,
    score,
    hasKoreanContext,
    violations,
    summary,
    autoFixCssSnippet: KOREAN_TYPOGRAPHY_AUTO_FIX_CSS,
    domProbeScript: KOREAN_TYPOGRAPHY_DOM_PROBE_SCRIPT,
  };
}

/**
 * Scans files or directories and aggregates Korean typography audit results.
 */
export function auditKoreanTypographyFiles(
  targets: string[],
  cwd = process.cwd(),
): {
  passed: boolean;
  overallScore: number;
  checkedFilesCount: number;
  results: Record<string, KoreanTypographyAuditResult>;
  violations: KoreanTypographyViolation[];
  autoFixCssSnippet: string;
} {
  const validExts = new Set([".html", ".htm", ".css", ".tsx", ".jsx", ".vue", ".svelte"]);
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", "coverage", ".orca", ".claude", ".agents", "tmp"]);
  const files: string[] = [];

  function walk(dir: string) {
    if (!existsSync(dir)) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const ent of entries) {
      if (skipDirs.has(ent)) continue;
      const full = join(dir, ent);
      try {
        const st = lstatSync(full);
        if (st.isDirectory()) walk(full);
        else if (validExts.has(extname(ent).toLowerCase())) files.push(full);
      } catch {
        continue;
      }
    }
  }

  for (const t of targets) {
    const full = resolve(cwd, t);
    if (!existsSync(full)) continue;
    const st = lstatSync(full);
    if (st.isDirectory()) walk(full);
    else files.push(full);
  }

  const uniqueFiles = [...new Set(files)];
  const results: Record<string, KoreanTypographyAuditResult> = {};
  const allViolations: KoreanTypographyViolation[] = [];
  let scoreSum = 0;
  let scoredCount = 0;

  for (const file of uniqueFiles) {
    try {
      const content = readFileSync(file, "utf8");
      const rel = relative(cwd, file).replace(/\\/g, "/");
      const res = auditKoreanTypography(content, rel);
      results[rel] = res;
      if (res.hasKoreanContext) {
        scoreSum += res.score;
        scoredCount++;
        allViolations.push(...res.violations);
      }
    } catch {
      // ignore unreadable files
    }
  }

  const overallScore = scoredCount > 0 ? Math.round(scoreSum / scoredCount) : 100;
  const hasCriticalOrSerious = allViolations.some(
    (v) => v.severity === "critical" || v.severity === "serious",
  );
  const passed = !hasCriticalOrSerious && overallScore >= 80;

  return {
    passed,
    overallScore,
    checkedFilesCount: uniqueFiles.length,
    results,
    violations: allViolations,
    autoFixCssSnippet: KOREAN_TYPOGRAPHY_AUTO_FIX_CSS,
  };
}

// CLI Runner
const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const targets = args.filter((a) => !a.startsWith("--"));
  const scanTargets = targets.length > 0 ? targets : ["plans"];

  const report = auditKoreanTypographyFiles(scanTargets);
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `[Korean Typography Audit] files=${report.checkedFilesCount} score=${report.overallScore}/100 passed=${report.passed}`,
    );
    for (const v of report.violations) {
      console.log(`  - [${v.severity.toUpperCase()}] ${v.id} @ ${v.target}: ${v.message}`);
    }
  }
  if (!report.passed) {
    process.exitCode = 1;
  }
}
