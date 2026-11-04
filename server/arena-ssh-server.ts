// server/arena-ssh-server.ts — Multi-user SSH Server Gateway for CTF Competition Arena.
// Allows participants to connect via native terminals (`ssh -p 2222 <nickname>@<host>`).
// Connects native PTY input/output streams directly to the 200-node mock internet engine & automated evaluator.

import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import ssh2, { type Server, type Connection, type ServerChannel } from "ssh2";
import type { ArenaManager, Player, EvaluationOutcome } from "./arena-manager.ts";
import type { MockInternetMesh } from "./mock-internet-mesh.ts";
import type { LanManager } from "./lan-manager.ts";
import { ArenaScriptRunner } from "./arena-script-runner.ts";

export interface ArenaSshServerOptions {
  port?: number;
  host?: string;
  hostKeyPem?: string;
  arenaManager: ArenaManager;
  mockMesh: MockInternetMesh;
  lanManager?: LanManager;
}

export class ArenaSshServer extends EventEmitter {
  public port: number;
  public host: string;
  private server: Server;
  private arenaManager: ArenaManager;
  private mockMesh: MockInternetMesh;
  private scriptRunner: ArenaScriptRunner;
  private lanManager?: LanManager;
  private hostKey: string;
  private activeClients: Set<Connection> = new Set();
  private isListening = false;

