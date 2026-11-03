import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

export type TerminalRole = "attacker" | "defender";

export interface TerminalOptions {
  containerName?: string;
  forceMock?: boolean;
  cols?: number;
  rows?: number;
}

export interface ISocket {
  send(data: string | Uint8Array): void;
  on(event: string, listener: (...args: any[]) => void): void;
  close(code?: number, reason?: string): void;
}

export interface TerminalSession {
  id: string;
  role: TerminalRole;
  isMock: boolean;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
  onData(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
}

/**
 * Mock Shell emulator when Docker containers are not yet running.
 * Simulates Kali Linux and Metasploitable2 shells with Chapter 3 commands.
 */
class MockShell extends EventEmitter implements TerminalSession {
  public id: string;
  public role: TerminalRole;
  public isMock = true;
  private buffer = "";
  private inMsf = false;
  private prompt: string;
  private closed = false;

  constructor(role: TerminalRole, id: string) {
    super();
    this.role = role;
    this.id = id;
    this.prompt = role === "attacker" ? "root@kalibox:~# " : "msfadmin@metasploitable:~# ";

    // Send initial banner after tiny delay to emulate startup
    setTimeout(() => {
      if (this.closed) return;
      if (role === "attacker") {
        this.emitOutput(
          "\x1b[1;32mKali GNU/Linux Rolling [metasploit-ch3-lab]\x1b[0m\r\n" +
            "Type 'help', 'whois', 'dig', 'nmap', or 'msfconsole' to begin reconnaissance.\r\n" +
            this.prompt
        );
      } else {
        this.emitOutput(
          "\x1b[1;34mMetasploitable2 - Linux metasploitable 2.6.24-16-server [simulated]\x1b[0m\r\n" +
            "Defensive monitoring active. Run 'netstat -tuln' or 'iptables -L' to inspect.\r\n" +
            this.prompt
        );
      }
    }, 10);
  }

  private emitOutput(text: string) {
    this.emit("data", text);
  }

  public onData(cb: (data: string) => void): void {
    this.on("data", cb);
  }

  public onClose(cb: () => void): void {
    this.on("close", cb);
  }

  public write(input: string): void {
    if (this.closed) return;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      // Ctrl+C
      if (char === "\x03") {
        this.buffer = "";
        if (this.inMsf) {
          this.inMsf = false;
          this.prompt = "root@kalibox:~# ";
        }
        this.emitOutput("^C\r\n" + this.prompt);
        continue;
      }

      // Enter key
      if (char === "\r" || char === "\n") {
        const cmd = this.buffer.trim();
        this.emitOutput("\r\n");
        this.buffer = "";
        this.handleCommand(cmd);
        continue;
      }

      // Backspace
      if (char === "\x7f" || char === "\b") {
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1);
          this.emitOutput("\b \b");
        }
        continue;
      }

