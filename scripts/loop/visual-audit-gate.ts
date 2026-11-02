// scripts/loop/visual-audit-gate.ts
// Health Gate for Visual Inspection & Playwright-based WCAG 2.2 Anti-Slop Audit.
// Captures Desktop (1280x800) and Mobile (375x667) screenshots, performs contrast/a11y audits,
// and writes evidence artifacts to evidence/ directory.

import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InspectionResult, InspectorOptions } from "../visual-inspector/types.ts";
import { inspectLayout } from "../visual-inspector/alignment-rule-engine.ts";
import { generateHtmlReport } from "../visual-inspector/html-reporter.ts";
import { renderSvgOverlay } from "../visual-inspector/overlay-renderer.ts";

export interface VisualAuditGateOptions {
  inputPath?: string;
  rawData?: unknown;
  card?: string;
  maxErrors?: number;
  tolerance?: number;
  gridBase?: 4 | 8;
  minTouchTarget?: number;
  evidenceDir?: string;
  cwd?: string;
}

export interface VisualAuditGateResult {
  passed: boolean;
  result: InspectionResult;
  htmlPath?: string;
  jsonPath?: string;
  svgPath?: string;
}

export interface PlaywrightVisualAuditOptions {
  url?: string;
  html?: string;
  card?: string;
  evidenceDir?: string;
  cwd?: string;
  contrastThreshold?: number; // default 4.5 (WCAG 2.2 AA)
  minTouchTarget?: number;    // default 24 (WCAG 2.2 AA Target Size Minimum)
  viewports?: {
    desktop?: { width: number; height: number };
    mobile?: { width: number; height: number };
  };
}

export interface AccessibilityAuditIssue {
  type: "contrast" | "alt" | "button-label" | "input-label" | "touch-target" | "aria-role";
  severity: "critical" | "serious" | "warning";
  selector?: string;
  element?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PlaywrightVisualAuditResult {
  passed: boolean;
  score: number;
  url?: string;
  evidenceDir: string;
  screenshots: {
    desktop: string;
    mobile: string;
  };
  accessibility: {
    passed: boolean;
    wcagLevel: "2.2 AA";
    totalIssues: number;
    issues: AccessibilityAuditIssue[];
    contrastAudit: {
      checkedCount: number;
      failedCount: number;
    };
  };
  reportHtmlPath: string;
  reportJsonPath: string;
}

export function localDateStamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
}

export function runVisualAuditGate(options: VisualAuditGateOptions = {}): VisualAuditGateResult {
  const cwd = options.cwd ?? process.cwd();
  const maxErrors = options.maxErrors ?? 0;
  let rawData = options.rawData;

  if (!rawData && options.inputPath) {
    const fullInput = resolve(cwd, options.inputPath);
    if (existsSync(fullInput)) {
      try {
        const text = readFileSync(fullInput, "utf8");
        rawData = JSON.parse(text);
      } catch (err) {
        console.error(`[VISUAL AUDIT GATE] 입력 데이터 파싱 실패: ${(err as Error).message}`);
      }
    }
  }

  if (!rawData) {
    rawData = [];
  }

  const inspectorOptions: InspectorOptions = {
    tolerance: options.tolerance ?? 2,
    gridBase: options.gridBase ?? 4,
    minTouchTarget: options.minTouchTarget ?? 44,
    maxErrors,
  };

  const result = inspectLayout(rawData, inspectorOptions);

  let targetDir = options.evidenceDir;
  if (!targetDir) {
    const card = options.card || "visual-grid-inspection";
    targetDir = resolve(cwd, "evidence", `${localDateStamp()}-${card}`);
  } else {
    targetDir = resolve(cwd, targetDir);
  }

  let htmlPath: string | undefined;
  let jsonPath: string | undefined;
  let svgPath: string | undefined;

  try {
    mkdirSync(targetDir, { recursive: true });

    htmlPath = join(targetDir, "visual-audit-report.html");
    const html = generateHtmlReport(result, "Visual Grid Inspection Gate Report");
    writeFileSync(htmlPath, html, "utf8");

    jsonPath = join(targetDir, "visual-audit-summary.json");
    writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf8");

    svgPath = join(targetDir, "visual-audit-overlay.svg");
    const svg = renderSvgOverlay(result);
    writeFileSync(svgPath, svg, "utf8");
  } catch (err) {
    console.warn(`[VISUAL AUDIT GATE] 산출물 저장 경고: ${(err as Error).message}`);
  }

  return {
    passed: result.summary.passed,
    result,
    htmlPath,
    jsonPath,
    svgPath,
  };
}

