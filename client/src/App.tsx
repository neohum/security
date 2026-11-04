// App.tsx — Role-Based Multi-Client Main Application for Metasploit Ch.3 Simulation.
//
// Conforms to:
//   - DESIGN.md: Dark minimal theme (#0b0c0f, #e7e9ee, #7c8cff, #ff5d6c)
//   - Anti-Fingernail: Strict symmetric borders (border border-zinc-800)
//   - Perfect Centering: inline-flex items-center justify-center leading-none
//   - Korean Typography: break-keep, text-balance, text-pretty, whitespace-nowrap

import {
  renderAttackerDashboardHtml,
  CH3_MISSIONS,
  type MissionItem,
} from "./components/AttackerDashboard.ts";
import {
  renderDefenderDashboardHtml,
  INITIAL_PACKET_ALERTS,
  INITIAL_PATCH_RECOMMENDATIONS,
  type IdsPacketAlert,
  type PatchRecommendation,
} from "./components/DefenderDashboard.ts";
import {
  renderTwinTerminalHtml,
  TwinTerminal,
  type RefKnowledgeTab,
} from "./components/TwinTerminal.ts";
import {
  INITIAL_TOPOLOGY_NODES,
  type TopologyHostNode,
} from "./components/TopologyRadar.ts";
import {
  renderArenaLobbyHtml,
  INITIAL_LOBBY_PARTICIPANTS,
  DEFAULT_MATCH_CONFIG,
  type ArenaParticipant,
  type LobbyStatus,
} from "./components/ArenaLobby.ts";
import {
  renderMeshRadar200Html,
  INITIAL_200_NODES,
  type Mesh200Node,
  type MeshCategory,
} from "./components/MeshRadar200.ts";
import {
  renderArenaScoreboardHtml,
  INITIAL_SCOREBOARD_PLAYERS,
  INITIAL_ATTACK_TRACES,
  type ScoreboardPlayer,
  type AttackTraceEvent,
} from "./components/ArenaScoreboard.ts";
import {
  renderTutorialSlideModalHtml,
  TUTORIAL_SLIDES,
  type TutorialSlide,
} from "./components/TutorialSlides.ts";

export type SimulationRole = "attacker" | "defender" | "observer" | "arena";
export type LayoutMode = "grid" | "attacker-only" | "defender-only" | "terminal-only" | "arena";

export interface AppProps {
  role?: SimulationRole;
  layout?: LayoutMode;
  missions?: MissionItem[];
  alerts?: IdsPacketAlert[];
  patches?: PatchRecommendation[];
  nodes?: TopologyHostNode[];
  activeTerminal?: "attacker" | "defender";
  arenaStatus?: LobbyStatus;
  remainingSeconds?: number;
  countdown?: number;
  arenaParticipants?: ArenaParticipant[];
  arenaPlayers?: ScoreboardPlayer[];
  arenaTraces?: AttackTraceEvent[];
  arenaNodes?: Mesh200Node[];
  arenaActiveFilter?: MeshCategory;
  arenaSelectedNodeId?: string;
  refActiveTab?: RefKnowledgeTab;
  activeMissionId?: string;
  selectedNodeId?: string;
  flagStatus?: string;
  statusMessage?: string;
  submittedFlag?: string;
  tutorialSlideStep?: number;
  isTutorialSlideOpen?: boolean;
}

/**
 * Extracts and sanitizes the role query parameter from a search string or full URL.
 * Defaults to 'observer' for multi-pane 2x2 grid if missing or invalid.
 */
export function parseRoleFromUrl(urlOrSearch: string = ""): SimulationRole {
  try {
    if (urlOrSearch.includes("/arena") || urlOrSearch.includes("role=arena")) {
      return "arena";
    }

    const searchString = urlOrSearch.includes("?")
      ? urlOrSearch.slice(urlOrSearch.indexOf("?"))
      : urlOrSearch.startsWith("role=")
        ? `?${urlOrSearch}`
        : urlOrSearch;

    const params = new URLSearchParams(searchString);
    const roleParam = params.get("role")?.toLowerCase();

    if (roleParam === "attacker") return "attacker";
    if (roleParam === "defender") return "defender";
    if (roleParam === "observer") return "observer";
    if (roleParam === "arena") return "arena";
  } catch {
    // fallback safe default
  }
  return "observer";
}