      // Regular character
      this.buffer += char;
      this.emitOutput(char);
    }
  }

  public resize(_cols: number, _rows: number): void {
    // No-op for mock shell
  }

  public close(): void {
    if (!this.closed) {
      this.closed = true;
      this.emit("close");
      this.removeAllListeners();
    }
  }

  private handleCommand(cmd: string): void {
    if (this.inMsf) {
      this.handleMsfCommand(cmd);
      return;
    }

    if (!cmd) {
      this.emitOutput(this.prompt);
      return;
    }

    const parts = cmd.split(/\s+/);
    const main = parts[0].toLowerCase();

    switch (main) {
      case "help":
        this.emitOutput(
          "Available simulated commands:\r\n" +
            "  whois -h <ip> <domain>    : Query Whois registry\r\n" +
            "  dig axfr @<ip> <domain>   : Attempt DNS Zone Transfer\r\n" +
            "  nmap -sS -p- <target>     : Perform SYN stealth port scan\r\n" +
            "  msfconsole                : Launch Metasploit Framework\r\n" +
            "  netstat -tuln             : Show listening ports\r\n" +
            "  iptables -L -n            : Inspect firewall packet filters\r\n" +
            "  clear, ls, pwd, uname, id : Basic Unix utilities\r\n"
        );
        break;

      case "clear":
        this.emitOutput("\x1b[2J\x1b[H");
        break;

      case "pwd":
        this.emitOutput(this.role === "attacker" ? "/root\r\n" : "/home/msfadmin\r\n");
        break;

      case "whoami":
      case "id":
        this.emitOutput(
          this.role === "attacker"
            ? "uid=0(root) gid=0(root) groups=0(root)\r\n"
            : "uid=1000(msfadmin) gid=1000(msfadmin) groups=1000(msfadmin)\r\n"
        );
        break;

      case "uname":
        this.emitOutput(
          this.role === "attacker"
            ? "Linux kalibox 6.6.0-kali3-amd64 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux\r\n"
            : "Linux metasploitable 2.6.24-16-server #1 SMP x86_64 GNU/Linux\r\n"
        );
        break;

      case "whois":
        if (cmd.includes("megacorp.internal")) {
          this.emitOutput(
            "[Whois Query: megacorp.internal]\r\n" +
              "Domain Name: MEGACORP.INTERNAL\r\n" +
              "Registrant: MegaCorp Global Security Lab\r\n" +
              "Admin Email: security-admin@megacorp.internal\r\n" +
              "Tech Contact: ops-team@megacorp.internal\r\n" +
              "Name Server: ns1.megacorp.internal (172.28.0.15)\r\n" +
              "Flag Hint: FLAG{whois_recon_success}\r\n"
          );
        } else {
          this.emitOutput(`Whois: querying ${parts[1] || "target"}...\r\nRegistrant: Local Sandbox Entity\r\n`);
        }
        break;

      case "dig":
        if (cmd.includes("axfr")) {
          this.emitOutput(
            "; <<>> DiG 9.18.1-1-Debian <<>> axfr @172.28.0.15 megacorp.internal\r\n" +
              ";; global options: +cmd\r\n" +
              "megacorp.internal.    3600 IN SOA ns1.megacorp.internal. hostmaster.megacorp.internal. (2026110301 7200 3600 1209600 3600)\r\n" +
              "megacorp.internal.    3600 IN NS  ns1.megacorp.internal.\r\n" +
              "ns1.megacorp.internal. 3600 IN A   172.28.0.15\r\n" +
              "gw.megacorp.internal.  3600 IN A   172.28.0.1\r\n" +
              "target.megacorp.internal. 3600 IN A 172.28.0.10\r\n" +
              "db-mssql.megacorp.internal. 3600 IN A 172.28.0.12\r\n" +
              "backup-s3.megacorp.internal. 3600 IN A 172.28.0.20\r\n" +
              ";; Zone Transfer Complete! Flag: FLAG{axfr_zone_transferred}\r\n"
          );
        } else {
          this.emitOutput("; <<>> DiG 9.18.1 <<>>\r\n;; Got answer: status: NOERROR\r\n");
        }
        break;

      case "nmap":
        this.emitOutput(
          "Starting Nmap 7.94 ( https://nmap.org ) at " +
            new Date().toISOString() +
            "\r\n" +
            "Nmap scan report for target (172.28.0.10)\r\n" +
            "Host is up (0.00042s latency).\r\n" +
            "PORT     STATE SERVICE     VERSION\r\n" +
            "21/tcp   open  ftp         vsftpd 2.3.4\r\n" +
            "22/tcp   open  ssh         OpenSSH 4.7p1 Debian\r\n" +
            "80/tcp   open  http        Apache httpd 2.2.8\r\n" +
            "139/tcp  open  netbios-ssn Samba smbd 3.X\r\n" +
            "445/tcp  open  netbios-ssn Samba smbd 3.X\r\n" +
            "1433/tcp open  ms-sql-s    Microsoft SQL Server 2019\r\n" +
            "3306/tcp open  mysql       MySQL 5.0.51a\r\n" +
            "Flag Hint: FLAG{syn_scan_detected}\r\n"
        );
        break;

      case "msfconsole":
        this.inMsf = true;
        this.prompt = "msf6 > ";
        this.emitOutput(
          "\x1b[1;31m" +
            "       =[ metasploit v6.3.55-dev                          ]\r\n" +
            "+ -- --=[ 2384 exploits - 1234 auxiliary - 413 post       ]\r\n" +
            "+ -- --=[ Chapter 3: Intelligence Gathering Lab Ready     ]\r\n" +
            "\x1b[0m" +
            "Type 'use auxiliary/scanner/portscan/syn' or 'exit'.\r\n"
        );
        break;

      case "netstat":
        this.emitOutput(
          "Active Internet connections (only servers)\r\n" +
            "Proto Recv-Q Send-Q Local Address           Foreign Address         State\r\n" +
            "tcp        0      0 0.0.0.0:21              0.0.0.0:*               LISTEN\r\n" +
            "tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN\r\n" +
            "tcp        0      0 0.0.0.0:80              0.0.0.0:*               LISTEN\r\n" +
            "tcp        0      0 0.0.0.0:445             0.0.0.0:*               LISTEN\r\n"
        );
        break;

      case "iptables":
        this.emitOutput(
          "Chain INPUT (policy ACCEPT)\r\n" +
            "target     prot opt source               destination\r\n" +
            "LOG        tcp  --  0.0.0.0/0            0.0.0.0/0           tcp flags:0x17/0x02 LOG level warning prefix \"[IDS-SYN] \"\r\n"
        );
        break;

      case "mssql":
      case "sqsh":
        this.emitOutput(
          "[*] Connecting to 172.28.0.30:1433 with sa credentials...\r\n" +
            "[+] MSSQL Login Successful: sa:Password123!\r\n" +
            "1> SELECT @@VERSION\r\n" +
            "Microsoft SQL Server 2019 (RTM-CU18) - 15.0.4261.1\r\n" +
            "Flag Hint: FLAG{MSSQL_SA_PWNED}\r\n"
        );
        break;

      case "aws":
      case "mc":
      case "s3":
        this.emitOutput(
          "download: s3://megacorp-backup/config.env to -\r\n" +
            "DB_HOST=172.28.0.30\r\n" +
            "DB_USER=sa\r\n" +
            "DB_PASS=Password123!\r\n" +
            "AWS_ACCESS_KEY_ID=minioadmin\r\n" +
            "Flag Hint: FLAG{S3_CONFIDENTIAL_LEAK}\r\n"
        );
        break;

      case "ruby":
        this.emitOutput(
          "[*] Executing custom_tcp_banner against 172.28.0.20...\r\n" +
            "[+] [172.28.0.20:21] - Banner: 220 (vsFTPd 2.3.4)\r\n" +
            "Flag Hint: FLAG{CUSTOM_RUBY_BANNER_GRABBED}\r\n"
        );
        break;

      default:
        this.emitOutput(`${main}: command executed in simulated environment\r\n`);
        break;
    }

    this.emitOutput(this.prompt);
  }

  private handleMsfCommand(cmd: string): void {
    if (!cmd) {
      this.emitOutput(this.prompt);
      return;
    }

    if (cmd === "exit" || cmd === "quit") {
      this.inMsf = false;
      this.prompt = "root@kalibox:~# ";
      this.emitOutput("Exiting msfconsole.\r\n" + this.prompt);
      return;
    }

    if (cmd.startsWith("use ")) {
      const mod = cmd.split(" ")[1];
      this.prompt = `msf6 auxiliary(${mod.split("/").pop() || "scanner"}) > `;
      this.emitOutput(`Loaded module: ${mod}\r\n${this.prompt}`);
      return;
    }

    if (cmd === "run" || cmd === "exploit") {
      if (this.prompt.includes("mssql")) {
        this.emitOutput(
          "[*] 172.28.0.30:1433 - Starting MSSQL login brute-force...\r\n" +
            "[+] 172.28.0.30:1433 - MSSQL - Login Successful: sa:Password123!\r\n" +
            "[*] Active session established. Flag: FLAG{MSSQL_SA_PWNED}\r\n" +
            this.prompt
        );
        return;
      }
      if (this.prompt.includes("custom") || this.prompt.includes("banner")) {
        this.emitOutput(
          "[*] Running custom TCP banner scanner against 172.28.0.20...\r\n" +
            "[+] 172.28.0.20:21 - Banner: 220 (vsFTPd 2.3.4)\r\n" +
            "[*] Auxiliary module execution completed. Flag: FLAG{CUSTOM_RUBY_BANNER_GRABBED}\r\n" +
            this.prompt
        );
        return;
      }
      this.emitOutput(
        "[*] Running module against 172.28.0.0/16...\r\n" +
          "[+] [172.28.0.10:445]   - Found Samba 3.0.20-Debian\r\n" +
          "[+] [172.28.0.12:1433]  - Microsoft SQL Server 2019 instance online\r\n" +
          "[*] Auxiliary module execution completed. Flag: FLAG{service_version_discovered}\r\n" +
          this.prompt
      );
      return;
    }

    this.emitOutput(`[*] msf command: ${cmd}\r\n${this.prompt}`);
  }
}