/**
 * Generates an interactive, standalone HTML report for the Playwright Visual & A11y Audit.
 */
function generatePlaywrightHtmlReport(
  res: {
    passed: boolean;
    score: number;
    url?: string;
    screenshots: { desktop: string; mobile: string };
    accessibility: PlaywrightVisualAuditResult["accessibility"];
  },
  card: string
): string {
  const statusColor = res.passed ? "#10b981" : "#ef4444";
  const statusBadge = res.passed ? "PASSED (✓)" : "BLOCKED (❌ FAIL-CLOSED)";

  const issueRows = res.accessibility.issues.map((issue) => {
    const badgeColor =
      issue.severity === "critical" ? "#ef4444" : issue.severity === "serious" ? "#f59e0b" : "#3b82f6";
    return `
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 10px 14px;"><span style="background:${badgeColor}; color:#fff; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:bold;">${issue.severity.toUpperCase()}</span></td>
        <td style="padding: 10px 14px; font-family: monospace; color:#cbd5e1;">${issue.type}</td>
        <td style="padding: 10px 14px; color:#cbd5e1;">${issue.element || issue.selector || "-"}</td>
        <td style="padding: 10px 14px; color:#94a3b8;">${issue.message}</td>
      </tr>
    `;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Playwright Visual & Accessibility Audit — ${card}</title>
  <style>
    body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    h1 { font-size: 20px; margin: 0 0 8px 0; color: #f8fafc; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-weight: 600; font-size: 13px; }
    .metrics { display: flex; gap: 16px; margin-top: 16px; flex-wrap: wrap; }
    .metric-box { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; min-width: 140px; }
    .metric-title { font-size: 12px; color: #94a3b8; text-transform: uppercase; }
    .metric-value { font-size: 22px; font-weight: bold; margin-top: 4px; }
    .viewports { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-top: 16px; }
    @media (max-width: 900px) { .viewports { grid-template-columns: 1fr; } }
    .preview-box { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px; text-align: center; }
    .preview-box img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid #475569; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th { text-align: left; padding: 10px 14px; background: #0f172a; color: #94a3b8; border-bottom: 2px solid #334155; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1>Playwright Visual & WCAG 2.2 Accessibility Gate</h1>
        <div style="color: #94a3b8; font-size: 13px;">Target Card: <strong>${card}</strong> | URL: ${res.url || "Inline HTML"}</div>
      </div>
      <div>
        <span class="badge" style="background: ${statusColor}22; color: ${statusColor}; border: 1px solid ${statusColor};">${statusBadge}</span>
      </div>
    </div>

    <div class="metrics">
      <div class="metric-box">
        <div class="metric-title">종합 평가 점수</div>
        <div class="metric-value" style="color: ${statusColor};">${res.score}/100</div>
      </div>
      <div class="metric-box">
        <div class="metric-title">WCAG 2.2 적합성</div>
        <div class="metric-value" style="color: ${res.accessibility.passed ? "#10b981" : "#ef4444"};">${res.accessibility.wcagLevel}</div>
      </div>
      <div class="metric-box">
        <div class="metric-title">총 발견 결함</div>
        <div class="metric-value">${res.accessibility.totalIssues}건</div>
      </div>
      <div class="metric-box">
        <div class="metric-title">명암비 검사</div>
        <div class="metric-value">${res.accessibility.contrastAudit.checkedCount}건 검사 (${res.accessibility.contrastAudit.failedCount}건 미달)</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>📱 뷰포트 캡처 아티팩트 (데스크톱 1280×800 vs 모바일 375×667)</h2>
    <div class="viewports">
      <div class="preview-box">
        <h3 style="margin-top: 0; color: #38bdf8;">🖥️ 데스크톱 뷰포트 (1280 × 800)</h3>
        <img src="screenshot-desktop.png" alt="Desktop Screenshot (1280x800)" />
      </div>
      <div class="preview-box">
        <h3 style="margin-top: 0; color: #38bdf8;">📱 모바일 뷰포트 (375 × 667)</h3>
        <img src="screenshot-mobile.png" alt="Mobile Screenshot (375x667)" />
      </div>
    </div>
  </div>

  <div class="card">
    <h2>🔍 WCAG 2.2 AA 접근성 및 명암비 상세 진단 내역</h2>
    ${
      res.accessibility.issues.length === 0
        ? `<div style="padding: 16px; background: rgba(16, 185, 129, 0.1); color: #34d399; border-radius: 8px;">✓ 발견된 접근성 결함이 없습니다. WCAG 2.2 AA 명암비 및 접근성 표준을 완벽히 통과했습니다.</div>`
        : `<table>
            <thead>
              <tr>
                <th style="width: 100px;">심각도</th>
                <th style="width: 130px;">규칙 분류</th>
                <th style="width: 180px;">대상 요소</th>
                <th>상세 설명 및 조치 권고사항</th>
              </tr>
            </thead>
            <tbody>
              ${issueRows}
            </tbody>
          </table>`
    }
  </div>
</body>
</html>`;
}

/**
 * Executes a single-run Playwright Visual & Accessibility Audit:
 * - Desktop (1280x800) screenshot
 * - Mobile (375x667) screenshot
 * - In-browser WCAG 2.2 AA contrast and accessibility verification
 * - Generates artifacts in evidence/<stamp>-<card>/ directory
 */
export async function runPlaywrightVisualAudit(
  options: PlaywrightVisualAuditOptions = {}
): Promise<PlaywrightVisualAuditResult> {
  const cwd = options.cwd ?? process.cwd();
  const card = options.card || "visual-audit";
  const contrastThreshold = options.contrastThreshold ?? 4.5;
  const minTouchTarget = options.minTouchTarget ?? 24;

  const targetDir = options.evidenceDir
    ? resolve(cwd, options.evidenceDir)
    : resolve(cwd, "evidence", `${localDateStamp()}-${card}`);

  mkdirSync(targetDir, { recursive: true });

  const desktopScreenshotPath = join(targetDir, "screenshot-desktop.png");
  const mobileScreenshotPath = join(targetDir, "screenshot-mobile.png");
  const reportHtmlPath = join(targetDir, "visual-audit-report.html");
  const reportJsonPath = join(targetDir, "visual-audit-report.json");

  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error(
      "Playwright가 설치되어 있지 않습니다: `npm i -D playwright && npx playwright install chromium`을 실행하세요."
    );
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const issues: AccessibilityAuditIssue[] = [];
  let contrastCheckedCount = 0;
  let contrastFailedCount = 0;

  try {
    // 1. Desktop Viewport (1280x800)
    const desktopVp = options.viewports?.desktop ?? { width: 1280, height: 800 };
    const desktopContext = await browser.newContext({
      viewport: desktopVp,
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopContext.newPage();

    if (options.html) {
      await desktopPage.setContent(options.html, { waitUntil: "domcontentloaded" });
    } else {
      const targetUrl = options.url || "http://localhost:3000";
      await desktopPage.goto(targetUrl, { waitUntil: "networkidle" });
    }

    await desktopPage.screenshot({ path: desktopScreenshotPath, fullPage: true });

    // In-browser WCAG 2.2 accessibility & contrast evaluation
    const a11yAudit: {
      issues: AccessibilityAuditIssue[];
      contrastChecked: number;
      contrastFailed: number;
    } = await desktopPage.evaluate(`
      ((cThreshold, tTarget) => {
        const foundIssues = [];

        const parseRgb = (colorStr) => {
          if (!colorStr) return null;
          const match = colorStr.match(/rgba?\\((\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([\\d.]+))?\\)/i);
          if (!match) return null;
          return {
            r: parseInt(match[1], 10),
            g: parseInt(match[2], 10),
            b: parseInt(match[3], 10),
            a: match[4] !== undefined ? parseFloat(match[4]) : 1,
          };
        };

        const getLuminance = (r, g, b) => {
          const a = [r, g, b].map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * (a[0] || 0) + 0.7152 * (a[1] || 0) + 0.0722 * (a[2] || 0);
        };

        const getContrast = (fg, bg) => {
          const l1 = getLuminance(fg.r, fg.g, fg.b);
          const l2 = getLuminance(bg.r, bg.g, bg.b);
          const lighter = Math.max(l1, l2);
          const darker = Math.min(l1, l2);
          return (lighter + 0.05) / (darker + 0.05);
        };

        const getEffectiveBgColor = (el) => {
          let curr = el;
          while (curr && curr !== document.documentElement) {
            const style = window.getComputedStyle(curr);
            const bg = parseRgb(style.backgroundColor);
            if (bg && bg.a > 0.1) return bg;
            curr = curr.parentElement;
          }
          return { r: 255, g: 255, b: 255, a: 1 };
        };

        // 1. Contrast Check
        let contrastChecked = 0;
        let contrastFailed = 0;
        const textElements = document.querySelectorAll(
          "p, span, h1, h2, h3, h4, h5, h6, label, a, button, li, td, th"
        );

        for (const el of Array.from(textElements)) {
          const text = el.innerText?.trim();
          if (!text) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const style = window.getComputedStyle(el);
          const fg = parseRgb(style.color);
          const bg = getEffectiveBgColor(el);
          if (!fg) continue;

          contrastChecked++;
          const ratio = Math.round(getContrast(fg, bg) * 100) / 100;
          const fontSize = parseFloat(style.fontSize) || 16;
          const isBold = parseInt(style.fontWeight, 10) >= 700 || style.fontWeight === "bold";
          const isLarge = fontSize >= 24 || (fontSize >= 18.66 && isBold);
          const requiredThreshold = isLarge ? 3.0 : cThreshold;

          if (ratio < requiredThreshold) {
            contrastFailed++;
            foundIssues.push({
              type: "contrast",
              severity: ratio < 3.0 ? "critical" : "serious",
              element: "<" + el.tagName.toLowerCase() + ">",
              selector: el.className ? "." + el.className.split(" ")[0] : el.tagName.toLowerCase(),
              message: "명암비 미달: 현재 " + ratio + ":1 (WCAG 2.2 AA 기준 " + requiredThreshold + ":1 이상 필요). 텍스트: \\"" + text.slice(0, 30) + "\\"",
            });
          }
        }

        // 2. Missing Alt on <img>
        const images = document.querySelectorAll("img");
        for (const img of Array.from(images)) {
          if (!img.hasAttribute("alt")) {
            foundIssues.push({
              type: "alt",
              severity: "critical",
              element: "<img>",
              message: "이미지 태그에 'alt' 대체 텍스트가 누락되었습니다. src: " + (img.getAttribute("src") || "unknown"),
            });
          }
        }

        // 3. Accessible Button Name
        const buttons = document.querySelectorAll("button");
        for (const btn of Array.from(buttons)) {
          const hasLabel = btn.getAttribute("aria-label") || btn.getAttribute("aria-labelledby");
          const text = btn.innerText?.trim();
          if (!hasLabel && !text) {
            foundIssues.push({
              type: "button-label",
              severity: "critical",
              element: "<button>",
              message: "버튼에 접근 가능한 이름(텍스트 또는 aria-label)이 누락되었습니다.",
            });
          }
        }

        // 4. Accessible Input Label
        const inputs = document.querySelectorAll('input:not([type="hidden"])');
        for (const input of Array.from(inputs)) {
          const hasLabel = input.id || input.getAttribute("aria-label") || input.getAttribute("aria-labelledby") || input.getAttribute("placeholder");
          if (!hasLabel) {
            foundIssues.push({
              type: "input-label",
              severity: "critical",
              element: "<input>",
              message: "입력 필드에 라벨(id, aria-label, aria-labelledby)이 누락되었습니다.",
            });
          }
        }

        // 5. Touch Target Size (WCAG 2.2 2.5.8 Target Size Minimum >= 24px)
        const interactives = document.querySelectorAll("button, a, input, select");
        for (const el of Array.from(interactives)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && (rect.width < tTarget || rect.height < tTarget)) {
            foundIssues.push({
              type: "touch-target",
              severity: "serious",
              element: "<" + el.tagName.toLowerCase() + ">",
              message: "터치 타겟 크기 부족: " + Math.round(rect.width) + "×" + Math.round(rect.height) + "px (WCAG 2.2 최소 권장: " + tTarget + "px 이상)",
            });
          }
        }

        return {
          issues: foundIssues,
          contrastChecked,
          contrastFailed,
        };
      })(${contrastThreshold}, ${minTouchTarget})
    `);

    issues.push(...a11yAudit.issues);
    contrastCheckedCount = a11yAudit.contrastChecked;
    contrastFailedCount = a11yAudit.contrastFailed;
    await desktopContext.close();

    // 2. Mobile Viewport (375x667)
    const mobileVp = options.viewports?.mobile ?? { width: 375, height: 667 };
    const mobileContext = await browser.newContext({
      viewport: mobileVp,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const mobilePage = await mobileContext.newPage();

    if (options.html) {
      await mobilePage.setContent(options.html, { waitUntil: "domcontentloaded" });
    } else {
      const targetUrl = options.url || "http://localhost:3000";
      await mobilePage.goto(targetUrl, { waitUntil: "networkidle" });
    }

    await mobilePage.screenshot({ path: mobileScreenshotPath, fullPage: true });
    await mobileContext.close();
  } finally {
    await browser.close();
  }

  // Score Calculation
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const seriousCount = issues.filter((i) => i.severity === "serious").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  const penalty = criticalCount * 25 + seriousCount * 10 + warningCount * 5;
  const score = Math.max(0, 100 - penalty);
  const passed = criticalCount === 0 && seriousCount === 0 && score >= 80;

  const result: PlaywrightVisualAuditResult = {
    passed,
    score,
    url: options.url,
    evidenceDir: targetDir,
    screenshots: {
      desktop: desktopScreenshotPath,
      mobile: mobileScreenshotPath,
    },
    accessibility: {
      passed: criticalCount === 0 && seriousCount === 0,
      wcagLevel: "2.2 AA",
      totalIssues: issues.length,
      issues,
      contrastAudit: {
        checkedCount: contrastCheckedCount,
        failedCount: contrastFailedCount,
      },
    },
    reportHtmlPath,
    reportJsonPath,
  };

  // Generate artifacts in evidence/
  writeFileSync(reportJsonPath, JSON.stringify(result, null, 2), "utf8");
  const htmlContent = generatePlaywrightHtmlReport(result, card);
  writeFileSync(reportHtmlPath, htmlContent, "utf8");

  return result;
}

export function runVisualAuditGateCli(argv = process.argv.slice(2)): number | Promise<number> {
  const isPlaywright = argv.includes("--playwright") || argv.some((a) => a.startsWith("--url"));

  if (isPlaywright) {
    let url: string | undefined;
    let card: string | undefined;

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!;
      if (arg === "--url" && i + 1 < argv.length) url = argv[++i];
      else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
      else if (arg === "--card" && i + 1 < argv.length) card = argv[++i];
      else if (arg.startsWith("--card=")) card = arg.slice("--card=".length);
    }

    return (async () => {
      try {
        console.log(`\n[HEALTH GATE: PLAYWRIGHT VISUAL & WCAG 2.2 AUDIT] 시작 (${url || "http://localhost:3000"})...`);
        const res = await runPlaywrightVisualAudit({ url, card });
        console.log(`- 결과: ${res.passed ? "✓ PASS" : "❌ FAIL"}`);
        console.log(`- 종합 건강 점수: ${res.score}/100 (WCAG 2.2 AA)`);
        console.log(`- 스크린샷 데스크톱: ${res.screenshots.desktop}`);
        console.log(`- 스크린샷 모바일: ${res.screenshots.mobile}`);
        console.log(`- HTML 보고서: ${res.reportHtmlPath}`);
        return res.passed ? 0 : 1;
      } catch (err) {
        console.error(`[PLAYWRIGHT AUDIT ERROR] ${(err as Error).message}`);
        return 1;
      }
    })();
  }

  let inputPath: string | undefined;
  let card: string | undefined;
  let maxErrors = 0;
  let jsonOutput = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--input" && i + 1 < argv.length) {
      inputPath = argv[++i];
    } else if (arg.startsWith("--input=")) {
      inputPath = arg.slice("--input=".length);
    } else if (arg === "--card" && i + 1 < argv.length) {
      card = argv[++i];
    } else if (arg.startsWith("--card=")) {
      card = arg.slice("--card=".length);
    } else if (arg === "--max-errors" && i + 1 < argv.length) {
      maxErrors = parseInt(argv[++i]!, 10) || 0;
    } else if (arg.startsWith("--max-errors=")) {
      maxErrors = parseInt(arg.slice("--max-errors=".length), 10) || 0;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (!arg.startsWith("-") && !inputPath) {
      inputPath = arg;
    }
  }

  const res = runVisualAuditGate({
    inputPath,
    card,
    maxErrors,
  });

  if (jsonOutput) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log("\n[HEALTH GATE: VISUAL GRID INSPECTION]");
    console.log(`- 결과: ${res.passed ? "✓ PASS" : "❌ FAIL"}`);
    console.log(`- 종합 점수: ${res.result.summary.score}/100`);
    console.log(`- 총 결함: ${res.result.summary.totalViolations}건 (허용 기준: ${maxErrors}건)`);
    if (res.htmlPath) {
      console.log(`- HTML 증거: ${res.htmlPath}`);
    }
    if (res.jsonPath) {
      console.log(`- JSON 요약: ${res.jsonPath}`);
    }
  }

  return res.passed ? 0 : 1;
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
  const result = runVisualAuditGateCli();
  if (result instanceof Promise) {
    result.then((code) => { process.exit(code); });
  } else {
    process.exitCode = result;
  }
}
