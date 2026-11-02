/**
 * graph-indexer.ts — AST-based Codebase Knowledge Graph Indexer.
 *
 * Benchmarked from Graphify-Labs/graphify and AlmanacCode/codealmanac:
 * - Parses TypeScript and JavaScript source files into AST entities.
 * - Extracts files, imports, classes, functions, methods, interfaces, and call relationships.
 * - Stores entities and relationships into SQLite tables `kl_graph_nodes` and `kl_graph_edges`.
 * - Enables multi-hop call graph traversal and cross-file dependency queries.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { resolve, relative, normalize, join, extname } from "node:path";
import ts from "typescript";

// ============================================================================
// Types and Contracts
// ============================================================================

export interface GraphNode {
  node_id: string;
  file_path: string;
  name: string;
  kind: "file" | "function" | "method" | "class" | "interface" | "type" | "variable" | "module";
  line_start: number;
  line_end: number;
  docstring?: string | null;
}

export interface GraphEdge {
  edge_id: string;
  source_id: string;
  target_id: string;
  relation_type: "imports" | "defines" | "calls" | "exports" | "implements" | "references";
  weight: number;
}

export interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  imports: Array<{ specifier: string; symbols: string[]; isDefault: boolean }>;
  rawCalls: Array<{ callerId: string; calleeName: string; line: number }>;
}

export interface IndexerStats {
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
}

// ============================================================================
// AST Parsing Logic
// ============================================================================

function extractDocstring(sourceFile: ts.SourceFile, node: ts.Node): string | null {
  try {
    const fullText = sourceFile.getFullText();
    const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
    if (!commentRanges || commentRanges.length === 0) return null;
    return commentRanges
      .map((range) => {
        let comment = fullText.substring(range.pos, range.end).trim();
        // Strip block comment syntax if desired
        if (comment.startsWith("/**") && comment.endsWith("*/")) {
          comment = comment
            .replace(/^\/\*\*|\*\/$/g, "")
            .split("\n")
            .map((line) => line.replace(/^\s*\*\s?/, "").trim())
            .filter(Boolean)
            .join(" ");
        } else if (comment.startsWith("//")) {
          comment = comment.replace(/^\/\/\s?/, "").trim();
        }
        return comment;
      })
      .filter(Boolean)
      .join("\n");
  } catch {
    return null;
  }
}

/**
 * Parses a single source code text into nodes, definitions, and raw calls.
 */
