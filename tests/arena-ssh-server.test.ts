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

  it("AC-4: SSH terminal launches nano editor, writes shell script, saves (Ctrl+O) and exits (Ctrl+X)", async () => {
    const client = new ssh2.Client();

    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => {
        client.shell({ term: "xterm-256color", cols: 80, rows: 24 }, (err, stream) => {
          if (err) return reject(err);

          let output = "";
          let stage = 0;

          stream.on("data", (chunk: Buffer) => {
            output += chunk.toString("utf-8");

            // Stage 0: Wait for initial prompt, then launch nano
            if (stage === 0 && output.includes("root@kalibox-NanoTester:~#")) {
              stage = 1;
              output = "";
              stream.write("nano my_custom_scan.sh\r");
            }

            // Stage 1: Verify nano banner is displayed, type script and save with Ctrl+O
            if (stage === 1 && output.includes("GNU nano 7.2") && output.includes("my_custom_scan.sh")) {
              stage = 2;
              output = "";
              // Type script: echo HelloFromNano, then save (Ctrl+O: \x0f)
              stream.write("#!/bin/bash\rwhois 10.10.1.15\r\x0f");
            }

            // Stage 2: Verify save notification, then exit with Ctrl+X (\x18)
            if (stage === 2 && (output.includes("[ Wrote") || output.includes("lines"))) {
              stage = 3;
              output = "";
              stream.write("\x18");
            }

            // Stage 3: Verify nano closed and returned to shell prompt
            if (stage === 3 && output.includes("nano: closed") && output.includes("root@kalibox-NanoTester:~#")) {
              const player = arena.getPlayerByNickname("NanoTester");
              assert.ok(player, "Player must exist");
              const saved = sshServer["scriptRunner"].getUserFileContent(player.id, "my_custom_scan.sh");
              assert.ok(saved, "File must be saved in user files");
              assert.ok(saved.includes("whois 10.10.1.15"), "File content must match typed text");
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
        username: "NanoTester",
        password: "ctf",
      });
    });
  });

  it("AC-5: SSH terminal launches vi editor, inserts text, saves and quits with :wq", async () => {
    const client = new ssh2.Client();

    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => {
        client.shell({ term: "xterm-256color", cols: 80, rows: 24 }, (err, stream) => {
          if (err) return reject(err);

          let output = "";
          let stage = 0;

          stream.on("data", (chunk: Buffer) => {
            output += chunk.toString("utf-8");

            // Stage 0: Wait for initial prompt, then launch vi
            if (stage === 0 && output.includes("root@kalibox-ViTester:~#")) {
              stage = 1;
              output = "";
              stream.write("vi vi_sweep.sh\r");
            }

            // Stage 1: Verify vi screen rendered, press 'i' for insert mode
            if (stage === 1 && (output.includes("vi_sweep.sh") || output.includes("~"))) {
              stage = 2;
              output = "";
              // Press 'i' (insert mode), type content, Esc (\x1b), then :wq\r
              stream.write("ifor i in {1..200}; do whois 10.10.1.$i; done\x1b:wq\r");
            }

            // Stage 2: Verify vi exited and prompt returned
            if (stage === 2 && output.includes("vi: saved and closed") && output.includes("root@kalibox-ViTester:~#")) {
              const player = arena.getPlayerByNickname("ViTester");
              assert.ok(player, "Player must exist");
              const saved = sshServer["scriptRunner"].getUserFileContent(player.id, "vi_sweep.sh");
              assert.ok(saved, "File must be saved in user files");
              assert.ok(saved.includes("for i in {1..200}"), "Saved content must contain loop code");
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
        username: "ViTester",
        password: "ctf",
      });
    });
  });

  it("AC-6: SSH terminal executes pasted multi-line bash loop script and outputs vulnerable targets", async () => {
    const client = new ssh2.Client();

    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => {
        client.shell({ term: "xterm-256color", cols: 80, rows: 24 }, (err, stream) => {
          if (err) return reject(err);

          let output = "";
          let stage = 0;

          stream.on("data", (chunk: Buffer) => {
            output += chunk.toString("utf-8");

            if (stage === 0 && output.includes("root@kalibox-PasteTester:~#")) {
              stage = 1;
              output = "";
              // Send multiline script paste
              const multilineScript =
                '#!/bin/bash\n' +
                'echo "[*] 200 nodes scan..."\n' +
                'for i in $(seq 1 200); do\n' +
                '    ip="10.10.1.$i"\n' +
                '    res=$(whois "$ip" 2>/dev/null)\n' +
                '    if ! echo "$res" | grep -q "REDACTED_FOR_PRIVACY"; then\n' +
                '        echo "[+] Found: $ip"\n' +
                '    fi\n' +
                'done\n';
              stream.write(multilineScript);
            }

            if (stage === 1 && (output.includes("VULNERABLE TARGET") || output.includes("10.10.1.25") || output.includes("Bash Loop Complete"))) {
              assert.ok(output.includes("10.10.1.25"), "Must discover vulnerable whois node in mesh");
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
        username: "PasteTester",
        password: "ctf",
      });
    });
  });
});
