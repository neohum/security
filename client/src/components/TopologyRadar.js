// TopologyRadar.js — ES Module Runtime for TopologyRadar

export const INITIAL_TOPOLOGY_NODES = [
  {
    id: "kalibox",
    ip: "172.28.0.10",
    hostname: "kalibox.internal",
    role: "attacker",
    label: "공격자 (Kali Linux 2024)",
    status: "operator",
    ports: [22, 4444],
    services: ["SSH", "MSF Handler"],
    vulnerabilities: ["(공격자 전진 기지 - 타깃 정찰 발원지)"],
    x: -60,
    y: 50,
  },
  {
    id: "fake-recon",
    ip: "172.28.0.15",
    hostname: "ns1.megacorp.internal",
    role: "recon",
    label: "정찰 대상 (Whois & DNS)",
    status: "discovered",
    ports: [43, 53, 8080],
    services: ["Whois (43)", "DNS BIND AXFR (53)", "Netcraft Mock (8080)"],
    vulnerabilities: ["DNS Zone Transfer 전체 레코드 누출", "공개 Whois 도메인 등록정보 노출"],
    x: -20,
    y: -45,
  },
  {
    id: "metasploitable2",
    ip: "172.28.0.20",
    hostname: "victim-linux.megacorp.internal",
    role: "target-ms2",
    label: "리눅스 타깃 (Metasploitable2)",
    status: "hidden",
    ports: [21, 22, 23, 80, 139, 445],
    services: ["vsftpd (21)", "OpenSSH (22)", "Telnet (23)", "Apache (80)", "Samba (445)"],
    vulnerabilities: ["vsftpd 2.3.4 백도어", "Samba usermap_script 익스플로잇 취약점"],
    x: 45,
    y: -30,
  },
  {
    id: "fake-s3",
    ip: "172.28.0.25",
    hostname: "s3-internal.megacorp.internal",
    role: "target-s3",
    label: "클라우드 스토리지 (Fake-S3 MinIO)",
    status: "hidden",
    ports: [9000, 9001],
    services: ["MinIO S3 API (9000)", "MinIO Console (9001)"],
    vulnerabilities: ["공개 버킷 megacorp-backup 익명 읽기 허용", "기밀 환경변수(config.env) 노출"],
    x: 65,
    y: 35,
  },
  {
    id: "vuln-mssql",
    ip: "172.28.0.30",
    hostname: "db-mssql.megacorp.internal",
    role: "target-mssql",
    label: "데이터베이스 (Vuln-MSSQL 2019)",
    status: "hidden",
    ports: [1433],
    services: ["Microsoft SQL Server (1433)"],
    vulnerabilities: ["sa 기본 관리자 계정 취약 비밀번호", "xp_cmdshell 원격 코드 실행 가능"],
    x: 0,
    y: 60,
  },
];

export function getStatusColor(status) {
  switch (status) {
    case "operator":
      return {
        color: "#34d399",
        bgClass: "bg-emerald-950/40 text-emerald-400",
        borderClass: "border-emerald-500/50",
        label: "작전 기지 (Operator Base)",
      };
    case "compromised":
      return {
        color: "#ff5d6c",
        bgClass: "bg-red-950/40 text-red-400",
        borderClass: "border-red-500/50",
        label: "장악됨 (Compromised)",
      };
    case "probed":
      return {
        color: "#fbbf24",
        bgClass: "bg-amber-950/40 text-amber-400",
        borderClass: "border-amber-500/50",
        label: "정찰완료 (Probed)",
      };
    case "discovered":
      return {
        color: "#7c8cff",
        bgClass: "bg-indigo-950/40 text-indigo-400",
        borderClass: "border-indigo-500/50",
        label: "발견됨 (Discovered)",
      };
    case "hidden":
    default:
      return {
        color: "#8a8f9c",
        bgClass: "bg-zinc-900/60 text-zinc-400",
        borderClass: "border-zinc-700/40",
        label: "미발견 (Hidden)",
      };
  }
}

