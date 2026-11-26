// server/arena-ssh-server.ts — Multi-user SSH Server Gateway for CTF Competition Arena.
// Allows participants to connect via native terminals (`ssh -p 2222 <nickname>@<host>`).
// Connects native PTY input/output streams directly to the 200-node mock internet engine & automated evaluator.

import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ssh2, { type Server, type Connection, type ServerChannel } from "ssh2";
import type { ArenaManager, Player, EvaluationOutcome } from "./arena-manager.ts";
import type { MockInternetMesh } from "./mock-internet-mesh.ts";
import type { LanManager } from "./lan-manager.ts";
import { ArenaScriptRunner, EMBEDDED_TOOLKIT_FILES } from "./arena-script-runner.ts";

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

    // Generate, reuse, or use provided RSA 2048-bit Host Key for zero-config SSH
    if (options.hostKeyPem) {
      this.hostKey = options.hostKeyPem;
    } else {
      const keyPath = path.resolve(process.cwd(), ".arena_ssh_host_key");
      if (fs.existsSync(keyPath)) {
        try {
          this.hostKey = fs.readFileSync(keyPath, "utf-8");
        } catch {}
      }
      if (!this.hostKey) {
        const { privateKey } = crypto.generateKeyPairSync("rsa", {
          modulusLength: 2048,
          publicKeyEncoding: { type: "pkcs1", format: "pem" },
          privateKeyEncoding: { type: "pkcs1", format: "pem" },
        });
        this.hostKey = privateKey;
        try {
          fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
        } catch {}
      }
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

      let ptyCols = 80;
      let ptyRows = 24;
      let onResize: ((rows: number, cols: number) => void) | null = null;

      session.on("pty", (acceptPty, _rejectPty, info) => {
        if (info) {
          if (info.cols) ptyCols = info.cols;
          if (info.rows) ptyRows = info.rows;
        }
        acceptPty();
      });

      session.on("window-change", (acceptWin, _rejectWin, info) => {
        if (info) {
          if (info.cols) ptyCols = info.cols;
          if (info.rows) ptyRows = info.rows;
          if (onResize) onResize(ptyRows, ptyCols);
        }
        if (acceptWin) acceptWin();
      });

      session.on("shell", (acceptShell, _rejectShell) => {
        const stream = acceptShell();
        this.runInteractiveShell(stream, player, clientIp, ptyRows, ptyCols, (cb) => {
          onResize = cb;
        });
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

  private runInteractiveShell(
    stream: ServerChannel,
    player: Player,
    clientIp: string,
    initialRows = 24,
    initialCols = 80,
    registerResize?: (cb: (rows: number, cols: number) => void) => void
  ): void {
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
        "\x1b[90m[*] 주요 도구: whois, dig, nmap, nano, vi, msfconsole, score, status, help, exit\x1b[0m\r\n" +
        "\x1b[36m--------------------------------------------------------------------------------\x1b[0m\r\n"
      );
    };

    const promptStr = `\x1b[1;32mroot@kalibox-${player.nickname}:~# \x1b[0m`;
    const msfPrompt = `\x1b[1;34mmsf6\x1b[0m > `;

    stream.write(renderBanner());
    stream.write(promptStr);

    let ptyRows = initialRows;
    let ptyCols = initialCols;
    let activeEditor: EditorSession | null = null;
    let inEditorEscape = false;
    let editorEscapeBuffer = "";

    if (registerResize) {
      registerResize((newRows, newCols) => {
        ptyRows = newRows;
        ptyCols = newCols;
        if (activeEditor) {
          activeEditor.rows = newRows;
          activeEditor.cols = newCols;
          renderEditor();
        }
      });
    }

    const openEditor = (type: "nano" | "vi", rawTarget: string | undefined) => {
      let filename = (rawTarget || "")
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .replace(/^(\/root\/tools\/|\/root\/|\.\/|tools\/)/, "")
        .trim();
      if (!filename) {
        filename = "script.sh";
      }

      let initialContent = this.scriptRunner.getUserFileContent(player.id, filename);
      if (initialContent === undefined) {
        initialContent = EMBEDDED_TOOLKIT_FILES[filename]?.content;
      }

      let lines: string[] = [];
      if (initialContent !== undefined && initialContent.length > 0) {
        lines = initialContent.split(/\r?\n/);
      } else {
        lines = [""];
      }

      activeEditor = {
        type,
        filename,
        lines,
        cursorRow: 0,
        cursorCol: 0,
        scrollRow: 0,
        modified: false,
        viMode: "normal",
        commandText: "",
        statusMessage: initialContent !== undefined ? `[ Read ${lines.length} lines ]` : `[ New File: ${filename} ]`,
        cutBuffer: null,
        lastNormalKey: "",
        rows: ptyRows,
        cols: ptyCols,
      };

      stream.write("\x1b[2J\x1b[H");
      renderEditor();
    };

    const renderEditor = () => {
      if (!activeEditor) return;
      const {
        type,
        filename,
        lines,
        cursorRow,
        cursorCol,
        modified,
        viMode,
        commandText,
        statusMessage,
        rows,
        cols,
      } = activeEditor;

      const contentHeight = type === "nano" ? Math.max(1, rows - 4) : Math.max(1, rows - 1);
      if (activeEditor.cursorRow < activeEditor.scrollRow) {
        activeEditor.scrollRow = activeEditor.cursorRow;
      } else if (activeEditor.cursorRow >= activeEditor.scrollRow + contentHeight) {
        activeEditor.scrollRow = activeEditor.cursorRow - contentHeight + 1;
      }
      const scrollRow = activeEditor.scrollRow;

      let buf = "\x1b[?25l\x1b[H";

      if (type === "nano") {
        const mod = modified ? " *" : "";
        const title = "GNU nano 7.2";
        const fileLabel = `File: ${filename}${mod}`;
        const centerPad = Math.max(2, Math.floor((cols - title.length - fileLabel.length) / 2));
        const header = `  ${title}${" ".repeat(centerPad)}${fileLabel}`;
        const paddedHeader = (header + " ".repeat(Math.max(0, cols - header.length))).slice(0, cols);
        buf += `\x1b[7m${paddedHeader}\x1b[0m\r\n`;

        for (let i = 0; i < contentHeight; i++) {
          const lIdx = scrollRow + i;
          const lineStr = lIdx < lines.length ? lines[lIdx] : "";
          buf += `\x1b[K${lineStr.slice(0, cols)}\r\n`;
        }

        const st = statusMessage || (modified ? "[ Modified ]" : `[ Read ${lines.length} lines ]`);
        const paddedSt = (st + " ".repeat(Math.max(0, cols - st.length))).slice(0, cols);
        buf += `\x1b[K\x1b[1;33m${paddedSt}\x1b[0m\r\n`;

        const foot1 = "^O WriteOut   ^R Read File  ^W Where Is   ^K Cut Line   ^C Cur Pos";
        const foot2 = "^X Exit       ^J Justify    ^\\ Replace    ^U Paste Line ^G Help";
        buf += `\x1b[7m${(foot1 + " ".repeat(Math.max(0, cols - foot1.length))).slice(0, cols)}\x1b[0m\r\n`;
        buf += `\x1b[7m${(foot2 + " ".repeat(Math.max(0, cols - foot2.length))).slice(0, cols)}\x1b[0m`;

        const screenRow = cursorRow - scrollRow + 2;
        const screenCol = cursorCol + 1;
        buf += `\x1b[${screenRow};${screenCol}H\x1b[?25h`;
      } else {
        for (let i = 0; i < contentHeight; i++) {
          const lIdx = scrollRow + i;
          if (lIdx < lines.length) {
            buf += `\x1b[K${lines[lIdx].slice(0, cols)}\r\n`;
          } else {
            buf += `\x1b[34m~\x1b[0m\x1b[K\r\n`;
          }
        }

        let st = "";
        if (viMode === "insert") {
          st = "\x1b[1m-- INSERT --\x1b[0m";
        } else if (viMode === "command") {
          st = `:${commandText}`;
        } else {
          st = statusMessage || `"${filename}" ${modified ? "[+]" : ""} ${lines.length}L, ${lines.join("\n").length}B`;
        }
        buf += `\x1b[K${st}`;

        if (viMode === "command") {
          buf += `\x1b[${rows};${commandText.length + 2}H\x1b[?25h`;
        } else {
          const screenRow = cursorRow - scrollRow + 1;
          const screenCol = cursorCol + 1;
          buf += `\x1b[${screenRow};${screenCol}H\x1b[?25h`;
        }
      }

      stream.write(buf);
    };

    const exitEditor = (msg: string) => {
      stream.write("\x1b[2J\x1b[H");
      stream.write(msg);
      activeEditor = null;
      inEditorEscape = false;
      editorEscapeBuffer = "";
      stream.write(inMsfConsole ? msfPrompt : promptStr);
    };

    const processEditorChunk = (input: string) => {
      if (!activeEditor) return;

      for (let i = 0; i < input.length; i++) {
        if (!activeEditor) break;
        const ch = input[i];

        // 1. In escape sequence
        if (inEditorEscape) {
          editorEscapeBuffer += ch;
          const isCsi = editorEscapeBuffer.startsWith("\x1b[");
          const isSs3 = editorEscapeBuffer.startsWith("\x1bO");
          const isTerminated =
            (isCsi && editorEscapeBuffer.length >= 3 && ch >= "@" && ch <= "~") ||
            (isSs3 && editorEscapeBuffer.length >= 3) ||
            editorEscapeBuffer.length >= 16;

          if (isTerminated) {
            inEditorEscape = false;
            const seq = editorEscapeBuffer;
            editorEscapeBuffer = "";

            if (seq === "\x1b[A" || seq === "\x1bOA") {
              if (activeEditor.cursorRow > 0) {
                activeEditor.cursorRow--;
                activeEditor.cursorCol = Math.min(activeEditor.cursorCol, activeEditor.lines[activeEditor.cursorRow].length);
              }
            } else if (seq === "\x1b[B" || seq === "\x1bOB") {
              if (activeEditor.cursorRow < activeEditor.lines.length - 1) {
                activeEditor.cursorRow++;
                activeEditor.cursorCol = Math.min(activeEditor.cursorCol, activeEditor.lines[activeEditor.cursorRow].length);
              }
            } else if (seq === "\x1b[C" || seq === "\x1bOC") {
              const curLen = activeEditor.lines[activeEditor.cursorRow].length;
              if (activeEditor.cursorCol < curLen) {
                activeEditor.cursorCol++;
              } else if (activeEditor.cursorRow < activeEditor.lines.length - 1) {
                activeEditor.cursorRow++;
                activeEditor.cursorCol = 0;
              }
            } else if (seq === "\x1b[D" || seq === "\x1bOD") {
              if (activeEditor.cursorCol > 0) {
                activeEditor.cursorCol--;
              } else if (activeEditor.cursorRow > 0) {
                activeEditor.cursorRow--;
                activeEditor.cursorCol = activeEditor.lines[activeEditor.cursorRow].length;
              }
            } else if (seq === "\x1b[H" || seq === "\x1b[1~" || seq === "\x1b[7~") {
              activeEditor.cursorCol = 0;
            } else if (seq === "\x1b[F" || seq === "\x1b[4~" || seq === "\x1b[8~") {
              activeEditor.cursorCol = activeEditor.lines[activeEditor.cursorRow].length;
            } else if (seq === "\x1b[3~") {
              const curLine = activeEditor.lines[activeEditor.cursorRow];
              if (activeEditor.cursorCol < curLine.length) {
                activeEditor.lines[activeEditor.cursorRow] =
                  curLine.slice(0, activeEditor.cursorCol) + curLine.slice(activeEditor.cursorCol + 1);
                activeEditor.modified = true;
              } else if (activeEditor.cursorRow < activeEditor.lines.length - 1) {
                activeEditor.lines[activeEditor.cursorRow] += activeEditor.lines[activeEditor.cursorRow + 1];
                activeEditor.lines.splice(activeEditor.cursorRow + 1, 1);
                activeEditor.modified = true;
              }
            }
          }
          continue;
        }

        // 2. Escape character
        if (ch === "\x1b") {
          if (activeEditor.type === "vi" && (i === input.length - 1 || (input[i + 1] !== "[" && input[i + 1] !== "O"))) {
            if (activeEditor.viMode === "insert") {
              activeEditor.viMode = "normal";
              activeEditor.cursorCol = Math.max(0, activeEditor.cursorCol - 1);
              activeEditor.statusMessage = "";
            } else if (activeEditor.viMode === "command") {
              activeEditor.viMode = "normal";
              activeEditor.commandText = "";
              activeEditor.statusMessage = "";
            }
            continue;
          }
          inEditorEscape = true;
          editorEscapeBuffer = "\x1b";
          continue;
        }

        // 3. Nano mode input
        if (activeEditor.type === "nano") {
          if (ch === "\x18" || ch === "\x11") {
            const saveNotice = activeEditor.modified ? " (buffer had unsaved edits)" : "";
            exitEditor(`\x1b[1;32m[+] nano: closed '${activeEditor.filename}'${saveNotice}\x1b[0m\r\n`);
            return;
          }

          if (ch === "\x0f" || ch === "\x13") {
            const content = activeEditor.lines.join("\n");
            this.scriptRunner.getUserFileMap(player.id).set(activeEditor.filename, content);
            activeEditor.modified = false;
            activeEditor.statusMessage = `[ Wrote ${activeEditor.lines.length} lines (${content.length} bytes) to ${activeEditor.filename} ]`;
            continue;
          }

          if (ch === "\x03") {
            activeEditor.statusMessage = `line ${activeEditor.cursorRow + 1}/${activeEditor.lines.length} (${Math.round(((activeEditor.cursorRow + 1) / activeEditor.lines.length) * 100)}%), col ${activeEditor.cursorCol + 1}`;
            continue;
          }

          if (ch === "\x0b") {
            activeEditor.cutBuffer = activeEditor.lines[activeEditor.cursorRow];
            if (activeEditor.lines.length > 1) {
              activeEditor.lines.splice(activeEditor.cursorRow, 1);
              if (activeEditor.cursorRow >= activeEditor.lines.length) activeEditor.cursorRow = activeEditor.lines.length - 1;
              activeEditor.cursorCol = Math.min(activeEditor.cursorCol, activeEditor.lines[activeEditor.cursorRow].length);
            } else {
              activeEditor.lines[0] = "";
              activeEditor.cursorCol = 0;
            }
            activeEditor.modified = true;
            activeEditor.statusMessage = "[ Cut 1 line ]";
            continue;
          }

          if (ch === "\x15") {
            if (activeEditor.cutBuffer !== null) {
              activeEditor.lines.splice(activeEditor.cursorRow + 1, 0, activeEditor.cutBuffer);
              activeEditor.cursorRow++;
              activeEditor.cursorCol = 0;
              activeEditor.modified = true;
              activeEditor.statusMessage = "[ Pasted 1 line ]";
            }
            continue;
          }

          if (ch === "\r" || ch === "\n") {
            if (lastWasCr && ch === "\n") {
              lastWasCr = false;
              continue;
            }
            lastWasCr = (ch === "\r");
            const curLine = activeEditor.lines[activeEditor.cursorRow] ?? "";
            const head = curLine.slice(0, activeEditor.cursorCol);
            const tail = curLine.slice(activeEditor.cursorCol);
            activeEditor.lines[activeEditor.cursorRow] = head;
            activeEditor.lines.splice(activeEditor.cursorRow + 1, 0, tail);
            activeEditor.cursorRow++;
            activeEditor.cursorCol = 0;
            activeEditor.modified = true;
            continue;
          }
          lastWasCr = false;

          if (ch === "\x7f" || ch === "\x08" || ch === "\b") {
            if (activeEditor.cursorCol > 0) {
              const curLine = activeEditor.lines[activeEditor.cursorRow];
              activeEditor.lines[activeEditor.cursorRow] =
                curLine.slice(0, activeEditor.cursorCol - 1) + curLine.slice(activeEditor.cursorCol);
              activeEditor.cursorCol--;
              activeEditor.modified = true;
            } else if (activeEditor.cursorRow > 0) {
              const prevLine = activeEditor.lines[activeEditor.cursorRow - 1];
              const curLine = activeEditor.lines[activeEditor.cursorRow];
              activeEditor.cursorCol = prevLine.length;
              activeEditor.lines[activeEditor.cursorRow - 1] = prevLine + curLine;
              activeEditor.lines.splice(activeEditor.cursorRow, 1);
              activeEditor.cursorRow--;
              activeEditor.modified = true;
            }
            continue;
          }

          if (ch === "\t") {
            const curLine = activeEditor.lines[activeEditor.cursorRow] ?? "";
            activeEditor.lines[activeEditor.cursorRow] =
              curLine.slice(0, activeEditor.cursorCol) + "  " + curLine.slice(activeEditor.cursorCol);
            activeEditor.cursorCol += 2;
            activeEditor.modified = true;
            continue;
          }

          if (ch >= " " && ch <= "~") {
            const curLine = activeEditor.lines[activeEditor.cursorRow] ?? "";
            activeEditor.lines[activeEditor.cursorRow] =
              curLine.slice(0, activeEditor.cursorCol) + ch + curLine.slice(activeEditor.cursorCol);
            activeEditor.cursorCol++;
            activeEditor.modified = true;
            continue;
          }
        }

        // 4. Vi / Vim mode input
        if (activeEditor.type === "vi") {
          if (activeEditor.viMode === "command") {
            if (ch === "\r" || ch === "\n") {
              if (lastWasCr && ch === "\n") {
                lastWasCr = false;
                continue;
              }
              lastWasCr = (ch === "\r");
              const c = activeEditor.commandText.trim();
              if (c === "w" || c.startsWith("w ") || c === "write") {
                const content = activeEditor.lines.join("\n");
                this.scriptRunner.getUserFileMap(player.id).set(activeEditor.filename, content);
                activeEditor.modified = false;
                activeEditor.viMode = "normal";
                activeEditor.commandText = "";
                activeEditor.statusMessage = `"${activeEditor.filename}" ${activeEditor.lines.length}L, ${content.length}B written`;
              } else if (c === "q") {
                if (activeEditor.modified) {
                  activeEditor.viMode = "normal";
                  activeEditor.commandText = "";
                  activeEditor.statusMessage = "E37: No write since last change (add ! to override)";
                } else {
                  exitEditor(`\x1b[1;32m[+] vi: closed '${activeEditor.filename}'\x1b[0m\r\n`);
                  return;
                }
              } else if (c === "q!" || c === "quit!") {
                exitEditor(`\x1b[1;33m[+] vi: quit without saving '${activeEditor.filename}'\x1b[0m\r\n`);
                return;
              } else if (c === "wq" || c === "x" || c === "wq!" || c === "x!") {
                const content = activeEditor.lines.join("\n");
                this.scriptRunner.getUserFileMap(player.id).set(activeEditor.filename, content);
                exitEditor(`\x1b[1;32m[+] vi: saved and closed '${activeEditor.filename}'\x1b[0m\r\n`);
                return;
              } else {
                activeEditor.viMode = "normal";
                activeEditor.statusMessage = `E492: Not an editor command: ${c}`;
                activeEditor.commandText = "";
              }
              continue;
            }
            lastWasCr = false;

            if (ch === "\x7f" || ch === "\x08" || ch === "\b") {
              if (activeEditor.commandText.length > 0) {
                activeEditor.commandText = activeEditor.commandText.slice(0, -1);
              } else {
                activeEditor.viMode = "normal";
              }
              continue;
            }

            if (ch >= " " && ch <= "~") {
              activeEditor.commandText += ch;
              continue;
            }
          }

          if (activeEditor.viMode === "insert") {
            if (ch === "\r" || ch === "\n") {
              if (lastWasCr && ch === "\n") {
                lastWasCr = false;
                continue;
              }
              lastWasCr = (ch === "\r");
              const curLine = activeEditor.lines[activeEditor.cursorRow] ?? "";
              const head = curLine.slice(0, activeEditor.cursorCol);
              const tail = curLine.slice(activeEditor.cursorCol);
              activeEditor.lines[activeEditor.cursorRow] = head;
              activeEditor.lines.splice(activeEditor.cursorRow + 1, 0, tail);
              activeEditor.cursorRow++;
              activeEditor.cursorCol = 0;
              activeEditor.modified = true;
              continue;
            }
            lastWasCr = false;

            if (ch === "\x7f" || ch === "\x08" || ch === "\b") {
              if (activeEditor.cursorCol > 0) {
                const curLine = activeEditor.lines[activeEditor.cursorRow];
                activeEditor.lines[activeEditor.cursorRow] =
                  curLine.slice(0, activeEditor.cursorCol - 1) + curLine.slice(activeEditor.cursorCol);
                activeEditor.cursorCol--;
                activeEditor.modified = true;
              } else if (activeEditor.cursorRow > 0) {
                const prevLine = activeEditor.lines[activeEditor.cursorRow - 1];
                const curLine = activeEditor.lines[activeEditor.cursorRow];
                activeEditor.cursorCol = prevLine.length;
                activeEditor.lines[activeEditor.cursorRow - 1] = prevLine + curLine;
                activeEditor.lines.splice(activeEditor.cursorRow, 1);
                activeEditor.cursorRow--;
                activeEditor.modified = true;
              }
              continue;
            }

            if (ch === "\t") {
              const curLine = activeEditor.lines[activeEditor.cursorRow] ?? "";
              activeEditor.lines[activeEditor.cursorRow] =
                curLine.slice(0, activeEditor.cursorCol) + "  " + curLine.slice(activeEditor.cursorCol);
              activeEditor.cursorCol += 2;
              activeEditor.modified = true;
              continue;
            }

            if (ch >= " " && ch <= "~") {
              const curLine = activeEditor.lines[activeEditor.cursorRow] ?? "";
              activeEditor.lines[activeEditor.cursorRow] =
                curLine.slice(0, activeEditor.cursorCol) + ch + curLine.slice(activeEditor.cursorCol);
              activeEditor.cursorCol++;
              activeEditor.modified = true;
              continue;
            }
          }

          if (activeEditor.viMode === "normal") {
            lastWasCr = false;

            if (ch === "i") {
              activeEditor.viMode = "insert";
              activeEditor.statusMessage = "";
            } else if (ch === "I") {
              activeEditor.cursorCol = 0;
              activeEditor.viMode = "insert";
              activeEditor.statusMessage = "";
            } else if (ch === "a") {
              const curLen = activeEditor.lines[activeEditor.cursorRow].length;
              if (curLen > 0) activeEditor.cursorCol = Math.min(curLen, activeEditor.cursorCol + 1);
              activeEditor.viMode = "insert";
              activeEditor.statusMessage = "";
            } else if (ch === "A") {
              activeEditor.cursorCol = activeEditor.lines[activeEditor.cursorRow].length;
              activeEditor.viMode = "insert";
              activeEditor.statusMessage = "";
            } else if (ch === "o") {
              activeEditor.lines.splice(activeEditor.cursorRow + 1, 0, "");
              activeEditor.cursorRow++;
              activeEditor.cursorCol = 0;
              activeEditor.viMode = "insert";
              activeEditor.modified = true;
              activeEditor.statusMessage = "";
            } else if (ch === "O") {
              activeEditor.lines.splice(activeEditor.cursorRow, 0, "");
              activeEditor.cursorCol = 0;
              activeEditor.viMode = "insert";
              activeEditor.modified = true;
              activeEditor.statusMessage = "";
            } else if (ch === "x") {
              const curLine = activeEditor.lines[activeEditor.cursorRow];
              if (curLine.length > 0 && activeEditor.cursorCol < curLine.length) {
                activeEditor.lines[activeEditor.cursorRow] =
                  curLine.slice(0, activeEditor.cursorCol) + curLine.slice(activeEditor.cursorCol + 1);
                if (activeEditor.cursorCol >= activeEditor.lines[activeEditor.cursorRow].length && activeEditor.cursorCol > 0) {
                  activeEditor.cursorCol--;
                }
                activeEditor.modified = true;
              }
            } else if (ch === "d") {
              if (activeEditor.lastNormalKey === "d") {
                activeEditor.lastNormalKey = "";
                activeEditor.cutBuffer = activeEditor.lines[activeEditor.cursorRow];
                if (activeEditor.lines.length > 1) {
                  activeEditor.lines.splice(activeEditor.cursorRow, 1);
                  if (activeEditor.cursorRow >= activeEditor.lines.length) activeEditor.cursorRow = activeEditor.lines.length - 1;
                  activeEditor.cursorCol = Math.min(activeEditor.cursorCol, activeEditor.lines[activeEditor.cursorRow].length);
                } else {
                  activeEditor.lines[0] = "";
                  activeEditor.cursorCol = 0;
                }
                activeEditor.modified = true;
                activeEditor.statusMessage = "1 line deleted";
              } else {
                activeEditor.lastNormalKey = "d";
              }
              continue;
            } else if (ch === "y") {
              if (activeEditor.lastNormalKey === "y") {
                activeEditor.lastNormalKey = "";
                activeEditor.cutBuffer = activeEditor.lines[activeEditor.cursorRow];
                activeEditor.statusMessage = "1 line yanked";
              } else {
                activeEditor.lastNormalKey = "y";
              }
              continue;
            } else if (ch === "p") {
              if (activeEditor.cutBuffer !== null) {
                activeEditor.lines.splice(activeEditor.cursorRow + 1, 0, activeEditor.cutBuffer);
                activeEditor.cursorRow++;
                activeEditor.cursorCol = 0;
                activeEditor.modified = true;
              }
            } else if (ch === "P") {
              if (activeEditor.cutBuffer !== null) {
                activeEditor.lines.splice(activeEditor.cursorRow, 0, activeEditor.cutBuffer);
                activeEditor.cursorCol = 0;
                activeEditor.modified = true;
              }
            } else if (ch === "Z") {
              if (activeEditor.lastNormalKey === "Z") {
                const content = activeEditor.lines.join("\n");
                this.scriptRunner.getUserFileMap(player.id).set(activeEditor.filename, content);
                exitEditor(`\x1b[1;32m[+] vi: saved and closed '${activeEditor.filename}'\x1b[0m\r\n`);
                return;
              } else {
                activeEditor.lastNormalKey = "Z";
              }
              continue;
            } else if (ch === ":") {
              activeEditor.viMode = "command";
              activeEditor.commandText = "";
              activeEditor.statusMessage = "";
            } else if (ch === "h") {
              activeEditor.cursorCol = Math.max(0, activeEditor.cursorCol - 1);
            } else if (ch === "l") {
              const maxCol = Math.max(0, activeEditor.lines[activeEditor.cursorRow].length - 1);
              activeEditor.cursorCol = Math.min(maxCol, activeEditor.cursorCol + 1);
            } else if (ch === "j") {
              if (activeEditor.cursorRow < activeEditor.lines.length - 1) {
                activeEditor.cursorRow++;
                const maxCol = Math.max(0, activeEditor.lines[activeEditor.cursorRow].length - 1);
                activeEditor.cursorCol = Math.min(maxCol, activeEditor.cursorCol);
              }
            } else if (ch === "k") {
              if (activeEditor.cursorRow > 0) {
                activeEditor.cursorRow--;
                const maxCol = Math.max(0, activeEditor.lines[activeEditor.cursorRow].length - 1);
                activeEditor.cursorCol = Math.min(maxCol, activeEditor.cursorCol);
              }
            } else if (ch === "0") {
              activeEditor.cursorCol = 0;
            } else if (ch === "$") {
              activeEditor.cursorCol = Math.max(0, activeEditor.lines[activeEditor.cursorRow].length - 1);
            } else if (ch === "G") {
              activeEditor.cursorRow = activeEditor.lines.length - 1;
              activeEditor.cursorCol = 0;
            } else if (ch === "g") {
              if (activeEditor.lastNormalKey === "g") {
                activeEditor.lastNormalKey = "";
                activeEditor.cursorRow = 0;
                activeEditor.cursorCol = 0;
              } else {
                activeEditor.lastNormalKey = "g";
              }
              continue;
            } else if (ch === "u") {
              activeEditor.statusMessage = "Already at oldest change";
            }

            activeEditor.lastNormalKey = "";
          }
        }
      }

      if (activeEditor) {
        renderEditor();
      }
    };

    let currentLine = "";
    let cursorPos = 0;
    const history: string[] = [];
    let historyIdx = -1;
    let inMsfConsole = false;
    let lastWasCr = false;
    let escapeBuffer = "";
    let inEscape = false;
    let multilineLines: string[] = [];

    stream.on("data", (chunk: Buffer) => {
      const input = chunk.toString("utf-8");

      // If active interactive editor (nano/vi) is open, route keystrokes directly
      if (activeEditor) {
        processEditorChunk(input);
        return;
      }

      // If a full multi-line script was pasted all at once (contains newlines and has a for/while block)
      if (input.includes("\n") || input.includes("\r")) {
        const trimmed = input.trim();
        if (this.scriptRunner.isScriptCommand(trimmed) || /for\s+[\s\S]+in\s+[\s\S]+do[\s\S]+done/i.test(trimmed)) {
          this.handleCommand(trimmed, stream, player, inMsfConsole, (newInMsf) => {
            inMsfConsole = newInMsf;
            stream.write(inMsfConsole ? msfPrompt : promptStr);
          });
          return;
        }
      }

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
          multilineLines = [];
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

          // Multi-line block buffering (e.g. for ... do ... done)
          if (multilineLines.length > 0) {
            multilineLines.push(cmd);
            if (cmd === "done" || cmd.endsWith("; done") || cmd.endsWith(";done") || cmd === "fi") {
              const fullCmd = multilineLines.join("\n");
              multilineLines = [];
              this.handleCommand(fullCmd, stream, player, inMsfConsole, (newInMsf) => {
                inMsfConsole = newInMsf;
                stream.write(inMsfConsole ? msfPrompt : promptStr);
              });
            } else {
              stream.write("> ");
            }
            continue;
          }

          if (/^(?:for\b|while\b)/i.test(cmd) && !/\bdone\b/i.test(cmd)) {
            multilineLines.push(cmd);
            stream.write("> ");
            continue;
          }

          // Check for interactive text editors: nano, vi, vim
          const nanoMatch = cmd.match(/^nano(?:\s+(.+))?$/i);
          const viMatch = cmd.match(/^(?:vi|vim)(?:\s+(.+))?$/i);
          if (nanoMatch || viMatch) {
            openEditor(nanoMatch ? "nano" : "vi", (nanoMatch || viMatch)![1]);
            continue;
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

      if (cmd === "help" || cmd === "?") {
        stream.write(
          "\r\n\x1b[1m=== CTF ARENA SSH SHELL COMMANDS ===\x1b[0m\r\n" +
            "  \x1b[32mwhois -h <IP> <domain>\x1b[0m         : 모의 Whois 레지스트리 질의\r\n" +
            "  \x1b[32mdig axfr @<IP> <domain>\x1b[0m        : DNS Zone Transfer 취약점 탐색\r\n" +
            "  \x1b[32mnmap -sV -p <port> <IP>\x1b[0m        : 포트 스캔 및 서비스 배너 지문 수집\r\n" +
            "  \x1b[32mnmap -sS <CIDR>\x1b[0m                : 서브넷 가상 호스트 탐지 (예: 10.10.1.0/24)\r\n" +
            "  \x1b[32mcurl -I http://<IP>:<port>\x1b[0m     : 웹 헤더 및 노출 파일(config.env 등) 확인\r\n" +
            "  \x1b[32mnano <filename>\x1b[0m                : 나노(nano) 대화형 텍스트 편집기 (Ctrl+O 저장, Ctrl+X 종료)\r\n" +
            "  \x1b[32mvi / vim <filename>\x1b[0m            : vi / vim 대화형 텍스트 편집기 (:wq 저장/종료, :q! 강제종료)\r\n" +
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
      // 6. Interactive editor warning in non-interactive sessions
      else if (cmd.startsWith("nano") || cmd.startsWith("vi ") || cmd === "vi" || cmd.startsWith("vim ") || cmd === "vim") {
        outputText = `[-] Error: Interactive editor (nano/vi) requires an interactive TTY. Connect via: ssh -p <port> <user>@<host>\r\n`;
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
