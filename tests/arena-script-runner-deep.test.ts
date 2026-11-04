// tests/arena-script-runner-deep.test.ts — Deep Verification Suite for Shell Script Runner & Filesystem Engine.
//
// Conforms to:
//   - Per-player script authoring and mass automation requirements
//   - Quote, newline, and special character escaping via echo & heredoc
//   - Multi-script lifecycle: create, overwrite, delete (rm), chmod, ls, cat
//   - Strict per-player isolation across all filesystem operations
//   - Flawless execution of the 5 core embedded scripts with full vulnerability scoring
//   - Multi-player competitive dynamics and first blood tracking

import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockInternetMesh } from "../server/mock-internet-mesh.ts";
import { ArenaManager } from "../server/arena-manager.ts";
import { ArenaScriptRunner, EMBEDDED_TOOLKIT_FILES } from "../server/arena-script-runner.ts";

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("Deep Verification: Arena Script Runner & Filesystem Engine", () => {
  let mesh: MockInternetMesh;
  let arena: ArenaManager;
  let runner: ArenaScriptRunner;

  before(() => {
    // Seed 4242 for deterministic mesh generation
    mesh = new MockInternetMesh(4242);
    arena = new ArenaManager(mesh);
    runner = new ArenaScriptRunner(mesh, arena);
    arena.startMatch();
  });

  after(() => {
    arena.destroy();
  });

  // =========================================================================
  // Section 1: Echo Redirection, Quotes, Newlines & Escape Character Handling
  // =========================================================================
  describe("1. Echo Redirection & Escaping Engine", () => {
    it("1.1: preserves literal variables and single quotes in echo '...'", async () => {
      const p = arena.registerPlayer({ nickname: "EchoSingleKid", clientIp: "127.0.0.1" });
      const rawScript = `for i in $(seq 1 200); do whois -h "10.10.1.$i" "megacorp.internal" | grep 'admin@mega-infra.net'; done`;
      const cmd = `echo '${rawScript}' > recon_single.sh`;

      assert.equal(runner.isScriptCommand(cmd), true);
      const res = await runner.execute(cmd, p.id);
      assert.equal(res.handled, true);
      assert.ok(stripAnsi(res.output).includes("셸 스크립트 생성 완료: recon_single.sh"));

      const saved = runner.getUserFileContent(p.id, "recon_single.sh");
      assert.equal(saved, rawScript, "Single quotes must preserve dollar signs and nested quotes verbatim");
    });

    it("1.2: handles double quotes with escaped quotes, dollar signs, and backslashes", async () => {
      const p = arena.registerPlayer({ nickname: "EchoDoubleKid", clientIp: "127.0.0.1" });
      // Shell command containing \" and \$ and \\
      const cmd = `echo "echo \\"Scanning host: \\$TARGET\\\\infra\\" > /dev/null" > escaped.sh`;

      assert.equal(runner.isScriptCommand(cmd), true);
      const res = await runner.execute(cmd, p.id);
      assert.equal(res.handled, true);

      const saved = runner.getUserFileContent(p.id, "escaped.sh");
      assert.equal(saved, `echo "Scanning host: $TARGET\\infra" > /dev/null`);
    });

    it("1.3: handles echo -e with escape sequences (\\n, \\t)", async () => {
      const p = arena.registerPlayer({ nickname: "EchoFlagKid", clientIp: "127.0.0.1" });
      const cmd = `echo -e "#!/bin/bash\\n\\twhois 10.10.1.1\\n\\texit 0" > multiline_flag.sh`;

      const res = await runner.execute(cmd, p.id);
      assert.equal(res.handled, true);

      const saved = runner.getUserFileContent(p.id, "multiline_flag.sh");
      assert.equal(saved, "#!/bin/bash\n\twhois 10.10.1.1\n\texit 0");
    });

    it("1.4: handles multiline echo commands containing actual newline characters", async () => {
      const p = arena.registerPlayer({ nickname: "EchoMultilineKid", clientIp: "127.0.0.1" });
      const cmd = `echo '#!/bin/bash\n# Line 1\n# Line 2\necho "Done"' > actual_multiline.sh`;

      const res = await runner.execute(cmd, p.id);
      assert.equal(res.handled, true);

      const saved = runner.getUserFileContent(p.id, "actual_multiline.sh");
      assert.equal(saved, `#!/bin/bash\n# Line 1\n# Line 2\necho "Done"`);
    });

    it("1.5: supports append redirection (>>) to accumulate script lines", async () => {
      const p = arena.registerPlayer({ nickname: "EchoAppendKid", clientIp: "127.0.0.1" });

      await runner.execute(`echo '#!/bin/bash' > accum.sh`, p.id);
      await runner.execute(`echo 'step1()' >> accum.sh`, p.id);
      await runner.execute(`echo 'step2()' >> ./accum.sh`, p.id);

      const saved = runner.getUserFileContent(p.id, "accum.sh");
      assert.equal(saved, `#!/bin/bash\nstep1()\nstep2()`);
    });

    it("1.6: supports destination paths with ./ and /root/", async () => {
      const p = arena.registerPlayer({ nickname: "PathKid", clientIp: "127.0.0.1" });

      await runner.execute(`echo 'data1' > ./test_dot.sh`, p.id);
      await runner.execute(`echo 'data2' > /root/test_root.sh`, p.id);

      assert.equal(runner.getUserFileContent(p.id, "test_dot.sh"), "data1");
      assert.equal(runner.getUserFileContent(p.id, "test_root.sh"), "data2");
    });
  });

  // =========================================================================
  // Section 2: Cat Heredoc (cat << 'EOF' > ...) Engine
  // =========================================================================
  describe("2. Cat Heredoc Creation Engine", () => {
    it("2.1: handles standard single-quoted delimiter heredoc", async () => {
      const p = arena.registerPlayer({ nickname: "HeredocStdKid", clientIp: "127.0.0.1" });
      const heredoc = `cat << 'EOF' > full_script.sh
#!/bin/bash
IP="10.10.1.1"
echo "Target: $IP"
curl -s "http://$IP:9000/megacorp-backup/config.env"
EOF`;

      assert.equal(runner.isScriptCommand(heredoc), true);
      const res = await runner.execute(heredoc, p.id);
      assert.equal(res.handled, true);
      assert.ok(stripAnsi(res.output).includes("셸 스크립트 작성 완료: full_script.sh"));

      const saved = runner.getUserFileContent(p.id, "full_script.sh");
      assert.ok(saved?.includes(`IP="10.10.1.1"`));
      assert.ok(saved?.includes(`curl -s "http://$IP:9000/megacorp-backup/config.env"`));
    });

    it("2.2: handles alternate delimiters (e.g. END, STOP, SH_EOF)", async () => {
      const p = arena.registerPlayer({ nickname: "HeredocAltKid", clientIp: "127.0.0.1" });
      const heredoc = `cat << 'CUSTOM_DELIM' > alt_delim.sh
line A
line B
CUSTOM_DELIM`;

      const res = await runner.execute(heredoc, p.id);
      assert.equal(res.handled, true);

      const saved = runner.getUserFileContent(p.id, "alt_delim.sh");
      assert.equal(saved, "line A\nline B");
    });

    it("2.3: handles unquoted and double-quoted delimiter syntax", async () => {
      const p = arena.registerPlayer({ nickname: "HeredocSyntaxKid", clientIp: "127.0.0.1" });

      const heredocUnquoted = `cat << EOF > unquoted.sh
hello unquoted $VAR
EOF`;
      await runner.execute(heredocUnquoted, p.id);
      assert.equal(runner.getUserFileContent(p.id, "unquoted.sh"), "hello unquoted $VAR");

      const heredocDouble = `cat << "EOF" > double_delim.sh
hello double $VAR
EOF`;
      await runner.execute(heredocDouble, p.id);
      assert.equal(runner.getUserFileContent(p.id, "double_delim.sh"), "hello double $VAR");
    });

    it("2.4: handles redirection before heredoc operator (cat > file << 'EOF')", async () => {
      const p = arena.registerPlayer({ nickname: "HeredocReverseKid", clientIp: "127.0.0.1" });
      const heredoc = `cat > reversed.sh << 'EOF'
reverse line 1
reverse line 2
EOF`;

      const res = await runner.execute(heredoc, p.id);
      assert.equal(res.handled, true);

      const saved = runner.getUserFileContent(p.id, "reversed.sh");
      assert.equal(saved, "reverse line 1\nreverse line 2");
    });

    it("2.5: handles tab-stripping heredoc syntax (<<-)", async () => {
      const p = arena.registerPlayer({ nickname: "HeredocTabKid", clientIp: "127.0.0.1" });
      const heredoc = `cat <<- 'EOF' > tabbed.sh
\t\tline with leading tabs
\t\tanother tabbed line
EOF`;

      const res = await runner.execute(heredoc, p.id);
      assert.equal(res.handled, true);

      const saved = runner.getUserFileContent(p.id, "tabbed.sh");
      assert.equal(saved, "line with leading tabs\nanother tabbed line");
    });

    it("2.6: handles heredoc append operator (>>)", async () => {
      const p = arena.registerPlayer({ nickname: "HeredocAppendKid", clientIp: "127.0.0.1" });

      await runner.execute(`echo 'first_line' > append_h.sh`, p.id);
      const appendDoc = `cat << 'EOF' >> append_h.sh
second_line
third_line
EOF`;
      await runner.execute(appendDoc, p.id);

      const saved = runner.getUserFileContent(p.id, "append_h.sh");
      assert.equal(saved, "first_line\nsecond_line\nthird_line");
    });
  });

  // =========================================================================
  // Section 3: Multi-Script Lifecycle & Per-Player Filesystem Isolation
  // =========================================================================
  describe("3. Multi-Script Lifecycle & Strict Per-Player Isolation", () => {
    it("3.1: manages multiple scripts, overwrite, deletion (rm), chmod, and ls", async () => {
      const p = arena.registerPlayer({ nickname: "LifecycleMaster", clientIp: "127.0.0.1" });

      // Create 3 scripts
      await runner.execute(`echo 'echo A' > scriptA.sh`, p.id);
      await runner.execute(`echo 'echo B' > scriptB.sh`, p.id);
      await runner.execute(`echo 'echo C' > scriptC.sh`, p.id);

      // Verify ls lists all 3
      let lsRes = await runner.execute("ls", p.id);
      let cleanLs = stripAnsi(lsRes.output);
      assert.ok(cleanLs.includes("scriptA.sh"));
      assert.ok(cleanLs.includes("scriptB.sh"));
      assert.ok(cleanLs.includes("scriptC.sh"));

      // Overwrite scriptA.sh
      await runner.execute(`echo 'echo A_UPDATED_CONTENT' > scriptA.sh`, p.id);
      const catA = await runner.execute("cat scriptA.sh", p.id);
      assert.ok(stripAnsi(catA.output).includes("echo A_UPDATED_CONTENT"));

      // Chmod +x scriptB.sh
      const chmodRes = await runner.execute("chmod +x scriptB.sh", p.id);
      assert.ok(stripAnsi(chmodRes.output).includes("실행 권한 부여 완료: chmod +x scriptB.sh"));

      // Remove scriptC.sh
      const rmRes = await runner.execute("rm scriptC.sh", p.id);
      assert.ok(stripAnsi(rmRes.output).includes("Removed scriptC.sh"));

      // Verify scriptC is gone from ls and cat
      lsRes = await runner.execute("ls", p.id);
      cleanLs = stripAnsi(lsRes.output);
      assert.ok(!cleanLs.includes("scriptC.sh"), "Deleted file must not appear in ls");

      const catC = await runner.execute("cat scriptC.sh", p.id);
      assert.ok(stripAnsi(catC.output).includes("No such file or directory"));

      // rm -f on nonexistent file should silently pass
      const rmForce = await runner.execute("rm -f non_existent.sh", p.id);
      assert.equal(rmForce.output, "");

      // rm on embedded system tool should be denied
      const rmSystem = await runner.execute("rm whois_scan.sh", p.id);
      assert.ok(stripAnsi(rmSystem.output).includes("Permission denied"));
    });

    it("3.2: strictly isolates user scripts between multiple players", async () => {
      const alice = arena.registerPlayer({ nickname: "AliceHacker", clientIp: "10.0.0.1" });
      const bob = arena.registerPlayer({ nickname: "BobHacker", clientIp: "10.0.0.2" });

      // Alice creates a private script
      await runner.execute(`echo '# ALICE PRIVATE EXPLOIT' > secret_payload.sh`, alice.id);

      // Bob checks ls — must NOT see Alice's file
      const bobLs = await runner.execute("ls", bob.id);
      assert.ok(!stripAnsi(bobLs.output).includes("secret_payload.sh"), "Bob must not see Alice's files in ls");

      // Bob tries to cat Alice's file — must fail
      const bobCat = await runner.execute("cat secret_payload.sh", bob.id);
      assert.ok(stripAnsi(bobCat.output).includes("No such file or directory"));

      // Bob tries to execute Alice's file — must fail
      const bobExec = await runner.execute("bash secret_payload.sh", bob.id);
      assert.ok(stripAnsi(bobExec.output).includes("No such file or directory"));

      // Bob creates own file with the same name
      await runner.execute(`echo '# BOB PRIVATE EXPLOIT' > secret_payload.sh`, bob.id);

      // Both read their own versions
      const aliceRead = await runner.execute("cat secret_payload.sh", alice.id);
      const bobRead = await runner.execute("cat secret_payload.sh", bob.id);

      assert.ok(stripAnsi(aliceRead.output).includes("# ALICE PRIVATE EXPLOIT"));
      assert.ok(stripAnsi(bobRead.output).includes("# BOB PRIVATE EXPLOIT"));

      // Alice deletes her file — Bob's file must remain intact
      await runner.execute("rm secret_payload.sh", alice.id);
      assert.equal(runner.getUserFileContent(alice.id, "secret_payload.sh"), undefined);
      assert.equal(runner.getUserFileContent(bob.id, "secret_payload.sh"), "# BOB PRIVATE EXPLOIT");
    });
  });

  // =========================================================================
  // Section 4: Execution of 5 Core Embedded Scripts & Full Vulnerability Scoring
  // =========================================================================
  describe("4. Execution of 5 Core Embedded Scripts & Real-time Scoring", () => {
    it("4.1: executes whois_scan.sh and scores all 10 Whois vulnerable nodes", async () => {
      const p = arena.registerPlayer({ nickname: "WhoisScannerUser", clientIp: "127.0.0.1" });

      // Execute via bash whois_scan.sh
      const res = await runner.execute("bash whois_scan.sh", p.id);
      assert.equal(res.handled, true);
      assert.ok(stripAnsi(res.output).includes("Whois 스위프 완료"));
      assert.equal(res.evaluatedTargets?.length, 10, "Must sweep all 10 Whois targets");
      assert.ok((res.totalScoreGained || 0) >= 500, "Should gain points for 10 whois targets");

      const refreshed = arena.getPlayer(p.id);
      assert.ok(refreshed);
      assert.equal(refreshed.compromisedCount, 10);
      assert.ok(refreshed.score >= 500);
    });

    it("4.2: executes axfr_scan.sh and scores all 10 DNS-AXFR vulnerable nodes", async () => {
      const p = arena.registerPlayer({ nickname: "AxfrScannerUser", clientIp: "127.0.0.1" });

      // Execute via ./axfr_scan.sh
      const res = await runner.execute("./axfr_scan.sh", p.id);
      assert.equal(res.handled, true);
      assert.ok(stripAnsi(res.output).includes("AXFR 셸 스크립트 완료"));
      assert.equal(res.evaluatedTargets?.length, 10, "Must sweep all 10 DNS-AXFR targets");
      assert.ok((res.totalScoreGained || 0) >= 1000);

      const refreshed = arena.getPlayer(p.id);
      assert.ok(refreshed);
      assert.equal(refreshed.compromisedCount, 10);
    });

    it("4.3: executes nmap_scan.sh and scores all 10 WEB/PORT banner targets", async () => {
      const p = arena.registerPlayer({ nickname: "NmapScannerUser", clientIp: "127.0.0.1" });

      // Execute via sh nmap_scan.sh
      const res = await runner.execute("sh nmap_scan.sh", p.id);
      assert.equal(res.handled, true);
      assert.ok(stripAnsi(res.output).includes("Nmap 포트 스캔 셸 스크립트 완료"));
      assert.equal(res.evaluatedTargets?.length, 10, "Must sweep all 10 Web/Banner targets");
      assert.ok((res.totalScoreGained || 0) >= 1000);

      const refreshed = arena.getPlayer(p.id);
      assert.ok(refreshed);
      assert.equal(refreshed.compromisedCount, 10);
    });

    it("4.4: executes s3_leak_scan.sh and scores all 10 S3 public bucket targets", async () => {
      const p = arena.registerPlayer({ nickname: "S3ScannerUser", clientIp: "127.0.0.1" });

      // Execute via bash /root/tools/s3_leak_scan.sh
      const res = await runner.execute("bash /root/tools/s3_leak_scan.sh", p.id);
      assert.equal(res.handled, true);
      assert.ok(stripAnsi(res.output).includes("S3 버킷 점검 셸 스크립트 완료"));
      assert.equal(res.evaluatedTargets?.length, 10, "Must sweep all 10 S3 targets");
      assert.ok((res.totalScoreGained || 0) >= 1500);

      const refreshed = arena.getPlayer(p.id);
      assert.ok(refreshed);
      assert.equal(refreshed.compromisedCount, 10);
    });

    it("4.5: executes auto_pwn.sh and scores all 60 vulnerable nodes across all 6 categories", async () => {
      const p = arena.registerPlayer({ nickname: "GrandAutoPwnUser", clientIp: "127.0.0.1" });

      // Execute via bash auto_pwn.sh
      const res = await runner.execute("bash auto_pwn.sh", p.id);
      assert.equal(res.handled, true);
      assert.ok(stripAnsi(res.output).includes("종합 셸 스크립트 실행 완료"));
      assert.ok(stripAnsi(res.output).includes("총 60개 취약 서버 전수 탈취"));
      assert.equal(res.evaluatedTargets?.length, 60, "Must sweep all 60 vulnerable targets across all categories");
      assert.ok((res.totalScoreGained || 0) >= 6000, "Should gain massive score for all 60 nodes");

      const refreshed = arena.getPlayer(p.id);
      assert.ok(refreshed);
      assert.equal(refreshed.compromisedCount, 60, "Player must have 60 compromised nodes");
    });

    it("4.6: supports quick sweep command shortcuts (whois-scan, axfr-scan, nmap-scan, s3-scan, auto-pwn)", async () => {
      const p = arena.registerPlayer({ nickname: "ShortcutKid", clientIp: "127.0.0.1" });

      assert.equal(runner.isScriptCommand("whois-scan"), true);
      assert.equal(runner.isScriptCommand("axfr-scan"), true);
      assert.equal(runner.isScriptCommand("nmap-scan"), true);
      assert.equal(runner.isScriptCommand("s3-scan"), true);
      assert.equal(runner.isScriptCommand("auto-pwn"), true);

      const whoisRes = await runner.execute("whois-scan", p.id);
      assert.equal(whoisRes.handled, true);
      assert.equal(whoisRes.evaluatedTargets?.length, 10);

      const s3Res = await runner.execute("s3-scan", p.id);
      assert.equal(s3Res.handled, true);
      assert.equal(s3Res.evaluatedTargets?.length, 10);
    });
  });

  // =========================================================================
  // Section 5: Custom Script Execution, Idempotency & Competitive Scoring
  // =========================================================================
  describe("5. Custom Script Execution, Scoring Idempotency & Multi-Player Leaderboard", () => {
    it("5.1: player writes and executes custom multi-vector script", async () => {
      const p = arena.registerPlayer({ nickname: "CustomScriptPwn", clientIp: "127.0.0.1" });

      // Custom script targeting AXFR and S3
      const scriptBody = `cat << 'EOF' > my_custom_sweep.sh
#!/bin/bash
for i in $(seq 1 200); do
  dig axfr @10.10.1.$i megacorp.internal
done
EOF`;
      await runner.execute(scriptBody, p.id);
      await runner.execute("chmod +x my_custom_sweep.sh", p.id);

      const execRes = await runner.execute("./my_custom_sweep.sh", p.id);
      assert.equal(execRes.handled, true);
      assert.ok(stripAnsi(execRes.output).includes("AXFR 셸 스크립트 완료"));
      assert.equal(execRes.evaluatedTargets?.length, 10);

      const refreshed = arena.getPlayer(p.id);
      assert.equal(refreshed?.compromisedCount, 10);
    });

    it("5.2: script re-execution is idempotent (prevents duplicate point gain)", async () => {
      const p = arena.registerPlayer({ nickname: "IdempotentUser", clientIp: "127.0.0.1" });

      // Run 1: first compromise
      const run1 = await runner.execute("bash axfr_scan.sh", p.id);
      const points1 = run1.totalScoreGained || 0;
      assert.ok(points1 > 0);

      const scoreAfterRun1 = arena.getPlayer(p.id)!.score;

      // Run 2: duplicate sweep
      const run2 = await runner.execute("bash axfr_scan.sh", p.id);
      const points2 = run2.totalScoreGained || 0;
      assert.equal(points2, 0, "Duplicate sweep must not award points again");

      const scoreAfterRun2 = arena.getPlayer(p.id)!.score;
      assert.equal(scoreAfterRun2, scoreAfterRun1, "Score must remain unchanged on duplicate compromise");
    });

    it("5.3: competitive scoring grants First Blood bonus to the first discoverer only", async () => {
      // Create fresh match for competitive race
      const freshMesh = new MockInternetMesh(9999);
      const freshArena = new ArenaManager(freshMesh, { firstBloodBonus: 75 });
      const freshRunner = new ArenaScriptRunner(freshMesh, freshArena);
      freshArena.startMatch();

      const speedster = freshArena.registerPlayer({ nickname: "SpeedsterA", clientIp: "10.0.0.1" });
      const follower = freshArena.registerPlayer({ nickname: "FollowerB", clientIp: "10.0.0.2" });

      // Speedster compromises whois targets first -> gets First Blood (+75 bonus per node)
      const resA = await freshRunner.execute("bash whois_scan.sh", speedster.id);
      assert.ok(stripAnsi(resA.output).includes("FIRST BLOOD BONUS"));

      // Follower runs whois scan later -> gets standard points, NO First Blood
      const resB = await freshRunner.execute("bash whois_scan.sh", follower.id);
      assert.ok(!stripAnsi(resB.output).includes("FIRST BLOOD BONUS"));

      const playerA = freshArena.getPlayer(speedster.id)!;
      const playerB = freshArena.getPlayer(follower.id)!;

      assert.equal(playerA.compromisedCount, 10);
      assert.equal(playerB.compromisedCount, 10);
      assert.equal(playerA.firstBloodCount, 10);
      assert.equal(playerB.firstBloodCount, 0);

      // Speedster score = 10 * (50 base + 75 bonus) = 1250
      // Follower score = 10 * 50 base = 500
      assert.equal(playerA.score, 1250);
      assert.equal(playerB.score, 500);

      // Verify Leaderboard ranking
      const lb = freshArena.getLeaderboard();
      assert.equal(lb[0].playerId, speedster.id);
      assert.equal(lb[0].rank, 1);
      assert.equal(lb[1].playerId, follower.id);
      assert.equal(lb[1].rank, 2);

      freshArena.destroy();
    });
  });
});
