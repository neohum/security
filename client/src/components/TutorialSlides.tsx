// client/src/components/TutorialSlides.tsx — Interactive Tutorial Slide Deck for Metasploit Ch.3.
// Provides a bidirectional, interactive step-by-step walkthrough of Chapters 3 missions (Steps 1-6)
// with Red Team (Attacker) and Blue Team (Defender) perspectives, commands, and mitigations.

export interface TutorialSlide {
  step: number;
  id: string;
  category: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  overview: string;
  vulnPrinciple: string;
  redTeam: {
    title: string;
    techniques: string[];
    commands: string[];
    obtainedIntel: string;
  };
  blueTeam: {
    title: string;
    detection: string;
    mitigation: string[];
    patchCommand?: string;
  };
}

export const TUTORIAL_SLIDES: TutorialSlide[] = [
  {
    step: 1,
    id: "step-1-whois",
    category: "수동 정보 수집",
    title: "1단계: 수동 정보 수집 — Whois 분석",
    subtitle: "도메인 등록 정보 및 서브넷 CIDR 인텔리전스 수집",
    badge: "PASSIVE RECON",
    badgeColor: "border-indigo-500/50 bg-indigo-950/40 text-indigo-300",
    overview:
      "공격 대상 시스템에 직접 패킷을 전송하지 않고, 공개된 인터넷 레지스트리(Whois 포트 43)를 질의하여 조직의 소유자 정보, 서브넷 범위, 담당자 이메일을 식별하는 단계입니다.",
    vulnPrinciple:
      "도메인 등록 시 개인정보 보호(Whois Privacy Guard)가 적용되지 않거나 내부 사설 CIDR 대역이 노출되면 공격자는 조직의 전체 서브넷 구조와 관리자 이메일을 파악하여 공격 표면(Attack Surface)을 좁힐 수 있습니다.",
    redTeam: {
      title: "공격자 침투 전략 (Red Team)",
      techniques: [
        "포트 43 Whois TCP 레지스트리 질의",
        "관리자 이메일(admin@mega-infra.net) 및 서브넷(172.28.0.0/16) 식별",
        "인텔리전스 기반 타깃 IP 범위 획득",
      ],
      commands: [
        "whois -h 172.28.0.15 megacorp.internal",
        "whois -h 172.28.0.15 172.28.0.10",
      ],
      obtainedIntel: "관리자: admin@mega-infra.net | 대역: 172.28.0.0/16 | 네임서버: ns1.megacorp.internal",
    },
    blueTeam: {
      title: "방어자 탐지 및 대응 (Blue Team)",
      detection: "Whois 질의는 서드파티 공개 DB를 조회하므로 로컬 IDS에는 직접 탐지되지 않으나, 비정상 대량 레지스트리 크롤링 모니터링 필요.",
      mitigation: [
        "Whois Privacy Protection(도메인 개인정보 보호) 서비스 적용",
        "등록 정보에 내부 사설 IP, 서브넷 CIDR 및 실제 담당자 실명/개인 이메일 노출 차단",
        "공개용 일반 접수 메일(e.g. noc@, hostmaster@) 사용",
      ],
      patchCommand: "# Whois 레코드 사설 IP 마스킹 정책 적용 및 관리자 이메일 보안 처리",
    },
  },
  {
    step: 2,
    id: "step-2-axfr",
    category: "DNS 정보 수집",
    title: "2단계: DNS Zone Transfer(AXFR) 영역 전송",
    subtitle: "BIND 네임서버 설정 결함을 이용한 내부 도메인 전수 탈취",
    badge: "DNS MISCONFIG",
    badgeColor: "border-sky-500/50 bg-sky-950/40 text-sky-300",
    overview:
      "주(Primary) 네임서버와 보조(Secondary) 네임서버 간에 DNS 존 레코드를 동기화하기 위한 AXFR 프로토콜의 보안 미흡을 악용하여, 외부에 비공개된 내부 호스트명을 일괄 수집합니다.",
    vulnPrinciple:
      "BIND DNS 서버의 named.conf 설정에서 allow-transfer 접근 제어가 누락되면, 인증되지 않은 외부 공격자가 AXFR 요청을 통해 모든 내부 서버의 FQDN과 IP 매핑 정보를 즉시 덤프할 수 있습니다.",
    redTeam: {
      title: "공격자 침투 전략 (Red Team)",
      techniques: [
        "TCP 53 포트를 통한 DNS AXFR 영역 전송 요청",
        "내부 관리 서버(admin-vault), 게이트웨이, DB 네임서버 레코드 전수 탈취",
        "서브도메인 사전 대입 없이 100% 완전한 인프라 맵 구축",
      ],
      commands: [
        "dig axfr @172.28.0.15 megacorp.internal",
        "host -l megacorp.internal 172.28.0.15",
      ],
      obtainedIntel: "admin-vault.megacorp.internal (172.28.0.20), secret-gateway (172.28.0.25)",
    },
    blueTeam: {
      title: "방어자 탐지 및 대응 (Blue Team)",
      detection: "TCP 53 포트로 유입되는 AXFR 쿼리 패킷 감지 (Snort SID: 254 'DNS zone transfer attempt').",
      mitigation: [
        "named.conf 파일 내 allow-transfer 지시어를 신뢰할 수 있는 보조 네임서버 IP로 엄격히 제한",
        "외부 질의 대상 네임서버에서는 allow-transfer { none; }; 적용",
        "TSIG(Transaction Signature) 암호화 서명 기반 동기화 적용",
      ],
      patchCommand: "sed -i 's/allow-transfer { any; };/allow-transfer { none; };/' /etc/bind/named.conf",
    },
  },
  {
    step: 3,
    id: "step-3-nmap",
    category: "능동 포트 스캔",
    title: "3단계: 능동 정보 수집 — db_nmap 포트 스캔",
    subtitle: "SYN Stealth 스캔 및 PostgreSQL DB 연동 지문 수집",
    badge: "ACTIVE SCANNING",
    badgeColor: "border-emerald-500/50 bg-emerald-950/40 text-emerald-300",
    overview:
      "식별된 서브넷의 모든 호스트를 대상으로 TCP SYN 스캔을 실행하여 활성화된 포트와 서비스 배너를 탐지하고, 그 결과를 Metasploit 백엔드 데이터베이스에 자동으로 체계화합니다.",
    vulnPrinciple:
      "불필요한 관리 서비스(FTP, MSSQL, S3 API 등)가 방화벽 없이 외부에 열려 있거나 기본 포트를 유지할 경우, 공격자는 버전 배너를 분석하여 알려진 CVE 취약점을 즉각 매핑할 수 있습니다.",
    redTeam: {
      title: "공격자 침투 전략 (Red Team)",
      techniques: [
        "TCP SYN Stealth 스캔(-sS)으로 3-Way Handshake를 완성하지 않고 로그 회피",
        "버전 배너 탐지(-sV) 및 msfconsole의 db_nmap으로 PostgreSQL에 결과 영구 저장",
        "Metasploit 내에서 'hosts', 'services' 명령으로 타깃 리스트 자동화",
      ],
      commands: [
        "db_nmap -sS -sV -p 21,80,1433,9000 172.28.0.0/24",
        "services -u -p 1433",
      ],
      obtainedIntel: "172.28.0.10:21(vsftpd), 172.28.0.30:1433(MSSQL), 172.28.0.25:9000(MinIO S3)",
    },
    blueTeam: {
      title: "방어자 탐지 및 대응 (Blue Team)",
      detection: "단시간에 발생하는 다중 포트 TCP SYN 요청 및 RST 응답 패턴 감지 (Portscan IDS 알림).",
      mitigation: [
        "iptables 또는 하드웨어 방화벽으로 불필요한 인바운드 포트 전면 차단",
        "포트 스캐닝 자동 차단 도구(Fail2ban, PSAD) 연동",
        "서비스 배너 정보 숨김(ServerTokens Prod, Banner None)",
      ],
      patchCommand: "iptables -A INPUT -p tcp -m multiport --dports 21,1433,9000 -j DROP",
    },
  },
  {
    step: 4,
    id: "step-4-mssql",
    category: "타깃 인증 스캔",
    title: "4단계: 타깃 스캔 — MSSQL sa 브루트포스",
    subtitle: "TDS 프로토콜 기본 관리자 자격증명 무차별 대입 공격",
    badge: "CREDENTIAL BRUTE",
    badgeColor: "border-amber-500/50 bg-amber-950/40 text-amber-300",
    overview:
      "3단계에서 식별된 MSSQL 데이터베이스(포트 1433)에 대해 Metasploit의 auxiliary 스캐너 모듈을 활용하여 기본 sa 계정의 취약한 패스워드를 브루트포스하여 최고 관리자 권한을 획득합니다.",
    vulnPrinciple:
      "데이터베이스 설치 시 기본 sa 계정의 비밀번호를 단순한 값(Password123!, admin 등)으로 설정하거나 계정 잠금 정책이 미적용된 경우, 무차별 대입 공격으로 손쉽게 전체 데이터베이스 및 OS 명령 실행 권한이 장악됩니다.",
    redTeam: {
      title: "공격자 침투 전략 (Red Team)",
      techniques: [
        "Metasploit auxiliary/scanner/mssql/mssql_login 모듈 로드",
        "사전 파일(wordlist) 기반 무차별 대입 또는 기본 자격증명(sa:Password123!) 스프레잉",
        "sa 인증 성공 후 xp_cmdshell을 활성화하여 원격 셸 실행 기반 마련",
      ],
      commands: [
        "use auxiliary/scanner/mssql/mssql_login",
        "set RHOSTS 172.28.0.30; set USERNAME sa; set PASS_FILE /root/dict.txt; run",
      ],
      obtainedIntel: "MSSQL sa 자격증명 획득: sa:Password123! -> 데이터베이스 전체 읽기/쓰기 권한 확보",
    },
    blueTeam: {
      title: "방어자 탐지 및 대응 (Blue Team)",
      detection: "포트 1433으로의 연속적인 TDS 로그인 실패 로그 및 Event ID 18456 (Login failed for user 'sa') 폭증.",
      mitigation: [
        "sa 계정 이름 변경 또는 완전 비활성화, Windows 인증 모드(인증 통합) 사용",
        "연속 로그인 실패 시 계정 임시 잠금 및 IP 자동차단 정책 적용",
        "SQL Server 포트를 VPN 또는 관리자 내부망 전용 IP로만 바인딩",
      ],
      patchCommand: "ALTER LOGIN [sa] DISABLE; ALTER SERVER ROLE [sysadmin] DROP MEMBER [sa];",
    },
  },
  {
    step: 5,
    id: "step-5-s3",
    category: "클라우드 스토리지",
    title: "5단계: 클라우드 스토리지 — Fake S3 버킷 정찰",
    subtitle: "오브젝트 스토리지 퍼블릭 노출 및 백업 자격증명 유출",
    badge: "CLOUD STORAGE LEAK",
    badgeColor: "border-purple-500/50 bg-purple-950/40 text-purple-300",
    overview:
      "모의 AWS S3 / MinIO 오브젝트 스토리지(포트 9000)를 대상으로 공개된 버킷 목록을 탐색하고, 잘못 구성된 퍼블릭 다운로드 권한을 통해 config.env 등 기밀 환경설정 파일을 탈취합니다.",
    vulnPrinciple:
      "클라우드 스토리지의 ACL(Access Control List) 정책이 'Public Read'로 잘못 열려 있으면, 공격자는 인증 토큰 없이 단순 HTTP GET 요청만으로 데이터베이스 접속 암호, API 시크릿 키가 포함된 백업 파일을 다운로드할 수 있습니다.",
    redTeam: {
      title: "공격자 침투 전략 (Red Team)",
      techniques: [
        "포트 9000 HTTP S3 REST API 버킷 목록 열거",
        "퍼블릭 버킷(megacorp-backup) 내 config.env 및 백업 아티팩트 직접 다운로드",
        "환경변수에서 DB_PASSWORD, AWS_SECRET_ACCESS_KEY, JWT_SECRET 추출",
      ],
      commands: [
        "curl -s http://172.28.0.25:9000/megacorp-backup/config.env",
        "aws --endpoint-url=http://172.28.0.25:9000 s3 cp s3://megacorp-backup/config.env .",
      ],
      obtainedIntel: "DB_PASSWORD=password123! | AWS_ACCESS_KEY_ID=minioadmin | JWT_SECRET=...",
    },
    blueTeam: {
      title: "방어자 탐지 및 대응 (Blue Team)",
      detection: "스토리지 서버 접근 로그에서 미인증 익명(Anonymous) 요청에 의한 민감 파일 다운로드 감지.",
      mitigation: [
        "S3 퍼블릭 액세스 차단(Block Public Access) 강제 활성화",
        "버킷 정책에서 s3:GetObject 권한을 인증된 IAM 역할로만 엄격히 제한",
        "config.env 등 기밀 정보는 소스/버킷에 평문 저장 금지, AWS Secrets Manager 또는 HashiCorp Vault 활용",
      ],
      patchCommand: "mc anonymous set none myminio/megacorp-backup",
    },
  },
  {
    step: 6,
    id: "step-6-custom-ruby",
    category: "커스텀 스캐너 개발",
    title: "6단계: 커스텀 MSF 스캐너 루비 모듈 작성",
    subtitle: "Msf::Exploit::Remote::Tcp 믹스인을 활용한 소켓 배너 획득",
    badge: "RUBY SCANNER MODULE",
    badgeColor: "border-rose-500/50 bg-rose-950/40 text-rose-300",
    overview:
      "교재 3장의 핵심 실습인 커스텀 모듈 작성을 직접 수행합니다. 메타스플로잇의 TCP 소켓 믹스인을 상속받아 원하는 포트에 접속해 배너를 수집하는 custom_tcp_banner.rb 루비 모듈을 제작하고 로드합니다.",
    vulnPrinciple:
      "알려진 표준 포트가 아니거나 독자적인 레거시 프로토콜의 경우 상용 도구로 탐지되지 않을 수 있습니다. 보안 분석가는 프레임워크 믹스인을 활용해 전용 스캐너를 신속히 개발하여 숨겨진 백도어와 버전 지문을 식별합니다.",
    redTeam: {
      title: "공격자 침투 전략 (Red Team)",
      techniques: [
        "Msf::Exploit::Remote::Tcp 및 Auxiliary::Scanner 믹스인 상속",
        "run_host(ip) 메서드에서 connect, sock.get_once, disconnect 구현",
        "reload_all로 모듈 즉시 적재 후 미확인 포트의 vsftpd 2.3.4 백도어 배너 식별",
      ],
      commands: [
        "cat << 'EOF' > /root/.msf4/modules/auxiliary/scanner/custom_tcp_banner.rb",
        "msfconsole -q -x 'reload_all; use auxiliary/scanner/custom_tcp_banner; set RHOSTS 172.28.0.10; run'",
      ],
      obtainedIntel: "포트 21 배너: '220 (vsFTPd 2.3.4)' 식별 -> Smiley Face 백도어 공격(exploit/unix/ftp/vsftpd_234_backdoor) 연계 가능",
    },
    blueTeam: {
      title: "방어자 탐지 및 대응 (Blue Team)",
      detection: "원격 호스트에서 짧은 주기로 TCP 세션을 연결하고 첫 번째 배너만 수신 후 즉시 연결을 종료하는 프로빙 행위 감지.",
      mitigation: [
        "vsftpd 2.3.4 등 알려진 백도어 포함 레거시 패키지 즉각 최신 안정 버전으로 업그레이드",
        "EDR 및 무결성 검증을 통해 시스템 바이너리 변조 상시 탐지",
        "내부망 세그멘테이션으로 비인가 호스트 간 포트 접근 격리",
      ],
      patchCommand: "apt-get update && apt-get --only-upgrade install vsftpd",
    },
  },
];

