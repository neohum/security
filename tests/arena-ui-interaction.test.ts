// tests/arena-ui-interaction.test.ts — Comprehensive UI Rendering & Interaction Test Suite
//
// Conforms to:
//   - Node.js native test runner (node:test, node:assert/strict)
//   - Verifies 100% rendering and interaction integrity for:
//     * ArenaLobby: nickname input, avatar select, participant list update, countdown animation
//     * MeshRadar200: 200-node grid, category filtering, compromise status color reactions
//     * ArenaScoreboard: real-time leaderboard table, attack trace timeline feed, Hall of Fame modal
//     * TwinTerminal: attacker reference card tab switching, shell script copy guide
//     * Design Guidelines: symmetrical borders, centered buttons, Flaticon (fi fi-rr-*), Korean typography
//     * Bundle integrity: client/index.html sync

import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Component imports (TypeScript)
import {
  ArenaLobby,
  renderArenaLobbyHtml,
  AVATAR_OPTIONS,
  DEFAULT_MATCH_CONFIG,
  INITIAL_LOBBY_PARTICIPANTS,
  type ArenaParticipant,
} from "../client/src/components/ArenaLobby.ts";

import {
  MeshRadar200,
  renderMeshRadar200Html,
  generate200MeshNodes,
  filterMeshNodes,
  getMeshNodeVisual,
  MESH_FILTER_TABS,
  INITIAL_200_NODES,
  type Mesh200Node,
} from "../client/src/components/MeshRadar200.ts";

import {
  ArenaScoreboard,
  renderArenaScoreboardHtml,
  formatRemainingTime,
  getRankBadge,
  INITIAL_SCOREBOARD_PLAYERS,
  INITIAL_ATTACK_TRACES,
  type ScoreboardPlayer,
  type AttackTraceEvent,
} from "../client/src/components/ArenaScoreboard.ts";

import {
  TwinTerminal,
  renderTwinTerminalHtml,
  renderReferenceKnowledgeCardHtml,
  ROLE_KNOWLEDGE,
  TERMINAL_CONFIGS,
  type RefKnowledgeTab,
} from "../client/src/components/TwinTerminal.ts";

import {
  App,
  renderAppHtml,
  parseRoleFromUrl,
  type AppProps,
} from "../client/src/App.ts";

// ES Module JS counterparts for runtime parity
import * as ArenaLobbyJs from "../client/src/components/ArenaLobby.js";
import * as MeshRadar200Js from "../client/src/components/MeshRadar200.js";
import * as ArenaScoreboardJs from "../client/src/components/ArenaScoreboard.js";
import * as TwinTerminalJs from "../client/src/components/TwinTerminal.js";
import * as AppJs from "../client/src/App.js";

const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

