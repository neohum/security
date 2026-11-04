// AttackerDashboard.tsx — Red Team Operations Dashboard for Metasploit Ch.3 Simulation.
//
// Conforms to:
//   - DESIGN.md: Dark minimal theme (#0b0c0f, #e7e9ee, #7c8cff, #ff5d6c)
//   - Anti-Fingernail: Strict symmetric borders (border border-zinc-800)
//   - Perfect Centering: inline-flex items-center justify-center leading-none
//   - Korean Typography: break-keep, text-balance, text-pretty, whitespace-nowrap

import {
  renderTopologyRadarHtml,
  INITIAL_TOPOLOGY_NODES,
  type TopologyHostNode,
} from "./TopologyRadar.ts";

export interface MissionItem {
  id: string;
  order: number;
  title: string;
  category: "passive" | "active" | "target" | "custom";
  description: string;
  targetIp: string;
  hintCommand: string;
  flagKey: string;
  aliases?: string[];
  points: number;
  solved: boolean;
}

export const CH3_MISSIONS: MissionItem[] = [
  {
    id: "m1-whois",
    order: 1,
    title: "1단계: 수동 정보 수집 — Whois 분석",
    category: "passive",
    description: "페이크 Whois 서버(172.28.0.15:43)에 도메인 등록 정보를 질의하여 담당자 이메일과 서브넷 정보를 식별하세요.",
    targetIp: "172.28.0.15",
    hintCommand: "whois -h 172.28.0.15 megacorp.internal",
    flagKey: "FLAG{WHOIS_RECON_SUCCESS}",
    aliases: [
      "FLAG{whois_megacorp_admin_discovered}",
      "FLAG{whois_recon_success}",
    ],
    points: 100,
    solved: false,
  },
  {
    id: "m2-dns-axfr",
    order: 2,
    title: "2단계: DNS Zone Transfer(AXFR) 영역 전송",
    category: "passive",
    description: "모의 DNS 서버의 BIND AXFR 취약점을 이용해 megacorp.internal의 모든 내부 서브도메인을 탈취하세요.",
    targetIp: "172.28.0.15",
    hintCommand: "dig axfr @172.28.0.15 megacorp.internal",
    flagKey: "FLAG{ZONE_TRANSFER_EXPOSED}",
    aliases: [
      "FLAG{axfr_zone_transferred}",
      "FLAG{axfr_zone_transfer_subdomains_leaked}",
      "FLAG{zone_transfer_exposed}",
    ],
    points: 100,
    solved: false,
  },
  {
    id: "m3-db-nmap",
    order: 3,
    title: "3단계: 능동 정보 수집 — db_nmap 포트 스캔",
    category: "active",
    description: "MSF 콘솔 내부에서 db_nmap을 실행하여 가상 서브넷(172.28.0.0/24)의 열린 포트를 PostgreSQL DB에 기록하세요.",
    targetIp: "172.28.0.20",
    hintCommand: "msfconsole -q -x 'db_nmap -sS -sV 172.28.0.20 172.28.0.30; hosts; services'",
    flagKey: "FLAG{MSF_DB_NMAP_RECORDED}",
    aliases: [
      "FLAG{syn_scan_detected}",
      "FLAG{nmap_syn_stealth_scan_completed}",
      "FLAG{msf_auxiliary_portscan_tcp_success}",
      "FLAG{msf_db_nmap_recorded}",
    ],
    points: 100,
    solved: false,
  },
  {
    id: "m4-mssql-login",
    order: 4,
    title: "4단계: 타깃 스캔 — MSSQL sa 브루트포스",
    category: "target",
    description: "auxiliary/scanner/mssql/mssql_login 모듈을 활용해 취약한 MSSQL 인스턴스(172.28.0.30)의 관리자 비밀번호를 획득하세요.",
    targetIp: "172.28.0.30",
    hintCommand: "use auxiliary/scanner/mssql/mssql_login\nset RHOSTS 172.28.0.30\nrun",
    flagKey: "FLAG{MSSQL_SA_PWNED}",
    aliases: [
      "FLAG{mssql_instance_ping_confirmed}",
      "FLAG{service_version_discovered}",
      "FLAG{mssql_sa_pwned}",
    ],
    points: 100,
    solved: false,
  },
  {
    id: "m5-s3-leak",
    order: 5,
    title: "5단계: 클라우드 스토리지 — Fake S3 버킷 정찰",
    category: "target",
    description: "모의 AWS S3(172.28.0.25:9000)의 퍼블릭 버킷에서 노출된 config.env 파일을 추출하여 데이터베이스 접속 정보를 확보하세요.",
    targetIp: "172.28.0.25",
    hintCommand: "aws --endpoint-url http://172.28.0.25:9000 s3 cp s3://megacorp-backup/config.env -",
    flagKey: "FLAG{S3_CONFIDENTIAL_LEAK}",
    aliases: [
      "FLAG{s3_bucket_leaked_creds}",
      "FLAG{s3_open_bucket_config_env_leaked}",
      "FLAG{s3_confidential_leak}",
    ],
    points: 100,
    solved: false,
  },
  {
    id: "m6-custom-scanner",
    order: 6,
    title: "6단계: 커스텀 MSF 스캐너 루비 모듈 작성",
    category: "custom",
    description: "교재 3장의 Msf::Exploit::Remote::Tcp 믹스인을 사용한 custom_tcp_banner.rb 스캐너를 로드하고 미지의 포트 배너를 획득하세요.",
    targetIp: "172.28.0.20",
    hintCommand: "msfconsole -m scenarios/modules -x 'use auxiliary/scanner/custom_tcp_banner; run'",
    flagKey: "FLAG{CUSTOM_RUBY_BANNER_GRABBED}",
    aliases: [
      "FLAG{custom_scanner_ruby_win}",
      "FLAG{custom_ruby_tcp_scanner_executed_successfully}",
      "FLAG{custom_ruby_banner_grabbed}",
    ],
    points: 100,
    solved: false,
  },
];

