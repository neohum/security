// tests/arena-script-runner.test.ts — Verification Suite for Arena Automation Scripting Engine.
//
// Conforms to:
//   - Step 6 of internet-ctf-competition-arena.plan.md
//   - Verifies AC-1, AC-2, AC-3, AC-4:
//     * Bash for-loop execution & automated 200-node sweep
//     * Embedded /root/tools/ scripts (whois_sweep.py, axfr_sweep.sh, nmap_sweep.py)
//     * GET /api/arena/probe programmatic REST endpoint for Python / Curl
//     * TwinTerminal UI reference cards with automation guides

import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockInternetMesh } from "../server/mock-internet-mesh.ts";
import { ArenaManager } from "../server/arena-manager.ts";
import { ArenaScriptRunner } from "../server/arena-script-runner.ts";
import { createGatewayServer, type GatewayApp } from "../server/index.ts";
import { renderReferenceKnowledgeCardHtml } from "../client/src/components/TwinTerminal.ts";

describe("Step 6: Arena Automation Scripting Engine & REST Probing", () => {
  let mesh: MockInternetMesh;
  let arena: ArenaManager;
  let runner: ArenaScriptRunner;
  let app: GatewayApp;
  let port: number;
  let baseUrl: string;

  before(async () => {
    mesh = new MockInternetMesh(777);
    arena = new ArenaManager(mesh);
    runner = new ArenaScriptRunner(mesh, arena);
    arena.startMatch();

    app = createGatewayServer(0, "127.0.0.1", 0);
    port = await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${port}`;
    app.arenaManager.startMatch();
  });

  after(async () => {
    await app.close();
    arena.destroy();
  });

  it("AC-1: executes Bash for-loop across 200 nodes and awards points for all 10 vulnerable whois targets", async () => {
    const player = arena.registerPlayer({ nickname: "ScriptKiddo", clientIp: "127.0.0.1" });
    const bashLoopCmd = "for i in {1..200}; do whois -h 10.10.1.$i megacorp.internal; done";

    assert.equal(runner.isScriptCommand(bashLoopCmd), true);
    const result = await runner.execute(bashLoopCmd, player.id);

    assert.equal(result.handled, true);
    assert.ok(result.output.includes("Bash Loop Complete"));
    assert.ok(result.output.includes("VULNERABLE TARGET COMPROMISED"));
    assert.equal(result.evaluatedTargets?.length, 10, "Should compromise exactly 10 whois targets");
    assert.ok((result.totalScoreGained || 0) >= 1000, "Should gain points for 10 targets");

    // Verify player state
    const refreshed = arena.getPlayer(player.id);
    assert.ok(refreshed);
    assert.equal(refreshed.compromisedCount, 10);
    assert.ok(refreshed.score >= 1000);
  });

  it("AC-2: provides embedded /root/tools/ files and runs whois_sweep.py", async () => {
    const player = arena.registerPlayer({ nickname: "PyHacker", clientIp: "127.0.0.1" });

    // 1. Check tools listing
    const lsResult = await runner.execute("ls /root/tools", player.id);
    assert.equal(lsResult.handled, true);
    assert.ok(lsResult.output.includes("whois_sweep.py"));
    assert.ok(lsResult.output.includes("axfr_sweep.sh"));
    assert.ok(lsResult.output.includes("nmap_sweep.py"));

    // 2. Cat tool file
    const catResult = await runner.execute("cat /root/tools/whois_sweep.py", player.id);
    assert.equal(catResult.handled, true);
    assert.ok(catResult.output.includes("urllib.request"));
    assert.ok(catResult.output.includes("/api/arena/probe?ip="));

    // 3. Execute python3 /root/tools/whois_sweep.py
    const pyResult = await runner.execute("python3 /root/tools/whois_sweep.py", player.id);
    assert.equal(pyResult.handled, true);
    assert.ok(pyResult.output.includes("Whois 스위프 완료"));
    assert.ok(pyResult.output.includes("취약 서버 식별"));
  });

  it("AC-3: GET /api/arena/probe returns structured JSON for Whois, DNS-AXFR, Nmap, and MSSQL", async () => {
    // 1. Probe a vulnerable whois node
    const vulnWhois = app.mockMesh.getVulnerableNodesByCategory("whois")[0];
    const resWhois = await fetch(`${baseUrl}/api/arena/probe?ip=${vulnWhois.ip}&service=whois`);
    assert.equal(resWhois.status, 200);
    const dataWhois = await resWhois.json();
    assert.equal(dataWhois.ip, vulnWhois.ip);
    assert.equal(dataWhois.vulnerable, true);
    assert.equal(dataWhois.adminEmail, "admin@mega-infra.net");
    assert.ok(dataWhois.flag);

    // 2. Probe a hardened node
    const hardenedNode = app.mockMesh.getAllNodes().find((n) => !n.isVulnerable)!;
    const resHardened = await fetch(`${baseUrl}/api/arena/probe?ip=${hardenedNode.ip}&service=whois`);
    assert.equal(resHardened.status, 200);
    const dataHardened = await resHardened.json();
    assert.equal(dataHardened.vulnerable, false);
    assert.equal(dataHardened.flag, undefined);

    // 3. Probe DNS AXFR
    const vulnAxfr = app.mockMesh.getVulnerableNodesByCategory("dns-axfr")[0];
    const resAxfr = await fetch(`${baseUrl}/api/arena/probe?ip=${vulnAxfr.ip}&service=dns-axfr`);
    const dataAxfr = await resAxfr.json();
    assert.equal(dataAxfr.vulnerable, true);
    assert.ok(dataAxfr.flag);

    // 4. Probe Port scan
    const resNmap = await fetch(`${baseUrl}/api/arena/probe?ip=${vulnWhois.ip}&service=nmap&port=80`);
    const dataNmap = await resNmap.json();
    assert.equal(typeof dataNmap.open, "boolean");
  });

  it("AC-4: TwinTerminal reference cards include automation guides and for-loop templates", () => {
    const cardHtml = renderReferenceKnowledgeCardHtml("attacker");
    assert.ok(cardHtml.includes("200개 노드 Whois 대역 자동화 스위프"));
    assert.ok(cardHtml.includes("for i in {1..200}"));
    assert.ok(cardHtml.includes("python3 /root/tools/whois_sweep.py"));
    assert.ok(cardHtml.includes("파이썬 일괄 정찰 툴킷"));
  });
});
