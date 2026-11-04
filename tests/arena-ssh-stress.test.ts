// tests/arena-ssh-stress.test.ts — Stress & Robustness Suite for CTF Arena SSH Server.
//
// Verifies:
//   1. 10+ concurrent SSH client connections, parallel shell sessions, and clean disconnect/EOF handling.
//   2. Interactive PTY control characters: Backspace (\x7f, \x08), Arrow keys (\x1b[A, \x1b[B), Ctrl+C (\x03),
//      Ctrl+D (\x04), long command (>1000 chars), and newline normalization (\r\n vs \n).
//   3. Core competition commands: whois -h, dig axfr, bash /root/tools/..., score, status, help
//      with exact output verification and automated real-time CTF score acquisition.

import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import ssh2, { type Client, type ClientChannel } from "ssh2";
import { MockInternetMesh } from "../server/mock-internet-mesh.ts";
import { ArenaManager } from "../server/arena-manager.ts";
import { ArenaSshServer } from "../server/arena-ssh-server.ts";

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b[=><]/g, "");
}

interface SshSession {
  client: Client;
  stream: ClientChannel;
  outputBuffer: string;
}

function connectSsh(port: number, username: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client();
    const timeout = setTimeout(() => {
      client.end();
      reject(new Error(`Connection timeout for ${username}`));
    }, 10000);

    client.on("ready", () => {
      clearTimeout(timeout);
      resolve(client);
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    client.connect({
      host: "127.0.0.1",
      port,
      username,
      password: "ctf-password",
      readyTimeout: 8000,
    });
  });
}

function openShellSession(client: Client): Promise<{ stream: ClientChannel; initialBanner: string }> {
  return new Promise((resolve, reject) => {
    client.shell({ term: "xterm-256color", cols: 80, rows: 24 }, (err, stream) => {
      if (err) return reject(err);

      let buf = "";
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf-8");
        const clean = stripAnsi(buf);
        if (clean.includes(":~#")) {
          stream.removeListener("data", onData);
          resolve({ stream, initialBanner: buf });
        }
      };

      stream.on("data", onData);
      stream.on("error", reject);
    });
  });
}