describe("1. ArenaLobby UI Rendering & Interaction Integrity", () => {
  it("renders nickname input field with proper classes, placeholder and value", () => {
    const htmlWithDefault = renderArenaLobbyHtml();
    assert.ok(htmlWithDefault.includes('class="input-nickname'), "Must have input-nickname class");
    assert.ok(htmlWithDefault.includes('placeholder="닉네임 입력'), "Must have Korean placeholder");

    const htmlWithCustomName = renderArenaLobbyHtml({ nicknameInput: "CyberPhantom" });
    assert.ok(htmlWithCustomName.includes('value="CyberPhantom"'), "Must preserve nicknameInput prop in value");
  });

  it("renders all 6 avatar selection options with Flaticon icons and labels", () => {
    const html = renderArenaLobbyHtml({ selectedAvatar: "user-secret" });

    assert.equal(AVATAR_OPTIONS.length, 6, "Must define 6 avatars");
    for (const av of AVATAR_OPTIONS) {
      assert.ok(html.includes(`data-avatar-id="${av.id}"`), `Must render avatar button for ${av.id}`);
      assert.ok(html.includes(av.icon), `Must include Flaticon icon ${av.icon}`);
      assert.ok(html.includes(av.label), `Must include Korean label ${av.label}`);
    }

    // Selected avatar highlight
    assert.ok(html.includes("border-cyan-400 bg-cyan-950/50 text-cyan-300"), "Selected avatar must have highlight classes");
  });

  it("renders updated participant list with ready status and host badges", () => {
    const customParticipants: ArenaParticipant[] = [
      {
        id: "p-host",
        nickname: "HostLeader",
        ip: "192.168.1.10",
        avatar: "fi-rr-skull",
        avatarLabel: "해커",
        isReady: true,
        isHost: true,
        joinedAt: "10:00:00",
      },
      {
        id: "p-02",
        nickname: "ChallengerOne",
        ip: "192.168.1.20",
        avatar: "fi-rr-ghost",
        avatarLabel: "고스트",
        isReady: false,
        isHost: false,
        joinedAt: "10:01:00",
      },
    ];

    const html = renderArenaLobbyHtml({ participants: customParticipants });
    assert.ok(html.includes("HostLeader"));
    assert.ok(html.includes("ChallengerOne"));
    assert.ok(html.includes("192.168.1.10"));
    assert.ok(html.includes("192.168.1.20"));
    assert.ok(html.includes("준비 완료"));
    assert.ok(html.includes("준비 중"));
    assert.ok(html.includes("방장"));
    assert.ok(html.includes("1</span> / 2 준비 완료"), "Ready counter must reflect 1/2");
  });

  it("renders start competition button and transitions into countdown animation when starting", () => {
    const waitingHtml = renderArenaLobbyHtml({ status: "waiting" });
    assert.ok(waitingHtml.includes("btn-start-match"), "Must contain start match button");
    assert.ok(waitingHtml.includes("대회 시작 (Start Competition)"));
    assert.ok(waitingHtml.includes("animate-pulse"), "Button must have pulsing animation");
    assert.ok(!waitingHtml.includes("countdown-overlay"), "Waiting state must not have countdown banner");

    const startingHtml = renderArenaLobbyHtml({ status: "starting", countdown: 3 });
    assert.ok(startingHtml.includes("countdown-overlay"), "Starting state must render countdown overlay");
    assert.ok(startingHtml.includes("경기 시작 카운트다운"));
    assert.ok(startingHtml.includes("3"));
    assert.ok(startingHtml.includes("잠시 후 200개 가상 모의 인터넷 서버가 전면 개방됩니다"));
  });

  it("renders connection guidance for both Wi-Fi Web LAN and Native SSH Terminal", () => {
    const html = renderArenaLobbyHtml({
      config: { hostIp: "172.20.10.5", hostPort: 8080, sshPort: 2222 },
    });
    assert.ok(html.includes("http://172.20.10.5:8080/arena"));
    assert.ok(html.includes("btn-copy-lobby-url"));
    assert.ok(html.includes("ssh -p 2222 player@172.20.10.5"));
    assert.ok(html.includes("btn-copy-ssh-cmd"));
  });
});

