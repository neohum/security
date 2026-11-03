// DefenderDashboard.tsx — Blue Team Monitoring & Threat Response Dashboard.
//
// Conforms to:
//   - DESIGN.md: Dark minimal theme (#0b0c0f, #e7e9ee, #7c8cff, #ff5d6c)
//   - Anti-Fingernail: Strict symmetric borders (border border-zinc-800)
//   - Perfect Centering: inline-flex items-center justify-center leading-none
//   - Korean Typography: break-keep, text-balance, text-pretty, whitespace-nowrap

export interface IdsPacketAlert {
  id: string;
  timestamp: string;
  sourceIp: string;
  destIp: string;
  port: number;
  protocol: string;
  signature: string;
  severity: "critical" | "high" | "medium" | "info";
  ruleId: string;
  rawPayload?: string;
}

export interface PatchRecommendation {
  id: string;
  title: string;
  targetService: string;
  attackMitigated: string;
  commandSnippet: string;
  applied: boolean;
  impactScore: number;
}

export const INITIAL_PACKET_ALERTS: IdsPacketAlert[] = [
  {
    id: "alert-001",
    timestamp: "10:14:02.110",
    sourceIp: "172.28.0.10",
    destIp: "172.28.0.15",
    port: 53,
    protocol: "TCP",
    signature: "ET DNS Zone Transfer (AXFR) Request Detected",
    severity: "critical",
    ruleId: "SID:2001452",
    rawPayload: "QUERY: megacorp.internal AXFR IN (Full zone replication requested)",
  },
  {
    id: "alert-002",
    timestamp: "10:14:15.340",
    sourceIp: "172.28.0.10",
    destIp: "172.28.0.30",
    port: 1433,
    protocol: "TCP",
    signature: "ET SCAN Potential MSSQL sa Brute-Force Password Guessing",
    severity: "high",
    ruleId: "SID:2002981",
    rawPayload: "TDS7 Login Packet: username=sa, auth_failure_count=14",
  },
  {
    id: "alert-003",
    timestamp: "10:14:28.910",
    sourceIp: "172.28.0.10",
    destIp: "172.28.0.20",
    port: 445,
    protocol: "TCP",
    signature: "ET SCAN Nmap OS/Service Fingerprint Probe",
    severity: "medium",
    ruleId: "SID:2000341",
    rawPayload: "TCP SYN seq=38472910 window=1024 options=[mss 1460,sackOK,TS]",
  },
  {
    id: "alert-004",
    timestamp: "10:14:40.020",
    sourceIp: "172.28.0.10",
    destIp: "172.28.0.25",
    port: 9000,
    protocol: "HTTP",
    signature: "ET POLICY AWS S3 Anonymous Bucket Listing (megacorp-backup)",
    severity: "high",
    ruleId: "SID:2018840",
    rawPayload: "GET /megacorp-backup/?list-type=2 HTTP/1.1 (Anonymous Access)",
  },
];

export const INITIAL_PATCH_RECOMMENDATIONS: PatchRecommendation[] = [
  {
    id: "patch-axfr",
    title: "DNS AXFR 전송 차단 (named.conf)",
    targetService: "BIND9 DNS (172.28.0.15)",
    attackMitigated: "DNS Zone Transfer 전체 서브도메인 정찰 무력화",
    commandSnippet: "sed -i 's/allow-transfer { any; };/allow-transfer { none; };/' /etc/bind/named.conf.options && rndc reload",
    applied: false,
    impactScore: 100,
  },
  {
    id: "patch-mssql",
    title: "MSSQL sa 계정 비활성화 및 IP 방화벽 제한",
    targetService: "Vuln-MSSQL (172.28.0.30)",
    attackMitigated: "무차별 대입(Brute-Force) 및 원격 셸(xp_cmdshell) 실행 차단",
    commandSnippet: "ALTER LOGIN sa DISABLE; IPTABLES -A INPUT -p tcp --dport 1433 -s 172.28.0.0/24 -j DROP",
    applied: false,
    impactScore: 150,
  },
  {
    id: "patch-s3-acl",
    title: "S3 버킷 퍼블릭 읽기 권한 비활성화 (Private ACL)",
    targetService: "Fake-S3 MinIO (172.28.0.25)",
    attackMitigated: "기밀 환경변수 파일(config.env) 무단 열람 방지",
    commandSnippet: "mc anonymous set none myminio/megacorp-backup",
    applied: false,
    impactScore: 120,
  },
];