function executeInteractiveCommand(
  stream: ClientChannel,
  commandToSend: string,
  timeoutMs = 8000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = "";
    const timer = setTimeout(() => {
      stream.removeListener("data", onData);
      reject(new Error(`Timeout waiting for command response. Got: ${received.slice(-300)}`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      received += chunk.toString("utf-8");
      const clean = stripAnsi(received);
      // Wait until next prompt appears
      if (clean.includes(":~#") || clean.includes("msf6 > ")) {
        clearTimeout(timer);
        stream.removeListener("data", onData);
        resolve(received);
      }
    };

    stream.on("data", onData);
    stream.write(commandToSend);
  });
}

describe("Arena SSH Server — Stress & Interactive Shell Suite", () => {
  let mesh: MockInternetMesh;
  let arena: ArenaManager;
  let sshServer: ArenaSshServer;
  let sshPort: number;

  before(async () => {
    mesh = new MockInternetMesh(2026);
    arena = new ArenaManager(mesh);
    sshServer = new ArenaSshServer({
      port: 0,
      host: "127.0.0.1",
      arenaManager: arena,
      mockMesh: mesh,
    });
    sshPort = await sshServer.listen(0, "127.0.0.1");
    arena.startMatch();
  });

  after(async () => {
    await sshServer.close();
    arena.destroy();
  });

  // =========================================================================
  // 1. Concurrent Connections (10+ simultaneous SSH sessions)
  // =========================================================================
  it("Feature 1: Handles 12 simultaneous SSH client connections, parallel shell sessions, and clean disconnects", async () => {
    const CLIENT_COUNT = 12;
    const clients: Client[] = [];
    const sessions: ClientChannel[] = [];

    // 1. Concurrently connect all 12 clients
    const connectPromises = Array.from({ length: CLIENT_COUNT }, (_, i) =>
      connectSsh(sshPort, `StressPlayer_${i + 1}`)
    );
    const connectedClients = await Promise.all(connectPromises);
    clients.push(...connectedClients);

    // Verify all 12 are connected in server state
    assert.equal(
      sshServer.getConnectedCount(),
      CLIENT_COUNT,
      `Expected ${CLIENT_COUNT} active SSH clients in server`
    );

    // Verify all 12 players are registered in ArenaManager
    for (let i = 1; i <= CLIENT_COUNT; i++) {
      const p = arena.getPlayerByNickname(`StressPlayer_${i}`);
      assert.ok(p, `Player StressPlayer_${i} must be registered in ArenaManager`);
    }

    // 2. Concurrently open PTY shell on all 12 clients
    const shellPromises = clients.map((c) => openShellSession(c));
    const openedShells = await Promise.all(shellPromises);
    for (const s of openedShells) {
      sessions.push(s.stream);
      assert.ok(s.initialBanner.includes("METASPLOIT CH3 CTF ARENA"), "Must show arena banner");
    }

    // 3. Concurrently run commands across all 12 sessions
    const cmdPromises = sessions.map((stream, idx) => {
      const cmd = idx % 2 === 0 ? "status\r" : "score\r";
      return executeInteractiveCommand(stream, cmd);
    });
    const cmdOutputs = await Promise.all(cmdPromises);

    for (let i = 0; i < cmdOutputs.length; i++) {
      const clean = stripAnsi(cmdOutputs[i]);
      if (i % 2 === 0) {
        assert.ok(clean.includes("200 가상 인터넷 노드 격자 상태"), "Must include status output");
      } else {
        assert.ok(clean.includes("CTF ARENA LEADERBOARD"), "Must include leaderboard output");
      }
    }

    // 4. Graceful disconnect half via EOF / stream.end()
    const halfCount = Math.floor(CLIENT_COUNT / 2);
    for (let i = 0; i < halfCount; i++) {
      sessions[i].end();
      clients[i].end();
    }

    // Allow network event loop tick
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(
      sshServer.getConnectedCount(),
      CLIENT_COUNT - halfCount,
      "Connected count must decrease after half disconnect"
    );

    // 5. Disconnect remaining half
    for (let i = halfCount; i < CLIENT_COUNT; i++) {
      clients[i].end();
    }

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(sshServer.getConnectedCount(), 0, "All clients must be cleanly disconnected");
  });

  // =========================================================================
  // 2. Control Characters, Backspace, Arrows, Long Commands, Line Endings
  // =========================================================================
  describe("Feature 2: PTY Interactive Terminal Control Characters", () => {
    let client: Client;
    let stream: ClientChannel;

    before(async () => {
      client = await connectSsh(sshPort, "TerminalOperator");
      const shell = await openShellSession(client);
      stream = shell.stream;
    });

    after(() => {
      try {
        client.end();
      } catch {}
    });

    it("Backspace (\\x7f and \\x08): Correctly deletes characters and executes repaired command", async () => {
      // Send typo 'statuuss' + 2 \x7f (DEL) + 's\r' -> 'status'
      const outputDel = await executeInteractiveCommand(stream, "statuuss\x7f\x7fs\r");
      const cleanDel = stripAnsi(outputDel);
      assert.ok(cleanDel.includes("200 가상 인터넷 노드 격자 상태"), "Must execute 'status' after \\x7f backspace");

      // Send typo 'helpp' + 1 \x08 (BS) + '\r' -> 'help'
      const outputBs = await executeInteractiveCommand(stream, "helpp\x08\r");
      const cleanBs = stripAnsi(outputBs);
      assert.ok(cleanBs.includes("CTF ARENA SSH SHELL COMMANDS"), "Must execute 'help' after \\x08 backspace");
    });

    it("Arrow Keys (\\x1b[A, \\x1b[B): Recalls previous command from history and executes", async () => {
      // 1. Run 'help' to put in history
      await executeInteractiveCommand(stream, "help\r");

      // 2. Send Up Arrow (\x1b[A) followed by Enter (\r)
      const outputRecall = await executeInteractiveCommand(stream, "\x1b[A\r");
      const cleanRecall = stripAnsi(outputRecall);
      assert.ok(cleanRecall.includes("CTF ARENA SSH SHELL COMMANDS"), "Must recall and execute 'help' via Up arrow");
    });

    it("Control character Ctrl+C (\\x03): Aborts typed line and prints fresh prompt without executing", async () => {
      // Send partially typed command followed by \x03
      const abortOutput = await new Promise<string>((resolve) => {
        let buf = "";
        const onData = (chunk: Buffer) => {
          buf += chunk.toString("utf-8");
          if (buf.includes("^C") && stripAnsi(buf).includes(":~#")) {
            stream.removeListener("data", onData);
            resolve(buf);
          }
        };
        stream.on("data", onData);
        stream.write("partially_typed_malicious_cmd\x03");
      });

      assert.ok(abortOutput.includes("^C"), "Must echo ^C on Ctrl+C");
      assert.ok(stripAnsi(abortOutput).includes(":~#"), "Must redisplay prompt");

      // Now ensure next command executes cleanly
      const nextOutput = await executeInteractiveCommand(stream, "help\r");
      assert.ok(stripAnsi(nextOutput).includes("CTF ARENA SSH SHELL COMMANDS"), "Next command executes normally");
    });

    it("Line endings (\\r\\n and \\n): Correctly executes without duplicate phantom prompts", async () => {
      // Test CRLF (\r\n)
      const outCrlf = await executeInteractiveCommand(stream, "status\r\n");
      const cleanCrlf = stripAnsi(outCrlf);
      assert.ok(cleanCrlf.includes("200 가상 인터넷 노드 격자 상태"), "Must handle \\r\\n properly");

      // Test LF only (\n)
      const outLf = await executeInteractiveCommand(stream, "status\n");
      const cleanLf = stripAnsi(outLf);
      assert.ok(cleanLf.includes("200 가상 인터넷 노드 격자 상태"), "Must handle \\n properly");
    });

    it("Long command (>1000 characters): Buffers and executes without truncation or crash", async () => {
      const padding = "A".repeat(1200);
      const longCmd = `echo '${padding}' > long_payload.txt\r`;
      const outLong = await executeInteractiveCommand(stream, longCmd);
      const cleanLong = stripAnsi(outLong);
      assert.ok(cleanLong.includes("셸 스크립트") || cleanLong.includes("long_payload.txt"), "Must handle >1000 byte command");
    });

    it("Control character Ctrl+D (\\x04): Logs out cleanly when input is empty", async () => {
      const clientD = await connectSsh(sshPort, "LogoutUser");
      const shellD = await openShellSession(clientD);

      const logoutPromise = new Promise<string>((resolve) => {
        let buf = "";
        shellD.stream.on("data", (chunk: Buffer) => {
          buf += chunk.toString("utf-8");
        });
        shellD.stream.on("close", () => {
          resolve(buf);
        });
      });

      // Send Ctrl+D
      shellD.stream.write("\x04");
      const logoutOutput = await logoutPromise;
      assert.ok(logoutOutput.includes("logout"), "Must print logout on Ctrl+D");
      clientD.end();
    });
  });

  // =========================================================================
  // 3. Attack Commands & Automated Real-Time Scoring
  // =========================================================================
  describe("Feature 3: Command Execution & Automated Real-Time CTF Scoring", () => {
    let client: Client;
    let stream: ClientChannel;
    let playerNickname: string;

    before(async () => {
      playerNickname = "EliteHacker99";
      client = await connectSsh(sshPort, playerNickname);
      const shell = await openShellSession(client);
      stream = shell.stream;
    });

    after(() => {
      try {
        client.end();
      } catch {}
    });

    it("whois -h: Queries vulnerable Whois node, extracts flag, and awards FirstBlood bonus", async () => {
      const vulnWhois = mesh.getVulnerableNodesByCategory("whois")[0];
      assert.ok(vulnWhois, "Must have at least one vulnerable whois node");

      const out = await executeInteractiveCommand(stream, `whois -h ${vulnWhois.ip} megacorp.internal\r`);
      const clean = stripAnsi(out);

      // Verify Whois output
      assert.ok(clean.includes("MEGA-INFRA.NET") || clean.includes("admin@mega-infra.net"), "Must return whois registry");
      assert.ok(clean.includes("ARENA COMPROMISED!"), "Must trigger compromise banner");
      assert.ok(clean.includes(vulnWhois.ip), "Banner must mention target IP");
      assert.ok(clean.includes("FIRST BLOOD BONUS"), "Must award first blood bonus");

      // Verify player state in ArenaManager
      const player = arena.getPlayerByNickname(playerNickname);
      assert.ok(player);
      assert.ok(player.score >= 150, "Score should include 100 base + 50 FirstBlood");
      assert.equal(player.compromisedCount, 1);
      assert.equal(player.firstBloodCount, 1);
    });

    it("dig axfr: Queries vulnerable DNS node, retrieves zone records, and awards points", async () => {
      const vulnAxfr = mesh.getVulnerableNodesByCategory("dns-axfr")[0];
      assert.ok(vulnAxfr, "Must have at least one vulnerable dns-axfr node");

      const out = await executeInteractiveCommand(stream, `dig axfr @${vulnAxfr.ip} mega-infra.net\r`);
      const clean = stripAnsi(out);

      assert.ok(clean.includes("Zone Transfer") || clean.includes("admin-vault"), "Must contain AXFR output");
      assert.ok(clean.includes("ARENA COMPROMISED!"), "Must trigger compromise banner");
      assert.ok(clean.includes(vulnAxfr.ip), "Banner must mention target IP");

      const player = arena.getPlayerByNickname(playerNickname);
      assert.ok(player);
      assert.equal(player.compromisedCount, 2);
    });

    it("bash /root/tools/...: Executes embedded whois_scan.sh script and batch-compromises nodes", async () => {
      const initialPlayer = arena.getPlayerByNickname(playerNickname)!;
      const initialScore = initialPlayer.score;

      const out = await executeInteractiveCommand(stream, "bash /root/tools/whois_scan.sh\r");
      const clean = stripAnsi(out);

      assert.ok(clean.includes("whois_scan.sh"), "Must show script execution header");
      assert.ok(clean.includes("Whois 스위프 완료") || clean.includes("취약점 발견 및 탈취"), "Must show scan completion");

      const player = arena.getPlayerByNickname(playerNickname)!;
      assert.ok(player.score > initialScore, "Player score must increase after running whois_scan.sh");
      assert.ok(player.compromisedCount >= 10, "Should compromise all whois nodes in mesh");
    });

    it("Utility commands: score, status, help return formatted and accurate data", async () => {
      // 1. score
      const scoreOut = await executeInteractiveCommand(stream, "score\r");
      const cleanScore = stripAnsi(scoreOut);
      assert.ok(cleanScore.includes("CTF ARENA LEADERBOARD"), "Must show leaderboard header");
      assert.ok(cleanScore.includes(playerNickname), "Must show current player nickname");
      assert.ok(cleanScore.includes("1위") || cleanScore.includes("위"), "Must show player rank");

      // 2. status
      const statusOut = await executeInteractiveCommand(stream, "status\r");
      const cleanStatus = stripAnsi(statusOut);
      assert.ok(cleanStatus.includes("200 가상 인터넷 노드 격자 상태"), "Must show grid status");
      assert.ok(cleanStatus.includes("200대"), "Must report 200 virtual nodes");
      assert.ok(cleanStatus.includes("탈취 완료"), "Must report compromised count");

      // 3. help
      const helpOut = await executeInteractiveCommand(stream, "help\r");
      const cleanHelp = stripAnsi(helpOut);
      assert.ok(cleanHelp.includes("CTF ARENA SSH SHELL COMMANDS"), "Must show help header");
      assert.ok(cleanHelp.includes("whois -h"), "Must document whois command");
      assert.ok(cleanHelp.includes("dig axfr"), "Must document dig command");
    });
  });
});