describe("2. MeshRadar200 UI Rendering & Interaction Integrity", () => {
  it("generates and renders exactly 200 node cells in the virtual internet grid", () => {
    const nodes = generate200MeshNodes();
    assert.equal(nodes.length, 200, "Node array must contain exactly 200 nodes");

    const html = renderMeshRadar200Html({ nodes });
    const cellMatches = html.match(/class="mesh-node-cell/g);
    assert.equal(cellMatches?.length, 200, "Grid must render exactly 200 cells");

    // IP range check
    assert.equal(nodes[0]?.ip, "10.10.1.1");
    assert.equal(nodes[199]?.ip, "10.10.1.200");
  });

  it("supports category filtering for all 8 categories (all, whois, dns, web, mssql, s3, legacy, hardened)", () => {
    const nodes = generate200MeshNodes();

    assert.equal(filterMeshNodes(nodes, "all").length, 200);
    assert.equal(filterMeshNodes(nodes, "whois").length, 10);
    assert.equal(filterMeshNodes(nodes, "dns-axfr").length, 10);
    assert.equal(filterMeshNodes(nodes, "web-banner").length, 10);
    assert.equal(filterMeshNodes(nodes, "mssql").length, 10);
    assert.equal(filterMeshNodes(nodes, "s3-bucket").length, 10);
    assert.equal(filterMeshNodes(nodes, "legacy-service").length, 10);
    assert.equal(filterMeshNodes(nodes, "hardened").length, 140);

    const html = renderMeshRadar200Html({ nodes, activeFilter: "whois" });
    assert.ok(html.includes('data-filter="whois"'));
    assert.ok(html.includes("border-cyan-500 bg-cyan-950/40 text-cyan-300 font-semibold"), "Active filter must have highlight");

    // Non-whois nodes must have opacity-20 dimmed class
    assert.ok(html.includes("opacity-20"), "Unmatched category cells must be dimmed");
  });

  it("resolves and reflects compromise status color reactions accurately", () => {
    const nodes = generate200MeshNodes();

    // Node 42 is compromised
    const compromisedNode = nodes.find((n) => n.status === "compromised")!;
    assert.ok(compromisedNode);
    const compVisual = getMeshNodeVisual(compromisedNode);
    assert.ok(compVisual.bgClass.includes("bg-emerald-950"));
    assert.ok(compVisual.borderClass.includes("border-emerald-500"));
    assert.ok(compVisual.textClass.includes("text-emerald-400"));
    assert.equal(compVisual.icon, "fi-rr-check");

    // Node 88 is scanned
    const scannedNode = nodes.find((n) => n.status === "scanned")!;
    assert.ok(scannedNode);
    const scanVisual = getMeshNodeVisual(scannedNode);
    assert.ok(scanVisual.bgClass.includes("bg-cyan-950"));
    assert.ok(scanVisual.borderClass.includes("border-cyan-500"));
    assert.equal(scanVisual.icon, "fi-rr-eye");

    // Hardened node
    const hardenedNode = nodes.find((n) => n.category === "hardened")!;
    assert.ok(hardenedNode);
    const hardVisual = getMeshNodeVisual(hardenedNode);
    assert.equal(hardVisual.icon, "fi-rr-shield-check");
  });

  it("renders node inspector detail panel with ports, services, vulnerability and compromise details", () => {
    const nodes = generate200MeshNodes();
    const targetNode = nodes.find((n) => n.status === "compromised")!;

    const html = renderMeshRadar200Html({ nodes, selectedNodeId: targetNode.id });
    assert.ok(html.includes("노드 정밀 진단"));
    assert.ok(html.includes(targetNode.ip));
    assert.ok(html.includes(targetNode.hostname));
    assert.ok(html.includes(targetNode.vulnerabilityName || ""));
    assert.ok(html.includes("침투 성공 및 장악 완료"));
    assert.ok(html.includes(targetNode.compromisedBy || ""));
  });
});

describe("3. ArenaScoreboard UI Rendering & Interaction Integrity", () => {
  it("formats remaining countdown timer correctly", () => {
    assert.equal(formatRemainingTime(900), "15:00");
    assert.equal(formatRemainingTime(885), "14:45");
    assert.equal(formatRemainingTime(59), "00:59");
    assert.equal(formatRemainingTime(0), "00:00");
  });

  it("renders real-time leaderboard table with rank badges and active player counter", () => {
    const html = renderArenaScoreboardHtml({
      status: "active",
      remainingSeconds: 885,
      activePlayersCount: 4,
      players: INITIAL_SCOREBOARD_PLAYERS,
    });

    assert.ok(html.includes("14:45"));
    assert.ok(html.includes("4명"));
    assert.ok(html.includes("실시간 리더보드 순위표"));

    // Check rank badges
    const badge1 = getRankBadge(1);
    assert.equal(badge1.rankText, "1ST");
    assert.ok(badge1.badgeHtml.includes("fi-rr-crown"));

    const badge2 = getRankBadge(2);
    assert.equal(badge2.rankText, "2ND");
    assert.ok(badge2.badgeHtml.includes("fi-rr-medal"));

    for (const player of INITIAL_SCOREBOARD_PLAYERS) {
      assert.ok(html.includes(player.nickname));
      assert.ok(html.includes(`+${player.points} PT`));
      assert.ok(html.includes(`${player.compromisedCount}개`));
    }
  });

  it("renders live attack timeline feed with First Blood badges and captured techniques", () => {
    const html = renderArenaScoreboardHtml({
      status: "active",
      attackTraces: INITIAL_ATTACK_TRACES,
    });

    assert.ok(html.includes("실시간 공격 추적 (Live Attack Trace)"));
    assert.ok(html.includes("FIRST BLOOD!"));
    assert.ok(html.includes("10.10.1.42"));
    assert.ok(html.includes("DNS AXFR"));
    assert.ok(html.includes("영역 전송 취약점을(를) 탈취했습니다!"));
  });

  it("renders Hall of Fame modal view when match status is 'finished'", () => {
    const html = renderArenaScoreboardHtml({
      status: "finished",
      players: INITIAL_SCOREBOARD_PLAYERS,
    });

    assert.ok(html.includes("arena-hall-of-fame-root"));
    assert.ok(html.includes("명예의 전당 (Hall of Fame) 결과 발표"));
    assert.ok(html.includes("최종 우승자 (Grand Champion)"));
    assert.ok(html.includes(INITIAL_SCOREBOARD_PLAYERS[0]?.nickname || "공격자1"));
    assert.ok(html.includes("podium-card"));
    assert.ok(html.includes("대기실(Lobby)로 복귀"));
    assert.ok(html.includes("btn-back-to-lobby"));
  });
});

describe("4. TwinTerminal UI Rendering: Knowledge Tabs & Shell Script Copy Guide", () => {
  it("renders attacker reference card with tab switchers (All, Recon, Scripts)", () => {
    const html = renderReferenceKnowledgeCardHtml("attacker", "all");

    assert.ok(html.includes("공격자(Red Team) 핵심 명령어 &amp; 정찰 지식 레퍼런스") || html.includes("공격자(Red Team) 핵심 명령어 & 정찰 지식 레퍼런스"));
    assert.ok(html.includes('data-ref-tab="all"'));
    assert.ok(html.includes('data-ref-tab="recon"'));
    assert.ok(html.includes('data-ref-tab="script"'));
    assert.ok(html.includes("전체 커맨드 (All)"));
    assert.ok(html.includes("기초 정찰 (Recon)"));
    assert.ok(html.includes("셸 스크립트 자동화 (Scripts)"));
  });

  it("renders dedicated shell script copy guide box with one-click copy button", () => {
    const html = renderReferenceKnowledgeCardHtml("attacker", "all");

    assert.ok(html.includes("shell-script-guide-box"), "Must contain shell script guide box");
    assert.ok(html.includes("실전 셸 스크립트 (.sh) 작성 &amp; 복사 가이드") || html.includes("실전 셸 스크립트 (.sh) 작성 & 복사 가이드"));
    assert.ok(html.includes("btn-copy-script-guide"), "Must include one-click script copy button");
    assert.ok(html.includes("cat &lt;&lt; 'EOF' &gt; scan.sh") || html.includes("cat << 'EOF' > scan.sh"));
    assert.ok(html.includes("chmod +x scan.sh &amp;&amp; bash scan.sh") || html.includes("chmod +x scan.sh && bash scan.sh"));
    assert.ok(html.includes("auto_pwn.sh 즉시 실행"));
  });

  it("filters reference items based on activeRefTab prop", () => {
    const reconHtml = renderReferenceKnowledgeCardHtml("attacker", "recon");
    // When tab is recon, script items must have hidden class
    assert.ok(reconHtml.includes('data-tab="recon"'));
    assert.ok(reconHtml.includes('data-tab="script"'));
    assert.ok(reconHtml.includes('reference-item p-2.5 rounded border border-zinc-800/80 bg-[#0f1115] hover:border-zinc-700 transition-colors flex flex-col justify-between hidden'));

    const scriptHtml = renderReferenceKnowledgeCardHtml("attacker", "script");
    assert.ok(scriptHtml.includes('data-tab="script"'));
    assert.ok(!scriptHtml.includes('data-tab="script" class="hidden"'));
  });

  it("renders single terminal panel and twin terminals properly", () => {
    const attackerTermHtml = renderTwinTerminalHtml({ role: "attacker" });
    assert.ok(attackerTermHtml.includes("terminal-attacker-container"));
    assert.ok(attackerTermHtml.includes("root@kalibox:~#"));

    const bothTermHtml = renderTwinTerminalHtml({ role: "both" });
    assert.ok(bothTermHtml.includes("terminal-attacker-container"));
    assert.ok(bothTermHtml.includes("terminal-defender-container"));
    assert.ok(bothTermHtml.includes("secops@metasploitable2:~$"));
  });
});

describe("5. Full App Component Arena Layout Integration", () => {
  it("renders ArenaLobby when role='arena' and arenaStatus='waiting'", () => {
    const html = renderAppHtml({ role: "arena", arenaStatus: "waiting" });
    assert.ok(html.includes("arena-lobby-root"));
    assert.ok(html.includes("가상 인터넷 200 노드 CTF 아레나 대기실"));
  });

  it("renders ArenaLobby with countdown when role='arena' and arenaStatus='starting'", () => {
    const html = renderAppHtml({ role: "arena", arenaStatus: "starting", countdown: 3 });
    assert.ok(html.includes("arena-lobby-root"));
    assert.ok(html.includes("countdown-overlay"));
    assert.ok(html.includes("3"));
  });

  it("renders 3-column Arena Arena UI when role='arena' and arenaStatus='active'", () => {
    const html = renderAppHtml({
      role: "arena",
      arenaStatus: "active",
      arenaActiveFilter: "whois",
      arenaSelectedNodeId: "node-015",
    });

    // Col 1: Scoreboard
    assert.ok(html.includes("arena-scoreboard-root"));
    assert.ok(html.includes("실시간 리더보드 순위표"));

    // Col 2: MeshRadar200
    assert.ok(html.includes("mesh-radar-root"));
    assert.ok(html.includes("200 가상 인터넷 노드 격자 히트맵 레이더"));
    assert.ok(html.includes('data-filter="whois"'));

    // Col 3: Terminal with shell script guide
    assert.ok(html.includes("terminal-attacker-container"));
    assert.ok(html.includes("shell-script-guide-box"));
  });

  it("renders Hall of Fame view when role='arena' and arenaStatus='finished'", () => {
    const html = renderAppHtml({ role: "arena", arenaStatus: "finished" });
    assert.ok(html.includes("arena-hall-of-fame-root"));
    assert.ok(html.includes("명예의 전당 (Hall of Fame) 결과 발표"));
  });

  it("parses simulation role accurately from URL search and path strings", () => {
    assert.equal(parseRoleFromUrl("/arena"), "arena");
    assert.equal(parseRoleFromUrl("http://localhost:3000/arena"), "arena");
    assert.equal(parseRoleFromUrl("?role=arena"), "arena");
    assert.equal(parseRoleFromUrl("?role=attacker"), "attacker");
    assert.equal(parseRoleFromUrl("?role=defender"), "defender");
    assert.equal(parseRoleFromUrl("?role=observer"), "observer");
    assert.equal(parseRoleFromUrl(""), "observer");
    assert.equal(parseRoleFromUrl("?invalid=yes"), "observer");
  });
});

describe("6. Design Guide & Standards Compliance", () => {
  const lobby = renderArenaLobbyHtml();
  const mesh = renderMeshRadar200Html();
  const score = renderArenaScoreboardHtml({ status: "active" });
  const fame = renderArenaScoreboardHtml({ status: "finished" });
  const term = renderTwinTerminalHtml({ role: "both" });
  const app = renderAppHtml({ role: "arena", arenaStatus: "active" });

  const allUis = [lobby, mesh, score, fame, term, app];

  it("prohibits asymmetrical fingernail borders (border-l-4 rounded-*)", () => {
    for (const ui of allUis) {
      assert.ok(!ui.includes("border-l-4 rounded"), "Must NOT contain border-l-4 rounded-*");
    }
  });

  it("enforces centered buttons and badges (inline-flex items-center justify-center leading-none)", () => {
    for (const ui of allUis) {
      assert.ok(
        ui.includes("inline-flex items-center justify-center leading-none"),
        "Must enforce perfect centering for buttons/badges",
      );
    }
  });

  it("strictly enforces Flaticon UIcons regular rounded (fi fi-rr-*) only", () => {
    for (const ui of allUis) {
      assert.ok(ui.includes("fi fi-rr-"), "Must use Flaticon uicons");
      assert.ok(!ui.includes("<svg"), "Must NOT contain inline SVG elements");
      assert.ok(!ui.includes("lucide-"), "Must NOT contain Lucide icons");
      assert.ok(!EMOJI_REGEX.test(ui), "Must NOT contain emojis");
    }
  });

  it("enforces Korean typography (break-keep, text-balance/text-pretty, whitespace-nowrap)", () => {
    for (const ui of allUis) {
      assert.ok(ui.includes("break-keep"), "Must use break-keep");
      assert.ok(ui.includes("text-balance") || ui.includes("text-pretty"), "Must use text-balance or text-pretty");
      assert.ok(ui.includes("whitespace-nowrap"), "Must use whitespace-nowrap for badges and buttons");
    }
  });
});

describe("7. Client Index Bundle (client/index.html) Parity & Integrity", () => {
  it("client/index.html includes all updated interactive components and script handlers", () => {
    const indexPath = path.resolve(process.cwd(), "client", "index.html");
    assert.ok(fs.existsSync(indexPath), "client/index.html must exist");

    const content = fs.readFileSync(indexPath, "utf8");
    assert.ok(content.includes("<!DOCTYPE html>"));
    assert.ok(content.includes("ref-knowledge-tab"), "Bundle must contain reference knowledge tabs");
    assert.ok(content.includes("shell-script-guide-box"), "Bundle must contain shell script guide box");
    assert.ok(content.includes("btn-copy-script-guide"), "Bundle must contain script guide copy button");
    assert.ok(content.includes("arenaActiveFilter"), "Bundle script must contain arenaActiveFilter");
    assert.ok(content.includes("refActiveTab"), "Bundle script must contain refActiveTab");
    assert.ok(content.includes("input-nickname"), "Bundle script must contain input-nickname handler");
    assert.ok(content.includes("btn-toggle-ready"), "Bundle script must contain btn-toggle-ready handler");
    assert.ok(content.includes("mesh-node-cell"), "Bundle script must contain mesh-node-cell handler");
  });

  it("ES Module JS counterparts maintain parity with TypeScript modules", () => {
    assert.equal(ArenaLobbyJs.DEFAULT_MATCH_CONFIG.totalNodes, 200);
    assert.equal(MeshRadar200Js.generate200MeshNodes().length, 200);
    assert.equal(ArenaScoreboardJs.formatRemainingTime(900), "15:00");
    assert.ok(TwinTerminalJs.renderReferenceKnowledgeCardHtml("attacker").includes("shell-script-guide-box"));
    assert.ok(AppJs.renderAppHtml({ role: "arena", arenaStatus: "waiting" }).includes("arena-lobby-root"));
  });
});
