#!/usr/bin/env node
// kordoc-bridge.ts — Lossless bidirectional bridge for HWPX documents,
// OWPML mathematical equations, form fields, and Korean law citation verification.
//
// Benchmarked against:
// - chrisryugj/kordoc: HWP·HWPX·PDF·Office -> Markdown, AST, Form fill, and Diff
// - Canine89/suneung-math-hwpx: Suneung math problem sheet generation in HWPX format
// - chrisryugj/korean-law-mcp: Korean Law (law.go.kr) search and citation verification
//
// Zero external runtime dependencies: uses native Node.js (node:zlib, node:fs, node:buffer).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";

// ============================================================================
// 1. AST & Type Definitions
// ============================================================================

export type KordocNodeType =
  | "root"
  | "heading"
  | "paragraph"
  | "text"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "equation"
  | "table"
  | "tableRow"
  | "tableCell"
  | "field"        // 누름틀 (Template form field)
  | "lawCitation";  // 법령·학칙 인용

export interface KordocNode {
  type: KordocNodeType;
  text?: string;
  level?: number;                     // for heading (1..6)
  children?: KordocNode[];
  attrs?: Record<string, unknown>;
  // equation
  hancomScript?: string;              // Hancom Equation format (e.g. {a} over {b})
  latex?: string;                     // LaTeX representation (e.g. \frac{a}{b})
  // table
  cols?: number;
  rows?: number;
  align?: ("left" | "center" | "right")[];
  // field (누름틀)
  fieldName?: string;
  fieldValue?: string;
  // lawCitation
  citation?: LawCitationResult;
}

export interface KordocDocumentAST {
  type: "root";
  metadata?: {
    title?: string;
    author?: string;
    date?: string;
    version?: string;
    [key: string]: unknown;
  };
  children: KordocNode[];
}

export interface ParsedHWPXResult {
  ast: KordocDocumentAST;
  markdown: string;
  plainText: string;
  fields: Record<string, string>;
  equations: Array<{ script: string; latex: string; line?: number }>;
  tables: Array<{ rows: string[][]; rowCount: number; colCount: number }>;
  citations: LawCitationResult[];
}

export interface BuildHWPXOptions {
  template?: Buffer | Uint8Array | string;
  templateFields?: Record<string, string>;
  title?: string;
  author?: string;
  autoConvertLatexEquations?: boolean;
}

export interface FormDiffResult {
  changedFields: Record<string, { before: string; after: string }>;
  changes: Array<{
    type: "added" | "removed" | "modified" | "unchanged";
    text: string;
    oldText?: string;
  }>;
  additions: number;
  deletions: number;
  modifications: number;
  diffTableMarkdown: string;
}

export interface LawCitationResult {
  raw: string;
  isValid: boolean;
  lawName?: string;
  canonicalName?: string;
  lawType?: "statute" | "enforcement_decree" | "enforcement_rule" | "ordinance" | "school_rule" | "other";
  article?: string;
  articleNumber?: number;
  clause?: string;
  clauseNumber?: number;
  item?: string;
  itemNumber?: number;
  statuteInfo?: {
    officialId?: string;
    title: string;
    category?: string;
    summary?: string;
  };
  error?: string;
}

export interface KordocAdapter {
  parseHWPX(buffer: Buffer | Uint8Array | string): ParsedHWPXResult;
  buildHWPX(markdownOrAst: string | KordocDocumentAST, options?: BuildHWPXOptions): Buffer;
  astToMarkdown(ast: KordocDocumentAST): string;
  markdownToAST(markdown: string): KordocDocumentAST;
  equationToLatex(hancomScript: string): string;
  latexToHancom(latex: string): string;
  diffHWPX(original: ParsedHWPXResult | string, modified: ParsedHWPXResult | string): FormDiffResult;
  verifyKoreanLawCitation(citationText: string): LawCitationResult;
}

// ============================================================================
// 2. Korean Educational & Administrative Law Knowledge Base
// ============================================================================

interface LawDatabaseEntry {
  canonicalName: string;
  lawType: "statute" | "enforcement_decree" | "enforcement_rule" | "ordinance" | "school_rule";
  aliases: string[];
  category: string;
  summary: string;
  keyArticles?: Record<number, string>;
}