export interface AttackerDashboardProps {
  missions?: MissionItem[];
  nodes?: TopologyHostNode[];
  activeMissionId?: string;
  submittedFlag?: string;
  flagStatus?: "idle" | "success" | "error";
  statusMessage?: string;
  className?: string;
}

/**
 * Validates submitted flag and returns updated mission list + score.
 * Supports case-insensitivity, leading/trailing whitespace tolerance, and alias flags.
 */
export function evaluateSubmittedFlag(
  flagInput: string,
  missions: MissionItem[] = CH3_MISSIONS,
): {
  success: boolean;
  message: string;
  updatedMissions: MissionItem[];
  totalScore: number;
} {
  const trimmed = (flagInput || "").trim();
  const upperTrimmed = trimmed.toUpperCase();

  const matched = missions.find(
    (m) =>
      m.flagKey.toUpperCase() === upperTrimmed ||
      (m.aliases && m.aliases.some((a) => a.toUpperCase() === upperTrimmed)),
  );

  if (!matched) {
    const totalScore = missions.filter((m) => m.solved).reduce((acc, m) => acc + m.points, 0);
    return {
      success: false,
      message: "일치하지 않는 플래그입니다. 명령 결과를 다시 점검하세요.",
      updatedMissions: missions,
      totalScore,
    };
  }

  const updatedMissions = missions.map((m) =>
    m.id === matched.id ? { ...m, solved: true } : m,
  );
  const totalScore = updatedMissions.filter((m) => m.solved).reduce((acc, m) => acc + m.points, 0);

  return {
    success: true,
    message: `정답입니다! "${matched.title}" 퀘스트를 완료했습니다. (+${matched.points}점)`,
    updatedMissions,
    totalScore,
  };
}

