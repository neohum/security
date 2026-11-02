#!/usr/bin/env node
/**
 * jevgrep.ts — Natural Language Code Intelligence & AST Knowledge Graph Grep.
 *
 * Benchmarked from dzhng/jevgrep, Graphify-Labs/graphify, and AlmanacCode/codealmanac:
 * - Natural language code intent understanding in Korean and English.
 * - Extracts entities, actions, and multi-step flow questions (e.g., "결제 후 알림을 보내는 흐름").
 * - Combines SQLite AST knowledge graph nodes, edges, and semantic keyword synonyms.
 * - Traces call chains and cross-file paths within 2 seconds (typically < 30ms).
 */

import { DatabaseSync } from "node:sqlite";
import { resolve, relative, normalize } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { CodebaseGraphIndexer, type GraphNode, type GraphEdge } from "../knowledge/graph-indexer.ts";

// ============================================================================
// Types
// ============================================================================

export interface JevgrepNodeMatch {
  node_id: string;
  file_path: string;
  name: string;
  kind: string;
  line_start: number;
  line_end: number;
  docstring?: string | null;
  score: number;
  matchedTerms: string[];
}

export interface JevgrepCallChain {
  path: Array<{
    node_id: string;
    name: string;
    file_path: string;
    line_start: number;
    kind: string;
  }>;
  summary: string;
}

export interface JevgrepResult {
  query: string;
  elapsedMs: number;
  detectedFlow: boolean;
  flowStages: string[];
  nodes: JevgrepNodeMatch[];
  callChains: JevgrepCallChain[];
  formattedOutput: string;
}

export interface JevgrepSearchOptions {
  db?: DatabaseSync;
  dbPath?: string;
  indexer?: CodebaseGraphIndexer;
  limit?: number;
  minScore?: number;
  maxChainDepth?: number;
}

// ============================================================================
// Synonym & Intent Dictionary (Korean & English)
// ============================================================================

const SYNONYM_MAP: Record<string, string[]> = {
  // Payment / Billing
  "결제": ["pay", "payment", "checkout", "billing", "charge", "purchase", "settle", "pg"],
  "비용": ["cost", "charge", "fee", "price", "amount"],
  "주문": ["order", "purchase", "item", "cart"],
  "환불": ["refund", "cancel", "rollback"],

  // Notification / Alert / Messaging
  "알림": ["notify", "notification", "alert", "notice", "push", "message", "webhook", "telegram", "email", "sms"],
  "전송": ["send", "push", "dispatch", "emit", "publish", "post", "transmit"],
  "메시지": ["message", "msg", "payload", "chat", "text"],

  // Auth / User
  "인증": ["auth", "authenticate", "login", "signin", "verify", "identity", "token"],
  "권한": ["role", "permission", "acl", "access", "scope"],
  "사용자": ["user", "account", "profile", "member", "customer"],
  "세션": ["session", "token", "jwt", "cookie"],

  // Search / Query
  "검색": ["search", "query", "find", "grep", "filter", "lookup"],
  "조회": ["get", "fetch", "query", "read", "retrieve", "load"],

  // Storage / DB
  "저장": ["save", "store", "persist", "write", "insert", "db", "database"],
  "수정": ["update", "modify", "edit", "patch", "change"],
  "삭제": ["delete", "remove", "destroy", "drop", "clear"],

  // Infra / Loop
  "배포": ["deploy", "release", "ship", "promote", "publish"],
  "로그": ["log", "logging", "logger", "trail", "telemetry", "trace"],
  "검증": ["verify", "validate", "check", "test", "assert", "gate", "audit"],
  "캐시": ["cache", "memoize", "redis"],
};

const FLOW_KEYWORDS = [
  "흐름", "순서", "체인", "과정", "경로", "호출", "어디",
  "flow", "chain", "path", "calls", "sequence", "pipeline", "where",
];

const STAGE_SPLITTERS = [
  " 후 ", " 다음 ", " 후에 ", " 한 뒤 ", " 하고 ", " 거쳐 ",
  " after ", " then ", " and then ", " -> ", " ->", "-> ",
];

// ============================================================================
// Query Parsing and Entity Extraction
// ============================================================================

export interface ParsedQuery {
  rawQuery: string;
  isFlowQuery: boolean;
  stages: string[];
  expandedTerms: string[];
}