/**
 * Renders the bidirectional tutorial slide modal dialog HTML.
 */
export function renderTutorialSlideModalHtml(currentStep = 1, isOpen = false): string {
  const slideIndex = Math.max(0, Math.min(TUTORIAL_SLIDES.length - 1, currentStep - 1));
  const slide = TUTORIAL_SLIDES[slideIndex] || TUTORIAL_SLIDES[0];
  const isFirst = slideIndex === 0;
  const isLast = slideIndex === TUTORIAL_SLIDES.length - 1;

  // Render Step Tabs (1 to 6)
  const tabsHtml = TUTORIAL_SLIDES.map((s, idx) => {
    const isActive = idx === slideIndex;
    return `
      <button
        type="button"
        class="slide-tab-btn inline-flex items-center justify-center leading-none px-3 py-1.5 text-xs rounded border transition-all whitespace-nowrap ${
          isActive
            ? "border-indigo-500 bg-indigo-950/70 text-indigo-300 font-bold shadow-sm"
            : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
        }"
        data-step="${s.step}"
      >
        <span class="w-4 h-4 rounded-full mr-1.5 flex items-center justify-center text-[10px] ${
          isActive ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400"
        }">${s.step}</span>
        <span>${s.category}</span>
      </button>
    `;
  }).join("");

  // Render Dot Indicators
  const dotsHtml = TUTORIAL_SLIDES.map((s, idx) => {
    const isActive = idx === slideIndex;
    return `
      <button
        type="button"
        class="slide-dot-btn w-2.5 h-2.5 rounded-full transition-all ${
          isActive ? "bg-indigo-500 w-6" : "bg-zinc-700 hover:bg-zinc-500"
        }"
        data-step="${s.step}"
        title="${s.step}단계: ${s.category}"
      ></button>
    `;
  }).join("");

  // Commands List
  const commandsHtml = slide.redTeam.commands
    .map(
      (cmd) => `
      <div class="flex items-center justify-between gap-2 p-2 bg-[#090a0d] border border-zinc-800 rounded font-mono text-xs text-emerald-400 group">
        <span class="overflow-x-auto select-all whitespace-nowrap scrollbar-thin">${escapeHtml(cmd)}</span>
        <button
          type="button"
          class="btn-slide-copy-cmd shrink-0 px-2 py-0.5 text-[11px] rounded border border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:text-white hover:border-indigo-500 transition-colors inline-flex items-center justify-center leading-none"
          data-cmd="${escapeHtml(cmd)}"
          title="명령어 클립보드 복사"
        >
          <i class="fi fi-rr-copy mr-1 flex items-center justify-center leading-none"></i>
          <span>복사</span>
        </button>
      </div>
    `
    )
    .join("");

  return `
    <!-- Tutorial Slide Deck Modal Backdrop -->
    <div
      id="tutorial-slides-modal"
      class="tutorial-slides-modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm transition-opacity ${
        isOpen ? "flex" : "hidden"
      }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="slide-dialog-title"
    >
      <div class="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#0d0e12] border border-zinc-800 rounded-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        <!-- Modal Top Bar -->
        <div class="flex items-center justify-between px-4 py-3 bg-[#12141a] border-b border-zinc-800 text-[#e7e9ee]">
          <div class="flex items-center gap-2.5">
            <div class="flex items-center justify-center w-7 h-7 rounded border border-indigo-500/40 bg-indigo-950/60 text-indigo-400">
              <i class="fi fi-rr-presentation flex items-center justify-center leading-none text-sm"></i>
            </div>
            <div>
              <h2 id="slide-dialog-title" class="text-sm font-bold text-[#e7e9ee] break-keep">
                메타스플로잇 2/e 제3장 인텔리전스 수집 — 양방향 학습 슬라이드
              </h2>
              <p class="text-[11px] text-zinc-400">
                공격자 침투 기법과 방어자 침입 탐지/패치 대응을 단계별로 대조 학습합니다.
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs font-mono px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300">
              <span id="slide-current-step">${slide.step}</span> / ${TUTORIAL_SLIDES.length}
            </span>
            <button
              type="button"
              id="btn-close-tutorial-slides"
              class="w-7 h-7 rounded border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors inline-flex items-center justify-center leading-none"
              title="슬라이드 닫기 (Esc)"
            >
              <i class="fi fi-rr-cross flex items-center justify-center leading-none text-xs"></i>
            </button>
          </div>
        </div>

        <!-- Step Navigation Tabs -->
        <div class="flex items-center gap-1.5 px-4 py-2 bg-[#0e1015] border-b border-zinc-800/80 overflow-x-auto scrollbar-thin">
          ${tabsHtml}
        </div>

        <!-- Slide Main Content (Scrollable) -->
        <div id="slide-content-body" class="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-zinc-200">
          
          <!-- Slide Header Card -->
          <div class="p-3.5 bg-zinc-900/60 rounded border border-zinc-800 space-y-1.5">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="inline-flex items-center justify-center leading-none text-[11px] px-2 py-0.5 rounded border ${
                slide.badgeColor
              } font-semibold uppercase tracking-wider">
                ${slide.badge}
              </span>
              <span class="text-xs text-zinc-400 font-mono">시나리오 퀘스트 #${slide.step}</span>
            </div>
            <h3 class="text-base sm:text-lg font-bold text-white text-balance break-keep">
              ${slide.title}
            </h3>
            <p class="text-xs text-indigo-300 font-medium break-keep">
              ${slide.subtitle}
            </p>
            <p class="text-xs text-zinc-300 pt-1 leading-relaxed break-keep">
              ${slide.overview}
            </p>
          </div>

          <!-- Vulnerability Mechanism Alert Box -->
          <div class="p-3 bg-amber-950/20 border border-amber-500/30 rounded flex items-start gap-2.5 text-xs text-amber-200/90 leading-relaxed">
            <i class="fi fi-rr-shield-exclamation text-amber-400 text-sm mt-0.5 flex items-center justify-center leading-none shrink-0"></i>
            <div>
              <strong class="font-semibold text-amber-300">취약점 발생 원리: </strong>
              <span class="break-keep">${slide.vulnPrinciple}</span>
            </div>
          </div>

          <!-- 2-Column: Red Team vs Blue Team Perspective Grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            <!-- Red Team (Attacker) Card -->
            <div class="flex flex-col p-3.5 bg-red-950/15 border border-red-500/30 rounded space-y-2.5">
              <div class="flex items-center justify-between border-b border-red-500/20 pb-2">
                <div class="flex items-center gap-1.5 text-xs font-bold text-red-300">
                  <i class="fi fi-rr-crosshairs flex items-center justify-center leading-none text-red-400"></i>
                  <span>${slide.redTeam.title}</span>
                </div>
                <span class="text-[10px] text-red-400/80 uppercase font-mono">Attack Vector</span>
              </div>

              <!-- Technique bullets -->
              <ul class="text-xs text-zinc-300 space-y-1 pl-4 list-disc marker:text-red-400 break-keep">
                ${slide.redTeam.techniques.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}
              </ul>

              <!-- Execution commands -->
              <div class="space-y-1.5 pt-1">
                <div class="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
                  <i class="fi fi-rr-terminal flex items-center justify-center leading-none text-xs text-emerald-400"></i>
                  <span>실습 공격 명령어 (Click to Copy):</span>
                </div>
                ${commandsHtml}
              </div>

              <!-- Obtained Intel -->
              <div class="mt-auto pt-2 border-t border-red-500/20 text-[11px] text-zinc-400">
                <strong class="text-red-300">탈취 대상 인텔리전스: </strong>
                <span class="font-mono text-zinc-300 select-all">${escapeHtml(slide.redTeam.obtainedIntel)}</span>
              </div>
            </div>

            <!-- Blue Team (Defender) Card -->
            <div class="flex flex-col p-3.5 bg-blue-950/15 border border-blue-500/30 rounded space-y-2.5">
              <div class="flex items-center justify-between border-b border-blue-500/20 pb-2">
                <div class="flex items-center gap-1.5 text-xs font-bold text-blue-300">
                  <i class="fi fi-rr-shield-check flex items-center justify-center leading-none text-blue-400"></i>
                  <span>${slide.blueTeam.title}</span>
                </div>
                <span class="text-[10px] text-blue-400/80 uppercase font-mono">Defense & Patch</span>
              </div>

              <!-- Detection mechanism -->
              <div class="text-xs text-zinc-300 space-y-1">
                <strong class="text-blue-300 text-[11px] block">침입 탐지(IDS) 원리:</strong>
                <p class="text-zinc-300 leading-relaxed break-keep pl-2 border-l border-blue-500/40">
                  ${slide.blueTeam.detection}
                </p>
              </div>

              <!-- Mitigation points -->
              <div class="space-y-1 pt-1">
                <strong class="text-blue-300 text-[11px] block">보안 대책 및 설정 권고:</strong>
                <ul class="text-xs text-zinc-300 space-y-1 pl-4 list-disc marker:text-blue-400 break-keep">
                  ${slide.blueTeam.mitigation.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}
                </ul>
              </div>

              <!-- Patch command (if any) -->
              ${
                slide.blueTeam.patchCommand
                  ? `
                <div class="mt-auto pt-2 border-t border-blue-500/20 space-y-1">
                  <span class="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
                    <i class="fi fi-rr-wrench flex items-center justify-center leading-none text-xs text-cyan-400"></i>
                    <span>방어자 보안 패치 명령어:</span>
                  </span>
                  <div class="p-2 bg-[#090a0d] border border-zinc-800 rounded font-mono text-[11px] text-cyan-300 select-all overflow-x-auto whitespace-nowrap">
                    ${escapeHtml(slide.blueTeam.patchCommand)}
                  </div>
                </div>
              `
                  : ""
              }
            </div>

          </div>

        </div>

        <!-- Slide Footer: Bidirectional Controls -->
        <div class="flex items-center justify-between px-4 py-3 bg-[#12141a] border-t border-zinc-800 gap-3">
          
          <!-- Prev Button -->
          <button
            type="button"
            id="btn-slide-prev"
            class="inline-flex items-center justify-center leading-none px-3.5 py-1.5 text-xs rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-white transition-all disabled:opacity-40 disabled:pointer-events-none"
            ${isFirst ? "disabled" : ""}
            data-target-step="${slideIndex}"
          >
            <i class="fi fi-rr-angle-left mr-1.5 flex items-center justify-center leading-none"></i>
            <span>이전 단계</span>
          </button>

          <!-- Center Dot Indicators -->
          <div class="flex items-center gap-1.5">
            ${dotsHtml}
          </div>

          <!-- Next Button -->
          <button
            type="button"
            id="btn-slide-next"
            class="inline-flex items-center justify-center leading-none px-3.5 py-1.5 text-xs rounded border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500 transition-all font-medium disabled:opacity-40 disabled:pointer-events-none"
            ${isLast ? "disabled" : ""}
            data-target-step="${slideIndex + 2}"
          >
            <span>다음 단계</span>
            <i class="fi fi-rr-angle-right ml-1.5 flex items-center justify-center leading-none"></i>
          </button>

        </div>

      </div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
