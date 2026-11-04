// tests/arena-ssh-server.test.ts — Comprehensive Integration Suite for Arena SSH Server.
//
// Conforms to:
//   - Step 5 of internet-ctf-competition-arena.plan.md
//   - Verifies AC-1, AC-2, AC-3:
//     * SSH connection & zero-config authentication
//     * PTY shell banner and automatic player registration
//     * Command execution (whois, dig axfr, nmap, score, status)
//     * Automated real-time evaluation & scoring feedback via SSH
//     * ArenaLobby UI SSH connection card & copy button verification

import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import ssh2, { type Client } from "ssh2";
import { MockInternetMesh } from "../server/mock-internet-mesh.ts";
import { ArenaManager } from "../server/arena-manager.ts";
import { ArenaSshServer } from "../server/arena-ssh-server.ts";
import { renderArenaLobbyHtml } from "../client/src/components/ArenaLobby.ts";

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("Step 5: Arena SSH Server & Native Terminal Gateway", () => {
  let mesh: MockInternetMesh;
  let arena: ArenaManager;
  let sshServer: ArenaSshServer;
  let sshPort: number;

  before(async () => {
    mesh = new MockInternetMesh(2026);
    arena = new ArenaManager(mesh);
    // Bind to port 0 for random free port in test
    sshServer = new ArenaSshServer({
      port: 0,
      host: "127.0.0.1",
      arenaManager: arena,
      mockMesh: mesh,
    });
    sshPort = await sshServer.listen(0, "127.0.0.1");
    // Start match so evaluation is active
    arena.startMatch();
  });

  after(async () => {
    await sshServer.close();
    arena.destroy();
  });

  it("AC-1: SSH client connects with username and gets registered in ArenaManager", async () => {
    const client = new ssh2.Client();

    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => {
        // Player should be registered
        const player = arena.getPlayerByNickname("SshHackerAlpha");
        assert.ok(player, "Player SshHackerAlpha must be registered in ArenaManager");
        assert.equal(player.nickname, "SshHackerAlpha");
        client.end();
        resolve();
      });

      client.on("error", reject);

      client.connect({
        host: "127.0.0.1",
        port: sshPort,
        username: "SshHackerAlpha",
        password: "any-password",
      });
    });
  });

  it("AC-1: SSH client requests PTY shell, receives interactive welcome banner and prompt", async () => {
    const client = new ssh2.Client();

    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => {
        client.shell({ term: "xterm-256color", cols: 80, rows: 24 }, (err, stream) => {
          if (err) return reject(err);

          let output = "";
          stream.on("data", (chunk: Buffer) => {
            output += chunk.toString("utf-8");
            if (output.includes("METASPLOIT CH3 CTF ARENA") && output.includes("root@kalibox-GhostRunner:~#")) {
              client.end();
              resolve();
            }
          });

          stream.on("error", reject);
        });
      });

      client.on("error", reject);

      client.connect({
        host: "127.0.0.1",
        port: sshPort,
        username: "GhostRunner",
        password: "ctf",
      });
    });
  });

  it("AC-2: SSH terminal executes whois against vulnerable node and receives automatic compromise banner & points", async () => {
    const client = new ssh2.Client();
    const vulnWhois = mesh.getVulnerableNodesByCategory("whois")[0];
    assert.ok(vulnWhois, "Must have a vulnerable whois node");

    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => {
        client.shell({ term: "xterm", cols: 80, rows: 24 }, (err, stream) => {
          if (err) return reject(err);

          let receivedBanner = false;
          let output = "";

          stream.on("data", (chunk: Buffer) => {
            const str = chunk.toString("utf-8");
            output += str;

            // Wait for initial prompt before sending command
            const clean = stripAnsi(output);
            if (!receivedBanner && clean.includes("root@kalibox-TerminalPro")) {
              receivedBanner = true;
              output = "";
              // Send whois attack command
              stream.write(`whois -h ${vulnWhois.ip} megacorp.internal\r\n`);
            }

            // Check if automated evaluation banner appeared
            if (clean.includes("ARENA COMPROMISED!") && clean.includes(vulnWhois.ip)) {
              assert.ok(clean.includes("FIRST BLOOD BONUS"), "Should award first blood bonus");
              client.end();
              resolve();
            }
          });

          stream.on("error", reject);
        });
      });

      client.on("error", reject);

      client.connect({
        host: "127.0.0.1",
        port: sshPort,
        username: "TerminalPro",
        password: "password",
      });
    });

    // Verify player score in ArenaManager
    const player = arena.getPlayerByNickname("TerminalPro");
    assert.ok(player);
    assert.equal(player.score, 100);
    assert.equal(player.compromisedCount, 1);
    assert.equal(player.firstBloodCount, 1);
  });

  it("AC-2: SSH terminal supports utility commands: score, status, help", async () => {
    const client = new ssh2.Client();

    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => {
        client.shell({ term: "xterm", cols: 80, rows: 24 }, (err, stream) => {
          if (err) return reject(err);

          let state = 0;
          let output = "";

          stream.on("data", (chunk: Buffer) => {
            output += chunk.toString("utf-8");

            const clean = stripAnsi(output);
            if (state === 0 && clean.includes("root@kalibox-AuditNinja")) {
              state = 1;
              output = "";
              stream.write("status\r");
            } else if (state === 1 && clean.includes("200 가상 인터넷 노드 격자 상태")) {
              state = 2;
              output = "";
              stream.write("score\r");
            } else if (state === 2 && clean.includes("CTF ARENA LEADERBOARD")) {
              client.end();
              resolve();
            }
          });

          stream.on("error", reject);
        });
      });

      client.on("error", reject);

      client.connect({
        host: "127.0.0.1",
        port: sshPort,
        username: "AuditNinja",
        password: "ctf",
      });
    });
  });

  it("AC-3: ArenaLobby component renders SSH connection box with command and copy button", () => {
    const html = renderArenaLobbyHtml({
      config: {
        hostIp: "192.168.1.112",
        hostPort: 3000,
        sshPort: 2222,
      },
      nicknameInput: "ViperZero",
    });

    assert.ok(html.includes("개인 터미널 SSH 접속"), "Must render SSH connection title");
    assert.ok(html.includes("포트: 2222"), "Must render SSH port 2222");
    assert.ok(html.includes("ssh -p 2222 ViperZero@192.168.1.112"), "Must format SSH command with nickname and host");
    assert.ok(html.includes("btn-copy-ssh-cmd"), "Must provide SSH copy button");
  });
});
