// MeshRadar200.tsx — 200-Node Virtual Internet Grid Heatmap for CTF Competition Arena.
//
// Conforms to:
//   - Korean language first for UI copy.
//   - Symmetrical borders (border border-zinc-800), strictly NO border-l-4 rounded-*.
//   - Centered buttons/badges: inline-flex items-center justify-center leading-none.
//   - Flaticon UIcons regular rounded (fi fi-rr-*) only (NO inline SVG, NO Lucide, NO emoji).
//   - Korean line breaking (break-keep, text-balance, text-pretty, whitespace-nowrap).
//   - Dark theme styling (bg-zinc-950, bg-zinc-900, border-zinc-800, emerald/cyan/rose/amber accents).

export type MeshNodeStatus = "unprobed" | "scanned" | "compromised" | "hardened";

export type MeshCategory =
  | "all"
  | "whois"
  | "dns-axfr"
  | "web-banner"
  | "mssql"
  | "s3-bucket"
  | "legacy-service"
  | "hardened";

export interface Mesh200Node {
  id: string; // e.g. "node-001" ~ "node-200"
  index: number; // 1 to 200
  ip: string; // "10.10.1.1" ~ "10.10.1.200"
  hostname: string;
  category: "whois" | "dns-axfr" | "web-banner" | "mssql" | "s3-bucket" | "legacy-service" | "hardened";
  isVulnerable: boolean;
  status: MeshNodeStatus;
  openPorts: number[];
  services: string[];
  vulnerabilityName?: string;
  compromisedBy?: string;
  compromisedAt?: string;
  flag?: string;
}

export interface MeshFilterTab {
  id: MeshCategory;
  label: string;
  icon: string;
  expectedCount: number;
}

export const MESH_FILTER_TABS: MeshFilterTab[] = [
  { id: "all", label: "전체", icon: "fi-rr-network", expectedCount: 200 },
  { id: "whois", label: "Whois", icon: "fi-rr-globe", expectedCount: 10 },
  { id: "dns-axfr", label: "DNS", icon: "fi-rr-browser", expectedCount: 10 },
  { id: "web-banner", label: "Web", icon: "fi-rr-window-alt", expectedCount: 10 },
  { id: "mssql", label: "MSSQL", icon: "fi-rr-database", expectedCount: 10 },
  { id: "s3-bucket", label: "S3", icon: "fi-rr-box-alt", expectedCount: 10 },
  { id: "legacy-service", label: "Legacy", icon: "fi-rr-server", expectedCount: 10 },
  { id: "hardened", label: "철통방어", icon: "fi-rr-shield-check", expectedCount: 140 },
];

/**
 * Deterministic pseudo-random number generator (Mulberry32).
 */