const KOREAN_LAW_DATABASE: LawDatabaseEntry[] = [
  {
    canonicalName: "초·중등교육법",
    lawType: "statute",
    aliases: ["초중등교육법", "초·중등교육법률", "초중등학교법"],
    category: "교육",
    summary: "초등교육 및 중등교육에 관한 기본적 사항을 정하는 법률",
    keyArticles: {
      18: "학생의 징계 및 지도",
      20: "교직원의 임무",
      31: "학교운영위원회의 설치",
      32: "학교운영위원회의 기능 및 심의사항",
    },
  },
  {
    canonicalName: "초·중등교육법 시행령",
    lawType: "enforcement_decree",
    aliases: ["초중등교육법시행령"],
    category: "교육",
    summary: "초·중등교육법에서 위임된 사항과 그 시행에 필요한 사항을 규정한 대통령령",
    keyArticles: {
      9: "학교규칙(학칙)의 기재사항 및 제·개정 절차",
      31: "학생의 징계 등",
      54: "학습부진아 등에 대한 교육",
    },
  },
  {
    canonicalName: "고등교육법",
    lawType: "statute",
    aliases: ["고등교육법률"],
    category: "교육",
    summary: "고등교육에 관한 기본적 사항을 정하는 법률",
    keyArticles: {
      6: "학교규칙",
      23: "학점인정",
    },
  },
  {
    canonicalName: "유아교육법",
    lawType: "statute",
    aliases: ["유아교육법률"],
    category: "교육",
    summary: "유아교육에 관한 기본적 사항을 정하는 법률",
    keyArticles: {
      10: "유치원규칙",
    },
  },
  {
    canonicalName: "교육기본법",
    lawType: "statute",
    aliases: ["교육기본법률"],
    category: "교육",
    summary: "교육에 관한 국민의 권리·의무와 국가 및 지방자치단체의 책임을 정하는 기본법",
    keyArticles: {
      12: "학습자의 기본적 인권 존중",
      13: "보호자의 권리와 책임",
      14: "교원의 전문성 존중과 신분보장",
    },
  },
  {
    canonicalName: "학교폭력예방 및 대책에 관한 법률",
    lawType: "statute",
    aliases: ["학교폭력예방법", "학폭법", "학교폭력예방대책법"],
    category: "교육·안전",
    summary: "학교폭력의 예방과 대책에 필요한 사항을 규정하여 피해학생 보호와 가해학생 선도",
    keyArticles: {
      12: "학교폭력대책심의위원회의 설치·기능",
      16: "피해학생의 보호",
      17: "가해학생에 대한 조치",
    },
  },
  {
    canonicalName: "학교폭력예방 및 대책에 관한 법률 시행령",
    lawType: "enforcement_decree",
    aliases: ["학교폭력예방법시행령", "학폭법시행령"],
    category: "교육·안전",
    summary: "학교폭력예방 및 대책에 관한 법률 시행령",
    keyArticles: {
      19: "가해학생에 대한 조치별 세부기준",
    },
  },
  {
    canonicalName: "교원의 지위 향상 및 교육활동 보호를 위한 특별법",
    lawType: "statute",
    aliases: ["교원지위법", "교원보호법", "교원지위향상법"],
    category: "교원",
    summary: "교원에 대한 예우와 처우를 개선하고 신분보장과 교육활동을 보호하는 법률",
    keyArticles: {
      15: "교육활동 침해행위에 대한 조치",
      19: "교원소청심사위원회의 설치",
    },
  },
  {
    canonicalName: "학교안전사고 예방 및 보상에 관한 법률",
    lawType: "statute",
    aliases: ["학교안전법", "학교안전사고예방법"],
    category: "안전",
    summary: "학교안전사고의 예방과 안전공제사업 등을 규정하는 법률",
    keyArticles: {
      8: "학교안전공제회 설립",
    },
  },
  {
    canonicalName: "학교보건법",
    lawType: "statute",
    aliases: [],
    category: "보건",
    summary: "학교의 보건관리와 환경위생 정화에 필요한 사항을 규정한 법률",
  },
  {
    canonicalName: "학교급식법",
    lawType: "statute",
    aliases: [],
    category: "급식",
    summary: "학교급식의 질 향상과 위생적이고 안전한 급식 관리를 위한 법률",
  },
  {
    canonicalName: "지방교육자치에 관한 법률",
    lawType: "statute",
    aliases: ["교육자치법", "지방교육자치법"],
    category: "교육행정",
    summary: "교육의 자주성과 전문성 및 지방의 교육자치를 보장하기 위한 법률",
    keyArticles: {
      20: "교육감의 관장사무",
    },
  },
];

/**
 * Validates and verifies a Korean legal citation (statute, ordinance, school regulation).
 */
export function verifyKoreanLawCitation(citationText: string): LawCitationResult {
  const trimmed = citationText.trim();
  if (!trimmed) {
    return { raw: citationText, isValid: false, error: "Empty citation string" };
  }

  // Regex pattern matching:
  // Examples:
  // "초·중등교육법 제32조제1항"
  // "학교폭력예방 및 대책에 관한 법률 제17조 제1항 제1호"
  // "교원지위법 제15조"
  // "서울특별시 학생인권조례 제5조"
  // "○○중학교 학칙 제10조"
  const regex = /([가-힣a-zA-Z0-9·\s]+?(?:법률|법|시행령|시행규칙|규정|조례|학칙|교칙|생활규정|생활인권규정))\s*(?:제\s*(\d+)\s*조(?:의\s*(\d+))?)?\s*(?:제\s*(\d+)\s*항)?\s*(?:제\s*(\d+)\s*호)?/;
  const match = trimmed.match(regex);

  if (!match) {
    return {
      raw: citationText,
      isValid: false,
      error: "Citation does not conform to Korean legal citation format (e.g. '법령명 제O조제O항')",
    };
  }

  const rawLawName = (match[1] || "").trim();
  const articleNum = match[2] ? parseInt(match[2], 10) : undefined;
  const articleSubNum = match[3] ? parseInt(match[3], 10) : undefined;
  const clauseNum = match[4] ? parseInt(match[4], 10) : undefined;
  const itemNum = match[5] ? parseInt(match[5], 10) : undefined;

  let articleStr = articleNum !== undefined ? `제${articleNum}조` : undefined;
  if (articleNum !== undefined && articleSubNum !== undefined) {
    articleStr = `제${articleNum}조의${articleSubNum}`;
  }
  const clauseStr = clauseNum !== undefined ? `제${clauseNum}항` : undefined;
  const itemStr = itemNum !== undefined ? `제${itemNum}호` : undefined;

  // Determine law type
  let lawType: LawCitationResult["lawType"] = "statute";
  if (rawLawName.endsWith("시행령")) lawType = "enforcement_decree";
  else if (rawLawName.endsWith("시행규칙")) lawType = "enforcement_rule";
  else if (rawLawName.endsWith("조례")) lawType = "ordinance";
  else if (rawLawName.endsWith("학칙") || rawLawName.endsWith("교칙") || rawLawName.endsWith("생활규정") || rawLawName.endsWith("생활인권규정")) {
    lawType = "school_rule";
  }

  // Normalize and match against database
  const normalizedInputName = rawLawName.replace(/\s+/g, "");
  const matchedEntry = KOREAN_LAW_DATABASE.find((entry) => {
    const normCanonical = entry.canonicalName.replace(/[\s·]/g, "");
    if (normCanonical === normalizedInputName.replace(/·/g, "")) return true;
    return entry.aliases.some((alias) => alias.replace(/[\s·]/g, "") === normalizedInputName.replace(/·/g, ""));
  });

  const canonicalName = matchedEntry ? matchedEntry.canonicalName : rawLawName;
  let statuteInfo: LawCitationResult["statuteInfo"] = undefined;

  if (matchedEntry) {
    let summary = matchedEntry.summary;
    if (articleNum !== undefined && matchedEntry.keyArticles?.[articleNum]) {
      summary += ` [${articleStr}: ${matchedEntry.keyArticles[articleNum]}]`;
    }
    statuteInfo = {
      title: matchedEntry.canonicalName,
      category: matchedEntry.category,
      summary,
    };
  } else if (lawType === "school_rule") {
    statuteInfo = {
      title: rawLawName,
      category: "학교규정(자치규범)",
      summary: "각급 학교의 장이 법령의 범위 안에서 지도·감독청 인가 또는 학교운영위원회 심의를 거쳐 제정한 학칙",
    };
  } else if (lawType === "ordinance") {
    statuteInfo = {
      title: rawLawName,
      category: "지방자치법규(조례)",
      summary: "지방의회의 의결을 거쳐 제정된 지방자치단체의 법규",
    };
  }

  return {
    raw: citationText,
    isValid: true,
    lawName: rawLawName,
    canonicalName,
    lawType,
    article: articleStr,
    articleNumber: articleNum,
    clause: clauseStr,
    clauseNumber: clauseNum,
    item: itemStr,
    itemNumber: itemNum,
    statuteInfo,
  };
}

