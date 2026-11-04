// tests/arena-shell-script.test.ts — Comprehensive Test Suite for Shell Scripting (.sh) Environment.
//
// Conforms to:
//   - Step 7 of internet-ctf-competition-arena.plan.md
//   - Verifies AC-1, AC-2, AC-3, AC-4:
//     * Shell script creation via echo and heredoc (cat << 'EOF' > ...)
//     * Script execution via 'bash script.sh', 'sh script.sh', and './script.sh'
//     * 5 core embedded shell scripts (whois_scan.sh, axfr_scan.sh, nmap_scan.sh, s3_leak_scan.sh, auto_pwn.sh)
//     * Real-time automated scoring and target compromise from shell scripts
//     * UI Reference cards with shell script templates

import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockInternetMesh } from "../server/mock-internet-mesh.ts";
import { ArenaManager } from "../server/arena-manager.ts";
import { ArenaScriptRunner } from "../server/arena-script-runner.ts";
import { renderReferenceKnowledgeCardHtml } from "../client/src/components/TwinTerminal.ts";

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("Step 7: Shell Scripting (.sh) Environment & Automation Suite", () => {
  let mesh: MockInternetMesh;
  let arena: ArenaManager;
  let runner: ArenaScriptRunner;

  before(() => {
    mesh = new MockInternetMesh(999);
    arena = new ArenaManager(mesh);
    runner = new ArenaScriptRunner(mesh, arena);
    arena.startMatch();
  });

  after(() => {
    arena.destroy();
  });

  it("AC-1: creates custom shell script via echo redirection and verifies file in ls", async () => {
    const player = arena.registerPlayer({ nickname: "BashMaster", clientIp: "127.0.0.1" });

    // Create a custom whois sweep shell script
    const createCmd = `echo 'for i in {1..200}; do whois -h 10.10.1.$i megacorp.internal; done' > custom_recon.sh`;
    assert.equal(runner.isScriptCommand(createCmd), true);
    const createRes = await runner.execute(createCmd, player.id);
    console.log("createRes output:", JSON.stringify(createRes));

    assert.equal(createRes.handled, true);
    assert.ok(stripAnsi(createRes.output).includes("셸 스크립트 생성 완료: custom_recon.sh"));

    // Check ls listing
    const lsRes = await runner.execute("ls", player.id);
    assert.equal(lsRes.handled, true);
    assert.ok(stripAnsi(lsRes.output).includes("custom_recon.sh"), "User-created script must be listed in ls");
    assert.ok(stripAnsi(lsRes.output).includes("[사용자]"), "Should tag user script");

    // Cat script
    const catRes = await runner.execute("cat custom_recon.sh", player.id);
    assert.equal(catRes.handled, true);
    assert.ok(stripAnsi(catRes.output).includes("custom_recon.sh (사용자 스크립트)"));
    assert.ok(stripAnsi(catRes.output).includes("for i in {1..200}"));
  });

  it("AC-1: creates shell script via cat heredoc (cat << 'EOF' > ...)", async () => {
    const player = arena.registerPlayer({ nickname: "HeredocUser", clientIp: "127.0.0.1" });

    const heredocCmd = `cat << 'EOF' > sweep_all.sh\nfor i in $(seq 1 200); do\n  whois -h 10.10.1.$i\ndone\nEOF`;
    assert.equal(runner.isScriptCommand(heredocCmd), true);
    const res = await runner.execute(heredocCmd, player.id);

    assert.equal(res.handled, true);
    assert.ok(stripAnsi(res.output).includes("셸 스크립트 작성 완료: sweep_all.sh"));

    const catRes = await runner.execute("cat sweep_all.sh", player.id);
    assert.ok(stripAnsi(catRes.output).includes("sweep_all.sh"));
  });

  it("AC-2: executes user-created shell script via 'bash custom_recon.sh' and './custom_recon.sh' with scoring", async () => {
    const player = arena.registerPlayer({ nickname: "ScriptRunnerUser", clientIp: "127.0.0.1" });

    // 1. Create script
    await runner.execute(`echo 'for i in {1..200}; do whois -h 10.10.1.$i megacorp.internal; done' > my_whois.sh`, player.id);

    // 2. Chmod +x
    const chmodRes = await runner.execute("chmod +x my_whois.sh", player.id);
    assert.ok(chmodRes.output.includes("실행 권한 부여 완료"));

    // 3. Execute via ./my_whois.sh
    const runRes = await runner.execute("./my_whois.sh", player.id);
    assert.equal(runRes.handled, true);
    assert.ok(runRes.output.includes("셸 스크립트 실행"));
    assert.ok(runRes.output.includes("my_whois.sh (User Custom)"));
    assert.ok(runRes.output.includes("WHOIS 취약점 발견 및 탈취"));
    assert.equal(runRes.evaluatedTargets?.length, 10, "Should compromise exactly 10 whois targets");
    assert.ok((runRes.totalScoreGained || 0) >= 1000);

    // Verify player score in ArenaManager
    const refreshed = arena.getPlayer(player.id);
    assert.ok(refreshed);
    assert.equal(refreshed.compromisedCount, 10);
    assert.ok(refreshed.score >= 1000);
  });

  it("AC-3: verifies 5 embedded production shell scripts (whois_scan.sh, axfr_scan.sh, nmap_scan.sh, s3_leak_scan.sh, auto_pwn.sh)", async () => {
    const player = arena.registerPlayer({ nickname: "ToolkitTester", clientIp: "127.0.0.1" });

    // 1. Check whois_scan.sh
    const catWhois = await runner.execute("cat whois_scan.sh", player.id);
    assert.ok(catWhois.output.includes("whois_scan.sh"));
    assert.ok(catWhois.output.includes("#!/bin/bash"));

    // 2. Execute axfr_scan.sh
    const axfrRes = await runner.execute("bash axfr_scan.sh", player.id);
    assert.equal(axfrRes.handled, true);
    assert.ok(axfrRes.output.includes("AXFR 셸 스크립트 완료"));
    assert.equal(axfrRes.evaluatedTargets?.length, 10, "Should compromise 10 DNS-AXFR servers");

    // 3. Execute auto_pwn.sh (Comprehensive attack script)
    const autoPwnRes = await runner.execute("bash auto_pwn.sh", player.id);
    assert.equal(autoPwnRes.handled, true);
    assert.ok(autoPwnRes.output.includes("종합 셸 스크립트 실행 완료"));
    assert.ok((autoPwnRes.totalScoreGained || 0) > 0);
  });

  it("AC-4: TwinTerminal reference card provides shell script creation and execution guides", () => {
    const html = renderReferenceKnowledgeCardHtml("attacker");
    assert.ok(html.includes("나만의 셸 스크립트 (.sh) 생성 및 저장"));
    assert.ok(html.includes("echo 'for i in {1..200}"));
    assert.ok(html.includes("bash /root/tools/auto_pwn.sh"));
    assert.ok(html.includes("200개 노드 6대 분야 전수 셸 스크립트 실행"));
  });
});