/**
 * Docker-backed interactive TTY session.
 */
class DockerTtySession extends EventEmitter implements TerminalSession {
  public id: string;
  public role: TerminalRole;
  public isMock = false;
  private child: ChildProcessWithoutNullStreams;
  private closed = false;

  constructor(role: TerminalRole, id: string, child: ChildProcessWithoutNullStreams) {
    super();
    this.role = role;
    this.id = id;
    this.child = child;

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.emit("data", chunk.toString("utf-8"));
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.emit("data", chunk.toString("utf-8"));
    });

    this.child.on("close", () => {
      this.close();
    });

    this.child.on("error", () => {
      this.close();
    });
  }

  public onData(cb: (data: string) => void): void {
    this.on("data", cb);
  }

  public onClose(cb: () => void): void {
    this.on("close", cb);
  }

  public write(data: string): void {
    if (!this.closed && this.child.stdin.writable) {
      this.child.stdin.write(data);
    }
  }

  public resize(_cols: number, _rows: number): void {
    // Docker exec without pseudo-tty resizing API can safely ignore or pass via stty if needed
  }

  public close(): void {
    if (!this.closed) {
      this.closed = true;
      try {
        this.child.kill();
      } catch {
        // Ignore kill errors
      }
      this.emit("close");
      this.removeAllListeners();
    }
  }
}

