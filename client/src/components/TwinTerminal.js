// TwinTerminal.js — ES Module Runtime for TwinTerminal with Knowledge Cards

export const TERMINAL_CONFIGS = {
  attacker: {
    role: "attacker",
    title: "공격자 칼리 터미널 (Kali Linux / MSF)",
    wsEndpoint: "/ws/terminal/attacker",
    containerId: "terminal-attacker-container",
    statusText: "연결 준비 (WebSocket Active)",
    badgeClass: "bg-red-950/40 text-red-400 border-red-500/50",
    defaultPrompt: "root@kalibox:~# ",
    initialLines: [
      "[*] Kali Linux Rolling 2024 (172.28.0.10) Initialized.",
      "[*] Metasploit Framework 6.4 ready. Type 'msfconsole' to start.",
      "[*] Target subnet mapped: 172.28.0.0/16",
      "root@kalibox:~# ",
    ],
  },
  defender: {
    role: "defender",
    title: "방어자 터미널 & 침입탐지 로그 (IDS / Audit)",
    wsEndpoint: "/ws/terminal/defender",
    containerId: "terminal-defender-container",
    statusText: "침입 감시중 (IDS Live Monitoring)",
    badgeClass: "bg-blue-950/40 text-blue-400 border-blue-500/50",
    defaultPrompt: "secops@metasploitable2:~$ ",
    initialLines: [
      "[INFO] Suricata/Snort packet monitor hooked to docker0 (172.28.0.0/16).",
      "[INFO] Listening for stealth SYN scans, AXFR transfers, and MSSQL brute-force.",
      "[ALERT-DAEMON] Audit daemon initialized on victim-host.",
      "secops@metasploitable2:~$ ",
    ],
  },
};

export const ROLE_KNOWLEDGE = {
  attacker: {
    title: "공격자(Red Team) 핵심 명령어 & 정찰 지식 레퍼런스",
    themeColor: "#ff5d6c",
    badge: "제3장 인텔리전스 수집 표준",
    items: [
      {
        tag: "수동 정찰",
        badgeClass: "border-zinc-700 bg-zinc-900 text-zinc-300",
        cmd: "whois -h 172.28.0.15 megacorp.internal",
        summary: "Whois 도메인 등록정보 수집",
        desc: "대상 서버와 직접 통신하지 않고 공개 Whois 데이터베이스를 조회하므로 침입탐지시스템(IDS)에 어떤 로그도 남지 않습니다. 담당자 이메일과 서브넷 블록(172.28.0.0/16)을 파악하는 안전한 1차 정찰 기법입니다.",
      },
      {
        tag: "영역 전송",
        badgeClass: "border-red-500/40 bg-red-950/30 text-red-300",
        cmd: "dig axfr @172.28.0.15 megacorp.internal",
        summary: "DNS Zone Transfer (AXFR) 취약점",
        desc: "보조 DNS 서버 동기화 프로토콜(AXFR)의 미흡한 접근 제어를 악용합니다. BIND의 allow-transfer가 개방되어 있으면 조직 내 모든 서브도메인(db, s3, backup 등) 전체가 단 한 번의 질의로 유출됩니다.",
      },
      {
        tag: "스텔스 스캔",
        badgeClass: "border-amber-500/40 bg-amber-950/30 text-amber-300",
        cmd: "nmap -sS -Pn 172.28.0.20",
        summary: "Nmap TCP SYN Half-Open 스캔",
        desc: "3-Way Handshake를 완결하지 않고 SYN/ACK 수신 즉시 RST를 보내 연결을 강제 종료합니다. 대상 서버의 애플리케이션 접속 로그에 남지 않고 포트 개방 여부만 파악할 수 있는 고전적 스텔스 기법입니다.",
      },
      {
        tag: "MSF 보조",
        badgeClass: "border-purple-500/40 bg-purple-950/30 text-purple-300",
        cmd: "msfconsole -q -x \"use auxiliary/scanner/smb/smb_version; set RHOSTS 172.28.0.20; run; exit\"",
        summary: "Metasploit Auxiliary 버전 지문 분석",
        desc: "공격 페이로드 투입 없이 원격 서비스 버전(SMB, MSSQL 등) 지문을 정밀 분석하고, 결과를 MSF 내장 DB(hosts, services)에 자동 체계화하여 후속 침투 벡터를 정밀 설계합니다.",
      },
    ],
  },
  defender: {
    title: "방어자(Blue Team) 관제 명령어 & 보안 대응 지식 레퍼런스",
    themeColor: "#38bdf8",
    badge: "인프라 방어 및 침입차단 표준",
    items: [
      {
        tag: "포트 감사",
        badgeClass: "border-zinc-700 bg-zinc-900 text-zinc-300",
        cmd: "netstat -tuln",
        summary: "열린 포트 및 리스닝 소켓 전수 조사",
        desc: "모든 인터페이스(0.0.0.0)에 바인딩된 불필요한 데몬(Telnet 23, Samba 445 등)을 식별합니다. 미인가 서비스가 외부에 노출되어 있으면 즉시 공격 표면(Attack Surface)이 되므로 주기적 소켓 감사가 필수입니다.",
      },
      {
        tag: "DNS 봉쇄",
        badgeClass: "border-blue-500/40 bg-blue-950/30 text-blue-300",
        cmd: "named.conf -> allow-transfer { none; };",
        summary: "DNS Zone Transfer (AXFR) 차단 정책",
        desc: "신뢰할 수 있는 보조 DNS 서버 IP만 명시적으로 허용하고, 외부 일반 사용자의 모든 AXFR 질의는 거부(REFUSED)해야 내부 인프라 네트워크 매핑 공격을 원천 무력화할 수 있습니다.",
      },
      {
        tag: "SYN 차단",
        badgeClass: "border-cyan-500/40 bg-cyan-950/30 text-cyan-300",
        cmd: "iptables -A INPUT -p tcp --syn -m limit --limit 5/m -j ACCEPT",
        summary: "패킷 레벨 SYN 스캔 임계치 제어",
        desc: "단시간 내 다수 포트로 쏟아지는 비정상 SYN 패킷 레이트를 감지하고 임계치 초과 시 방화벽 레벨에서 발원지 IP를 자동 DROP 처리하여 포트 스캔 및 서비스 거부 공격을 차단합니다.",
      },
      {
        tag: "권한 잠금",
        badgeClass: "border-emerald-500/40 bg-emerald-950/30 text-emerald-300",
        cmd: "mc anonymous set none myminio/megacorp-backup",
        summary: "S3 공개 버킷 폐쇄 및 SA 계정 보호",
        desc: "클라우드 오브젝트 스토리지의 익명 다운로드 권한을 회수하고, 데이터베이스 기본 sa 관리자 계정을 비활성화하며 16자리 이상의 강력한 비밀번호를 강제하여 기본 설정 미흡(Misconfiguration)을 제거합니다.",
      },
    ],
  },
};