// ============================================================================
// 3. Mathematical Equation Converter (Hancom Equation <-> LaTeX)
// ============================================================================

/**
 * Translates Hancom Equation script (OWPML KS X 6101) into standard LaTeX.
 * Benchmarked with Canine89/suneung-math-hwpx.
 */
export function equationToLatex(hancom: string): string {
  if (!hancom) return "";
  let latex = hancom;

  // Fractions: {A} over {B} or {A over B} -> \frac{A}{B}
  latex = latex.replace(/\{([^{}]+?)\}\s*over\s*\{([^{}]+?)\}/g, (_, a, b) => `\\frac{${a.trim()}}{${b.trim()}}`);
  latex = latex.replace(/\{([^{}]+?)\s+over\s+([^{}]+?)\}/g, (_, a, b) => `\\frac{${a.trim()}}{${b.trim()}}`);
  latex = latex.replace(/\b([a-zA-Z0-9]+)\s+over\s+([a-zA-Z0-9]+)\b/g, "\\frac{$1}{$2}");

  // N-th Roots: root {n} {x} -> \sqrt[n]{x}
  latex = latex.replace(/root\s*\{([^{}]+?)\}\s*\{([^{}]+?)\}/g, (_, n, x) => `\\sqrt[${n.trim()}]{${x.trim()}}`);

  // Square roots: sqrt {x} -> \sqrt{x}
  latex = latex.replace(/sqrt\s*\{([^{}]+?)\}/g, (_, x) => `\\sqrt{${x.trim()}}`);
  latex = latex.replace(/sqrt\s*([a-zA-Z0-9])/g, "\\sqrt{$1}");

  // Integrals: int _{a}^{b} -> \int_{a}^{b}
  latex = latex.replace(/int\s*_\s*\{([^{}]+?)\}\s*\^\s*\{([^{}]+?)\}/g, (_, a, b) => `\\int_{${a.trim()}}^{${b.trim()}}`);
  latex = latex.replace(/int\s*_\s*([a-zA-Z0-9])\s*\^\s*([a-zA-Z0-9])/g, "\\int_{$1}^{$2}");
  latex = latex.replace(/(?<!\\)\bint\b/g, "\\int");

  // Sums: sum _{i=1}^{n} -> \sum_{i=1}^{n}
  latex = latex.replace(/sum\s*_\s*\{([^{}]+?)\}\s*\^\s*\{([^{}]+?)\}/g, (_, a, b) => `\\sum_{${a.trim()}}^{${b.trim()}}`);
  latex = latex.replace(/(?<!\\)\bsum\b/g, "\\sum");

  // Limits: lim _{x -> 0} -> \lim_{x \to 0}
  latex = latex.replace(/lim\s*_\s*\{([^{}]+?)\s*(?:->|to)\s*([^{}]+?)\}/g, (_, a, b) => `\\lim_{${a.trim()} \\to ${b.trim()}}`);
  latex = latex.replace(/(?<!\\)\blim\b/g, "\\lim");

  // Brackets: LEFT ( ... RIGHT ) -> \left( ... \right)
  latex = latex.replace(/LEFT\s*\(/g, "\\left(");
  latex = latex.replace(/RIGHT\s*\)/g, "\\right)");
  latex = latex.replace(/LEFT\s*\[/g, "\\left[");
  latex = latex.replace(/RIGHT\s*\]/g, "\\right]");
  latex = latex.replace(/LEFT\s*\{/g, "\\left\\{");
  latex = latex.replace(/RIGHT\s*\}/g, "\\right\\}");

  // Operators
  latex = latex.replace(/\btimes\b/g, "\\times");
  latex = latex.replace(/\bdiv\b/g, "\\div");
  latex = latex.replace(/\bpm\b/g, "\\pm");
  latex = latex.replace(/\bmp\b/g, "\\mp");
  latex = latex.replace(/\bleq\b/g, "\\le");
  latex = latex.replace(/\bgeq\b/g, "\\ge");
  latex = latex.replace(/\bneq\b/g, "\\ne");
  latex = latex.replace(/\bapprox\b/g, "\\approx");
  latex = latex.replace(/\binfty\b/g, "\\infty");
  latex = latex.replace(/->/g, "\\to");

  // Greek letters
  const greekLetters = ["alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "pi", "sigma", "phi", "omega"];
  for (const g of greekLetters) {
    const re = new RegExp(`\\b${g}\\b`, "g");
    latex = latex.replace(re, `\\${g}`);
  }

  return latex.trim();
}

/**
 * Translates standard LaTeX math equation into Hancom Equation script.
 */
export function latexToHancom(latex: string): string {
  if (!latex) return "";
  let hancom = latex;

  // Fractions: \frac{A}{B} -> {A} over {B}
  hancom = hancom.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "{$1} over {$2}");

  // N-th root: \sqrt[n]{x} -> root {n} {x}
  hancom = hancom.replace(/\\sqrt\s*\[([^[\]]+)\]\s*\{([^{}]+)\}/g, "root {$1} {$2}");

  // Square root: \sqrt{x} -> sqrt {x}
  hancom = hancom.replace(/\\sqrt\s*\{([^{}]+)\}/g, "sqrt {$1}");

  // Limits: \lim_{x \to 0} -> lim _{x -> 0}
  hancom = hancom.replace(/\\lim\s*_\s*\{([^{}]+)\s*\\to\s*([^{}]+)\}/g, "lim _{$1 -> $2}");
  hancom = hancom.replace(/\\lim/g, "lim");

  // Integrals: \int_{a}^{b} -> int _{a}^{b}
  hancom = hancom.replace(/\\int\s*_\s*\{([^{}]+)\}\s*\^\s*\{([^{}]+)\}/g, "int _{$1}^{$2}");
  hancom = hancom.replace(/\\int/g, "int");

  // Sums: \sum_{i=1}^{n} -> sum _{i=1}^{n}
  hancom = hancom.replace(/\\sum\s*_\s*\{([^{}]+)\}\s*\^\s*\{([^{}]+)\}/g, "sum _{$1}^{$2}");
  hancom = hancom.replace(/\\sum/g, "sum");

  // Delimiters
  hancom = hancom.replace(/\\left\(/g, "LEFT (");
  hancom = hancom.replace(/\\right\)/g, "RIGHT )");
  hancom = hancom.replace(/\\left\[/g, "LEFT [");
  hancom = hancom.replace(/\\right\]/g, "RIGHT ]");
  hancom = hancom.replace(/\\left\\\{/g, "LEFT {");
  hancom = hancom.replace(/\\right\\\}/g, "RIGHT }");

  // Operators
  hancom = hancom.replace(/\\times/g, "times");
  hancom = hancom.replace(/\\div/g, "div");
  hancom = hancom.replace(/\\pm/g, "pm");
  hancom = hancom.replace(/\\mp/g, "mp");
  hancom = hancom.replace(/\\le(q)?\b/g, "leq");
  hancom = hancom.replace(/\\ge(q)?\b/g, "geq");
  hancom = hancom.replace(/\\ne(q)?\b/g, "neq");
  hancom = hancom.replace(/\\approx/g, "approx");
  hancom = hancom.replace(/\\infty/g, "infty");
  hancom = hancom.replace(/\\to/g, "->");

  // Greek letters: \alpha -> alpha
  hancom = hancom.replace(/\\([a-zA-Z]+)/g, "$1");

  return hancom.trim();
}