export function evaluateTerminalOutput(
  cmd = "",
  output = "",
  missions: MissionItem[] = CH3_MISSIONS,
): { matched: boolean; mission?: MissionItem; updatedMissions: MissionItem[]; totalScore?: number; message?: string } {
  const text = `${cmd} ${output}`.toLowerCase();
  const normalizedText = text.replace(/\s+/g, " ");

  for (const m of missions) {
    if (m.solved) continue;

    let isMatch = false;
    if (m.id === "m1-whois") {
      isMatch =
        (text.includes("whois") || normalizedText.includes("whois")) &&
        (text.includes("megacorp") ||
          text.includes("172.28.0.15") ||
          text.includes("admin@megacorp") ||
          text.includes("orgname") ||
          text.includes("whois_recon_success"));
    } else if (m.id === "m2-dns-axfr") {
      isMatch =
        (text.includes("axfr") ||
          text.includes("zone transfer") ||
          text.includes("zone_transfer") ||
          normalizedText.includes("host -l") ||
          normalizedText.includes("nslookup -type=axfr") ||
          normalizedText.includes("nslookup -type=any")) &&
        (text.includes("megacorp") ||
          text.includes("172.28.0.15") ||
          text.includes("ns1") ||
          text.includes("db-mssql") ||
          text.includes("backup-s3") ||
          text.includes("zone_transfer_exposed"));
    } else if (m.id === "m3-db-nmap") {
      isMatch =
        (text.includes("nmap") || text.includes("db_nmap")) &&
        (text.includes("172.28.0.20") ||
          text.includes("172.28.0.10") ||
          text.includes("172.28.0.0") ||
          text.includes("21/tcp") ||
          text.includes("22/tcp") ||
          text.includes("445/tcp") ||
          text.includes("open  ftp") ||
          text.includes("open ftp") ||
          text.includes("msf_db_nmap_recorded") ||
          text.includes("syn_scan_detected"));
    } else if (m.id === "m4-mssql-login") {
      isMatch =
        (text.includes("mssql") || text.includes("1433")) &&
        (text.includes("login") ||
          text.includes("sa") ||
          text.includes("run") ||
          text.includes("instance") ||
          text.includes("mssql_sa_pwned"));
    } else if (m.id === "m5-s3-leak") {
      isMatch =
        (text.includes("s3") || text.includes("minio") || text.includes("9000")) &&
        (text.includes("megacorp-backup") ||
          text.includes("config.env") ||
          text.includes("s3_confidential_leak"));
    } else if (m.id === "m6-custom-scanner") {
      isMatch =
        text.includes("custom_tcp_banner") ||
        text.includes("custom-scanner") ||
        text.includes("tcp_banner") ||
        text.includes("custom_ruby_banner_grabbed");
    }

    if (!isMatch && m.flagKey && text.includes(m.flagKey.toLowerCase())) {
      isMatch = true;
    }

    if (!isMatch && m.aliases) {
      for (const alias of m.aliases) {
        if (text.includes(alias.toLowerCase())) {
          isMatch = true;
          break;
        }
      }
    }

    if (isMatch) {
      const updatedMissions = missions.map((x) => (x.id === m.id ? { ...x, solved: true } : x));
      const totalScore = updatedMissions.filter((x) => x.solved).reduce((acc, x) => acc + x.points, 0);
      return {
        matched: true,
        mission: m,
        updatedMissions,
        totalScore,
        message: `🎯 터미널 정찰 성공! "${m.title}" 퀘스트가 자동 완료되었습니다. (+${m.points} PT)`,
      };
    }
  }

  return { matched: false, updatedMissions: missions };
}

/**
 * Pure HTML generator for AttackerDashboard.
 */