export interface DefenderDashboardProps {
  alerts?: IdsPacketAlert[];
  patches?: PatchRecommendation[];
  selectedAlertId?: string;
  isStreamPaused?: boolean;
  className?: string;
}

export function getSeverityBadge(severity: IdsPacketAlert["severity"]): {
  bgClass: string;
  borderClass: string;
  label: string;
} {
  switch (severity) {
    case "critical":
      return {
        bgClass: "bg-red-950/50 text-red-300",
        borderClass: "border-red-500/60",
        label: "CRITICAL",
      };
    case "high":
      return {
        bgClass: "bg-amber-950/50 text-amber-300",
        borderClass: "border-amber-500/60",
        label: "HIGH",
      };
    case "medium":
      return {
        bgClass: "bg-yellow-950/40 text-yellow-300",
        borderClass: "border-yellow-500/40",
        label: "MEDIUM",
      };
    case "info":
    default:
      return {
        bgClass: "bg-blue-950/40 text-blue-300",
        borderClass: "border-blue-500/40",
        label: "INFO",
      };
  }
}

/**
 * Pure HTML string generator for DefenderDashboard.
 */
export function renderDefenderDashboardHtml(props: DefenderDashboardProps = {}): string {
  const alerts = props.alerts ?? INITIAL_PACKET_ALERTS;
  const patches = props.patches ?? INITIAL_PATCH_RECOMMENDATIONS;
  const selectedAlertId = props.selectedAlertId ?? alerts[0]?.id;
  const selectedAlert = alerts.find((a) => a.id === selectedAlertId) || alerts[0];
  const appliedPatchesCount = patches.filter((p) => p.applied).length;
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;

  return `
    <div class="defender-dashboard flex flex-col h-full bg-[#0b0c0f] border border-zinc-800 rounded-lg p-3 text-[#e7e9ee] space-y-3 box-border overflow-y-auto ${
      props.className || ""
    }">
      <!-- Blue Team Header -->
      <div class="flex items-center justify-between pb-2 border-b border-zinc-800/80">
        <div class="flex items-center gap-2">
          <i class="fi fi-rr-shield-check flex items-center justify-center leading-none text-[#38bdf8] text-base"></i>
          <div>
            <h2 class="text-xs font-bold text-[#e7e9ee] uppercase tracking-wider text-balance">
              방어자 관제 센터 (Blue Team IDS)
            </h2>
            <p class="text-[11px] text-[#8a8f9c] break-keep">
              실시간 가상 네트워크 침입탐지 및 능동 보안 조치 권고
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Live Status Indicator -->
          <div class="inline-flex items-center justify-center leading-none px-2 py-1 rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-300 text-xs font-mono whitespace-nowrap">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>
            IDS 패킷 엔진: 감시중 (${alerts.length} 패킷 수집)
          </div>
        </div>
      </div>

      <!-- Quick Metrics Telemetry Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div class="p-2 rounded border border-zinc-800 bg-[#0f1115] text-center">
          <div class="text-[10px] text-[#8a8f9c] uppercase font-sans whitespace-nowrap">수집된 경보</div>
          <div class="text-base font-bold font-mono text-[#e7e9ee]">${alerts.length}건</div>
        </div>
        <div class="p-2 rounded border border-zinc-800 bg-[#0f1115] text-center">
          <div class="text-[10px] text-[#8a8f9c] uppercase font-sans whitespace-nowrap">긴급 침해 (Critical)</div>
          <div class="text-base font-bold font-mono text-[#ff5d6c]">${criticalCount}건</div>
        </div>
        <div class="p-2 rounded border border-zinc-800 bg-[#0f1115] text-center">
          <div class="text-[10px] text-[#8a8f9c] uppercase font-sans whitespace-nowrap">적용된 패치 조치</div>
          <div class="text-base font-bold font-mono text-[#38bdf8]">${appliedPatchesCount} / ${patches.length}</div>
        </div>
        <div class="p-2 rounded border border-zinc-800 bg-[#0f1115] text-center">
          <div class="text-[10px] text-[#8a8f9c] uppercase font-sans whitespace-nowrap">방어 방화벽 상태</div>
          <div class="text-base font-bold font-mono text-emerald-400">ACTIVE</div>
        </div>
      </div>

      <!-- IDS Packet Alert Stream & Inspection Split -->
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-3 flex-1">
        <!-- Live Alert Feed (7 cols) -->
        <div class="xl:col-span-7 flex flex-col p-2.5 rounded border border-zinc-800 bg-[#0f1115]">
          <div class="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/80">
            <span class="text-[11px] font-semibold text-[#8a8f9c] uppercase tracking-wider whitespace-nowrap">
              실시간 IDS 탐지 패킷 스트림
            </span>
            <div class="flex items-center gap-1.5">
              <button type="button" class="btn-pause-stream inline-flex items-center justify-center leading-none px-2 py-0.5 text-[10px] text-zinc-300 hover:text-white bg-zinc-800 rounded border border-zinc-700 whitespace-nowrap">
                ${props.isStreamPaused ? "재개" : "일시정지"}
              </button>
              <button type="button" class="btn-clear-alerts inline-flex items-center justify-center leading-none px-2 py-0.5 text-[10px] text-zinc-300 hover:text-white bg-zinc-800 rounded border border-zinc-700 whitespace-nowrap">
                로그 지우기
              </button>
            </div>
          </div>

          <div class="space-y-1.5 overflow-y-auto max-h-[220px]">
            ${alerts
              .map((alert) => {
                const isSelected = alert.id === selectedAlert.id;
                const sev = getSeverityBadge(alert.severity);

                return `
                  <div class="packet-alert-item p-2 rounded border ${
                    isSelected ? "border-blue-500/60 bg-[#141822]" : "border-zinc-800/80 bg-[#0a0c10] hover:bg-[#11131a]"
                  } transition-colors cursor-pointer" data-alert-id="${alert.id}">
                    <div class="flex items-center justify-between text-[11px] mb-1">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-zinc-500 text-[10px]">${alert.timestamp}</span>
                        <span class="inline-flex items-center justify-center leading-none text-[9px] px-1.5 py-0.5 rounded border ${sev.borderClass} ${sev.bgClass} whitespace-nowrap font-mono">
                          ${sev.label}
                        </span>
                        <span class="font-mono text-zinc-400 text-[10px]">${alert.ruleId}</span>
                      </div>
                      <span class="font-mono text-xs text-[#7c8cff]">${alert.sourceIp} -> ${alert.destIp}:${alert.port}</span>
                    </div>
                    <div class="text-xs text-[#e7e9ee] font-sans break-keep font-medium">
                      ${alert.signature}
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>

        <!-- Attack Explanation Card (5 cols) -->
        <div class="xl:col-span-5 flex flex-col p-2.5 rounded border border-zinc-800 bg-[#0f1115] justify-between">
          <div>
            <div class="flex items-center justify-between pb-1.5 mb-2 border-b border-zinc-800/80">
              <span class="text-[11px] font-semibold text-[#38bdf8] uppercase tracking-wider whitespace-nowrap">
                공격 원리 분석 및 인텔리전스 해설
              </span>
              <span class="text-[10px] font-mono text-zinc-500">${selectedAlert.destIp}</span>
            </div>

            <div class="space-y-2">
              <div class="text-xs font-bold text-[#e7e9ee] break-keep">
                ${selectedAlert.signature}
              </div>
              <p class="text-[11px] text-[#8a8f9c] leading-relaxed break-keep text-pretty">
                ${
                  selectedAlert.port === 53
                    ? "공격자가 DNS 네임서버에 AXFR 질의를 전송하여 호스트 내 모든 내부 도메인과 IP 매핑 정보를 무단 수집하고 있습니다. BIND9의 allow-transfer 지시어를 제한하지 않으면 인프라 내부망 구조가 완전히 외부에 누출됩니다."
                    : selectedAlert.port === 1433
                      ? "공격자가 MSF auxiliary/scanner/mssql/mssql_login 모듈을 이용해 기본 관리자 계정인 sa에 대해 사전 대입 공격을 시도하고 있습니다. 로그인 성공 시 xp_cmdshell을 통해 호스트 운영체제 셸이 완전히 장악될 수 있습니다."
                      : selectedAlert.port === 9000
                        ? "공격자가 공개 설정된 S3 버킷을 조회하여 config.env 및 백업 DB 패스워드 등 민감한 자격증명을 탈취하려 시도하고 있습니다. AWS S3 퍼블릭 액세스 차단 규칙이 필요합니다."
                        : "네트워크 브릿지 상에서 무차별 포트 스캔 패킷이 탐지되었습니다. 방화벽 SYN 필터링 및 침입 방지 시스템(IPS) 규칙에 의한 차단이 요구됩니다."
                }
              </p>

              <!-- Raw Payload Preview Box -->
              <div class="mt-2">
                <div class="text-[10px] text-zinc-500 font-mono mb-1">캡처된 원시 패킷 페이로드</div>
                <div class="p-1.5 rounded bg-[#08090b] border border-zinc-800 font-mono text-[10px] text-zinc-300 break-all select-all">
                  ${selectedAlert.rawPayload || "No payload extracted"}
                </div>
              </div>
            </div>
          </div>

          <div class="mt-2 pt-2 border-t border-zinc-800 flex items-center justify-between text-[10px]">
            <span class="text-zinc-500 font-mono">탐지 프로토콜: ${selectedAlert.protocol}</span>
            <span class="text-emerald-400 font-sans break-keep">실시간 방어 모니터 가동중</span>
          </div>
        </div>
      </div>

      <!-- One-Click Patch Recommendation Action Cards -->
      <div class="pt-2 border-t border-zinc-800 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold text-[#38bdf8] uppercase tracking-wider whitespace-nowrap">
            원클릭 즉각 방어 패치 권고 (Instant Mitigations)
          </span>
          <span class="text-[10px] text-zinc-400 font-sans break-keep">
            클릭 즉시 가상 컨테이너 방화벽 및 설정 파일에 보안 규칙이 주입됩니다.
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          ${patches
            .map((patch) => {
              return `
                <div class="patch-card p-2.5 rounded border ${
                  patch.applied ? "border-emerald-500/50 bg-[#0c1612]" : "border-zinc-800 bg-[#0f1115]"
                } flex flex-col justify-between" data-patch-id="${patch.id}">
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-xs font-bold text-[#e7e9ee] break-keep">${patch.title}</span>
                      <span class="inline-flex items-center justify-center leading-none text-[9px] px-1.5 py-0.5 rounded border ${
                        patch.applied
                          ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300"
                          : "border-zinc-700 bg-zinc-900 text-zinc-400"
                      } whitespace-nowrap font-mono">
                        ${patch.applied ? "적용 완료" : "대기중"}
                      </span>
                    </div>
                    <div class="text-[11px] text-[#8a8f9c] font-sans break-keep mb-1.5">${patch.attackMitigated}</div>
                    <div class="p-1 rounded bg-[#08090b] border border-zinc-800/80 font-mono text-[9px] text-zinc-400 break-all select-all">
                      <code>${patch.commandSnippet}</code>
                    </div>
                  </div>

                  <div class="mt-2.5 pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                    <span class="text-[10px] text-zinc-500 font-mono">+${patch.impactScore} 방어점수</span>
                    <button
                      type="button"
                      class="btn-apply-patch inline-flex items-center justify-center leading-none px-2.5 py-1 text-[11px] font-semibold rounded border transition-colors whitespace-nowrap ${
                        patch.applied
                          ? "bg-zinc-800 text-zinc-400 border-zinc-700 cursor-not-allowed"
                          : "bg-[#38bdf8] hover:bg-[#0284c7] text-[#0b0c0f] border-[#38bdf8]"
                      }"
                      ${patch.applied ? "disabled" : ""}
                    >
                      ${patch.applied ? "패치 활성화됨" : "원클릭 패치 적용"}
                    </button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    </div>
  `;
}

/**
 * Interactive React component wrapper for DefenderDashboard.
 */
export function DefenderDashboard(props: DefenderDashboardProps) {
  return {
    type: "DefenderDashboard",
    props,
    renderHtml: () => renderDefenderDashboardHtml(props),
  };
}

export default DefenderDashboard;