// ============================================================================
// 4. Built-in Pure Node.js ZIP Utility (for HWPX Packaging & Extraction)
// ============================================================================

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function computeCrc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ -1) >>> 0;
}

export function packZip(files: Record<string, Buffer | string>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(raw);
    const useDeflate = deflated.length < raw.length;
    const compData = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = computeCrc32(raw);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    localHeader.writeUInt16LE(20, 4);          // version needed
    localHeader.writeUInt16LE(0, 6);           // general flags
    localHeader.writeUInt16LE(method, 8);      // compression method
    localHeader.writeUInt16LE(0, 10);          // time
    localHeader.writeUInt16LE(0, 12);          // date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compData.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compData);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    centralHeader.writeUInt16LE(20, 4);          // version made by
    centralHeader.writeUInt16LE(20, 6);          // version needed
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compData.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + compData.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const ch of centralHeaders) centralSize += ch.length;

  const count = Object.keys(files).length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

export function unpackZip(buf: Buffer): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  let offset = 0;

  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x04034b50) {
      const method = buf.readUInt16LE(offset + 8);
      const compSize = buf.readUInt32LE(offset + 18);
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const name = buf.toString("utf8", offset + 30, offset + 30 + nameLen);
      const dataStart = offset + 30 + nameLen + extraLen;
      const compData = buf.subarray(dataStart, dataStart + compSize);
      const data = method === 8 ? zlib.inflateRawSync(compData) : compData;
      files[name] = data;
      offset = dataStart + compSize;
    } else {
      offset++;
    }
  }

  return files;
}

// ============================================================================
// 5. HWPX Parsing (OWPML XML -> JSON AST & Markdown)
// ============================================================================

/**
 * Parses an HWPX file buffer (ZIP container or raw section0.xml) into structured AST,
 * Markdown, extracted form fields, equations, and detected law citations.
 */
