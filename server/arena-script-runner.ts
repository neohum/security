// server/arena-script-runner.ts — Automation Scripting Engine & Shell Scripting Environment for CTF Competition Arena.
// Enables participants to write custom Shell scripts (.sh), execute Bash loops, run Python recon scripts,
// and batch-sweep 200 virtual nodes with automated real-time scoring.

import { CATEGORY_POINTS, type MockInternetMesh, type VirtualServerNode } from "./mock-internet-mesh.ts";
import type { ArenaManager, EvaluationOutcome } from "./arena-manager.ts";

export interface ScriptExecutionResult {
  handled: boolean;
  output: string;
  evaluatedTargets?: string[];
  totalScoreGained?: number;
}

export interface ToolkitFile {
  filename: string;
  desc: string;
  type: "shell" | "python";
  content: string;
}

export const EMBEDDED_TOOLKIT_FILES: Record<string, ToolkitFile> = {
  "whois_scan.sh": {
    filename: "whois_scan.sh",
    desc: "200개 가상 노드 Whois 등록정보 일괄 고속 정찰 셸 스크립트",
    type: "shell",
    content: `#!/bin/bash
# whois_scan.sh — 200 가상 인터넷 노드 Whois 일괄 정찰 셸 스크립트
# 사용법: ./whois_scan.sh 또는 bash whois_scan.sh

echo -e "\\033[1;36m[*] 200개 가상 노드 (10.10.1.1 ~ 10.10.1.200) Whois 일괄 스캔 시작...\\033[0m"
found=0

for i in $(seq 1 200); do
    ip="10.10.1.$i"
    # Whois 질의 수행
    out=$(whois -h "$ip" megacorp.internal 2>/dev/null)
    if echo "$out" | grep -qi "admin@mega-infra.net\\|CIDR Range"; then
        found=$((found + 1))
        echo -e "\\033[1;32m[!] [취약 WHOIS 발견]\\033[0m $ip -> 내부 관리자 이메일 및 CIDR 유출!"
    fi
done

echo -e "\\033[1;35m[+] Whois 정찰 완료: 200개 중 총 $found개 취약 서버 발굴 성공!\\033[0m"
`,
  },
  "axfr_scan.sh": {
    filename: "axfr_scan.sh",
    desc: "200개 가상 노드 DNS Zone Transfer (AXFR) 일괄 점검 셸 스크립트",
    type: "shell",
    content: `#!/bin/bash
# axfr_scan.sh — 200 가상 인터넷 노드 DNS Zone Transfer (AXFR) 일괄 점검
# 사용법: bash axfr_scan.sh

echo -e "\\033[1;36m[*] Scanning 200 virtual DNS servers for BIND AXFR misconfigurations...\\033[0m"
found=0

for i in $(seq 1 200); do
    ip="10.10.1.$i"
    out=$(dig axfr @"$ip" megacorp.internal 2>/dev/null)
    if echo "$out" | grep -qi "admin-vault\\|secret-gateway\\|SOA"; then
        found=$((found + 1))
        echo -e "\\033[1;31m[+] [AXFR 취약 네임서버 탈취]\\033[0m $ip -> 내부 DNS 영역 전송 성공!"
    fi
done

echo -e "\\033[1;35m[+] AXFR 스위프 완료: 총 $found개 취약 네임서버 발견 및 점령 완료!\\033[0m"
`,
  },
  "nmap_scan.sh": {
    filename: "nmap_scan.sh",
    desc: "200개 가상 노드 포트(21, 80, 1433, 9000) 고속 점검 셸 스크립트",
    type: "shell",
    content: `#!/bin/bash
# nmap_scan.sh — 200 가상 노드 핵심 공격 포트 일괄 스캐너
echo -e "\\033[1;36m[*] Launching multi-port scan across 200 nodes (10.10.1.1 - 10.10.1.200)...\\033[0m"

for i in {1..200}; do
    ip="10.10.1.$i"
    nmap -sV -p 21,80,1433,9000 "$ip" 2>/dev/null | grep -E "open|vsftpd|Apache|MSSQL|MinIO"
done
echo -e "\\033[1;32m[+] 포트 스캔 및 서비스 배너 지문 수집 완료.\\033[0m"
`,
  },
  "s3_leak_scan.sh": {
    filename: "s3_leak_scan.sh",
    desc: "200개 가상 노드 모의 S3 퍼블릭 버킷 노출 점검 셸 스크립트",
    type: "shell",
    content: `#!/bin/bash
# s3_leak_scan.sh — 200 가상 노드 모의 S3 퍼블릭 버킷 노출 점검
echo -e "\\033[1;36m[*] Searching for public S3 buckets on port 9000 across 200 nodes...\\033[0m"

for i in $(seq 1 200); do
    ip="10.10.1.$i"
    curl -s -m 1 "http://$ip:9000/megacorp-backup/config.env" | grep -E "DB_PASSWORD|AWS_SECRET" && {
        echo -e "\\033[1;32m[+] [S3 버킷 유출 확정]\\033[0m $ip:9000 -> config.env 다운로드 성공!"
    }
done
`,
  },
  "auto_pwn.sh": {
    filename: "auto_pwn.sh",
    desc: "6대 분야 전수 고속 일괄 침투 및 자동 채점 종합 셸 스크립트",
    type: "shell",
    content: `#!/bin/bash
# auto_pwn.sh — 200개 가상 인터넷 노드 전수 자동화 공략 셸 스크립트
echo -e "\\033[1;33m[!] 6대 분야 (Whois, AXFR, Web, MSSQL, S3, Legacy) 전수 자동화 침투 개시...\\033[0m"

bash /root/tools/whois_scan.sh
bash /root/tools/axfr_scan.sh
bash /root/tools/nmap_scan.sh
bash /root/tools/s3_leak_scan.sh

echo -e "\\033[1;32m[★] 전 분야 취약 노드 침투 및 실시간 순위표 점수 동기화 완료!\\033[0m"
`,
  },
  "whois_sweep.py": {
    filename: "whois_sweep.py",
    desc: "200개 가상 노드 Whois 등록정보 일괄 고속 정찰 파이썬 스크립트",
    type: "python",
    content: `#!/usr/bin/env python3
import urllib.request, json, sys
host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1:3000"
for i in range(1, 201):
    ip = f"10.10.1.{i}"
    try:
        with urllib.request.urlopen(f"http://{host}/api/arena/probe?ip={ip}&service=whois", timeout=1) as resp:
            data = json.loads(resp.read().decode())
            if data.get("vulnerable"):
                print(f"[!] [취약 WHOIS 발견] {ip} -> Admin: {data.get('adminEmail')} | Flag: {data.get('flag')}")
    except: pass
`,
  },
  "axfr_sweep.sh": {
    filename: "axfr_sweep.sh",
    desc: "200개 가상 노드 DNS Zone Transfer (AXFR) 일괄 점검 셸 스크립트 (별칭)",
    type: "shell",
    content: `#!/bin/bash
# axfr_sweep.sh — 200 가상 인터넷 노드 DNS Zone Transfer (AXFR) 일괄 점검
bash /root/tools/axfr_scan.sh
`,
  },
  "nmap_sweep.py": {
    filename: "nmap_sweep.py",
    desc: "200개 가상 노드 Nmap 포트 스캔 및 서비스 배너 탐색 파이썬 스크립트",
    type: "python",
    content: `#!/usr/bin/env python3
import urllib.request, json, sys
host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1:3000"
for i in range(1, 201):
    ip = f"10.10.1.{i}"
    try:
        with urllib.request.urlopen(f"http://{host}/api/arena/probe?ip={ip}&service=nmap", timeout=1) as resp:
            data = json.loads(resp.read().decode())
            if data.get("vulnerable"):
                print(f"[+] [포트 취약점 발견] {ip} -> Open Ports: {data.get('openPorts')}")
    except: pass
`,
  },
};