export function parseSourceCode(filePath: string, sourceText: string): ParseResult {
  const normPath = normalize(filePath).replace(/\\/g, "/");
  const isTs = filePath.endsWith(".ts") || filePath.endsWith(".tsx");
  const isJsx = filePath.endsWith(".jsx") || filePath.endsWith(".tsx");

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    isJsx ? (isTs ? ts.ScriptKind.TSX : ts.ScriptKind.JSX) : (isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS),
  );

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const imports: Array<{ specifier: string; symbols: string[]; isDefault: boolean }> = [];
  const rawCalls: Array<{ callerId: string; calleeName: string; line: number }> = [];

  const totalLines = sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd()).line + 1;
  const fileNodeId = `file:${normPath}`;

  // Top level file docstring
  const fileDocstring = extractDocstring(sourceFile, sourceFile);

  // File Node
  const fileNode: GraphNode = {
    node_id: fileNodeId,
    file_path: normPath,
    name: normPath.split("/").pop() || normPath,
    kind: "file",
    line_start: 1,
    line_end: totalLines,
    docstring: fileDocstring,
  };
  nodes.push(fileNode);

  function getLineRange(node: ts.Node): { start: number; end: number } {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    return { start, end };
  }

  function getCalleeName(expr: ts.LeftHandSideExpression): string | null {
    if (ts.isIdentifier(expr)) {
      return expr.text;
    }
    if (ts.isPropertyAccessExpression(expr)) {
      return expr.name.text;
    }
    return null;
  }

  function visitCalls(body: ts.Node, callerId: string) {
    function walk(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const callee = getCalleeName(node.expression);
        if (callee) {
          const { start } = getLineRange(node);
          rawCalls.push({ callerId, calleeName: callee, line: start });
        }
      }
      ts.forEachChild(node, walk);
    }
    ts.forEachChild(body, walk);
  }

  function visit(node: ts.Node) {
    // 1. Imports
    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : "";
      const symbols: string[] = [];
      let isDefault = false;

      if (node.importClause) {
        if (node.importClause.name) {
          symbols.push(node.importClause.name.text);
          isDefault = true;
        }
        if (node.importClause.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            for (const elem of node.importClause.namedBindings.elements) {
              symbols.push(elem.name.text);
            }
          } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            symbols.push(node.importClause.namedBindings.name.text);
          }
        }
      }

      if (specifier) {
        imports.push({ specifier, symbols, isDefault });
        const targetModuleId = specifier.startsWith(".")
          ? `file:${specifier}`
          : `module:${specifier}`;

        // Module target node placeholder
        nodes.push({
          node_id: targetModuleId,
          file_path: specifier,
          name: specifier,
          kind: "module",
          line_start: 1,
          line_end: 1,
          docstring: null,
        });

        edges.push({
          edge_id: `edge:${fileNodeId}->${targetModuleId}:imports`,
          source_id: fileNodeId,
          target_id: targetModuleId,
          relation_type: "imports",
          weight: 1.0,
        });
      }
    }

    // 2. Class Declarations
    else if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const classNodeId = `${normPath}#${className}`;
      const { start, end } = getLineRange(node);
      const doc = extractDocstring(sourceFile, node);

      nodes.push({
        node_id: classNodeId,
        file_path: normPath,
        name: className,
        kind: "class",
        line_start: start,
        line_end: end,
        docstring: doc,
      });

      edges.push({
        edge_id: `edge:${fileNodeId}->${classNodeId}:defines`,
        source_id: fileNodeId,
        target_id: classNodeId,
        relation_type: "defines",
        weight: 1.0,
      });

      // Methods inside class
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          const methodName = member.name.text;
          const fullName = `${className}.${methodName}`;
          const methodNodeId = `${normPath}#${fullName}`;
          const mRange = getLineRange(member);
          const mDoc = extractDocstring(sourceFile, member);

          nodes.push({
            node_id: methodNodeId,
            file_path: normPath,
            name: fullName,
            kind: "method",
            line_start: mRange.start,
            line_end: mRange.end,
            docstring: mDoc,
          });

          edges.push({
            edge_id: `edge:${classNodeId}->${methodNodeId}:defines`,
            source_id: classNodeId,
            target_id: methodNodeId,
            relation_type: "defines",
            weight: 1.0,
          });

          if (member.body) {
            visitCalls(member.body, methodNodeId);
          }
        }
      }
    }

    // 3. Function Declarations
    else if (ts.isFunctionDeclaration(node) && node.name) {
      const funcName = node.name.text;
      const funcNodeId = `${normPath}#${funcName}`;
      const { start, end } = getLineRange(node);
      const doc = extractDocstring(sourceFile, node);

      nodes.push({
        node_id: funcNodeId,
        file_path: normPath,
        name: funcName,
        kind: "function",
        line_start: start,
        line_end: end,
        docstring: doc,
      });

      edges.push({
        edge_id: `edge:${fileNodeId}->${funcNodeId}:defines`,
        source_id: fileNodeId,
        target_id: funcNodeId,
        relation_type: "defines",
        weight: 1.0,
      });

      if (node.body) {
        visitCalls(node.body, funcNodeId);
      }
    }

    // 4. Variable Statements (export const foo = () => { ... })
    else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const varName = decl.name.text;
          const isFunc = ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer);
          const varNodeId = `${normPath}#${varName}`;
          const { start, end } = getLineRange(node);
          const doc = extractDocstring(sourceFile, node);

          nodes.push({
            node_id: varNodeId,
            file_path: normPath,
            name: varName,
            kind: isFunc ? "function" : "variable",
            line_start: start,
            line_end: end,
            docstring: doc,
          });

          edges.push({
            edge_id: `edge:${fileNodeId}->${varNodeId}:defines`,
            source_id: fileNodeId,
            target_id: varNodeId,
            relation_type: "defines",
            weight: 1.0,
          });

          if (isFunc && decl.initializer.body) {
            visitCalls(decl.initializer.body, varNodeId);
          }
        }
      }
    }

    // 5. Interface Declarations
    else if (ts.isInterfaceDeclaration(node) && node.name) {
      const ifaceName = node.name.text;
      const ifaceNodeId = `${normPath}#${ifaceName}`;
      const { start, end } = getLineRange(node);
      const doc = extractDocstring(sourceFile, node);

      nodes.push({
        node_id: ifaceNodeId,
        file_path: normPath,
        name: ifaceName,
        kind: "interface",
        line_start: start,
        line_end: end,
        docstring: doc,
      });

      edges.push({
        edge_id: `edge:${fileNodeId}->${ifaceNodeId}:defines`,
        source_id: fileNodeId,
        target_id: ifaceNodeId,
        relation_type: "defines",
        weight: 1.0,
      });
    }

    // 6. Type Alias Declarations
    else if (ts.isTypeAliasDeclaration(node) && node.name) {
      const typeName = node.name.text;
      const typeNodeId = `${normPath}#${typeName}`;
      const { start, end } = getLineRange(node);
      const doc = extractDocstring(sourceFile, node);

      nodes.push({
        node_id: typeNodeId,
        file_path: normPath,
        name: typeName,
        kind: "type",
        line_start: start,
        line_end: end,
        docstring: doc,
      });

      edges.push({
        edge_id: `edge:${fileNodeId}->${typeNodeId}:defines`,
        source_id: fileNodeId,
        target_id: typeNodeId,
        relation_type: "defines",
        weight: 1.0,
      });
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);

  return { nodes, edges, imports, rawCalls };
}