export function renderReferenceKnowledgeCardHtml(role = "attacker") {
  const info = ROLE_KNOWLEDGE[role] || ROLE_KNOWLEDGE.attacker;
  const isAttacker = role === "attacker";

  const cardsHtml = info.items
    .map(
      (item, idx) => `
      <div class="reference-item p-2.5 rounded border border-zinc-800/80 bg-[#0f1115] hover:border-zinc-700 transition-colors flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-1.5 gap-1.5 flex-wrap">
            <div class="flex items-center gap-1.5">
              <span class="inline-flex items-center justify-center leading-none text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                item.badgeClass
              } whitespace-nowrap">
                ${item.tag}
              </span>
              <span class="text-xs font-semibold text-[#e7e9ee] font-sans break-keep">${item.summary}</span>
            </div>
          </div>
          
          <pre class="p-1.5 my-1.5 bg-[#08090b] rounded border border-zinc-800/80 text-[11px] font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap select-all"><code>${
            item.cmd
          }</code></pre>
          
          <p class="text-[11px] text-[#8a8f9c] leading-relaxed break-keep text-pretty mt-1">
            ${item.desc}
          </p>
        </div>

        <div class="mt-2.5 pt-2 border-t border-zinc-800/60 flex items-center justify-between gap-1">
          <span class="text-[10px] text-zinc-500 font-mono">참고 커맨드 #${idx + 1}</span>
          <div class="flex items-center gap-1.5">
            <button type="button" class="btn-copy-ref-cmd inline-flex items-center justify-center leading-none px-2 py-1 text-[10px] text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700 transition-colors whitespace-nowrap" data-cmd="${item.cmd.replace(/"/g, "&quot;")}">
              <i class="fi fi-rr-copy mr-1 flex items-center justify-center leading-none"></i>복사
            </button>
            <button type="button" class="btn-insert-ref-cmd inline-flex items-center justify-center leading-none px-2 py-1 text-[10px] ${
              isAttacker
                ? "text-red-300 hover:text-white bg-red-950/40 hover:bg-red-900/40 border-red-500/40"
                : "text-blue-300 hover:text-white bg-blue-950/40 hover:bg-blue-900/40 border-blue-500/40"
            } rounded border transition-colors whitespace-nowrap" data-role="${role}" data-cmd="${item.cmd.replace(/"/g, "&quot;")}">
              <i class="fi fi-rr-play mr-1 flex items-center justify-center leading-none"></i>터미널 입력
            </button>
          </div>
        </div>
      </div>
    `
    )
    .join("");

  return `
    <div class="knowledge-reference-panel flex flex-col bg-[#0b0c0f] border border-zinc-800 rounded-lg p-3 text-[#e7e9ee] flex-1 min-h-[220px] max-h-[42vh] overflow-hidden mt-3">
      <div class="flex items-center justify-between pb-2 border-b border-zinc-800/80 shrink-0">
        <div class="flex items-center gap-2">
          <i class="fi ${
            isAttacker ? "fi-rr-book-alt text-[#ff5d6c]" : "fi-rr-shield-check text-[#38bdf8]"
          } flex items-center justify-center leading-none text-sm"></i>
          <div>
            <h3 class="text-xs font-bold text-[#e7e9ee] font-sans break-keep">${info.title}</h3>
            <p class="text-[11px] text-[#8a8f9c] break-keep">침투 및 방어 실무에서 반드시 알아야 할 핵심 명령어와 보안 지식 (내부 스크롤 가능)</p>
          </div>
        </div>
        <span class="inline-flex items-center justify-center leading-none text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-400 whitespace-nowrap">
          ${info.badge}
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2 flex-1 min-h-0 overflow-y-auto pr-1">
        ${cardsHtml}
      </div>
    </div>
  `;
}