function createPrng(seed: number) {
  let s = seed >>> 0;
  return function (): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate 200 virtual internet nodes deterministically.
 * Exactly 60 vulnerable nodes (10 each across 6 categories) and 140 hardened nodes.
 */
export function generate200MeshNodes(seed: number = 20261104): Mesh200Node[] {
  const prng = createPrng(seed);
  const categories: Array<"whois" | "dns-axfr" | "web-banner" | "mssql" | "s3-bucket" | "legacy-service"> = [
    "whois",
    "dns-axfr",
    "web-banner",
    "mssql",
    "s3-bucket",
    "legacy-service",
  ];

  // Prepare 200 slot category assignments: 10 of each vulnerable + 140 hardened
  const assignmentList: Array<Mesh200Node["category"]> = [];
  for (const cat of categories) {
    for (let i = 0; i < 10; i++) {
      assignmentList.push(cat);
    }
  }
  for (let i = 0; i < 140; i++) {
    assignmentList.push("hardened");
  }

  // Deterministic Fisher-Yates shuffle
  for (let i = assignmentList.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const temp = assignmentList[i]!;
    assignmentList[i] = assignmentList[j]!;
    assignmentList[j] = temp;
  }

  // Ensure slots 14, 41, 87 (nodes 15, 42, 88) are assigned vulnerable categories
  const targetVulnIndices = [14, 41, 87];
  for (const tIdx of targetVulnIndices) {
    if (assignmentList[tIdx] === "hardened") {
      const swapIdx = assignmentList.findIndex(
        (cat, idx) => !targetVulnIndices.includes(idx) && cat !== "hardened",
      );
      if (swapIdx !== -1) {
        const temp = assignmentList[tIdx]!;
        assignmentList[tIdx] = assignmentList[swapIdx]!;
        assignmentList[swapIdx] = temp;
      }
    }
  }

  const categoryMeta: Record<
    Mesh200Node["category"],
    { ports: number[]; services: string[]; vulnName: string; hostPrefix: string }
  > = {
    whois: {
      ports: [43],
      services: ["Whois Daemon v4.1"],
      vulnName: "Whois 공개 등록정보 유출 (담당자 이메일 & 서브넷)",
      hostPrefix: "whois-gw",
    },
    "dns-axfr": {
      ports: [53],
      services: ["BIND 9.18 AXFR"],
      vulnName: "DNS Zone Transfer 전체 서브도메인 영역 전송 취약점",
      hostPrefix: "ns-core",
    },
    "web-banner": {
      ports: [80, 8080],
      services: ["Apache 2.4.49", "Nginx 1.18 Proxy"],
      vulnName: "웹 서버 배너 디스크립터 노출 및 경로 순회 취약점",
      hostPrefix: "web-srv",
    },
    mssql: {
      ports: [1433],
      services: ["Microsoft SQL Server 2019"],
      vulnName: "MSSQL sa 기본 계정 취약 패스워드 및 원격 프로시저 실행",
      hostPrefix: "db-mssql",
    },
    "s3-bucket": {
      ports: [9000],
      services: ["MinIO S3 Compatible API"],
      vulnName: "S3 공개 퍼블릭 버킷 익명 읽기 및 환경변수(config.env) 노출",
      hostPrefix: "s3-storage",
    },
    "legacy-service": {
      ports: [21, 23, 445],
      services: ["vsftpd 2.3.4", "Telnet", "Samba 3.0.20"],
      vulnName: "레거시 서비스 백도어 (vsftpd 2.3.4 Smiley Face RCE)",
      hostPrefix: "legacy-box",
    },
    hardened: {
      ports: [],
      services: ["Hardened Linux Kernel 6.8", "Strict DROP Firewall"],
      vulnName: "최신 보안 패치 적용 완료 (침입 불가능 철통 보안)",
      hostPrefix: "sec-node",
    },
  };

  const nodes: Mesh200Node[] = [];

  for (let i = 1; i <= 200; i++) {
    const id = `node-${String(i).padStart(3, "0")}`;
    const ip = `10.10.1.${i}`;
    const cat = assignmentList[i - 1]!;
    const meta = categoryMeta[cat];
    const isVuln = cat !== "hardened";

    // Initial simulated states: node 15 is compromised for demo/test, node 42 is compromised, node 88 scanned
    let status: MeshNodeStatus = "unprobed";
    let compromisedBy: string | undefined;
    let compromisedAt: string | undefined;
    let flag: string | undefined;

    if (i === 15) {
      status = "compromised";
      compromisedBy = "CyberShadow";
      compromisedAt = "14:24:18";
      flag = `FLAG{MESH_${id.toUpperCase()}_PWNED}`;
    } else if (i === 42) {
      status = "compromised";
      compromisedBy = "공격자1";
      compromisedAt = "14:23:05";
      flag = `FLAG{MESH_${id.toUpperCase()}_PWNED}`;
    } else if (i === 88) {
      status = "scanned";
    } else if (cat === "hardened") {
      status = "hardened";
    }

    nodes.push({
      id,
      index: i,
      ip,
      hostname: `${meta.hostPrefix}-${String(i).padStart(3, "0")}.mega-infra.net`,
      category: cat,
      isVulnerable: isVuln,
      status,
      openPorts: [...meta.ports],
      services: [...meta.services],
      vulnerabilityName: meta.vulnName,
      compromisedBy,
      compromisedAt,
      flag,
    });
  }

  return nodes;
}

export const INITIAL_200_NODES = generate200MeshNodes();

/**
 * Filter nodes by category.
 */
export function filterMeshNodes(nodes: Mesh200Node[], filter: MeshCategory): Mesh200Node[] {
  if (filter === "all") return nodes;
  return nodes.filter((n) => n.category === filter);
}

/**
 * Visual styling resolver for a node's status & category.
 */
export function getMeshNodeVisual(node: Mesh200Node): {
  bgClass: string;
  borderClass: string;
  textClass: string;
  glowClass: string;
  label: string;
  badgeClass: string;
  icon: string;
} {
  if (node.status === "compromised") {
    return {
      bgClass: "bg-emerald-950",
      borderClass: "border-emerald-500",
      textClass: "text-emerald-400 font-bold",
      glowClass: "shadow-[0_0_10px_rgba(16,185,129,0.4)]",
      label: "탈취됨 (Compromised)",
      badgeClass: "border-emerald-500/50 bg-emerald-950/40 text-emerald-400",
      icon: "fi-rr-check",
    };
  }
  if (node.status === "scanned") {
    return {
      bgClass: "bg-cyan-950/70",
      borderClass: "border-cyan-500",
      textClass: "text-cyan-400 font-medium",
      glowClass: "shadow-[0_0_8px_rgba(6,182,212,0.3)]",
      label: "정찰됨 (Scanned)",
      badgeClass: "border-cyan-500/50 bg-cyan-950/40 text-cyan-400",
      icon: "fi-rr-eye",
    };
  }
  if (node.category === "hardened" || node.status === "hardened") {
    return {
      bgClass: "bg-zinc-900/80",
      borderClass: "border-zinc-800",
      textClass: "text-zinc-500",
      glowClass: "",
      label: "철통보안 (Hardened)",
      badgeClass: "border-zinc-700 bg-zinc-800 text-zinc-400",
      icon: "fi-rr-shield-check",
    };
  }
  // Default unprobed
  return {
    bgClass: "bg-zinc-900",
    borderClass: "border-zinc-800",
    textClass: "text-zinc-600",
    glowClass: "",
    label: "미탐색 (Unprobed)",
    badgeClass: "border-zinc-800 bg-zinc-950 text-zinc-500",
    icon: "fi-rr-interrogation",
  };
}

export interface MeshRadar200Props {
  nodes?: Mesh200Node[];
  selectedNodeId?: string | null;
  activeFilter?: MeshCategory;
  onSelectNode?: (nodeId: string) => void;
  onFilterChange?: (filter: MeshCategory) => void;
}

/**
 * Pure HTML string generator for MeshRadar200 component.
 */
export function renderMeshRadar200Html(props: MeshRadar200Props = {}): string {
  const nodes = props.nodes ?? INITIAL_200_NODES;
  const activeFilter = props.activeFilter ?? "all";
  const selectedNodeId = props.selectedNodeId ?? nodes[41]?.id ?? nodes[0]?.id; // Default to node 42
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[0]!;

  // Counts
  const totalCount = nodes.length;
  const compromisedCount = nodes.filter((n) => n.status === "compromised").length;
  const scannedCount = nodes.filter((n) => n.status === "scanned").length;
  const hardenedCount = nodes.filter((n) => n.category === "hardened").length;
  const vulnerableTotal = totalCount - hardenedCount; // exactly 60
  const remainingVuln = vulnerableTotal - compromisedCount;

  // Filter tabs HTML
  const filterTabsHtml = MESH_FILTER_TABS.map((tab) => {
    const isSelected = tab.id === activeFilter;
    const count = tab.id === "all" ? nodes.length : nodes.filter((n) => n.category === tab.id).length;
    const tabClass = isSelected
      ? "border-cyan-500 bg-cyan-950/40 text-cyan-300 font-semibold"
      : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200";

    return `
      <button type="button" class="mesh-filter-tab inline-flex items-center justify-center leading-none px-2.5 py-1.5 rounded border ${tabClass} text-xs transition-colors whitespace-nowrap" data-filter="${tab.id}">
        <i class="fi ${tab.icon} mr-1.5 flex items-center justify-center leading-none text-xs"></i>
        <span>${tab.label}</span>
        <span class="ml-1.5 font-mono text-[10px] opacity-75">(${count})</span>
      </button>
    `;
  }).join("");

  // 200-Node Grid Cells HTML
  const gridCellsHtml = nodes
    .map((node) => {
      const visual = getMeshNodeVisual(node);
      const isSelected = node.id === selectedNodeId;
      const isDimmed = activeFilter !== "all" && node.category !== activeFilter;
      const selectionRing = isSelected ? "ring-2 ring-cyan-400 scale-105 z-10" : "";
      const opacityClass = isDimmed ? "opacity-20" : "opacity-100";

      let indicatorHtml = "";
      if (node.status === "compromised") {
        indicatorHtml = `<i class="fi fi-rr-check text-[10px] text-emerald-400 flex items-center justify-center leading-none"></i>`;
      } else if (node.status === "scanned") {
        indicatorHtml = `<i class="fi fi-rr-eye text-[9px] text-cyan-400 flex items-center justify-center leading-none"></i>`;
      } else if (node.category === "hardened") {
        indicatorHtml = `<i class="fi fi-rr-shield-check text-[9px] text-zinc-700 flex items-center justify-center leading-none"></i>`;
      } else {
        indicatorHtml = `<span class="text-[9px] font-mono text-zinc-600">${node.index}</span>`;
      }

      return `
        <div class="mesh-node-cell cursor-pointer p-1 rounded border ${visual.borderClass} ${visual.bgClass} ${visual.textClass} ${visual.glowClass} ${selectionRing} ${opacityClass} flex flex-col items-center justify-center min-h-[34px] min-w-[34px] transition-all hover:border-cyan-400 hover:scale-105" data-node-id="${node.id}" title="${node.ip} (${node.category})">
          ${indicatorHtml}
          <span class="text-[8px] font-mono text-zinc-400 tracking-tighter leading-none mt-0.5 truncate w-full text-center">
            .${node.index}
          </span>
        </div>
      `;
    })
    .join("");

  // Selected Node Detail Panel
  const selVisual = getMeshNodeVisual(selectedNode);
  const openPortsList =
    selectedNode.openPorts.length > 0
      ? selectedNode.openPorts.map((p) => `<span class="font-mono text-xs px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-cyan-300">${p}</span>`).join(" ")
      : `<span class="text-xs text-zinc-500 italic break-keep">전체 포트 차단 (DROP/Filtered)</span>`;

  const servicesList =
    selectedNode.services.length > 0
      ? selectedNode.services.map((s) => `<li class="text-xs text-zinc-300 break-keep flex items-start gap-1"><i class="fi fi-rr-bullet text-cyan-400 mt-1 flex items-center justify-center leading-none"></i><span>${s}</span></li>`).join("")
      : `<li class="text-xs text-zinc-500 break-keep">실행 중인 공개 서비스 없음</li>`;

  let compromiseInfoHtml = "";
  if (selectedNode.status === "compromised") {
    compromiseInfoHtml = `
      <div class="p-2.5 rounded border border-emerald-500/50 bg-emerald-950/40 text-xs text-emerald-300 space-y-1">
        <div class="font-semibold flex items-center gap-1.5 break-keep">
          <i class="fi fi-rr-check text-emerald-400 flex items-center justify-center leading-none"></i>
          침투 성공 및 장악 완료
        </div>
        <div class="text-[11px] text-emerald-200/90 break-keep">
          탈취자: <span class="font-bold text-emerald-100">${selectedNode.compromisedBy ?? "공격자"}</span>
        </div>
        <div class="text-[10px] text-emerald-400/80 font-mono">
          장악 시각: ${selectedNode.compromisedAt ?? "14:23:05"}
        </div>
        ${
          selectedNode.flag
            ? `<div class="mt-1 pt-1 border-t border-emerald-800/60 font-mono text-[10px] text-emerald-300 break-all">플래그: ${selectedNode.flag}</div>`
            : ""
        }
      </div>
    `;
  } else if (selectedNode.category === "hardened") {
    compromiseInfoHtml = `
      <div class="p-2.5 rounded border border-zinc-800 bg-zinc-900/60 text-xs text-zinc-400 space-y-1">
        <div class="font-semibold flex items-center gap-1.5 text-zinc-300 break-keep">
          <i class="fi fi-rr-shield-check text-indigo-400 flex items-center justify-center leading-none"></i>
          철통 방어 노드 (Hardened)
        </div>
        <p class="text-[11px] text-zinc-500 break-keep text-pretty">
          이 서버는 커널 레벨 패킷 필터링과 취약점 패치가 완벽히 적용되어 외부 공격 침투가 전면 차단되어 있습니다.
        </p>
      </div>
    `;
  } else {
    compromiseInfoHtml = `
      <div class="p-2.5 rounded border border-zinc-800 bg-zinc-900/60 text-xs text-zinc-400 space-y-1">
        <div class="font-semibold flex items-center gap-1.5 text-amber-400 break-keep">
          <i class="fi fi-rr-flame text-amber-400 flex items-center justify-center leading-none"></i>
          침투 공략 대기 중
        </div>
        <p class="text-[11px] text-zinc-500 break-keep text-pretty">
          터미널에서 이 IP(<code>${selectedNode.ip}</code>)를 대상으로 포트 스캔 및 취약점 타격을 수행하면 실시간으로 장악됩니다.
        </p>
      </div>
    `;
  }

  return `
    <div class="mesh-radar-root w-full h-full p-4 md:p-6 bg-zinc-950 text-zinc-100 flex flex-col space-y-4 overflow-y-auto">
      <!-- Radar Header & Stats -->
      <div class="flex flex-col md:flex-row md:items-center justify-between pb-3 border-b border-zinc-800 gap-3">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="inline-flex items-center justify-center leading-none px-2 py-0.5 text-[10px] font-mono rounded border border-cyan-500/40 bg-cyan-950/30 text-cyan-300 uppercase">
              <i class="fi fi-rr-network mr-1 flex items-center justify-center leading-none"></i>200-NODE MESH
            </span>
            <span class="text-xs text-zinc-500 font-mono">10.10.1.1 ~ 10.10.1.200</span>
          </div>
          <h2 class="text-lg md:text-xl font-bold text-zinc-100 tracking-tight break-keep text-balance">
            200 가상 인터넷 노드 격자 히트맵 레이더
          </h2>
        </div>

        <!-- Metric Counter Pills -->
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="inline-flex items-center justify-center leading-none px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-400 font-mono">
            <i class="fi fi-rr-check mr-1 flex items-center justify-center leading-none"></i>탈취: ${compromisedCount} / ${vulnerableTotal}
          </span>
          <span class="inline-flex items-center justify-center leading-none px-2.5 py-1 rounded border border-cyan-500/40 bg-cyan-950/30 text-cyan-400 font-mono">
            <i class="fi fi-rr-eye mr-1 flex items-center justify-center leading-none"></i>정찰: ${scannedCount}
          </span>
          <span class="inline-flex items-center justify-center leading-none px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-400 font-mono">
            <i class="fi fi-rr-shield-check mr-1 flex items-center justify-center leading-none"></i>철통보안: ${hardenedCount}
          </span>
          <span class="inline-flex items-center justify-center leading-none px-2.5 py-1 rounded border border-amber-500/40 bg-amber-950/30 text-amber-300 font-mono">
            <i class="fi fi-rr-flame mr-1 flex items-center justify-center leading-none"></i>잔여: ${remainingVuln}개
          </span>
        </div>
      </div>

      <!-- Category Filter Tabs -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        ${filterTabsHtml}
      </div>

      <!-- Main Layout: 200 Grid (Left) + Detail Panel (Right) -->
      <div class="grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1">
        <!-- Heatmap Grid (3 cols on large) -->
        <div class="lg:col-span-3 p-4 rounded border border-zinc-800 bg-zinc-900/40 flex flex-col">
          <div class="flex items-center justify-between text-xs text-zinc-400 mb-3">
            <span class="font-semibold flex items-center gap-1.5 break-keep">
              <i class="fi fi-rr-globe text-cyan-400 flex items-center justify-center leading-none"></i>
              가상 인터넷 서브넷 노드 맵 (10.10.1.0/24)
            </span>
            <div class="flex items-center gap-3 text-[11px]">
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-zinc-900 border border-zinc-800 inline-block"></span>미탐색</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-cyan-950 border border-cyan-500 inline-block"></span>정찰</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-emerald-950 border border-emerald-500 inline-block"></span>탈취</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-zinc-900 border border-zinc-700 inline-block"></span>철통보안</span>
            </div>
          </div>

          <!-- The 200-Node Grid -->
          <div class="grid grid-cols-10 sm:grid-cols-20 gap-1.5 flex-1 p-2 rounded border border-zinc-800 bg-zinc-950/60 overflow-y-auto max-h-[460px]">
            ${gridCellsHtml}
          </div>

          <div class="mt-2 text-[10px] text-zinc-500 flex items-center justify-between font-mono">
            <span>총 200개 노드 에뮬레이션 활성</span>
            <span>노드를 클릭하여 정밀 정보 확인</span>
          </div>
        </div>

        <!-- Node Inspector Detail Panel (1 col on large) -->
        <div class="lg:col-span-1 p-4 rounded border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between space-y-4">
          <div class="space-y-3">
            <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span class="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5 break-keep">
                <i class="fi fi-rr-eye text-cyan-400 flex items-center justify-center leading-none"></i>노드 정밀 진단
              </span>
              <span class="inline-flex items-center justify-center leading-none px-2 py-0.5 text-[10px] font-mono rounded border ${selVisual.badgeClass}">
                ${selVisual.label.split(" ")[0]}
              </span>
            </div>

            <!-- Host info header -->
            <div>
              <div class="font-mono text-base font-bold text-cyan-400 flex items-center justify-between">
                <span>${selectedNode.ip}</span>
                <span class="text-xs text-zinc-500 font-mono">#${selectedNode.index}</span>
              </div>
              <div class="font-mono text-xs text-zinc-400 truncate mt-0.5" title="${selectedNode.hostname}">
                ${selectedNode.hostname}
              </div>
            </div>

            <!-- Category & Vulnerability -->
            <div class="space-y-1.5 pt-1">
              <div class="text-[11px] text-zinc-400 flex items-center justify-between">
                <span>분야:</span>
                <span class="font-semibold text-zinc-200 uppercase">${selectedNode.category}</span>
              </div>

              <div class="p-2 rounded border border-zinc-800 bg-zinc-950 text-xs">
                <div class="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5 break-keep">진단된 취약점 프로파일</div>
                <div class="text-zinc-200 break-keep text-pretty">${selectedNode.vulnerabilityName}</div>
              </div>
            </div>

            <!-- Open Ports & Services -->
            <div class="space-y-1.5 pt-1">
              <div class="text-[11px] text-zinc-400">개방 포트:</div>
              <div class="flex flex-wrap gap-1">
                ${openPortsList}
              </div>

              <div class="text-[11px] text-zinc-400 mt-2">감지된 서비스:</div>
              <ul class="space-y-1 pl-1">
                ${servicesList}
              </ul>
            </div>
          </div>

          <!-- Compromise info status block -->
          <div class="pt-2 border-t border-zinc-800">
            ${compromiseInfoHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Interactive React component wrapper for MeshRadar200.
 */
export function MeshRadar200(props: MeshRadar200Props) {
  return {
    type: "MeshRadar200",
    props,
    renderHtml: () => renderMeshRadar200Html(props),
  };
}

export default MeshRadar200;