  constructor(options: ArenaSshServerOptions) {
    super();
    this.port = options.port ?? 2222;
    this.host = options.host ?? "0.0.0.0";
    this.arenaManager = options.arenaManager;
    this.mockMesh = options.mockMesh;
    this.lanManager = options.lanManager;
    this.scriptRunner = new ArenaScriptRunner(this.mockMesh, this.arenaManager);

    // Generate or use provided RSA 2048-bit Host Key for zero-config SSH
    if (options.hostKeyPem) {
      this.hostKey = options.hostKeyPem;
    } else {
      const { privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "pkcs1", format: "pem" },
        privateKeyEncoding: { type: "pkcs1", format: "pem" },
      });
      this.hostKey = privateKey;
    }

    this.server = new ssh2.Server({ hostKeys: [this.hostKey] }, (client, info) => {
      this.handleClientConnection(client, info);
    });

    this.server.on("error", (err) => {
      this.emit("error", err);
    });
  }

  public listen(port?: number, host?: string): Promise<number> {
    const targetPort = port ?? this.port;
    const targetHost = host ?? this.host;

    return new Promise((resolve, reject) => {
      this.server.listen(targetPort, targetHost, () => {
        const addr = (this.server as any).address();
        const actualPort = typeof addr === "object" && addr ? addr.port : targetPort;
        this.port = actualPort;
        this.isListening = true;
        this.emit("listening", actualPort);
        resolve(actualPort);
      });
      this.server.once("error", reject);
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.activeClients) {
        try {
          client.end();
          (client as any).destroy?.();
        } catch {}
      }
      this.activeClients.clear();

      if (this.isListening) {
        const timeout = setTimeout(() => {
          this.isListening = false;
          resolve();
        }, 1000);
        if (timeout.unref) timeout.unref();

        this.server.close(() => {
          clearTimeout(timeout);
          this.isListening = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getConnectedCount(): number {
    return this.activeClients.size;
  }

  private handleClientConnection(client: Connection, clientInfo: ssh2.ClientInfo): void {
    this.activeClients.add(client);
    const clientIp = clientInfo.ip || "127.0.0.1";
    let identifiedUser = "guest";

    client.on("authentication", (ctx) => {
      identifiedUser = (ctx.username || "player").trim();
      // Friendly CTF authentication: allow any password or none
      ctx.accept();
    });

    client.on("ready", () => {
      this.setupClientSession(client, identifiedUser, clientIp);
    });

    client.on("close", () => {
      this.activeClients.delete(client);
    });

    client.on("error", () => {
      this.activeClients.delete(client);
    });
  }

  private setupClientSession(client: Connection, username: string, clientIp: string): void {
    // 1. Sanitize nickname
    let nickname = username;
    if (["root", "kali", "admin", "user", "ctf"].includes(nickname.toLowerCase())) {
      const shortIp = clientIp.split(".").slice(-2).join("_").replace(/[^a-zA-Z0-9_]/g, "");
      nickname = `${nickname}_${shortIp || Math.floor(Math.random() * 899 + 100)}`;
    }

    // 2. Register with ArenaManager
    let player: Player;
    try {
      player = this.arenaManager.registerPlayer({
        nickname,
        clientIp,
        avatar: "fi-rr-terminal",
      });
    } catch {
      // Reconnection or fallback
      player =
        this.arenaManager.getPlayerByNickname(nickname) ||
        this.arenaManager.registerPlayer({
          nickname: `${nickname}_${Math.floor(Math.random() * 899 + 100)}`,
          clientIp,
          avatar: "fi-rr-terminal",
        });
    }

    client.on("session", (accept, _reject) => {
      const session = accept();

      session.on("pty", (acceptPty, _rejectPty, _info) => {
        acceptPty();
      });

      session.on("window-change", (acceptWin, _rejectWin, _info) => {
        if (acceptWin) acceptWin();
      });

      session.on("shell", (acceptShell, _rejectShell) => {
        const stream = acceptShell();
        this.runInteractiveShell(stream, player, clientIp);
      });

      session.on("exec", (acceptExec, _rejectExec, info) => {
        const stream = acceptExec();
        this.runExecCommand(stream, player, clientIp, info.command);
      });
    });
  }

  private runExecCommand(
    stream: ServerChannel,
    player: Player,
    clientIp: string,
    command: string
  ): void {
    stream.on("error", () => {});
    const cmd = command.trim();
    if (!cmd) {
      try {
        (stream as any).exit?.(0);
        stream.end();
      } catch {}
      return;
    }

    if (this.scriptRunner.isScriptCommand(cmd)) {
      this.scriptRunner
        .execute(cmd, player.id)
        .then((res) => {
          if (res.handled) {
            stream.write(res.output.replace(/\r?\n/g, "\r\n"));
            try {
              (stream as any).exit?.(0);
              stream.end();
            } catch {}
          } else {
            this.dispatchNormalCommand(cmd, stream, player, false, () => {
              try {
                (stream as any).exit?.(0);
                stream.end();
              } catch {}
            });
          }
        })
        .catch((err) => {
          stream.write(`\r\n[-] Error: ${err.message}\r\n`);
          try {
            (stream as any).exit?.(1);
            stream.end();
          } catch {}
        });
      return;
    }

    this.dispatchNormalCommand(cmd, stream, player, false, () => {
      try {
        (stream as any).exit?.(0);
        stream.end();
      } catch {}
    });
  }

  private runInteractiveShell(stream: ServerChannel, player: Player, clientIp: string): void {
    const hostIp = this.lanManager?.hostIp || "127.0.0.1";
    const webPort = this.lanManager?.port || 3000;

    // Suppress channel write errors on sudden client termination
    stream.on("error", () => {});
    stream.on("eof", () => {
      try {
        (stream as any).exit?.(0);
        stream.end();
      } catch {}
    });

    const renderBanner = () => {
      const lobbyState = this.arenaManager.getLobbyState().toUpperCase();
      const timeRemaining = this.arenaManager.getTimeRemaining();
      const mins = Math.floor(timeRemaining / 60);
      const secs = (timeRemaining % 60).toString().padStart(2, "0");

      return (
        "\r\n" +
        "\x1b[1;36m================================================================================\x1b[0m\r\n" +
        "\x1b[1;32m      🔥 METASPLOIT CH3 CTF ARENA - KALI LINUX PTY SHELL (SSH) 🔥             \x1b[0m\r\n" +
        "\x1b[1;36m================================================================================\x1b[0m\r\n" +
        `\x1b[33m[+] 플레이어 닉네임 : \x1b[1;37m${player.nickname}\x1b[0m (\x1b[35m${clientIp}\x1b[0m)\r\n` +
        `\x1b[33m[+] 아레나 대전 상태: \x1b[1;32m${lobbyState}\x1b[0m | 남은 경기 시간: \x1b[1;31m${mins}:${secs}\x1b[0m\r\n` +
        `\x1b[33m[+] 모의 인터넷 타깃: \x1b[1;37m200개 가상 서버 노드 (10.10.1.1 ~ 10.10.1.200)\x1b[0m\r\n` +
        `\x1b[33m[+] 실시간 웹 전광판: \x1b[4;34mhttp://${hostIp}:${webPort}/arena\x1b[0m\r\n` +
        "\x1b[36m--------------------------------------------------------------------------------\x1b[0m\r\n" +
        "\x1b[90m[*] 터미널에서 입력한 공격 명령어는 실시간으로 자동 분석 및 채점됩니다.\x1b[0m\r\n" +
        "\x1b[90m[*] 주요 도구: whois, dig, nmap, msfconsole, score, status, help, exit\x1b[0m\r\n" +
        "\x1b[36m--------------------------------------------------------------------------------\x1b[0m\r\n"
      );
    };

    const promptStr = `\x1b[1;32mroot@kalibox-${player.nickname}:~# \x1b[0m`;
    const msfPrompt = `\x1b[1;34mmsf6\x1b[0m > `;

    stream.write(renderBanner());
    stream.write(promptStr);

    let currentLine = "";
    let cursorPos = 0;
    const history: string[] = [];
    let historyIdx = -1;
    let inMsfConsole = false;
    let lastWasCr = false;
    let escapeBuffer = "";
    let inEscape = false;

    stream.on("data", (chunk: Buffer) => {
      const input = chunk.toString("utf-8");

      for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        // 1. Handle active escape sequence
        if (inEscape) {
          escapeBuffer += ch;
          const isCsi = escapeBuffer.startsWith("\x1b[");
          const isSs3 = escapeBuffer.startsWith("\x1bO");

          const isTerminated =
            (isCsi && escapeBuffer.length >= 3 && ch >= "@" && ch <= "~") ||
            (isSs3 && escapeBuffer.length >= 3) ||
            escapeBuffer.length >= 16;

          if (isTerminated) {
            inEscape = false;
            const seq = escapeBuffer;
            escapeBuffer = "";

            // Up Arrow
            if (seq === "\x1b[A" || seq === "\x1bOA") {
              if (history.length > 0) {
                if (historyIdx === -1) historyIdx = history.length - 1;
                else if (historyIdx > 0) historyIdx--;
                const recalled = history[historyIdx] || "";
                stream.write("\r" + (inMsfConsole ? msfPrompt : promptStr) + "\x1b[K" + recalled);
                currentLine = recalled;
                cursorPos = recalled.length;
              }
              continue;
            }

            // Down Arrow
            if (seq === "\x1b[B" || seq === "\x1bOB") {
              if (history.length > 0 && historyIdx !== -1) {
                if (historyIdx < history.length - 1) {
                  historyIdx++;
                  const recalled = history[historyIdx] || "";
                  stream.write("\r" + (inMsfConsole ? msfPrompt : promptStr) + "\x1b[K" + recalled);
                  currentLine = recalled;
                  cursorPos = recalled.length;
                } else {
                  historyIdx = -1;
                  stream.write("\r" + (inMsfConsole ? msfPrompt : promptStr) + "\x1b[K");
                  currentLine = "";
                  cursorPos = 0;
                }
              }
              continue;
            }

            // Left Arrow
            if (seq === "\x1b[D" || seq === "\x1bOD") {
              if (cursorPos > 0) {
                cursorPos--;
                stream.write("\x1b[D");
              }
              continue;
            }

            // Right Arrow
            if (seq === "\x1b[C" || seq === "\x1bOC") {
              if (cursorPos < currentLine.length) {
                cursorPos++;
                stream.write("\x1b[C");
              }
              continue;
            }

            // Home
            if (seq === "\x1b[H" || seq === "\x1b[1~" || seq === "\x1b[7~") {
              if (cursorPos > 0) {
                stream.write(`\x1b[${cursorPos}D`);
                cursorPos = 0;
              }
              continue;
            }

            // End
            if (seq === "\x1b[F" || seq === "\x1b[4~" || seq === "\x1b[8~") {
              if (cursorPos < currentLine.length) {
                stream.write(`\x1b[${currentLine.length - cursorPos}C`);
                cursorPos = currentLine.length;
              }
              continue;
            }

            // Delete key (\x1b[3~)
            if (seq === "\x1b[3~") {
              if (cursorPos < currentLine.length) {
                currentLine = currentLine.slice(0, cursorPos) + currentLine.slice(cursorPos + 1);
                const tail = currentLine.slice(cursorPos);
                stream.write(tail + " " + `\x1b[${tail.length + 1}D`);
              }
              continue;
            }

            // Unhandled ANSI sequence ignored
            continue;
          } else {
            // Wait for rest of sequence
            continue;
          }
        }

        // 2. Start of escape sequence
        if (ch === "\x1b") {
          inEscape = true;
          escapeBuffer = "\x1b";
          continue;
        }

        // 3. Ctrl+C (\x03)
        if (ch === "\x03") {
          currentLine = "";
          cursorPos = 0;
          historyIdx = -1;
          stream.write("^C\r\n" + (inMsfConsole ? msfPrompt : promptStr));
          lastWasCr = false;
          continue;
        }

        // 4. Ctrl+D / logout (\x04)
        if (ch === "\x04") {
          if (currentLine.length === 0) {
            stream.write("\r\nlogout\r\n");
            try {
              (stream as any).exit?.(0);
              stream.end();
            } catch {}
            return;
          }
          continue;
        }

        // 5. Backspace (\x7f or \x08 / \b)
        if (ch === "\x7f" || ch === "\x08" || ch === "\b") {
          if (cursorPos > 0) {
            if (cursorPos === currentLine.length) {
              currentLine = currentLine.slice(0, -1);
              cursorPos--;
              stream.write("\b \b");
            } else {
              currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
              cursorPos--;
              const tail = currentLine.slice(cursorPos);
              stream.write("\b" + tail + " " + `\x1b[${tail.length + 1}D`);
            }
          }
          lastWasCr = false;
          continue;
        }

        // 6. Enter key (\r or \n)
        if (ch === "\r" || ch === "\n") {
          if (lastWasCr && ch === "\n") {
            lastWasCr = false;
            continue;
          }
          lastWasCr = (ch === "\r");

          stream.write("\r\n");
          const cmd = currentLine.trim();
          currentLine = "";
          cursorPos = 0;
          historyIdx = -1;

          if (cmd.length > 0) {
            history.push(cmd);
          }

          if (inMsfConsole) {
            if (cmd === "exit" || cmd === "back") {
              inMsfConsole = false;
              stream.write("[*] Exited Metasploit Framework console.\r\n");
              stream.write(promptStr);
              continue;
            }
          }

          this.handleCommand(cmd, stream, player, inMsfConsole, (newInMsf) => {
            inMsfConsole = newInMsf;
            stream.write(inMsfConsole ? msfPrompt : promptStr);
          });
          continue;
        }

        lastWasCr = false;

        // 7. Normal printable characters
        if (ch >= " " && ch <= "~") {
          if (cursorPos === currentLine.length) {
            currentLine += ch;
            cursorPos++;
            stream.write(ch);
          } else {
            currentLine = currentLine.slice(0, cursorPos) + ch + currentLine.slice(cursorPos);
            cursorPos++;
            const tail = currentLine.slice(cursorPos);
            stream.write(ch + tail + `\x1b[${tail.length}D`);
          }
        }
      }
    });

    stream.on("close", () => {
      // Stream finished
    });
  }

  private handleCommand(
    cmd: string,
    stream: ServerChannel,
    player: Player,
    inMsfConsole: boolean,
    done: (inMsf: boolean) => void
  ): void {
    try {
      if (!cmd) {
        done(inMsfConsole);
        return;
      }

      // Check if command is an automation script (Bash loop, Python sweep, tools inspection)
      if (this.scriptRunner.isScriptCommand(cmd)) {
        this.scriptRunner
          .execute(cmd, player.id)
          .then((res) => {
            if (res.handled) {
              stream.write(res.output.replace(/\r?\n/g, "\r\n"));
              done(inMsfConsole);
            } else {
              this.dispatchNormalCommand(cmd, stream, player, inMsfConsole, done);
            }
          })
          .catch((err) => {
            stream.write(`\r\n[-] Script Execution Error: ${err.message}\r\n`);
            done(inMsfConsole);
          });
        return;
      }

      this.dispatchNormalCommand(cmd, stream, player, inMsfConsole, done);
    } catch (err: any) {
      stream.write(`\r\n[-] Error: ${err.message}\r\n`);
      done(inMsfConsole);
    }
  }

  private dispatchNormalCommand(
    cmd: string,
    stream: ServerChannel,
    player: Player,
    inMsfConsole: boolean,
    done: (inMsf: boolean) => void
  ): void {
    try {
      // Built-in utility commands
      if (cmd === "exit") {
        stream.write("Connection to ctf-arena closed.\r\n");
        try {
          (stream as any).exit?.(0);
          stream.end();
        } catch {}
        return;
      }

      if (cmd === "clear") {
        stream.write("\x1b[2J\x1b[H");
        done(inMsfConsole);
        return;
      }

      if (cmd === "help") {
        stream.write(
          "\r\n\x1b[1m=== CTF ARENA SSH SHELL COMMANDS ===\x1b[0m\r\n" +
            "  \x1b[32mwhois -h <IP> <domain>\x1b[0m         : 모의 Whois 레지스트리 질의\r\n" +
            "  \x1b[32mdig axfr @<IP> <domain>\x1b[0m        : DNS Zone Transfer 취약점 탐색\r\n" +
            "  \x1b[32mnmap -sV -p <port> <IP>\x1b[0m        : 포트 스캔 및 서비스 배너 지문 수집\r\n" +
            "  \x1b[32mnmap -sS <CIDR>\x1b[0m                : 서브넷 가상 호스트 탐지 (예: 10.10.1.0/24)\r\n" +
            "  \x1b[32mcurl -I http://<IP>:<port>\x1b[0m     : 웹 헤더 및 노출 파일(config.env 등) 확인\r\n" +
            "  \x1b[32mmsfconsole\x1b[0m                     : 메타스플로잇 프레임워크 대화형 모드 진입\r\n" +
            "  \x1b[33mscore\x1b[0m                          : 나의 점수 및 탈취 서버 현황 확인\r\n" +
            "  \x1b[33mstatus\x1b[0m                         : 200 노드 격자 및 경기 남은 시간 요약\r\n" +
            "  \x1b[33mtop\x1b[0m / \x1b[33mrank\x1b[0m                     : 실시간 리더보드 순위표 조회\r\n" +
            "  \x1b[31mexit\x1b[0m                           : SSH 세션 종료\r\n\r\n"
        );
        done(inMsfConsole);
        return;
      }

      if (cmd === "score" || cmd === "rank" || cmd === "top") {
        const refreshedPlayer = this.arenaManager.getPlayer(player.id) || player;
        const lb = this.arenaManager.getLeaderboard();
        const myRank = lb.findIndex((p) => p.playerId === player.id) + 1;

        stream.write(
          `\r\n\x1b[1;36m=== 🏆 CTF ARENA LEADERBOARD ===\x1b[0m\r\n` +
            `[+] 나의 정보: \x1b[1;32m${refreshedPlayer.nickname}\x1b[0m | 현재 순위: \x1b[1;33m${myRank || "-"}위\x1b[0m | 총점: \x1b[1;35m${refreshedPlayer.score} PT\x1b[0m (탈취: ${refreshedPlayer.compromisedCount}대, FirstBlood: ${refreshedPlayer.firstBloodCount}회)\r\n\r\n` +
            `순위  닉네임               점수    탈취  FirstBlood  접속IP\r\n` +
            `-----------------------------------------------------------------\r\n`
        );

        for (let i = 0; i < Math.min(lb.length, 10); i++) {
          const item = lb[i];
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
          const nickPadded = (item.nickname + "                 ").slice(0, 18);
          const scorePadded = (item.score.toString() + "       ").slice(0, 7);
          const compPadded = (item.compromisedCount.toString() + "     ").slice(0, 5);
          const fbPadded = (item.firstBloodCount.toString() + "     ").slice(0, 5);
          stream.write(`${medal} ${i + 1}   ${nickPadded} ${scorePadded} ${compPadded} ${fbPadded}       ${item.clientIp}\r\n`);
        }
        stream.write("\r\n");
        done(inMsfConsole);
        return;
      }

      if (cmd === "status") {
        const state = this.arenaManager.getLobbyState();
        const remaining = this.arenaManager.getTimeRemaining();
        const mins = Math.floor(remaining / 60);
        const secs = (remaining % 60).toString().padStart(2, "0");
        const nodeMap = this.arenaManager.getNodeStateMap();
        const total = Object.keys(nodeMap).length;
        let compromised = 0;
        let scanned = 0;
        for (const s of Object.values(nodeMap)) {
          if (s.status === "compromised") compromised++;
          else if (s.status === "scanned") scanned++;
        }

        stream.write(
          `\r\n\x1b[1;33m=== 🌐 200 가상 인터넷 노드 격자 상태 ===\x1b[0m\r\n` +
            `[+] 경기 상태: \x1b[1;32m${state.toUpperCase()}\x1b[0m (남은 시간: ${mins}:${secs})\r\n` +
            `[+] 전체 가상 노드: ${total}대 (10.10.1.1 ~ 10.10.1.200)\r\n` +
            `[+] 취약점 노드: 60대 (6대 분야 각 10대 무작위 분배)\r\n` +
            `[+] 철통 방어 노드: 140대 (Hardened/Filtered)\r\n` +
            `[+] 현재 점령 현황: 탈취 완료 \x1b[1;31m${compromised}대\x1b[0m | 정찰 탐색 \x1b[1;34m${scanned}대\x1b[0m\r\n\r\n`
        );
        done(inMsfConsole);
        return;
      }

      if (cmd.startsWith("msfconsole")) {
        stream.write(
          "\r\n\x1b[1;31m" +
            "  _|_|_|  _|_|_|_|_|  _|_|_|_|            _|                    _|    _|     \r\n" +
            " _|           _|      _|        _|_|_|    _|  _|_|      _|_|    _|_|_|  _|  \r\n" +
            " _|  _|_|     _|      _|_|_|    _|    _|  _|  _|  _|  _|    _|  _|    _| _| \r\n" +
            " _|    _|     _|      _|        _|    _|  _|  _|  _|  _|    _|  _|    _| _| \r\n" +
            "  _|_|_|      _|      _|        _|_|_|    _|  _|  _|    _|_|    _|_|_|  _|  \r\n" +
            "\x1b[0m\r\n" +
            "       =[ \x1b[1;33mmetasploit v6.4.12-dev                          \x1b[0m]\r\n" +
            "+ -- --=[ 2420 exploits - 1245 auxiliary - 428 post       ]\r\n" +
            "+ -- --=[ 1465 payloads - 45 encoders - 13 nops           ]\r\n" +
            "[*] MSF DB connected (postgresql://msf:msf@127.0.0.1/msfdb)\r\n" +
            "[*] Hint: Use 'use auxiliary/scanner/...' or 'db_nmap' then 'run'\r\n\r\n"
        );
        done(true);
        return;
      }

      // Command dispatch to Mock Internet Mesh Engine
      let outputText = "";

      // 1. Whois
      const ipMatch = cmd.match(/(10\.10\.1\.\d+)/);
      const whoisMatch = cmd.match(/whois\s+(?:-h\s+([0-9.]+)(?::43)?\s+)?([a-zA-Z0-9.-]+)/i);
      if (cmd.startsWith("whois")) {
        const targetIp = ipMatch ? ipMatch[1] : (whoisMatch ? (whoisMatch[1] || whoisMatch[2]) : "10.10.1.15");
        const res = this.mockMesh.queryWhois(targetIp);
        outputText = res.output || "% No whois record found.";
      }
      // 2. DNS Zone Transfer (dig axfr)
      else if (cmd.includes("axfr")) {
        const dnsIpMatch = cmd.match(/@([0-9.]+)/) || cmd.match(/(10\.10\.1\.\d+)/);
        const domainMatch = cmd.match(/axfr\s+(?:@[0-9.]+\s+)?([a-zA-Z0-9.-]+)/i) || cmd.match(/([a-zA-Z0-9.-]+)$/i);
        const targetIp = dnsIpMatch ? (dnsIpMatch[1] || dnsIpMatch[0]) : "10.10.1.15";
        const domain = domainMatch ? domainMatch[1] : "mega-infra.net";
        const res = this.mockMesh.queryDnsAxfr(targetIp, domain);
        outputText = res.output || ";; Transfer failed: Refused";
      }
      // 3. Port scan (nmap or db_nmap)
      else if (cmd.includes("nmap")) {
        const cidrMatch = cmd.match(/(10\.10\.1\.\d+\/\d+)/);

        if (cidrMatch) {
          const res = this.mockMesh.scanSubnet(cidrMatch[1]);
          outputText =
            `Starting Nmap 7.94 ( https://nmap.org )\r\n` +
            `Discovered ${res.hostsUp.length} active virtual hosts in subnet:\r\n` +
            res.hostsUp.slice(0, 15).map((d) => `  [+] ${d.ip} (${d.hostname})`).join("\r\n") +
            (res.hostsUp.length > 15 ? `\r\n  ... and ${res.hostsUp.length - 15} more hosts.` : "") +
            `\r\nNmap done: ${res.total} IP addresses scanned in 0.05 seconds\r\n`;
        } else if (ipMatch) {
          const targetIp = ipMatch[1];
          const portMatch = cmd.match(/-p\s*(\d+)/);
          const targetPort = portMatch ? parseInt(portMatch[1], 10) : 80;
          const res = this.mockMesh.scanPort(targetIp, targetPort);

          outputText =
            `Starting Nmap 7.94 ( https://nmap.org )\r\n` +
            `Nmap scan report for ${targetIp}\r\n` +
            `PORT     STATE  SERVICE VERSION\r\n` +
            `${targetPort}/tcp ${res.open ? "open " : "filtered"} ${res.banner || ""}\r\n` +
            `\r\nNmap done: 1 IP address scanned in 0.02 seconds\r\n`;
        } else {
          outputText = `Starting Nmap 7.94\r\nScanning localhost...\r\nNmap done: specify target IP (e.g. nmap -sV 10.10.1.X)\r\n`;
        }
      }
      // 4. MSSQL login or brute force
      else if (cmd.includes("mssql") || (inMsfConsole && cmd.includes("run"))) {
        const targetIp = ipMatch ? ipMatch[1] : "10.10.1.30";
        const res = this.mockMesh.attemptMssqlLogin(targetIp, "sa", "Password123!");
        outputText = res.output || `[-] ${targetIp}:1433 - Login Failed\r\n`;
      }
      // 5. Cloud S3 or HTTP curl
      else if (cmd.includes("s3") || cmd.includes("curl") || cmd.includes("minio") || cmd.includes("aws")) {
        const targetIp = ipMatch ? ipMatch[1] : "10.10.1.25";
        const res = this.mockMesh.accessS3Bucket(targetIp, "config.env");
        outputText = res.output || `fatal error: An error occurred (403 Forbidden) when connecting to ${targetIp}:9000.\r\n`;
      }
      // Generic fallback execution
      else {
        outputText = `[*] ${cmd}: command executed. Output code: 0\r\n`;
      }

      // Write output to SSH stream
      stream.write(outputText.replace(/\r?\n/g, "\r\n") + "\r\n");

      // Perform Automated CTF Evaluation
      const outcome: EvaluationOutcome = this.arenaManager.evaluateCommand(
        player.id,
        cmd + "\n" + outputText
      );

      if (outcome && outcome.success && outcome.event) {
        const fbStr = outcome.isFirstBlood ? "\x1b[1;31m🔥 FIRST BLOOD BONUS! (+50 PT)\x1b[0m" : "";
        const banner =
          `\r\n\x1b[1;42;30m [★] 🏆 [ARENA COMPROMISED!] ${outcome.targetIp} (${outcome.event.category}) 서버 장악 성공! \x1b[0m\r\n` +
          `\x1b[1;33m[+] 획득 점수: +${outcome.pointsAwarded} PT ${fbStr}\x1b[0m\r\n` +
          `\x1b[1;36m[+] 공격 기법: ${outcome.event.method}\x1b[0m\r\n` +
          `\x1b[90m[*] 웹 전광판 및 200 노드 히트맵에 실시간 반영되었습니다.\x1b[0m\r\n\r\n`;
        stream.write(banner);
      }

      done(inMsfConsole);
    } catch (err: any) {
      stream.write(`\r\n[-] Error: ${err.message}\r\n`);
      done(inMsfConsole);
    }
  }
}