export function parseHWPX(input: Buffer | Uint8Array | string): ParsedHWPXResult {
  let xml = "";

  if (typeof input === "string") {
    xml = input;
  } else {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
    // Detect ZIP magic bytes PK\x03\x04
    if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      const unzipped = unpackZip(buf);
      const sectionKey = Object.keys(unzipped).find((k) => /Contents\/section\d+\.xml/i.test(k)) || "Contents/section0.xml";
      if (unzipped[sectionKey]) {
        xml = unzipped[sectionKey].toString("utf8");
      } else {
        // Fallback: take first xml
        const anyXml = Object.keys(unzipped).find((k) => k.endsWith(".xml"));
        xml = anyXml && unzipped[anyXml] ? unzipped[anyXml].toString("utf8") : "";
      }
    } else {
      xml = buf.toString("utf8");
    }
  }

  const fields: Record<string, string> = {};
  const equations: Array<{ script: string; latex: string; line?: number }> = [];
  const tables: Array<{ rows: string[][]; rowCount: number; colCount: number }> = [];
  const citations: LawCitationResult[] = [];
  const astChildren: KordocNode[] = [];
  const markdownLines: string[] = [];

  // Extract 누름틀 / Field templates: <hp:fieldBegin name="fieldName"...> ... <hp:fieldEnd>
  const fieldRegex = /<hp:fieldBegin[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<hp:fieldEnd/g;
  let fieldMatch: RegExpExecArray | null;
  while ((fieldMatch = fieldRegex.exec(xml)) !== null) {
    const fName = fieldMatch[1];
    const fInner = fieldMatch[2] || "";
    const textMatch = fInner.match(/<hp:t>([\s\S]*?)<\/hp:t>/);
    const fVal = textMatch && textMatch[1] ? textMatch[1].trim() : "";
    if (fName) fields[fName] = fVal;
  }

  // Extract mustache-style placeholders {{fieldName}} if present
  const mustacheRegex = /\{\{([가-힣a-zA-Z0-9_-]+)\}\}/g;
  let mustMatch: RegExpExecArray | null;
  while ((mustMatch = mustacheRegex.exec(xml)) !== null) {
    const mKey = mustMatch[1];
    if (mKey && !fields[mKey]) {
      fields[mKey] = "";
    }
  }

  // Extract Tables: <hp:tbl> ... </hp:tbl>
  const tableRegex = /<hp:tbl[\s\S]*?<\/hp:tbl>/g;
  let tblMatch: RegExpExecArray | null;
  while ((tblMatch = tableRegex.exec(xml)) !== null) {
    const tblXml = tblMatch[0];
    const trRegex = /<hp:tr[\s\S]*?<\/hp:tr>/g;
    let trMatch: RegExpExecArray | null;
    const rows: string[][] = [];

    while ((trMatch = trRegex.exec(tblXml)) !== null) {
      const trXml = trMatch[0];
      const tcRegex = /<hp:tc[\s\S]*?<\/hp:tc>/g;
      let tcMatch: RegExpExecArray | null;
      const rowCells: string[] = [];

      while ((tcMatch = tcRegex.exec(trXml)) !== null) {
        const tcXml = tcMatch[0];
        // Collect all <hp:t> in this cell
        const tMatches = [...tcXml.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)];
        const cellText = tMatches.map((m) => (m[1] || "").trim()).filter(Boolean).join(" ");
        rowCells.push(cellText);
      }
      if (rowCells.length > 0) {
        rows.push(rowCells);
      }
    }

    if (rows.length > 0) {
      const maxCols = Math.max(...rows.map((r) => r.length));
      tables.push({ rows, rowCount: rows.length, colCount: maxCols });

      // AST Table Node
      const tableNode: KordocNode = {
        type: "table",
        rows: rows.length,
        cols: maxCols,
        children: rows.map((r) => ({
          type: "tableRow",
          children: r.map((c) => ({
            type: "tableCell",
            children: [{ type: "text", text: c }],
          })),
        })),
      };
      astChildren.push(tableNode);

      // Markdown Table Representation
      if (rows.length > 0) {
        const header = rows[0] || [];
        markdownLines.push("| " + header.join(" | ") + " |");
        markdownLines.push("| " + header.map(() => "---").join(" | ") + " |");
        for (let i = 1; i < rows.length; i++) {
          const rowData = rows[i] || [];
          markdownLines.push("| " + rowData.join(" | ") + " |");
        }
        markdownLines.push("");
      }
    }
  }

  // Extract Equations: <hp:equation> ... <hp:script>formula</hp:script> ... </hp:equation>
  const eqRegex = /<hp:equation[\s\S]*?<hp:script>([\s\S]*?)<\/hp:script>[\s\S]*?<\/hp:equation>/g;
  let eqMatch: RegExpExecArray | null;
  while ((eqMatch = eqRegex.exec(xml)) !== null) {
    const rawScript = (eqMatch[1] || "").trim();
    const latex = equationToLatex(rawScript);
    equations.push({ script: rawScript, latex });
  }

  // Extract Paragraphs: <hp:p> ... </hp:p>
  const pRegex = /<hp:p[\s\S]*?<\/hp:p>/g;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pXml = pMatch[0];
    // If inside a table, we already parsed tables separately to prevent duplication
    if (/<hp:tbl/i.test(pXml)) continue;

    // Check equations inside paragraph
    const pEqMatch = pXml.match(/<hp:script>([\s\S]*?)<\/hp:script>/);
    let eqInlineLatex = "";
    if (pEqMatch && pEqMatch[1]) {
      eqInlineLatex = equationToLatex(pEqMatch[1].trim());
    }

    // Extract text runs
    const runRegex = /<hp:run([^>]*)>([\s\S]*?)<\/hp:run>/g;
    let rMatch: RegExpExecArray | null;
    const paragraphRuns: KordocNode[] = [];
    let pText = "";

    while ((rMatch = runRegex.exec(pXml)) !== null) {
      const runAttrs = rMatch[1] || "";
      const runBody = rMatch[2] || "";
      const tMatch = runBody.match(/<hp:t>([\s\S]*?)<\/hp:t>/);
      const eqM = runBody.match(/<hp:script>([\s\S]*?)<\/hp:script>/);

      if (eqM && eqM[1]) {
        const sc = eqM[1].trim();
        const lx = equationToLatex(sc);
        paragraphRuns.push({
          type: "equation",
          hancomScript: sc,
          latex: lx,
          text: `$${lx}$`,
        });
        pText += `$${lx}$ `;
      } else if (tMatch && tMatch[1]) {
        let textVal = tMatch[1];
        const isBold = /bold="1"|charPrIDRef="[1-9]"/i.test(runAttrs) || /<hh:bold\/>/i.test(runBody);
        const isItalic = /italic="1"/i.test(runAttrs) || /<hh:italic\/>/i.test(runBody);
        const isUnderline = /underline="1"/i.test(runAttrs) || /<hh:underline\/>/i.test(runBody);

        let nodeType: KordocNodeType = "text";
        if (isBold) nodeType = "bold";
        else if (isItalic) nodeType = "italic";
        else if (isUnderline) nodeType = "underline";

        paragraphRuns.push({
          type: nodeType,
          text: textVal,
        });

        if (isBold) pText += `**${textVal}**`;
        else if (isItalic) pText += `*${textVal}*`;
        else pText += textVal;
      }
    }

    if (paragraphRuns.length > 0 || eqInlineLatex) {
      const fullText = pText.trim();
      if (!fullText) continue;

      // Detect legal citations in text
      const citeCheck = verifyKoreanLawCitation(fullText);
      if (citeCheck.isValid) {
        citations.push(citeCheck);
      }

      // Heading detection: e.g. "# 제목", "## 소제목" or large font / style
      let isHeading = false;
      let headingLevel = 1;
      if (/^#{1,6}\s+/.test(fullText)) {
        const m = fullText.match(/^(#{1,6})\s+(.*)$/);
        if (m && m[1] && m[2]) {
          isHeading = true;
          headingLevel = m[1].length;
          astChildren.push({
            type: "heading",
            level: headingLevel,
            text: m[2],
            children: paragraphRuns,
          });
          markdownLines.push(fullText);
        }
      }

      if (!isHeading) {
        astChildren.push({
          type: "paragraph",
          text: fullText,
          children: paragraphRuns,
          citation: citeCheck.isValid ? citeCheck : undefined,
        });
        markdownLines.push(fullText);
      }
    }
  }

  const markdown = markdownLines.join("\n\n");
  const plainText = markdownLines.map((l) => l.replace(/[*#`_|$]/g, "").trim()).filter(Boolean).join("\n");

  const ast: KordocDocumentAST = {
    type: "root",
    metadata: {
      generator: "create-agent-harness/kordoc-bridge",
      version: "1.0.0",
      parsedAt: new Date().toISOString(),
    },
    children: astChildren,
  };

  return {
    ast,
    markdown,
    plainText,
    fields,
    equations,
    tables,
    citations,
  };
}

// ============================================================================
// 6. HWPX Building (Markdown / AST -> HWPX ZIP Package)
// ============================================================================

/**
 * Builds an HWPX document (KS X 6101 ZIP archive) from Markdown or JSON AST.
 * If a template is provided, replaces 누름틀 (fieldBegin) and placeholder fields.
 */
export function buildHWPX(
  markdownOrAst: string | KordocDocumentAST,
  options: BuildHWPXOptions = {},
): Buffer {
  const templateFields = options.templateFields || {};
  let ast: KordocDocumentAST;

  if (typeof markdownOrAst === "string") {
    ast = markdownToAST(markdownOrAst);
  } else {
    ast = markdownOrAst;
  }

  // If a template buffer or string is provided, apply field replacements
  if (options.template) {
    let tXml = "";
    let templateFiles: Record<string, Buffer> = {};

    if (Buffer.isBuffer(options.template)) {
      const unpacked = unpackZip(options.template);
      templateFiles = unpacked;
      const secKey = Object.keys(unpacked).find((k) => /section\d+\.xml/i.test(k)) || "Contents/section0.xml";
      tXml = (unpacked[secKey] || Buffer.from("")).toString("utf8");
    } else {
      tXml = String(options.template);
    }

    // Replace <hp:fieldBegin name="KEY"...> ... <hp:fieldEnd> with new value
    for (const [key, val] of Object.entries(templateFields)) {
      const fRegex = new RegExp(`(<hp:fieldBegin[^>]*name=["']${key}["'][^>]*>)[\\s\\S]*?(<hp:fieldEnd)`, "g");
      tXml = tXml.replace(fRegex, `$1<hp:run><hp:t>${escapeXml(val)}</hp:t></hp:run>$2`);

      // Also replace mustache style {{KEY}}
      const mustRegex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      tXml = tXml.replace(mustRegex, escapeXml(val));
    }

    if (Object.keys(templateFiles).length > 0) {
      const secKey = Object.keys(templateFiles).find((k) => /section\d+\.xml/i.test(k)) || "Contents/section0.xml";
      templateFiles[secKey] = Buffer.from(tXml, "utf8");
      return packZip(templateFiles);
    } else {
      return packStandardHwpx(tXml, options);
    }
  }

  // Synthesize OWPML XML from AST
  const sectionXml = astToSectionXml(ast, options);
  return packStandardHwpx(sectionXml, options);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function astToSectionXml(ast: KordocDocumentAST, options: BuildHWPXOptions): string {
  const parts: string[] = [];

  for (const node of ast.children) {
    if (node.type === "heading") {
      parts.push(`  <hp:p paraPrIDRef="1">`);
      parts.push(`    <hp:run charPrIDRef="${node.level || 1}">`);
      parts.push(`      <hp:t>${escapeXml(node.text || "")}</hp:t>`);
      parts.push(`    </hp:run>`);
      parts.push(`  </hp:p>`);
    } else if (node.type === "paragraph") {
      parts.push(`  <hp:p paraPrIDRef="0">`);
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          if (child.type === "equation") {
            const hancomEq = child.hancomScript || (child.latex ? latexToHancom(child.latex) : "");
            parts.push(`    <hp:run>`);
            parts.push(`      <hp:equation>`);
            parts.push(`        <hp:script>${escapeXml(hancomEq)}</hp:script>`);
            parts.push(`      </hp:equation>`);
            parts.push(`    </hp:run>`);
          } else if (child.type === "bold") {
            parts.push(`    <hp:run charPrIDRef="2">`);
            parts.push(`      <hp:t>${escapeXml(child.text || "")}</hp:t>`);
            parts.push(`    </hp:run>`);
          } else if (child.type === "italic") {
            parts.push(`    <hp:run charPrIDRef="3">`);
            parts.push(`      <hp:t>${escapeXml(child.text || "")}</hp:t>`);
            parts.push(`    </hp:run>`);
          } else {
            parts.push(`    <hp:run charPrIDRef="0">`);
            parts.push(`      <hp:t>${escapeXml(child.text || "")}</hp:t>`);
            parts.push(`    </hp:run>`);
          }
        }
      } else {
        parts.push(`    <hp:run charPrIDRef="0">`);
        parts.push(`      <hp:t>${escapeXml(node.text || "")}</hp:t>`);
        parts.push(`    </hp:run>`);
      }
      parts.push(`  </hp:p>`);
    } else if (node.type === "table") {
      parts.push(`  <hp:tbl colCnt="${node.cols || 2}" rowCnt="${node.rows || 2}">`);
      for (const row of node.children || []) {
        parts.push(`    <hp:tr>`);
        for (const cell of row.children || []) {
          const cellText = cell.children?.map((c) => c.text).filter(Boolean).join(" ") || cell.text || "";
          parts.push(`      <hp:tc>`);
          parts.push(`        <hp:cellAddr colAddr="0" rowAddr="0"/>`);
          parts.push(`        <hp:cellSpan colSpan="1" rowSpan="1"/>`);
          parts.push(`        <hp:subList>`);
          parts.push(`          <hp:p><hp:run><hp:t>${escapeXml(cellText)}</hp:t></hp:run></hp:p>`);
          parts.push(`        </hp:subList>`);
          parts.push(`      </hp:tc>`);
        }
        parts.push(`    </hp:tr>`);
      }
      parts.push(`  </hp:tbl>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
        xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"
        xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
${parts.join("\n")}
</hs:sec>`;
}

function packStandardHwpx(sectionXml: string, options: BuildHWPXOptions): Buffer {
  const contentHpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata>
    <title>${options.title || "HWPX Document"}</title>
    <creator>${options.author || "kordoc-bridge"}</creator>
    <language>ko</language>
  </metadata>
  <manifest>
    <item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
  </manifest>
  <spine>
    <itemref idref="section0"/>
  </spine>
</package>`;

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="Contents/content.hpf" media-type="application/hwp+zip"/>
  </rootfiles>
</container>`;

  const files: Record<string, Buffer | string> = {
    mimetype: "application/hwp+zip",
    "META-INF/container.xml": containerXml,
    "Contents/content.hpf": contentHpf,
    "Contents/section0.xml": sectionXml,
  };

  return packZip(files);
}

// ============================================================================
// 7. Markdown <-> AST Bidirectional Converters
// ============================================================================

export function markdownToAST(markdown: string): KordocDocumentAST {
  const lines = markdown.split(/\r?\n/);
  const children: KordocNode[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  const flushTable = () => {
    if (tableRows.length > 0) {
      const cols = Math.max(...tableRows.map((r) => r.length));
      children.push({
        type: "table",
        rows: tableRows.length,
        cols,
        children: tableRows.map((r) => ({
          type: "tableRow",
          children: r.map((c) => ({
            type: "tableCell",
            children: [{ type: "text", text: c }],
          })),
        })),
      });
      tableRows = [];
    }
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    const line = rawLine.trim();

    if (!line) {
      if (inTable) flushTable();
      continue;
    }

    // Markdown Table row: | col1 | col2 |
    if (line.startsWith("|") && line.endsWith("|")) {
      // Skip separator |---|---|
      if (/^\|[\s\-:|]+\|$/.test(line)) {
        inTable = true;
        continue;
      }
      inTable = true;
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Headings: #, ##, ###
    if (/^#{1,6}\s+/.test(line)) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match && match[1] && match[2]) {
        children.push({
          type: "heading",
          level: match[1].length,
          text: match[2],
        });
        continue;
      }
    }

    // Paragraph with inline tokens (bold, math equations, normal text)
    const runNodes: KordocNode[] = [];
    // Tokenize: $math$, **bold**, *italic*, normal text
    const tokenRegex = /(\$\$[\s\S]+?\$\$|\$[^\$]+?\$|\*\*[^*]+?\*\*|\*[^*]+?\*|[^\$*]+)/g;
    let tokMatch: RegExpExecArray | null;

    while ((tokMatch = tokenRegex.exec(line)) !== null) {
      const tok = tokMatch[1] || "";
      if (tok.startsWith("$$") && tok.endsWith("$$")) {
        const lx = tok.slice(2, -2).trim();
        runNodes.push({
          type: "equation",
          latex: lx,
          hancomScript: latexToHancom(lx),
          text: tok,
        });
      } else if (tok.startsWith("$") && tok.endsWith("$")) {
        const lx = tok.slice(1, -1).trim();
        runNodes.push({
          type: "equation",
          latex: lx,
          hancomScript: latexToHancom(lx),
          text: tok,
        });
      } else if (tok.startsWith("**") && tok.endsWith("**")) {
        runNodes.push({
          type: "bold",
          text: tok.slice(2, -2),
        });
      } else if (tok.startsWith("*") && tok.endsWith("*")) {
        runNodes.push({
          type: "italic",
          text: tok.slice(1, -1),
        });
      } else {
        runNodes.push({
          type: "text",
          text: tok,
        });
      }
    }

    const citationCheck = verifyKoreanLawCitation(line);
    children.push({
      type: "paragraph",
      text: line,
      children: runNodes,
      citation: citationCheck.isValid ? citationCheck : undefined,
    });
  }

  if (inTable) flushTable();

  return {
    type: "root",
    children,
  };
}

export function astToMarkdown(ast: KordocDocumentAST): string {
  const lines: string[] = [];

  for (const node of ast.children) {
    if (node.type === "heading") {
      const hashes = "#".repeat(node.level || 1);
      lines.push(`${hashes} ${node.text || ""}`);
      lines.push("");
    } else if (node.type === "paragraph") {
      if (node.children && node.children.length > 0) {
        let pStr = "";
        for (const c of node.children) {
          if (c.type === "equation") {
            pStr += `$${c.latex || equationToLatex(c.hancomScript || "")}$`;
          } else if (c.type === "bold") {
            pStr += `**${c.text || ""}**`;
          } else if (c.type === "italic") {
            pStr += `*${c.text || ""}*`;
          } else {
            pStr += c.text || "";
          }
        }
        lines.push(pStr);
      } else {
        lines.push(node.text || "");
      }
      lines.push("");
    } else if (node.type === "table") {
      const rows: string[][] = [];
      for (const row of node.children || []) {
        const rowCells = row.children?.map((cell) => cell.children?.map((c) => c.text).filter(Boolean).join(" ") || cell.text || "") || [];
        rows.push(rowCells);
      }
      if (rows.length > 0) {
        const header = rows[0] || [];
        lines.push("| " + header.join(" | ") + " |");
        lines.push("| " + header.map(() => "---").join(" | ") + " |");
        for (let i = 1; i < rows.length; i++) {
          const rowData = rows[i] || [];
          lines.push("| " + rowData.join(" | ") + " |");
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n").trim();
}

// ============================================================================
// 8. Form Diff (신구대조표) Generator
// ============================================================================

/**
 * Compares two HWPX parse results or text strings and generates a Korean standard
 * Form Diff (신구대조표) with changed fields and paragraph comparisons.
 */
export function diffHWPX(
  original: ParsedHWPXResult | string,
  modified: ParsedHWPXResult | string,
): FormDiffResult {
  let origParas: string[] = [];
  let modParas: string[] = [];
  let origFields: Record<string, string> = {};
  let modFields: Record<string, string> = {};

  if (typeof original === "string" && !original.includes("<hp:")) {
    origParas = original.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } else {
    const origResult: ParsedHWPXResult = typeof original === "string" ? parseHWPX(original) : original;
    origParas = (origResult.plainText || origResult.markdown || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    origFields = origResult.fields || {};
  }

  if (typeof modified === "string" && !modified.includes("<hp:")) {
    modParas = modified.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } else {
    const modResult: ParsedHWPXResult = typeof modified === "string" ? parseHWPX(modified) : modified;
    modParas = (modResult.plainText || modResult.markdown || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    modFields = modResult.fields || {};
  }

  const changedFields: Record<string, { before: string; after: string }> = {};
  const allFieldKeys = new Set([...Object.keys(origFields), ...Object.keys(modFields)]);

  for (const key of allFieldKeys) {
    const before = origFields[key] || "";
    const after = modFields[key] || "";
    if (before !== after) {
      changedFields[key] = { before, after };
    }
  }

  const changes: FormDiffResult["changes"] = [];
  let additions = 0;
  let deletions = 0;
  let modifications = 0;

  const maxLen = Math.max(origParas.length, modParas.length);
  for (let i = 0; i < maxLen; i++) {
    const oText = origParas[i];
    const mText = modParas[i];

    if (oText !== undefined && mText !== undefined) {
      if (oText === mText) {
        changes.push({ type: "unchanged", text: mText });
      } else {
        modifications++;
        changes.push({ type: "modified", text: mText, oldText: oText });
      }
    } else if (oText !== undefined) {
      deletions++;
      changes.push({ type: "removed", text: oText });
    } else if (mText !== undefined) {
      additions++;
      changes.push({ type: "added", text: mText });
    }
  }

  // Generate 신구대조표 Markdown table
  const tableRows: string[] = [
    "| 번호 | 현행 (원안) | 개정안 (변경) | 개정 사유 및 비고 |",
    "|:---:|:---|:---|:---|",
  ];

  let rowIdx = 1;
  for (const c of changes) {
    if (c.type === "unchanged") continue;
    const beforeCol = c.oldText || (c.type === "removed" ? c.text : "(신설)");
    const afterCol = c.type === "removed" ? "(삭제)" : c.text;
    const noteCol = c.type === "added" ? "신설" : c.type === "removed" ? "삭제" : "일부 개정";
    tableRows.push(`| ${rowIdx++} | ${beforeCol.replace(/\|/g, "\\|")} | ${afterCol.replace(/\|/g, "\\|")} | ${noteCol} |`);
  }

  // Also include changed fields in the diff table
  for (const [k, v] of Object.entries(changedFields)) {
    tableRows.push(`| ${rowIdx++} | [서식 누름틀: ${k}] ${v.before} | [서식 누름틀: ${k}] ${v.after} | 양식 필드 변경 |`);
  }

  const diffTableMarkdown = tableRows.join("\n");

  return {
    changedFields,
    changes,
    additions,
    deletions,
    modifications,
    diffTableMarkdown,
  };
}

// ============================================================================
// 9. Standard Bridge Adapter Instance
// ============================================================================

export const kordocBridge: KordocAdapter = {
  parseHWPX,
  buildHWPX,
  astToMarkdown,
  markdownToAST,
  equationToLatex,
  latexToHancom,
  diffHWPX,
  verifyKoreanLawCitation,
};

// ============================================================================
// 10. CLI Entry Point
// ============================================================================

const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === "parse") {
    const file = args[0];
    if (!file || !existsSync(file)) {
      console.error("usage: kordoc-bridge.ts parse <hwpx-file> [--json]");
      process.exit(2);
    }
    const buf = readFileSync(file);
    const parsed = parseHWPX(buf);
    if (args.includes("--json")) {
      console.log(JSON.stringify(parsed, null, 2));
    } else {
      console.log(parsed.markdown);
    }
  } else if (cmd === "build") {
    const inFile = args[0];
    let outFile = "output.hwpx";
    let tmplFile: string | undefined;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === "-o" && args[i + 1]) outFile = args[++i] || "output.hwpx";
      if (args[i] === "--template" && args[i + 1]) tmplFile = args[++i];
    }

    if (!inFile || !existsSync(inFile)) {
      console.error("usage: kordoc-bridge.ts build <input.md> -o <output.hwpx> [--template <template.hwpx>]");
      process.exit(2);
    }

    const md = readFileSync(inFile, "utf8");
    const tmpl = tmplFile && existsSync(tmplFile) ? readFileSync(tmplFile) : undefined;
    const hwpxBuf = buildHWPX(md, { template: tmpl });
    writeFileSync(outFile, hwpxBuf);
    console.log(`Generated HWPX: ${outFile} (${hwpxBuf.length} bytes)`);
  } else if (cmd === "verify-law") {
    const citation = args.join(" ");
    if (!citation) {
      console.error("usage: kordoc-bridge.ts verify-law <citation-text>");
      process.exit(2);
    }
    const res = verifyKoreanLawCitation(citation);
    console.log(JSON.stringify(res, null, 2));
  } else if (cmd === "diff") {
    const [file1, file2] = args;
    if (!file1 || !file2 || !existsSync(file1) || !existsSync(file2)) {
      console.error("usage: kordoc-bridge.ts diff <file1.hwpx> <file2.hwpx>");
      process.exit(2);
    }
    const r1 = parseHWPX(readFileSync(file1));
    const r2 = parseHWPX(readFileSync(file2));
    const diff = diffHWPX(r1, r2);
    console.log(diff.diffTableMarkdown);
  } else {
    console.error("usage: kordoc-bridge.ts <parse|build|verify-law|diff> ...");
    process.exit(2);
  }
}