/**
 * Pure HTML generator for the entire application interface.
 */
export function renderAppHtml(props: AppProps = {}): string {
  const role = props.role ?? "observer";
  const missions = props.missions ?? CH3_MISSIONS;
  const alerts = props.alerts ?? INITIAL_PACKET_ALERTS;
  const patches = props.patches ?? INITIAL_PATCH_RECOMMENDATIONS;
  const nodes = props.nodes ?? INITIAL_TOPOLOGY_NODES;
  const refActiveTab = props.refActiveTab ?? "all";

  // Role metadata
  const roleBadgeMap: Record<SimulationRole, { label: string; badgeClass: string; icon: string }> = {
    attacker: {
      label: "공격자 (Red Team - Kali)",
      badgeClass: "border-red-500/50 bg-red-950/40 text-red-300",
      icon: "fi-rr-crosshairs",
    },
    defender: {
      label: "방어자 (Blue Team - IDS)",
      badgeClass: "border-blue-500/50 bg-blue-950/40 text-blue-300",
      icon: "fi-rr-shield-check",
    },
    observer: {
      label: "2x2 전체 관제 (Observer)",
      badgeClass: "border-indigo-500/50 bg-indigo-950/40 text-indigo-300",
      icon: "fi-rr-eye",
    },
    arena: {
      label: "CTF 대회 (Arena)",
      badgeClass: "border-amber-500/50 bg-amber-950/40 text-amber-300",
      icon: "fi-rr-trophy",
    },
  };

  const currentRoleMeta = roleBadgeMap[role] || roleBadgeMap.observer;

  // Header component
  const headerHtml = `
    <header class="app-header flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#0b0c0f] border-b border-zinc-800 text-[#e7e9ee]">
      <!-- Brand & Title -->
      <div class="flex items-center gap-3">
        <div class="flex items-center justify-center w-7 h-7 rounded border border-zinc-700 bg-zinc-900 text-[#7c8cff]">
          <i class="fi fi-rr-bug flex items-center justify-center leading-none text-sm"></i>
        </div>
        <div>
          <h1 class="text-sm font-bold tracking-tight text-[#e7e9ee] text-balance">
            메타스플로잇 2/e 3장 인텔리전스 수집 시뮬레이션
          </h1>
          <div class="flex items-center gap-2 text-[11px] text-[#8a8f9c]">
            <span class="break-keep">Windows 호스트 & LAN 다중 접속 협업 랩</span>
            <span class="text-zinc-600">•</span>
            <span class="font-mono text-zinc-400">172.28.0.0/16</span>
          </div>
        </div>
      </div>

      <!-- Center Role Switcher Navigation -->
      <nav class="flex items-center gap-1.5 p-1 bg-[#101217] rounded border border-zinc-800">
        <a
          href="?role=observer"
          class="role-switch-btn inline-flex items-center justify-center leading-none px-2.5 py-1 text-xs rounded border transition-colors whitespace-nowrap ${
            role === "observer"
              ? "border-indigo-500/60 bg-indigo-950/50 text-[#7c8cff] font-semibold"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }"
        >
          <i class="fi fi-rr-eye mr-1.5 flex items-center justify-center leading-none"></i>
          2x2 관제 (Observer)
        </a>
        <button
          type="button"
          id="btn-open-tutorial-slides"
          class="btn-tutorial-slides inline-flex items-center justify-center leading-none px-2.5 py-1 text-xs rounded border border-indigo-500/40 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-900/50 hover:text-indigo-200 transition-colors whitespace-nowrap"
          title="튜토리얼 단계별 설명 양방향 슬라이드 열기"
        >
          <i class="fi fi-rr-presentation mr-1.5 flex items-center justify-center leading-none text-indigo-400"></i>
          <span class="font-medium">튜토리얼 슬라이드</span>
        </button>
        <a
          href="?role=attacker"
          class="role-switch-btn inline-flex items-center justify-center leading-none px-2.5 py-1 text-xs rounded border transition-colors whitespace-nowrap ${
            role === "attacker"
              ? "border-red-500/60 bg-red-950/50 text-red-300 font-semibold"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }"
        >
          <i class="fi fi-rr-crosshairs mr-1.5 flex items-center justify-center leading-none"></i>
          공격자 (Attacker)
        </a>
        <a
          href="?role=defender"
          class="role-switch-btn inline-flex items-center justify-center leading-none px-2.5 py-1 text-xs rounded border transition-colors whitespace-nowrap ${
            role === "defender"
              ? "border-blue-500/60 bg-blue-950/50 text-blue-300 font-semibold"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }"
        >
          <i class="fi fi-rr-shield-check mr-1.5 flex items-center justify-center leading-none"></i>
          방어자 (Defender)
        </a>
        <a
          href="?role=arena"
          class="role-switch-btn inline-flex items-center justify-center leading-none px-2.5 py-1 text-xs rounded border transition-colors whitespace-nowrap ${
            role === "arena"
              ? "border-amber-500/60 bg-amber-950/50 text-amber-300 font-semibold"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }"
        >
          <i class="fi fi-rr-trophy mr-1.5 flex items-center justify-center leading-none"></i>
          CTF 대회 (Arena)
        </a>
      </nav>

      <!-- Right Role Status Indicator -->
      <div class="flex items-center gap-2">
        <span class="inline-flex items-center justify-center leading-none text-xs px-2.5 py-1 rounded border ${
          currentRoleMeta.badgeClass
        } whitespace-nowrap font-medium">
          <i class="fi ${currentRoleMeta.icon} mr-1.5 flex items-center justify-center leading-none"></i>
          ${currentRoleMeta.label}
        </span>
      </div>
    </header>
  `;

  // Layout View Generation
  let mainContentHtml = "";
  const activeMissionId = props.activeMissionId;
  const selectedNodeId = props.selectedNodeId;
  const flagStatus = props.flagStatus;
  const statusMessage = props.statusMessage;
  const submittedFlag = props.submittedFlag;

  if (role === "attacker") {
    // Fullscreen Attacker Dashboard + Kali Terminal Split
    mainContentHtml = `
      <main class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 min-h-0 overflow-y-auto">
        <!-- Left: Attacker Dashboard (Missions, Radar, Hints, Flag) -->
        <div class="lg:col-span-7 flex flex-col min-h-0">
          ${renderAttackerDashboardHtml({ missions, nodes, activeMissionId, selectedNodeId, flagStatus, statusMessage, submittedFlag, className: "flex-1" } as any)}
        </div>
        <!-- Right: Kali Terminal Full Height -->
        <div class="lg:col-span-5 flex flex-col min-h-0">
          ${renderTwinTerminalHtml({ role: "attacker", className: "flex-1", activeRefTab: refActiveTab })}
        </div>
      </main>
    `;
  } else if (role === "defender") {
    // Fullscreen Defender Dashboard + Defense Terminal Split
    mainContentHtml = `
      <main class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 min-h-0 overflow-y-auto">
        <!-- Left: Defender Dashboard (IDS Alerts, Explanations, Patches) -->
        <div class="lg:col-span-7 flex flex-col min-h-0">
          ${renderDefenderDashboardHtml({ alerts, patches, className: "flex-1" })}
        </div>
        <!-- Right: Defense Terminal / Log View Full Height -->
        <div class="lg:col-span-5 flex flex-col min-h-0">
          ${renderTwinTerminalHtml({ role: "defender", className: "flex-1", activeRefTab: refActiveTab })}
        </div>
      </main>
    `;
  } else if (role === "arena") {
    const arenaStatus = props.arenaStatus ?? "waiting";
    const remainingSeconds = props.remainingSeconds ?? 900;
    const arenaParticipants = props.arenaParticipants ?? INITIAL_LOBBY_PARTICIPANTS;
    const arenaPlayers = props.arenaPlayers ?? INITIAL_SCOREBOARD_PLAYERS;
    const arenaTraces = props.arenaTraces ?? INITIAL_ATTACK_TRACES;
    const arenaNodes = props.arenaNodes ?? INITIAL_200_NODES;

    if (arenaStatus === "waiting" || arenaStatus === "starting") {
      mainContentHtml = `
        <main class="flex-1 flex flex-col p-3 min-h-0 overflow-y-auto">
          ${renderArenaLobbyHtml({
            status: arenaStatus,
            participants: arenaParticipants,
            countdown: props.countdown ?? 5,
          })}
        </main>
      `;
    } else {
      mainContentHtml = `
        <main class="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-3 p-3 min-h-0 overflow-y-auto">
          <!-- Left: Scoreboard & Live Attack Trace (4 cols) -->
          <div class="xl:col-span-4 flex flex-col min-h-[500px]">
            ${renderArenaScoreboardHtml({
              status: arenaStatus,
              remainingSeconds,
              players: arenaPlayers,
              attackTraces: arenaTraces,
            })}
          </div>
          <!-- Center: 200-Node Heatmap Radar (5 cols) -->
          <div class="xl:col-span-5 flex flex-col min-h-[500px]">
            ${renderMeshRadar200Html({
              nodes: arenaNodes,
              activeFilter: props.arenaActiveFilter,
              selectedNodeId: props.arenaSelectedNodeId,
            })}
          </div>
          <!-- Right: Attacker Kali Terminal for Command Input (3 cols) -->
          <div class="xl:col-span-3 flex flex-col min-h-[500px]">
            ${renderTwinTerminalHtml({ role: "attacker", className: "h-full", activeRefTab: refActiveTab })}
          </div>
        </main>
      `;
    }
  } else {
    // Default Observer: 2x2 Grid
    // Top Row: Attacker View (Left) + Defender View (Right)
    // Bottom Row: Twin Terminals (Kali Terminal Left + Defense Terminal Right)
    mainContentHtml = `
      <main class="flex-1 flex flex-col gap-3 p-3 min-h-0 overflow-y-auto">
        <!-- Top Row: Attacker & Defender Dashboards Side-by-Side -->
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 flex-1 min-h-[360px]">
          <div class="flex flex-col h-full">
            ${renderAttackerDashboardHtml({ missions, nodes, activeMissionId, selectedNodeId, flagStatus, statusMessage, submittedFlag, className: "h-full" } as any)}
          </div>
          <div class="flex flex-col h-full">
            ${renderDefenderDashboardHtml({ alerts, patches, className: "h-full" })}
          </div>
        </div>

        <!-- Grid Split Resizer Divider Bar -->
        <div class="grid-resizer-bar flex items-center justify-between px-3 py-1 bg-[#101217] border border-zinc-800 rounded text-[11px] text-[#8a8f9c]">
          <div class="flex items-center gap-2">
            <i class="fi fi-rr-apps flex items-center justify-center leading-none text-[#7c8cff]"></i>
            <span class="font-sans break-keep">2x2 다중 협업 분할 뷰</span>
          </div>
          <span class="text-zinc-500 font-mono text-[10px]">RESIZER ACTIVE: TOP DASHBOARDS / BOTTOM TWIN TERMINALS</span>
        </div>

        <!-- Bottom Row: Twin Terminals Side-by-Side -->
        <div class="flex-1 min-h-[300px]">
          ${renderTwinTerminalHtml({ role: "both", className: "h-full", activeRefTab: refActiveTab })}
        </div>
      </main>
    `;
  }

  // Footer bar
  const footerHtml = `
    <footer class="app-footer flex items-center justify-between px-4 py-1.5 bg-[#0b0c0f] border-t border-zinc-800 text-[11px] text-[#8a8f9c]">
      <div class="flex items-center gap-3">
        <span class="break-keep">보안 모의 훈련 샌드박스 v0.1.0</span>
        <span class="text-zinc-700">•</span>
        <span class="text-zinc-400 font-mono">Status: All Docker Containers Healthy</span>
      </div>
      <div class="flex items-center gap-2 font-mono text-[10px]">
        <span>WS PTY: Active</span>
        <span>|</span>
        <span>April Zhu Minimalist Theme</span>
      </div>
    </footer>
  `;

  return `
    <div class="app-container flex flex-col h-screen w-screen bg-[#0b0c0f] text-[#e7e9ee] font-sans antialiased overflow-hidden select-none">
      ${headerHtml}
      ${mainContentHtml}
      ${footerHtml}
      ${renderTutorialSlideModalHtml(props.tutorialSlideStep || 1, props.isTutorialSlideOpen || false)}
    </div>
  `;
}

/**
 * Interactive React component wrapper for App.
 */
export function App(props: AppProps) {
  return {
    type: "App",
    props,
    renderHtml: () => renderAppHtml(props),
  };
}

export default App;