interface EchoRedirectionResult {
  filename: string;
  content: string;
  append: boolean;
}

interface CatHeredocResult {
  filename: string;
  content: string;
  append: boolean;
}

/**
 * Parses `echo [...] [>|>>] <filename>` commands.
 * Properly handles:
 * - Single quotes `'...'`: literal string, no escaping, preserves internal newlines and special characters.
 * - Double quotes `"..."`: unescapes `\"`, `\$`, `\\`, and newline/tab escape sequences.
 * - Flag `-e` (interpret backslash escapes) and `-n`.
 * - Append (`>>`) vs overwrite (`>`).
 * - Path prefixes (`./`, `/root/`, `tools/`).
 */
function parseEchoCommand(cmd: string): EchoRedirectionResult | null {
  const redirectMatch = cmd.match(
    /^(?:echo\b)([\s\S]*?)\s*(>>|>)\s*(?:(?:\/root\/tools\/|\/root\/|\.\/|tools\/)?([a-zA-Z0-9_.-]+))\s*$/
  );
  if (!redirectMatch) return null;

  const rawArg = redirectMatch[1].trim();
  const append = redirectMatch[2] === ">>";
  const filename = redirectMatch[3];

  // Parse echo flags e.g. -e, -E, -n, -en, -ne
  const flagMatch = rawArg.match(/^(-[eEnN]+)\s*([\s\S]*)$/);
  const flags = flagMatch ? flagMatch[1] : "";
  const body = flagMatch ? flagMatch[2].trim() : rawArg;
  const hasEFlag = flags.includes("e");

  let content = "";

  if (body.startsWith("'") && body.endsWith("'") && body.length >= 2) {
    // Single quotes: strictly literal, preserve all characters, newlines, variables without modification
    content = body.slice(1, -1);
  } else if (body.startsWith('"') && body.endsWith('"') && body.length >= 2) {
    // Double quotes: unescape bash escapes
    content = body.slice(1, -1);
    content = content.replace(/\\([\\"$`])/g, "$1");
    // Unescape newlines / tabs if -e flag is present or explicitly typed
    if (hasEFlag || content.includes("\\n") || content.includes("\\t")) {
      content = content.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
    }
  } else {
    // Unquoted or raw
    content = body;
    if (hasEFlag) {
      content = content.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
    }
  }

  return { filename, content, append };
}

/**
 * Parses heredoc redirection commands:
 *   cat << 'EOF' > file.sh ... EOF
 *   cat <<- 'EOF' >> ./file.sh ... EOF
 *   cat > file.sh << 'EOF' ... EOF
 * Supports arbitrary delimiter words, quotes around delimiter, and tab-stripping (`<<-`).
 */
function parseCatHeredoc(cmd: string): CatHeredocResult | null {
  const lines = cmd.split(/\r?\n/);
  if (lines.length < 2) return null;

  const header = lines[0].trim();
  let delimiter = "";
  let filename = "";
  let append = false;

  // Pattern A: cat << 'EOF' > file.sh or cat <<- 'EOF' >> ./file.sh
  const matchA = header.match(
    /^cat\s*<<-?\s*['"]?([a-zA-Z0-9_-]+)['"]?\s*(>>|>)\s*(?:(?:\/root\/tools\/|\/root\/|\.\/|tools\/)?([a-zA-Z0-9_.-]+))\s*$/
  );
  if (matchA) {
    delimiter = matchA[1];
    append = matchA[2] === ">>";
    filename = matchA[3];
  } else {
    // Pattern B: cat > file.sh << 'EOF' or cat >> ./file.sh <<- 'EOF'
    const matchB = header.match(
      /^cat\s*(>>|>)\s*(?:(?:\/root\/tools\/|\/root\/|\.\/|tools\/)?([a-zA-Z0-9_.-]+))\s*<<-?\s*['"]?([a-zA-Z0-9_-]+)['"]?\s*$/
    );
    if (matchB) {
      append = matchB[1] === ">>";
      filename = matchB[2];
      delimiter = matchB[3];
    }
  }

  if (!delimiter || !filename) return null;

  // Find the closing delimiter line
  const delimRegex = new RegExp(`^\\s*${delimiter}\\s*$`);
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (delimRegex.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) return null;

  const contentLines = lines.slice(1, endIndex);
  const isTabStripped = header.includes("<<-");
  const processedLines = isTabStripped
    ? contentLines.map((line) => line.replace(/^\t+/, ""))
    : contentLines;

  return {
    filename,
    content: processedLines.join("\n"),
    append,
  };
}

export class ArenaScriptRunner {
  private mesh: MockInternetMesh;
  private arena: ArenaManager;
  // Per-player user custom scripts map: playerId -> Map<filename, content>
  private userFiles: Map<string, Map<string, string>> = new Map();

  constructor(mesh: MockInternetMesh, arena: ArenaManager) {
    this.mesh = mesh;
    this.arena = arena;
  }

  public getUserFileMap(playerId: string): Map<string, string> {
    let map = this.userFiles.get(playerId);
    if (!map) {
      map = new Map();
      this.userFiles.set(playerId, map);
    }
    return map;
  }

  public getUserFiles(playerId: string): Map<string, string> {
    return new Map(this.getUserFileMap(playerId));
  }

  public getUserFileContent(playerId: string, filename: string): string | undefined {
    return this.getUserFileMap(playerId).get(filename);
  }

  /**
   * Evaluates whether the command is an automation script, shell script creation, or file execution.
   */
  public isScriptCommand(rawCmd: string): boolean {
    const cmd = rawCmd.trim();
    return (
      /^for\s+.+in\s+.+do.+done$/is.test(cmd) ||
      cmd.startsWith("python") ||
      cmd.startsWith("bash ") ||
      cmd.startsWith("bash") ||
      cmd.startsWith("sh ") ||
      cmd.startsWith("./") ||
      cmd.startsWith("chmod ") ||
      cmd.startsWith("chmod") ||
      cmd.startsWith("echo ") ||
      cmd.startsWith("echo") ||
      /^cat(\s+|<|$)/i.test(cmd) ||
      cmd === "ls" ||
      cmd.startsWith("ls ") ||
      cmd === "rm" ||
      cmd.startsWith("rm ") ||
      cmd.startsWith("whois-scan") ||
      cmd.startsWith("whois-sweep") ||
      cmd.startsWith("axfr-scan") ||
      cmd.startsWith("axfr-sweep") ||
      cmd.startsWith("nmap-scan") ||
      cmd.startsWith("nmap-sweep") ||
      cmd.startsWith("s3-scan") ||
      cmd.startsWith("s3-sweep") ||
      cmd.startsWith("auto-pwn") ||
      cmd.startsWith("scan-all")
    );
  }

  /**
   * Executes the script command and performs real-time batch evaluation against the 200 virtual nodes.
   */
  public async execute(rawCmd: string, playerId: string): Promise<ScriptExecutionResult> {
    const cmd = rawCmd.trim();
    const userMap = this.getUserFileMap(playerId);

    // 1. Script file creation via echo redirection: `echo '...' > script.sh` or `echo "..." > script.sh`
    const echoParsed = parseEchoCommand(cmd);
    if (echoParsed) {
      const { filename, content, append } = echoParsed;
      if (append) {
        const existing = userMap.get(filename) || "";
        userMap.set(filename, existing ? existing + "\n" + content : content);
      } else {
        userMap.set(filename, content);
      }
      const finalContent = userMap.get(filename) || "";
      const opText = append ? "셸 스크립트 추가(append) 완료" : "셸 스크립트 생성 완료";
      return {
        handled: true,
        output: `\r\n\x1b[1;32m[+] ${opText}:\x1b[0m ${filename} (${finalContent.length} bytes)\r\n\x1b[90m[*] 실행: 'bash ${filename}' 또는 'chmod +x ${filename}; ./${filename}'\x1b[0m\r\n`,
      };
    }

    // 2. Script file creation via heredoc: `cat << 'EOF' > script.sh ... EOF`
    const heredocParsed = parseCatHeredoc(cmd);
    if (heredocParsed) {
      const { filename, content, append } = heredocParsed;
      if (append) {
        const existing = userMap.get(filename) || "";
        userMap.set(filename, existing ? existing + "\n" + content : content);
      } else {
        userMap.set(filename, content);
      }
      const finalContent = userMap.get(filename) || "";
      return {
        handled: true,
        output: `\r\n\x1b[1;32m[+] 셸 스크립트 작성 완료:\x1b[0m ${filename} (${finalContent.length} bytes)\r\n\x1b[90m[*] 실행: 'bash ${filename}' 또는 './${filename}'\x1b[0m\r\n`,
      };
    }

    // 3. chmod command: `chmod +x <filename>`
    const chmodMatch = cmd.match(
      /^chmod\s+([+\-][rwx]+|[0-7]{3,4}|[ugoa]+[+\-][rwx]+)\s+(?:(?:\/root\/tools\/|\/root\/|\.\/|tools\/)?([a-zA-Z0-9_.-]+))$/
    );
    if (chmodMatch) {
      const mode = chmodMatch[1];
      const filename = chmodMatch[2];
      const exists = userMap.has(filename) || EMBEDDED_TOOLKIT_FILES[filename] !== undefined;
      if (!exists) {
        return {
          handled: true,
          output: `\r\nchmod: cannot access '${filename}': No such file or directory\r\n`,
        };
      }
      return {
        handled: true,
        output: `\r\n\x1b[1;32m[+] 실행 권한 부여 완료:\x1b[0m chmod ${mode} ${filename}\r\n`,
      };
    }

    // 4. rm command: `rm <filename>`
    const rmMatch = cmd.match(
      /^rm\s+(?:-[rfRF]+\s+)?(?:(?:\/root\/tools\/|\/root\/|\.\/|tools\/)?([a-zA-Z0-9_.-]+))$/
    );
    if (rmMatch) {
      const filename = rmMatch[1];
      const hasForce = /-[rfRF]*f/i.test(cmd);
      if (userMap.has(filename)) {
        userMap.delete(filename);
        return {
          handled: true,
          output: `\r\n[*] Removed ${filename}\r\n`,
        };
      }
      if (EMBEDDED_TOOLKIT_FILES[filename]) {
        return {
          handled: true,
          output: `\r\nrm: cannot remove '${filename}': Permission denied (system toolkit file is read-only)\r\n`,
        };
      }
      if (!hasForce) {
        return {
          handled: true,
          output: `\r\nrm: cannot remove '${filename}': No such file or directory\r\n`,
        };
      }
      return {
        handled: true,
        output: "",
      };
    }

    // 5. File listings: `ls` or `ls -l`
    if (cmd === "ls" || cmd.startsWith("ls ")) {
      const defaultFiles = Object.values(EMBEDDED_TOOLKIT_FILES);
      const userFileNames = Array.from(userMap.keys());
      const userFileSet = new Set(userFileNames);

      let output =
        `\r\n\x1b[1;36m=== 📂 /root/ (작업 디렉터리 및 자동화 셸 스크립트) ===\x1b[0m\r\n` +
        `권한         크기    파일명              유형      설명\r\n` +
        `------------------------------------------------------------------------------------\r\n`;

      // List user-created files first
      for (const name of userFileNames) {
        const content = userMap.get(name) || "";
        const sizeStr = (content.length + " B    ").slice(0, 7);
        const nameStr = (name + "                   ").slice(0, 19);
        output += `-rwxr-xr-x   ${sizeStr} \x1b[1;33m${nameStr}\x1b[0m [사용자]   사용자 작성 커스텀 셸 스크립트\r\n`;
      }

      // List embedded toolkit files (excluding user-overwritten files)
      for (const f of defaultFiles) {
        if (userFileSet.has(f.filename)) continue;
        const sizeStr = (f.content.length + " B    ").slice(0, 7);
        const nameStr = (f.filename + "                   ").slice(0, 19);
        const typeStr = f.type === "shell" ? "[셸 스크립트]" : "[파이썬]     ";
        output += `-rwxr-xr-x   ${sizeStr} \x1b[1;32m${nameStr}\x1b[0m ${typeStr} ${f.desc}\r\n`;
      }

      output +=
        `\r\n\x1b[90m[*] 사용 예시: 'cat whois_scan.sh', 'bash whois_scan.sh', './whois_scan.sh'\x1b[0m\r\n` +
        `\x1b[90m[*] 새 스크립트 작성: 'echo \"for i in {1..200}; do whois -h 10.10.1.\\$i megacorp.internal; done\" > my_scan.sh'\x1b[0m\r\n`;

      return { handled: true, output };
    }

    // 6. View file content: `cat <file>`
    const catMatch = cmd.match(/^cat\s+(?:(?:\/root\/tools\/|\/root\/|\.\/|tools\/)?([a-zA-Z0-9_.-]+))$/);
    if (catMatch) {
      const filename = catMatch[1];
      if (userMap.has(filename)) {
        const userContent = userMap.get(filename) || "";
        return {
          handled: true,
          output: `\r\n\x1b[1m# ${filename} (사용자 스크립트)\x1b[0m\r\n${userContent.replace(/\r?\n/g, "\r\n")}\r\n`,
        };
      }
      const embedded = EMBEDDED_TOOLKIT_FILES[filename];
      if (embedded) {
        return {
          handled: true,
          output: `\r\n\x1b[1m# ${embedded.filename} (${embedded.desc})\x1b[0m\r\n${embedded.content.replace(/\r?\n/g, "\r\n")}\r\n`,
        };
      }
      return {
        handled: true,
        output: `\r\ncat: ${filename}: No such file or directory\r\n`,
      };
    }

    // 7. Shell script execution: `bash script.sh`, `sh script.sh`, `./script.sh`
    const execMatch = cmd.match(
      /^(?:bash|sh|\.\/)\s*(?:\/root\/tools\/|\/root\/|\.\/|tools\/)?([a-zA-Z0-9_.-]+(?:\.sh)?)/
    );
    if (execMatch) {
      const filename = execMatch[1];
      return this.executeShellScriptFile(filename, playerId);
    }

    // 8. Python script execution: `python3 script.py`
    const pyMatch = cmd.match(/^python3?\s+(?:\/root\/tools\/|\/root\/|\.\/|tools\/)?([a-zA-Z0-9_.-]+\.py)/);
    if (pyMatch) {
      const filename = pyMatch[1];
      return this.executePythonScriptFile(filename, playerId);
    }

    // 9. Built-in quick sweeps
    if (cmd === "whois-scan" || cmd === "whois-sweep") {
      return this.executeShellScriptFile("whois_scan.sh", playerId);
    }
    if (cmd === "axfr-scan" || cmd === "axfr-sweep") {
      return this.executeShellScriptFile("axfr_scan.sh", playerId);
    }
    if (cmd === "nmap-scan" || cmd === "nmap-sweep") {
      return this.executeShellScriptFile("nmap_scan.sh", playerId);
    }
    if (cmd === "s3-scan" || cmd === "s3-sweep") {
      return this.executeShellScriptFile("s3_leak_scan.sh", playerId);
    }
    if (cmd === "auto-pwn" || cmd === "scan-all") {
      return this.executeShellScriptFile("auto_pwn.sh", playerId);
    }

    // 10. Bash for loop: `for i in {1..200}; do ...; done`
    if (/^for\s+/i.test(cmd)) {
      return this.runBashForLoop(cmd, playerId);
    }

    return { handled: false, output: "" };
  }

  /**
   * Executes a shell script file (.sh) either from user files or embedded toolkit.
   */
  private executeShellScriptFile(filename: string, playerId: string): ScriptExecutionResult {
    const userMap = this.getUserFileMap(playerId);
    let content = userMap.get(filename);
    let isUserScript = true;

    if (content === undefined) {
      const embedded = EMBEDDED_TOOLKIT_FILES[filename];
      if (embedded) {
        content = embedded.content;
        isUserScript = false;
      }
    }

    if (content === undefined) {
      return {
        handled: true,
        output: `\r\n\x1b[31mbash: ${filename}: No such file or directory\x1b[0m\r\n`,
        evaluatedTargets: [],
        totalScoreGained: 0,
      };
    }

    // Determine target attack vector
    const isAutoPwn =
      filename === "auto_pwn.sh" ||
      /auto[_-]?pwn/i.test(filename) ||
      (/whois/i.test(content) && /axfr/i.test(content) && /nmap|port/i.test(content));
    const isWhoisTarget =
      filename === "whois_scan.sh" ||
      (/whois/i.test(filename) && !/axfr|nmap/i.test(filename)) ||
      (/whois/i.test(content) && !/axfr/i.test(content) && !/nmap/i.test(content));
    const isAxfrTarget =
      filename === "axfr_scan.sh" ||
      (/axfr/i.test(filename) && !/whois|nmap/i.test(filename)) ||
      (/axfr|dig/i.test(content) && !/whois/i.test(content) && !/nmap/i.test(content));
    const isS3Target =
      filename === "s3_leak_scan.sh" ||
      (/s3/i.test(filename) && !/nmap/i.test(filename)) ||
      (!/nmap/i.test(content) && (/s3|minio/i.test(content) || /megacorp-backup/i.test(content)));
    const isNmapTarget =
      filename === "nmap_scan.sh" ||
      /nmap/i.test(filename) ||
      /nmap/i.test(content);
    const isMssqlTarget =
      /mssql/i.test(filename) ||
      (/mssql|sqlcmd/i.test(content) && !/nmap/i.test(content));
    const isLegacyTarget =
      /legacy/i.test(filename) ||
      (/backdoor|legacy/i.test(content) && !/nmap/i.test(content));

    let output =
      `\r\n\x1b[1;36m=== 🚀 [셸 스크립트 실행] ${filename} ${isUserScript ? "(User Custom)" : "(Embedded)"} ===\x1b[0m\r\n` +
      `[*] 스크립트 인터프리터: /bin/bash\r\n` +
      `[*] 모의 인터넷 200개 노드 (10.10.1.1 ~ 10.10.1.200) 대상 고속 스캔 파이프라인 가동...\r\n\r\n`;

    let totalPoints = 0;
    const evaluatedTargets: string[] = [];

    // Helper to evaluate nodes
    const evaluateNodes = (category: any, label: string) => {
      const nodes = this.mesh.getVulnerableNodesByCategory(category);
      for (const node of nodes) {
        evaluatedTargets.push(node.ip);
        const evalOutcome = this.arena.evaluateCommand(playerId, `shell_script ${node.ip} ${node.flag || ""}`);
        const pts = evalOutcome.pointsAwarded ?? (evalOutcome.success ? (CATEGORY_POINTS[node.category] ?? 100) : 0);
        totalPoints += pts;
        const fbStr = evalOutcome.isFirstBlood ? " \x1b[1;31m🔥 FIRST BLOOD BONUS!\x1b[0m" : "";

        if (evalOutcome.success) {
          output += `\x1b[1;32m[!] [${label} 취약점 발견 및 탈취]\x1b[0m ${node.ip} -> Flag: \x1b[33m${node.flag}\x1b[0m (+${pts} PT${fbStr})\r\n`;
        } else if (evalOutcome.duplicate) {
          output += `\x1b[90m[-] [${label} 기탈취 노드]\x1b[0m ${node.ip} -> 이미 탈취 완료된 노드입니다.\x1b[0m\r\n`;
        }
      }
      return nodes.length;
    };

    if (isAutoPwn) {
      // Full sweep across all 6 categories (60 vulnerable nodes)
      const c1 = evaluateNodes("whois", "WHOIS");
      const c2 = evaluateNodes("dns-axfr", "DNS-AXFR");
      const c3 = evaluateNodes("web-banner", "WEB/FTP");
      const c4 = evaluateNodes("mssql", "MSSQL");
      const c5 = evaluateNodes("s3-bucket", "S3-STORAGE");
      const c6 = evaluateNodes("legacy-service", "LEGACY");
      output +=
        `\r\n\x1b[1;32m[★] 종합 셸 스크립트 실행 완료: 총 ${evaluatedTargets.length}개 취약 서버 전수 탈취! (+${totalPoints} PT 획득)\x1b[0m\r\n` +
        `[*] 실시간 웹 전광판 및 순위표에 100% 동기화되었습니다.\r\n\r\n`;
    } else if (isWhoisTarget) {
      const count = evaluateNodes("whois", "WHOIS");
      output +=
        `\r\n\x1b[1;35m[+] Whois 스위프 완료: 200개 서버 중 ${count}개 취약 서버 식별 및 전수 탈취 성공! (+${totalPoints} PT)\x1b[0m\r\n` +
        `[*] 웹 전광판 리더보드 순위가 즉시 갱신되었습니다.\r\n\r\n`;
    } else if (isAxfrTarget) {
      const count = evaluateNodes("dns-axfr", "DNS-AXFR");
      output +=
        `\r\n\x1b[1;35m[+] AXFR 셸 스크립트 완료: ${count}개 취약 DNS 서버 전수 탈취! (+${totalPoints} PT)\x1b[0m\r\n\r\n`;
    } else if (isS3Target) {
      const count = evaluateNodes("s3-bucket", "S3");
      output +=
        `\r\n\x1b[1;35m[+] S3 버킷 점검 셸 스크립트 완료: ${count}개 공개 버킷 기밀 유출 식별! (+${totalPoints} PT)\x1b[0m\r\n\r\n`;
    } else if (isMssqlTarget) {
      const count = evaluateNodes("mssql", "MSSQL");
      output +=
        `\r\n\x1b[1;35m[+] MSSQL 무차별 대입 셸 스크립트 완료: ${count}개 취약 데이터베이스 탈취 성공! (+${totalPoints} PT)\x1b[0m\r\n\r\n`;
    } else if (isLegacyTarget) {
      const count = evaluateNodes("legacy-service", "LEGACY");
      output +=
        `\r\n\x1b[1;35m[+] 레거시 백도어 셸 스크립트 완료: ${count}개 취약 백도어 장악 성공! (+${totalPoints} PT)\x1b[0m\r\n\r\n`;
    } else {
      const count = evaluateNodes("web-banner", "PORT/BANNER");
      output +=
        `\r\n\x1b[1;35m[+] Nmap 포트 스캔 셸 스크립트 완료: ${count}개 취약 서비스 배너 탐색 완료! (+${totalPoints} PT)\x1b[0m\r\n\r\n`;
    }

    return {
      handled: true,
      output,
      evaluatedTargets,
      totalScoreGained: totalPoints,
    };
  }

  /**
   * Executes a Python script file (.py).
   */
  private executePythonScriptFile(filename: string, playerId: string): ScriptExecutionResult {
    const userMap = this.getUserFileMap(playerId);
    const userContent = userMap.get(filename);
    if (userContent !== undefined) {
      if (/whois/i.test(userContent)) {
        return this.executeShellScriptFile("whois_scan.sh", playerId);
      }
      if (/axfr/i.test(userContent)) {
        return this.executeShellScriptFile("axfr_scan.sh", playerId);
      }
      if (/s3|minio/i.test(userContent)) {
        return this.executeShellScriptFile("s3_leak_scan.sh", playerId);
      }
      return this.executeShellScriptFile("nmap_scan.sh", playerId);
    }

    const embedded = EMBEDDED_TOOLKIT_FILES[filename];
    if (embedded) {
      if (embedded.filename === "whois_sweep.py") {
        return this.executeShellScriptFile("whois_scan.sh", playerId);
      }
      if (embedded.filename === "nmap_sweep.py") {
        return this.executeShellScriptFile("nmap_scan.sh", playerId);
      }
    }

    return {
      handled: true,
      output: `\r\n[*] Python script ${filename} executed successfully.\r\n`,
      evaluatedTargets: [],
      totalScoreGained: 0,
    };
  }

  /**
   * Executes a Bash for loop over IP range 1..200 and automatically evaluates targets.
   */
  private runBashForLoop(cmd: string, playerId: string): ScriptExecutionResult {
    let output = `\r\n\x1b[1;33m[*] Executing Bash loop across 200 nodes...\x1b[0m\r\n`;

    const isWhois = /whois/i.test(cmd);
    const isAxfr = /axfr|dig/i.test(cmd);
    const isMssql = /mssql|sqlcmd/i.test(cmd);
    const isS3 = /s3|minio|curl/i.test(cmd);

    let vulnNodes: VirtualServerNode[] = [];

    if (isWhois) {
      vulnNodes = this.mesh.getVulnerableNodesByCategory("whois");
    } else if (isAxfr) {
      vulnNodes = this.mesh.getVulnerableNodesByCategory("dns-axfr");
    } else if (isMssql) {
      vulnNodes = this.mesh.getVulnerableNodesByCategory("mssql");
    } else if (isS3) {
      vulnNodes = this.mesh.getVulnerableNodesByCategory("s3-bucket");
    } else {
      vulnNodes = this.mesh.getVulnerableNodesByCategory("web-banner");
    }

    output += `[*] Range: 10.10.1.1 - 10.10.1.200 (Total 200 nodes)\r\n`;
    output += `[.] 140 hardened nodes filtered / connection refused.\r\n`;

    let totalPoints = 0;
    const evaluatedTargets: string[] = [];

    for (const node of vulnNodes) {
      evaluatedTargets.push(node.ip);
      const evalOutcome = this.arena.evaluateCommand(playerId, `automation ${node.ip} ${node.flag || ""}`);
      const pts = evalOutcome.pointsAwarded ?? (evalOutcome.success ? (CATEGORY_POINTS[node.category] ?? 100) : 0);
      totalPoints += pts;

      const fbText = evalOutcome.isFirstBlood ? " \x1b[1;31m🔥 FIRST BLOOD!\x1b[0m" : "";
      if (evalOutcome.success) {
        output += `\x1b[1;32m[+] VULNERABLE TARGET COMPROMISED: ${node.ip} (${node.category})\x1b[0m -> +${pts} PT${fbText}\r\n`;
        output += `    | Flag: \x1b[33m${node.flag || "FLAG{AUTO_PWN}"}\x1b[0m\r\n`;
      }
    }

    output +=
      `\r\n\x1b[1;36m[★] Bash Loop Complete: ${vulnNodes.length} 취약 노드 전체 장악 성공! (+${totalPoints} PT 획득)\x1b[0m\r\n` +
      `[*] 실시간 웹 전광판 및 200 노드 격자 히트맵에 전원 반영되었습니다.\r\n\r\n`;

    return {
      handled: true,
      output,
      evaluatedTargets,
      totalScoreGained: totalPoints,
    };
  }
}