export function parseNaturalLanguageQuery(query: string): ParsedQuery {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  // Check if flow/sequence is requested
  const isFlow = FLOW_KEYWORDS.some((kw) => lower.includes(kw));

  // Check stage splitters
  let stages: string[] = [];
  for (const splitter of STAGE_SPLITTERS) {
    if (lower.includes(splitter)) {
      stages = lower.split(splitter).map((s) => s.trim()).filter(Boolean);
      break;
    }
  }

  // Tokenize words
  const rawTokens = trimmed
    .replace(/[?.,!~[\](){}'"]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1);

  const expandedSet = new Set<string>();

  for (const token of rawTokens) {
    expandedSet.add(token);

    // Look for synonyms
    for (const [k, syns] of Object.entries(SYNONYM_MAP)) {
      if (token.includes(k) || k.includes(token)) {
        expandedSet.add(k);
        for (const s of syns) expandedSet.add(s);
      }
      for (const s of syns) {
        if (token === s || token.includes(s) || s.includes(token)) {
          expandedSet.add(k);
          for (const s2 of syns) expandedSet.add(s2);
        }
      }
    }
  }

  return {
    rawQuery: trimmed,
    isFlowQuery: isFlow || stages.length > 1,
    stages,
    expandedTerms: Array.from(expandedSet),
  };
}

// ============================================================================
// Core Search Logic
// ============================================================================

export function searchCodebase(
  query: string,
  options: JevgrepSearchOptions = {},
): JevgrepResult {
  const startTime = performance.now();
  const limit = options.limit ?? 15;
  const minScore = options.minScore ?? 15;
  const maxChainDepth = options.maxChainDepth ?? 5;

  let db = options.db;
  let shouldCloseDb = false;

  if (!db) {
    const dbPath = options.dbPath || resolve(process.cwd(), ".harness", "knowledge.db");
    const dir = resolve(dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA busy_timeout = 5000;");
    shouldCloseDb = true;
  }

  try {
    const indexer = options.indexer ?? new CodebaseGraphIndexer(db);
    const parsed = parseNaturalLanguageQuery(query);

    // 1. Fetch candidate nodes from database
    const allNodes = db.prepare(`
      SELECT node_id, file_path, name, kind, line_start, line_end, docstring
      FROM kl_graph_nodes
      WHERE kind != 'file' AND kind != 'module'
    `).all() as unknown as GraphNode[];

    // 2. Score nodes based on terms
    const matchedNodes: JevgrepNodeMatch[] = [];

    for (const node of allNodes) {
      let score = 0;
      const matched: string[] = [];
      const nodeNameLower = node.name.toLowerCase();
      const docLower = (node.docstring || "").toLowerCase();
      const pathLower = node.file_path.toLowerCase();

      for (const term of parsed.expandedTerms) {
        let hit = false;
        // Exact name match
        if (nodeNameLower === term) {
          score += 100;
          hit = true;
        }
        // Substring in name (e.g. processPayment matching payment or pay)
        else if (nodeNameLower.includes(term)) {
          score += 50;
          hit = true;
        }
        // Name contains compound part
        else if (term.length >= 3 && term.includes(nodeNameLower)) {
          score += 40;
          hit = true;
        }

        // Docstring match
        if (docLower.includes(term)) {
          score += 35;
          hit = true;
        }

        // File path match
        if (pathLower.includes(term)) {
          score += 15;
          hit = true;
        }

        if (hit) {
          matched.push(term);
        }
      }

      // Bonus if matched multiple distinct concepts
      if (matched.length > 1) {
        score += matched.length * 10;
      }

      if (score >= minScore) {
        matchedNodes.push({
          ...node,
          score,
          matchedTerms: Array.from(new Set(matched)),
        });
      }
    }

    matchedNodes.sort((a, b) => b.score - a.score);
    const topNodes = matchedNodes.slice(0, limit);

    // 3. Resolve Call Chains / Flow Paths
    const callChains: JevgrepCallChain[] = [];

    if (parsed.isFlowQuery) {
      if (parsed.stages.length >= 2) {
        // Multi-stage flow query: e.g. Stage 1 ("결제") -> Stage 2 ("알림")
        const stage1Text = parsed.stages[0] || "";
        const stage2Text = parsed.stages[1] || "";
        const stage1Query = parseNaturalLanguageQuery(stage1Text);
        const stage2Query = parseNaturalLanguageQuery(stage2Text);

        const stage1Candidates = matchedNodes.filter((n) =>
          stage1Query.expandedTerms.some((t) => n.name.toLowerCase().includes(t) || (n.docstring && n.docstring.toLowerCase().includes(t))),
        ).slice(0, 5);

        const stage2Candidates = matchedNodes.filter((n) =>
          stage2Query.expandedTerms.some((t) => n.name.toLowerCase().includes(t) || (n.docstring && n.docstring.toLowerCase().includes(t))),
        ).slice(0, 5);

        for (const s1 of stage1Candidates) {
          for (const s2 of stage2Candidates) {
            if (s1.node_id === s2.node_id) continue;
            const pathNodes = indexer.tracePath(s1.node_id, s2.node_id, maxChainDepth);
            if (pathNodes && pathNodes.length >= 2) {
              const chainSummary = pathNodes.map((p) => `${p.name} (${p.file_path}:${p.line_start})`).join(" ──calls──> ");
              callChains.push({
                path: pathNodes.map((p) => ({
                  node_id: p.node_id,
                  name: p.name,
                  file_path: p.file_path,
                  line_start: p.line_start,
                  kind: p.kind,
                })),
                summary: chainSummary,
              });
            }
          }
        }
      }

      // If no multi-stage chain found or no explicit stages, trace outgoing calls from top nodes
      if (callChains.length === 0 && topNodes.length > 0) {
        for (const root of topNodes.slice(0, 3)) {
          const rawChain = indexer.getCallChain(root.node_id, 3);
          if (rawChain.length > 0) {
            const chainSet = new Map<string, GraphNode>();
            chainSet.set(root.node_id, root as unknown as GraphNode);
            for (const step of rawChain) {
              chainSet.set(step.to.node_id, step.to);
            }
            const pathArr = Array.from(chainSet.values());
            if (pathArr.length >= 2) {
              const chainSummary = pathArr.map((p) => `${p.name} (${p.file_path}:${p.line_start})`).join(" ──calls──> ");
              callChains.push({
                path: pathArr.map((p) => ({
                  node_id: p.node_id,
                  name: p.name,
                  file_path: p.file_path,
                  line_start: p.line_start,
                  kind: p.kind,
                })),
                summary: chainSummary,
              });
            }
          }
        }
      }
    }

    const elapsedMs = Math.round((performance.now() - startTime) * 100) / 100;

    // 4. Build Formatted Output
    const lines: string[] = [];
    lines.push(`🔍 Jevgrep Query: "${query}" (${elapsedMs}ms, ${topNodes.length} nodes, ${callChains.length} flow chains)`);
    lines.push("");

    if (callChains.length > 0) {
      lines.push("🔗 [Call Graph Execution Flows]:");
      callChains.forEach((c, i) => {
        lines.push(`  Flow #${i + 1}: ${c.summary}`);
      });
      lines.push("");
    }

    lines.push("📍 [Matched Functions, Classes & Handlers]:");
    if (topNodes.length === 0) {
      lines.push("  (No relevant code entities found matching query terms)");
    } else {
      for (const node of topNodes) {
        const docSnippet = node.docstring ? ` — "${node.docstring.replace(/\n/g, " ").slice(0, 70)}..."` : "";
        lines.push(`  • ${node.name} [${node.kind}] @ ${node.file_path}:${node.line_start}-${node.line_end} (score: ${node.score})${docSnippet}`);
      }
    }

    return {
      query,
      elapsedMs,
      detectedFlow: parsed.isFlowQuery,
      flowStages: parsed.stages,
      nodes: topNodes,
      callChains,
      formattedOutput: lines.join("\n"),
    };
  } finally {
    if (shouldCloseDb && db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

export async function runJevgrepCli(args: string[] = process.argv.slice(2)): Promise<void> {
  let query = "";
  let dbPath: string | undefined = undefined;
  let indexDir: string | undefined = undefined;
  let jsonOutput = false;
  let limit = 10;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] || "";
    if (arg === "--db" && i + 1 < args.length) {
      dbPath = args[++i];
    } else if ((arg === "--dir" || arg === "--index") && i + 1 < args.length) {
      indexDir = args[++i];
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--limit" && i + 1 < args.length) {
      const next = args[++i] || "10";
      limit = parseInt(next, 10);
    } else if (!arg.startsWith("-")) {
      query = query ? `${query} ${arg}` : arg;
    }
  }

  if (!query) {
    console.log(`
Usage: jevgrep <natural language query> [options]

Options:
  --db <path>      Path to knowledge SQLite database (default: .harness/knowledge.db)
  --index <dir>    Index directory before searching
  --limit <n>      Maximum entities to return (default: 10)
  --json           Print raw JSON result

Examples:
  npx tsx scripts/loop/jevgrep.ts "결제 후 알림을 보내는 흐름이 어디 있나요?"
  npx tsx scripts/loop/jevgrep.ts "where is user authentication verified?"
    `);
    process.exit(0);
  }

  const db = new DatabaseSync(dbPath || resolve(process.cwd(), ".harness", "knowledge.db"));
  try {
    const indexer = new CodebaseGraphIndexer(db);

    if (indexDir) {
      const stats = indexer.indexDirectory(indexDir);
      console.log(`Indexed ${stats.fileCount} files in ${stats.durationMs}ms (${stats.nodeCount} nodes, ${stats.edgeCount} edges).`);
    }

    const result = searchCodebase(query, { db, indexer, limit });

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.formattedOutput);
    }
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

// Auto-run if executed directly
if (process.argv[1] && normalize(process.argv[1]).endsWith("jevgrep.ts")) {
  runJevgrepCli().catch((err) => {
    console.error("jevgrep error:", err);
    process.exit(1);
  });
}
