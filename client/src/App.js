// App.js — ES Module Runtime for App
import { renderAttackerDashboardHtml, CH3_MISSIONS } from "./components/AttackerDashboard.js";
import { renderDefenderDashboardHtml, INITIAL_PACKET_ALERTS, INITIAL_PATCH_RECOMMENDATIONS } from "./components/DefenderDashboard.js";
import { renderTwinTerminalHtml } from "./components/TwinTerminal.js";
import { INITIAL_TOPOLOGY_NODES } from "./components/TopologyRadar.js";
import { renderArenaLobbyHtml, INITIAL_LOBBY_PARTICIPANTS, DEFAULT_MATCH_CONFIG } from "./components/ArenaLobby.js";
import { renderMeshRadar200Html, INITIAL_200_NODES } from "./components/MeshRadar200.js";
import { renderArenaScoreboardHtml, INITIAL_SCOREBOARD_PLAYERS, INITIAL_ATTACK_TRACES } from "./components/ArenaScoreboard.js";

export function parseRoleFromUrl(urlOrSearch = "") {
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

export function renderAppHtml(props = {}) {
  const role = props.role ?? "observer";
  const missions = props.missions ?? CH3_MISSIONS;
  const alerts = props.alerts ?? INITIAL_PACKET_ALERTS;
  const patches = props.patches ?? INITIAL_PATCH_RECOMMENDATIONS;
  const nodes = props.nodes ?? INITIAL_TOPOLOGY_NODES;
  const refActiveTab = props.refActiveTab ?? "all";

  const roleBadgeMap = {
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

  const headerHtml = `
    <header class="app-header flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#0b0c0f] border-b border-zinc-800 text-[#e7e9ee]">
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

  let mainContentHtml = "";

  const activeMissionId = props.activeMissionId;
  const selectedNodeId = props.selectedNodeId;
  const flagStatus = props.flagStatus;
  const statusMessage = props.statusMessage;
  const submittedFlag = props.submittedFlag;

  if (role === "attacker") {
    mainContentHtml = `
      <main class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 min-h-0 overflow-y-auto">
        <div class="lg:col-span-7 flex flex-col min-h-0">
          ${renderAttackerDashboardHtml({ missions, nodes, activeMissionId, selectedNodeId, flagStatus, statusMessage, submittedFlag, className: "flex-1" })}
        </div>
        <div class="lg:col-span-5 flex flex-col min-h-0">
          ${renderTwinTerminalHtml({ role: "attacker", className: "flex-1", activeRefTab })}
        </div>
      </main>
    `;
  } else if (role === "defender") {
    mainContentHtml = `
      <main class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 min-h-0 overflow-y-auto">
        <div class="lg:col-span-7 flex flex-col min-h-0">
          ${renderDefenderDashboardHtml({ alerts, patches, className: "flex-1" })}
        </div>
        <div class="lg:col-span-5 flex flex-col min-h-0">
          ${renderTwinTerminalHtml({ role: "defender", className: "flex-1", activeRefTab })}
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
            ${renderTwinTerminalHtml({ role: "attacker", className: "h-full", activeRefTab })}
          </div>
        </main>
      `;
    }
  } else {
    mainContentHtml = `
      <main class="flex-1 flex flex-col gap-3 p-3 min-h-0 overflow-y-auto">
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 flex-1 min-h-[360px]">
          <div class="flex flex-col h-full">
            ${renderAttackerDashboardHtml({ missions, nodes, activeMissionId, selectedNodeId, flagStatus, statusMessage, submittedFlag, className: "h-full" })}
          </div>
          <div class="flex flex-col h-full">
            ${renderDefenderDashboardHtml({ alerts, patches, className: "h-full" })}
          </div>
        </div>

        <div class="grid-resizer-bar flex items-center justify-between px-3 py-1 bg-[#101217] border border-zinc-800 rounded text-[11px] text-[#8a8f9c]">
          <div class="flex items-center gap-2">
            <i class="fi fi-rr-apps flex items-center justify-center leading-none text-[#7c8cff]"></i>
            <span class="font-sans break-keep">2x2 다중 협업 분할 뷰</span>
          </div>
          <span class="text-zinc-500 font-mono text-[10px]">RESIZER ACTIVE: TOP DASHBOARDS / BOTTOM TWIN TERMINALS</span>
        </div>

        <div class="flex-1 min-h-[300px]">
          ${renderTwinTerminalHtml({ role: "both", className: "h-full", activeRefTab })}
        </div>
      </main>
    `;
  }

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
    </div>
  `;
}

export function App(props) {
  return {
    type: "App",
    props,
    renderHtml: () => renderAppHtml(props),
  };
}

export default App;