// ============================================================================
// Codebase Graph Indexer Service
// ============================================================================

export class CodebaseGraphIndexer {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.initTables();
  }

  /**
   * Ensures the knowledge graph tables and indexes are created.
   */
  public initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kl_graph_nodes (
        node_id TEXT NOT NULL PRIMARY KEY,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        docstring TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_kl_graph_nodes_file ON kl_graph_nodes(file_path);
      CREATE INDEX IF NOT EXISTS idx_kl_graph_nodes_name ON kl_graph_nodes(name);
      CREATE INDEX IF NOT EXISTS idx_kl_graph_nodes_kind ON kl_graph_nodes(kind);

      CREATE TABLE IF NOT EXISTS kl_graph_edges (
        edge_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        FOREIGN KEY (source_id) REFERENCES kl_graph_nodes(node_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_kl_graph_edges_source ON kl_graph_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_kl_graph_edges_target ON kl_graph_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_kl_graph_edges_relation ON kl_graph_edges(relation_type);
    `);
  }

  /**
   * Clears all nodes and edges belonging to a given file path.
   */
  public clearFile(filePath: string): void {
    const normPath = normalize(filePath).replace(/\\/g, "/");
    // Cascades delete edges where source_id in kl_graph_nodes
    this.db.prepare("DELETE FROM kl_graph_nodes WHERE file_path = ?").run(normPath);
    // Clean up any remaining edges targeting or sourcing that file
    this.db.prepare("DELETE FROM kl_graph_edges WHERE source_id LIKE ? OR target_id LIKE ?")
      .run(`${normPath}%`, `${normPath}%`);
  }

  /**
   * Indexes a single source file (content provided or read from disk).
   */
  public indexFile(filePath: string, content?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const normPath = normalize(filePath).replace(/\\/g, "/");
    const sourceCode = content !== undefined ? content : readFileSync(filePath, "utf-8");
    const parsed = parseSourceCode(normPath, sourceCode);

    this.clearFile(normPath);

    // Insert nodes
    const insertNode = this.db.prepare(`
      INSERT OR REPLACE INTO kl_graph_nodes (node_id, file_path, name, kind, line_start, line_end, docstring)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const node of parsed.nodes) {
      insertNode.run(
        node.node_id,
        node.file_path,
        node.name,
        node.kind,
        node.line_start,
        node.line_end,
        node.docstring ?? null,
      );
    }

    // Insert static edges (defines, imports)
    const insertEdge = this.db.prepare(`
      INSERT OR REPLACE INTO kl_graph_edges (edge_id, source_id, target_id, relation_type, weight)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const edge of parsed.edges) {
      insertEdge.run(
        edge.edge_id,
        edge.source_id,
        edge.target_id,
        edge.relation_type,
        edge.weight,
      );
    }

    // Resolve raw calls:
    // First try to find target in current file's nodes
    // If not found, look up any existing node in the database with matching name
    const createdEdges: GraphEdge[] = [...parsed.edges];
    const callCountMap = new Map<string, number>();

    for (const call of parsed.rawCalls) {
      // Find candidate node
      let targetNode = parsed.nodes.find(
        (n) => n.name === call.calleeName || n.name.endsWith(`.${call.calleeName}`),
      );

      if (!targetNode) {
        // Search DB for symbol
        const dbTarget = this.db.prepare(
          "SELECT node_id, file_path, name, kind, line_start, line_end, docstring FROM kl_graph_nodes WHERE name = ? OR name LIKE ? LIMIT 1",
        ).get(call.calleeName, `%.${call.calleeName}`) as GraphNode | undefined;
        if (dbTarget) {
          targetNode = dbTarget;
        }
      }

      const targetId = targetNode
        ? targetNode.node_id
        : `symbol:${call.calleeName}`;

      if (!targetNode) {
        // Create unresolved placeholder symbol node
        insertNode.run(
          targetId,
          normPath,
          call.calleeName,
          "function",
          call.line,
          call.line,
          null,
        );
      }

      const pairKey = `${call.callerId}->${targetId}`;
      const count = (callCountMap.get(pairKey) || 0) + 1;
      callCountMap.set(pairKey, count);
    }

    for (const [pairKey, count] of callCountMap.entries()) {
      const parts = pairKey.split("->");
      const source_id = parts[0] || "";
      const target_id = parts[1] || "";
      const edge_id = `edge:${source_id}->${target_id}:calls`;
      const edge: GraphEdge = {
        edge_id,
        source_id,
        target_id,
        relation_type: "calls",
        weight: count,
      };
      insertEdge.run(edge.edge_id, edge.source_id, edge.target_id, edge.relation_type, edge.weight);
      createdEdges.push(edge);
    }

    return { nodes: parsed.nodes, edges: createdEdges };
  }

  /**
   * Indexes a list of files in a single transaction.
   */
  public indexFiles(filePaths: string[]): IndexerStats {
    const start = performance.now();
    let totalNodes = 0;
    let totalEdges = 0;

    this.db.exec("BEGIN TRANSACTION;");
    try {
      for (const file of filePaths) {
        const { nodes, edges } = this.indexFile(file);
        totalNodes += nodes.length;
        totalEdges += edges.length;
      }
      this.db.exec("COMMIT;");
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }

    // Second-pass: link cross-file calls that were previously unresolved placeholders
    this.relinkCrossFileCalls();

    const durationMs = Math.round(performance.now() - start);
    return {
      fileCount: filePaths.length,
      nodeCount: totalNodes,
      edgeCount: totalEdges,
      durationMs,
    };
  }

  /**
   * Second-pass: if edges point to `symbol:<name>`, and a concrete function or method node
   * now exists in the database, re-point the edge to the concrete node.
   */
  public relinkCrossFileCalls(): void {
    const placeholderEdges = this.db.prepare(
      "SELECT edge_id, source_id, target_id, relation_type, weight FROM kl_graph_edges WHERE target_id LIKE 'symbol:%' AND relation_type = 'calls'",
    ).all() as unknown as GraphEdge[];

    const updateEdge = this.db.prepare("UPDATE kl_graph_edges SET target_id = ? WHERE edge_id = ?");

    for (const edge of placeholderEdges) {
      const symbolName = edge.target_id.replace(/^symbol:/, "");
      const concreteNode = this.db.prepare(
        "SELECT node_id FROM kl_graph_nodes WHERE (name = ? OR name LIKE ?) AND node_id NOT LIKE 'symbol:%' LIMIT 1",
      ).get(symbolName, `%.${symbolName}`) as { node_id: string } | undefined;

      if (concreteNode) {
        updateEdge.run(concreteNode.node_id, edge.edge_id);
      }
    }
  }

  /**
   * Indexes a directory recursively for supported JS/TS extensions.
   */
  public indexDirectory(
    dirPath: string,
    options: { extensions?: string[]; exclude?: string[] } = {},
  ): IndexerStats {
    const exts = options.extensions ?? [".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"];
    const excludes = options.exclude ?? ["node_modules", ".git", "dist", "build", "coverage", ".harness"];

    const filesToScan: string[] = [];

    function walk(curr: string) {
      const entries = readdirSync(curr, { withFileTypes: true });
      for (const entry of entries) {
        if (excludes.includes(entry.name)) continue;
        const full = join(curr, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          if (exts.includes(extname(entry.name))) {
            filesToScan.push(full);
          }
        }
      }
    }

    walk(dirPath);
    return this.indexFiles(filesToScan);
  }

  // ==========================================================================
  // Graph Query and Traversal APIs
  // ==========================================================================

  public getNode(nodeId: string): GraphNode | null {
    const row = this.db.prepare("SELECT * FROM kl_graph_nodes WHERE node_id = ?").get(nodeId);
    return (row as unknown as GraphNode) || null;
  }

  public findNodes(query: { name?: string; filePath?: string; kind?: string }): GraphNode[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.name) {
      clauses.push("name LIKE ?");
      params.push(`%${query.name}%`);
    }
    if (query.filePath) {
      clauses.push("file_path LIKE ?");
      params.push(`%${query.filePath}%`);
    }
    if (query.kind) {
      clauses.push("kind = ?");
      params.push(query.kind);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.prepare(`SELECT * FROM kl_graph_nodes ${where} ORDER BY line_start ASC`).all(...(params as any)) as unknown as GraphNode[];
  }

  public getOutgoingEdges(sourceId: string, relationType?: string): GraphEdge[] {
    if (relationType) {
      return this.db.prepare(
        "SELECT * FROM kl_graph_edges WHERE source_id = ? AND relation_type = ?",
      ).all(sourceId, relationType) as unknown as GraphEdge[];
    }
    return this.db.prepare("SELECT * FROM kl_graph_edges WHERE source_id = ?").all(sourceId) as unknown as GraphEdge[];
  }

  public getIncomingEdges(targetId: string, relationType?: string): GraphEdge[] {
    if (relationType) {
      return this.db.prepare(
        "SELECT * FROM kl_graph_edges WHERE target_id = ? AND relation_type = ?",
      ).all(targetId, relationType) as unknown as GraphEdge[];
    }
    return this.db.prepare("SELECT * FROM kl_graph_edges WHERE target_id = ?").all(targetId) as unknown as GraphEdge[];
  }

  /**
   * Traces execution/call chains up to maxDepth starting from a node.
   */
  public getCallChain(
    startNodeOrName: string,
    maxDepth = 5,
  ): Array<{ from: GraphNode; to: GraphNode; depth: number }> {
    const chain: Array<{ from: GraphNode; to: GraphNode; depth: number }> = [];
    const visited = new Set<string>();

    let startNode: GraphNode | null = this.getNode(startNodeOrName);
    if (!startNode) {
      const candidates = this.findNodes({ name: startNodeOrName });
      if (candidates.length > 0 && candidates[0]) {
        startNode = candidates[0];
      }
    }
    if (!startNode) return chain;

    const queue: Array<{ node: GraphNode; depth: number }> = [{ node: startNode, depth: 1 }];
    visited.add(startNode.node_id);

    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;
      if (depth > maxDepth) continue;

      const edges = this.getOutgoingEdges(node.node_id, "calls");
      for (const edge of edges) {
        let targetNode = this.getNode(edge.target_id);
        if (!targetNode && edge.target_id.startsWith("symbol:")) {
          const sym = edge.target_id.replace(/^symbol:/, "");
          const found = this.findNodes({ name: sym });
          if (found.length > 0 && found[0]) targetNode = found[0];
        }

        if (targetNode) {
          chain.push({ from: node, to: targetNode, depth });
          if (!visited.has(targetNode.node_id)) {
            visited.add(targetNode.node_id);
            queue.push({ node: targetNode, depth: depth + 1 });
          }
        }
      }
    }

    return chain;
  }

  /**
   * Finds shortest path of calls from start symbol to target symbol.
   */
  public tracePath(startNameOrId: string, endNameOrId: string, maxDepth = 6): GraphNode[] | null {
    const startNode = this.getNode(startNameOrId) || this.findNodes({ name: startNameOrId })[0] || null;
    const endNode = this.getNode(endNameOrId) || this.findNodes({ name: endNameOrId })[0] || null;
    if (!startNode || !endNode) return null;

    if (startNode.node_id === endNode.node_id) return [startNode];

    const queue: Array<{ curr: GraphNode; path: GraphNode[] }> = [
      { curr: startNode, path: [startNode] },
    ];
    const visited = new Set<string>([startNode.node_id]);

    while (queue.length > 0) {
      const { curr, path } = queue.shift()!;
      if (path.length > maxDepth) continue;

      const edges = this.getOutgoingEdges(curr.node_id, "calls");
      for (const edge of edges) {
        let nextNode = this.getNode(edge.target_id);
        if (!nextNode && edge.target_id.startsWith("symbol:")) {
          const sym = edge.target_id.replace(/^symbol:/, "");
          const match = this.findNodes({ name: sym })[0];
          if (match) nextNode = match;
        }

        if (nextNode) {
          if (nextNode.node_id === endNode.node_id || nextNode.name === endNode.name) {
            return [...path, nextNode];
          }
          if (!visited.has(nextNode.node_id)) {
            visited.add(nextNode.node_id);
            queue.push({ curr: nextNode, path: [...path, nextNode] });
          }
        }
      }
    }

    return null;
  }
}