export function renderSingleTerminalHtml(config, isFocused = true) {
  const terminalBuffer = config.initialLines
    .map((line) => `<div class="font-mono text-xs leading-relaxed text-[#e7e9ee] whitespace-pre-wrap">${line}</div>`)
    .join("");

  return `
    <div class="flex flex-col h-full min-h-0">
      <!-- Terminal Panel: 세로 절반(50vh) 차지 -->
      <div class="terminal-panel flex flex-col h-[50vh] min-h-[350px] bg-[#0b0c0f] border border-zinc-800 rounded-lg overflow-hidden shrink-0" data-terminal-role="${config.role}">
        <div class="flex items-center justify-between px-3 py-2 bg-[#12141a] border-b border-zinc-800 shrink-0">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center justify-center leading-none w-2.5 h-2.5 rounded-full ${
              config.role === "attacker" ? "bg-red-500" : "bg-emerald-500"
            }"></span>
            <i class="fi fi-rr-terminal flex items-center justify-center leading-none text-[#7c8cff]"></i>
            <span class="text-xs font-semibold text-[#e7e9ee] whitespace-nowrap font-sans">${config.title}</span>
          </div>

          <div class="flex items-center gap-2">
            <span class="inline-flex items-center justify-center leading-none text-[10px] font-mono px-2 py-0.5 rounded border ${config.badgeClass} whitespace-nowrap">
              ${config.statusText}
            </span>
            <button type="button" class="btn-terminal-clear inline-flex items-center justify-center leading-none px-2 py-1 text-[11px] text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700 rounded border border-zinc-700 transition-colors whitespace-nowrap">
              지우기
            </button>
            <button type="button" class="btn-terminal-reconnect inline-flex items-center justify-center leading-none px-2 py-1 text-[11px] text-[#7c8cff] hover:text-[#9bb0ff] bg-indigo-950/40 hover:bg-indigo-900/40 rounded border border-indigo-500/40 transition-colors whitespace-nowrap">
              재연결
            </button>
          </div>
        </div>

        <div id="${config.containerId}" class="flex-1 p-3 font-mono text-xs overflow-y-auto bg-[#08090b] text-[#e7e9ee] min-h-[220px]">
          <div class="terminal-fallback-content space-y-1">
            ${terminalBuffer}
          </div>
        </div>

        <div class="px-3 py-1.5 bg-[#0e1014] border-t border-zinc-800/80 flex items-center justify-between text-[11px] shrink-0">
          <span class="text-zinc-500 font-mono">WS: ${config.wsEndpoint}</span>
          <span class="text-zinc-400 font-sans break-keep">UTF-8 PTY 실시간 연동 활성화</span>
        </div>
      </div>

      <!-- Reference Knowledge Card Directly Below Terminal: 내부 스크롤 지원 -->
      ${renderReferenceKnowledgeCardHtml(config.role)}
    </div>
  `;
}

export function renderTwinTerminalHtml(props = {}) {
  const role = props.role ?? "both";

  if (role === "attacker") {
    return `
      <div class="twin-terminal-container w-full h-full ${props.className || ""}">
        ${renderSingleTerminalHtml(TERMINAL_CONFIGS.attacker, true)}
      </div>
    `;
  }

  if (role === "defender") {
    return `
      <div class="twin-terminal-container w-full h-full ${props.className || ""}">
        ${renderSingleTerminalHtml(TERMINAL_CONFIGS.defender, true)}
      </div>
    `;
  }

  return `
    <div class="twin-terminal-container grid grid-cols-1 lg:grid-cols-2 gap-3 w-full h-full ${props.className || ""}">
      <div class="h-full min-h-[220px]">
        ${renderSingleTerminalHtml(TERMINAL_CONFIGS.attacker, props.activeTerminal === "attacker")}
      </div>
      <div class="h-full min-h-[220px]">
        ${renderSingleTerminalHtml(TERMINAL_CONFIGS.defender, props.activeTerminal === "defender")}
      </div>
    </div>
  `;
}

export default renderTwinTerminalHtml;