export function renderAttackerDashboardHtml(props: AttackerDashboardProps = {}): string {
  const missions = props.missions ?? CH3_MISSIONS;
  const nodes = props.nodes ?? INITIAL_TOPOLOGY_NODES;
  const activeMission = missions.find((m) => m.id === props.activeMissionId) || missions[0]; // default 1st mission
  const solvedCount = missions.filter((m) => m.solved).length;
  const totalPoints = missions.reduce((acc, m) => acc + m.points, 0);
  const currentPoints = missions.filter((m) => m.solved).reduce((acc, m) => acc + m.points, 0);

  const flagStatusClass =
    props.flagStatus === "success"
      ? "text-emerald-400 bg-emerald-950/40 border-emerald-500/50"
      : props.flagStatus === "error"
        ? "text-red-400 bg-red-950/40 border-red-500/50"
        : "text-zinc-400 bg-zinc-900 border-zinc-700/60";

  return `
    <div class="attacker-dashboard flex flex-col h-full bg-[#0b0c0f] border border-zinc-800 rounded-lg p-3 text-[#e7e9ee] space-y-3 box-border overflow-y-auto ${
      props.className || ""
    }">
      <!-- Red Team Header -->
      <div class="flex items-center justify-between pb-2 border-b border-zinc-800/80">
        <div class="flex items-center gap-2">
          <i class="fi fi-rr-crosshairs flex items-center justify-center leading-none text-[#ff5d6c] text-base"></i>
          <div>
            <h2 class="text-xs font-bold text-[#e7e9ee] uppercase tracking-wider text-balance">
              공격자 작전 대시보드 (Red Team)
            </h2>
            <p class="text-[11px] text-[#8a8f9c] break-keep">
              메타스플로잇 2/e 제3장 "인텔리전스 수집" 시뮬레이션
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Score Pill -->
          <div class="inline-flex items-center justify-center leading-none px-2.5 py-1 rounded border border-red-500/40 bg-red-950/30 text-red-300 font-mono text-xs whitespace-nowrap">
            획득 점수: ${currentPoints} / ${totalPoints} PT (${solvedCount}/${missions.length})
          </div>
        </div>
      </div>

      <!-- Main Operational Split: Missions List & Topology Radar -->
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <!-- Missions Column (7 Cols) -->
        <div class="xl:col-span-7 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-[#8a8f9c] uppercase tracking-wider whitespace-nowrap">
              침투 정찰 퀘스트 목록
            </span>
            <span class="text-[10px] text-zinc-500 font-mono">CH3 MISSIONS</span>
          </div>

          <div class="space-y-1.5">
            ${missions
              .map((m) => {
                const isSelected = m.id === activeMission.id;
                const statusBadge = m.solved
                  ? `<span class="inline-flex items-center justify-center leading-none text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/50 bg-emerald-950/40 text-emerald-300 whitespace-nowrap">완료됨</span>`
                  : `<span class="inline-flex items-center justify-center leading-none text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-400 whitespace-nowrap">${m.points} PT</span>`;

                return `
                  <div class="mission-item p-2.5 rounded border ${
                    isSelected ? "border-red-500/60 bg-[#16141a]" : "border-zinc-800/80 bg-[#0f1115] hover:bg-[#13161c]"
                  } transition-colors cursor-pointer" data-mission-id="${m.id}">
                    <div class="flex items-start justify-between gap-2">
                      <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <i class="fi ${
                            m.solved ? "fi-rr-check-circle text-emerald-400" : "fi-rr-flag text-zinc-400"
                          } flex items-center justify-center leading-none text-xs"></i>
                          <span class="text-xs font-semibold text-[#e7e9ee] break-keep">${m.title}</span>
                        </div>
                        <p class="text-[11px] text-[#8a8f9c] text-pretty mt-1 break-keep">${m.description}</p>
                      </div>
                      ${statusBadge}
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>

        <!-- Topology Radar Column (5 Cols) -->
        <div class="xl:col-span-5 flex flex-col">
          ${renderTopologyRadarHtml({ nodes, selectedNodeId: props.selectedNodeId, className: "flex-1" })}
        </div>
      </div>

      <!-- Active Mission Command Hints & Flag Submission Box -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-zinc-800">
        <!-- Command Hint Box -->
        <div class="p-2.5 rounded border border-zinc-800 bg-[#0f1115] flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[11px] font-semibold text-[#7c8cff] uppercase tracking-wider whitespace-nowrap">
                추천 실행 명령어 힌트
              </span>
              <span class="text-[10px] font-mono text-zinc-500">${activeMission.targetIp}</span>
            </div>
            <pre class="p-2 bg-[#08090b] rounded border border-zinc-800/80 text-[11px] font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap select-all"><code>${activeMission.hintCommand}</code></pre>
          </div>
          <div class="mt-2 flex items-center justify-between">
            <span class="text-[10px] text-zinc-400 break-keep">칼리 터미널에서 위 명령어를 복사/실행하세요.</span>
            <button type="button" class="btn-copy-command inline-flex items-center justify-center leading-none px-2 py-1 text-[10px] text-zinc-300 hover:text-white bg-zinc-800 rounded border border-zinc-700 whitespace-nowrap">
              <i class="fi fi-rr-copy mr-1 flex items-center justify-center leading-none"></i>복사
            </button>
          </div>
        </div>

        <!-- Live Terminal Auto-Evaluator Box -->
        <div class="p-2.5 rounded border border-zinc-800 bg-[#0f1115] flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-[11px] font-semibold text-[#ff5d6c] uppercase tracking-wider whitespace-nowrap flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                실시간 터미널 정찰 자동 채점기
              </span>
              <span class="inline-flex items-center justify-center leading-none text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-400 whitespace-nowrap">
                AUTO-EVAL ACTIVE
              </span>
            </div>
            <p class="text-[11px] text-[#8a8f9c] break-keep mt-0.5 mb-2">
              우측 칼리 터미널에서 명령어를 실행하면, 출력 결과(FLAG{...} 및 취약점 지문)를 실시간 감지하여 수동 플래그 입력 없이 퀘스트를 즉시 자동 채점하고 점수를 부여합니다.
            </p>
            <div class="flex items-center gap-2 p-2 bg-[#08090b] rounded border border-zinc-800 text-xs font-mono text-[#38ef7d]">
              <i class="fi fi-rr-terminal flex items-center justify-center leading-none text-[#7c8cff]"></i>
              <span class="truncate">터미널 실행 감시 중: ${activeMission.hintCommand.split('\n')[0]}</span>
            </div>
            <!-- Hidden manual fallback for compatibility -->
            <input type="hidden" class="flag-input" value="${props.submittedFlag || ""}" placeholder="FLAG{...}" />
            <button type="button" class="btn-submit-flag hidden">제출</button>
          </div>

          <!-- Feedback Status -->
          <div class="mt-2 text-[11px] p-1.5 rounded border ${flagStatusClass} break-keep flex items-center justify-between">
            <span class="truncate mr-2">${props.statusMessage || "터미널에서 추천 명령어를 실행하면 퀘스트가 자동 완료됩니다."}</span>
            <span class="font-mono text-[10px] text-zinc-500 shrink-0">${solvedCount}/${missions.length} 완료</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Interactive React component wrapper for AttackerDashboard.
 */
export function AttackerDashboard(props: AttackerDashboardProps) {
  return {
    type: "AttackerDashboard",
    props,
    renderHtml: () => renderAttackerDashboardHtml(props),
  };
}

export default AttackerDashboard;