export class PtyManager {
  private sessions = new Map<string, TerminalSession>();
  private defaultContainers: Record<TerminalRole, string> = {
    attacker: "kalibox",
    defender: "metasploitable2",
  };

  /**
   * Spawns or connects to a terminal session for the specified role.
   * Tries Docker container attachment first; on error or fallback flag, uses MockShell.
   */
  public async createSession(role: TerminalRole, options?: TerminalOptions): Promise<TerminalSession> {
    const sessionId = `${role}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const container = options?.containerName || this.defaultContainers[role];

    if (!options?.forceMock) {
      try {
        const child = await this.trySpawnDocker(container);
        if (child) {
          const dockerSession = new DockerTtySession(role, sessionId, child);
          this.sessions.set(sessionId, dockerSession);
          dockerSession.onClose(() => this.sessions.delete(sessionId));
          return dockerSession;
        }
      } catch {
        // Fall back to MockShell
      }
    }

    const mockSession = new MockShell(role, sessionId);
    this.sessions.set(sessionId, mockSession);
    mockSession.onClose(() => this.sessions.delete(sessionId));
    return mockSession;
  }

  /**
   * Attaches a WebSocket connection to a terminal session for the specified role.
   */
  public async attachWebSocket(ws: ISocket, role: TerminalRole, options?: TerminalOptions): Promise<TerminalSession> {
    const session = await this.createSession(role, options);

    // Forward terminal output to client
    session.onData((data: string) => {
      try {
        ws.send(data);
      } catch {
        // Ignore send errors if socket is dead
      }
    });

    // Handle client input and resizing
    ws.on("message", (raw: any) => {
      const text = typeof raw === "string" ? raw : raw?.toString?.() || "";
      if (text.startsWith("{") && text.endsWith("}")) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
            session.resize(parsed.cols, parsed.rows);
            return;
          }
        } catch {
          // Normal string input that happened to start with {
        }
      }
      session.write(text);
    });

    ws.on("close", () => {
      session.close();
    });

    ws.on("error", () => {
      session.close();
    });

    return session;
  }

  public getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  public getActiveSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  public closeAll(): void {
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
  }

  private trySpawnDocker(container: string): Promise<ChildProcessWithoutNullStreams | null> {
    return new Promise((resolve) => {
      try {
        const proc = spawn("docker", ["exec", "-i", container, "/bin/bash"]);

        let done = false;
        const finish = (result: ChildProcessWithoutNullStreams | null) => {
          if (!done) {
            done = true;
            resolve(result);
          }
        };

        proc.on("error", () => finish(null));
        proc.on("exit", () => finish(null));

        setTimeout(() => {
          if (!done && proc.exitCode === null && !proc.killed) {
            finish(proc);
          } else {
            finish(null);
          }
        }, 150);
      } catch {
        resolve(null);
      }
    });
  }
}