export function renderTopologyRadarHtml(props = {}) {
  const nodes = props.nodes ?? INITIAL_TOPOLOGY_NODES;
  const selectedNodeId = props.selectedNodeId ?? nodes[0]?.id;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[0];

  const nodesSvg = nodes
    .map((node) => {
      const cx = 150 + node.x * 1.2;
      const cy = 150 + node.y * 1.2;
      const { color } = getStatusColor(node.status);
      const isSelected = node.id === selectedNodeId;
      const isHidden = node.status === "hidden";
      const fillColor = isHidden ? "#27272a" : color;
      const opacity = isHidden ? "0.45" : "1";

      return `
        <g class="radar-node-group cursor-pointer" data-node-id="${node.id}">
          ${
            !isHidden
              ? `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="${color}" stroke-width="1" opacity="0.3" class="animate-ping" />`
              : ""
          }
          ${
            isSelected
              ? `<circle cx="${cx}" cy="${cy}" r="12" fill="none" stroke="#e7e9ee" stroke-width="2" stroke-dasharray="3 3" />`
              : ""
          }
          <circle cx="${cx}" cy="${cy}" r="7" fill="${fillColor}" stroke="#0b0c0f" stroke-width="2" opacity="${opacity}" />
          <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="9" fill="${
            isSelected ? "#e7e9ee" : "#8a8f9c"
          }" font-family="ui-monospace, monospace" font-weight="${isSelected ? "bold" : "normal"}">
            ${node.ip.split(".").slice(-2).join(".")}
          </text>
        </g>
      `;
    })
    .join("");

  const statusMeta = getStatusColor(selectedNode.status);

  return `
    <div class="topology-radar flex flex-col h-full bg-[#0b0c0f] border border-zinc-800 rounded-lg p-3 text-[#e7e9ee] box-border ${
      props.className || ""
    }">
      <div class="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/80">
        <div class="flex items-center gap-2">
          <i class="fi fi-rr-network flex items-center justify-center leading-none text-[#7c8cff]"></i>
          <span class="text-xs font-semibold tracking-wider text-[#e7e9ee] uppercase whitespace-nowrap">네트워크 토폴로지 레이더</span>
        </div>
        <span class="inline-flex items-center justify-center leading-none text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-700 bg-zinc-900/80 text-zinc-300 whitespace-nowrap">
          LAN 172.28.0.0/16
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 items-center">
        <div class="relative flex items-center justify-center p-2 bg-[#08090b] rounded border border-zinc-800/60 overflow-hidden">
          <svg viewBox="0 0 300 300" class="w-full max-w-[240px] aspect-square">
            <defs>
              <radialGradient id="radarSweepGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#7c8cff" stop-opacity="0.15" />
                <stop offset="100%" stop-color="#7c8cff" stop-opacity="0.0" />
              </radialGradient>
            </defs>
            <circle cx="150" cy="150" r="130" fill="url(#radarSweepGrad)" stroke="#1e232d" stroke-width="1" />
            <circle cx="150" cy="150" r="95" fill="none" stroke="#1e232d" stroke-width="1" />
            <circle cx="150" cy="150" r="60" fill="none" stroke="#1e232d" stroke-width="1" stroke-dasharray="2 2" />
            <circle cx="150" cy="150" r="25" fill="none" stroke="#1e232d" stroke-width="1" />
            
            <line x1="20" y1="150" x2="280" y2="150" stroke="#1e232d" stroke-width="1" />
            <line x1="150" y1="20" x2="150" y2="280" stroke="#1e232d" stroke-width="1" />
            
            ${nodesSvg}
          </svg>
          <div class="absolute bottom-1 right-2 text-[9px] font-mono text-[#8a8f9c]">RADAR ACTIVE</div>
        </div>

        <div class="flex flex-col justify-between h-full p-2.5 bg-[#101217] rounded border border-zinc-800 text-xs">
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="font-mono font-bold text-sm text-[#e7e9ee] whitespace-nowrap">${selectedNode.ip}</span>
              <span class="inline-flex items-center justify-center leading-none text-[10px] px-2 py-0.5 rounded border ${statusMeta.borderClass} ${statusMeta.bgClass} whitespace-nowrap">
                ${statusMeta.label}
              </span>
            </div>
            <div class="text-[11px] text-[#8a8f9c] font-sans break-keep mb-2">${selectedNode.label}</div>
            
            <div class="space-y-1 text-[11px] font-mono">
              <div class="flex justify-between py-0.5 border-b border-zinc-800/60">
                <span class="text-[#8a8f9c]">도메인:</span>
                <span class="text-[#e7e9ee]">${selectedNode.hostname}</span>
              </div>
              <div class="flex justify-between py-0.5 border-b border-zinc-800/60">
                <span class="text-[#8a8f9c]">오픈 포트:</span>
                <span class="text-[#7c8cff]">${selectedNode.status === "hidden" ? "미확인 (Scan Req)" : selectedNode.ports.join(", ")}</span>
              </div>
            </div>

            <div class="mt-2.5">
              <div class="text-[10px] font-semibold text-[#8a8f9c] uppercase tracking-wider mb-1">인텔리전스 취약점</div>
              ${
                selectedNode.vulnerabilities.length > 0 && selectedNode.status !== "hidden"
                  ? `<ul class="space-y-1">
                      ${selectedNode.vulnerabilities
                        .map(
                          (v) => `
                        <li class="flex items-start gap-1.5 text-[11px] text-zinc-300 break-keep">
                          <i class="fi fi-rr-bullet flex items-center justify-center leading-none text-[#ff5d6c] mt-0.5"></i>
                          <span>${v}</span>
                        </li>
                      `,
                        )
                        .join("")}
                    </ul>`
                  : `<div class="text-[10px] text-zinc-500 italic break-keep">Nmap 또는 MSF 스캐너로 타깃 탐색 필요</div>`
              }
            </div>
          </div>

          <div class="mt-2 pt-2 border-t border-zinc-800 flex items-center justify-between text-[10px]">
            <span class="text-[#8a8f9c] font-mono">역할: ${selectedNode.role}</span>
            <span class="text-[#7c8cff] font-sans break-keep">실시간 LAN 감시 활성</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

export default renderTopologyRadarHtml;
