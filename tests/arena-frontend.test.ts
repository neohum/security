// tests/arena-frontend.test.ts — Comprehensive Test Suite for Step 3: arena-frontend-components.
//
// Conforms to:
//   - Tier 2 automated testing with node:test & node:assert/strict
//   - Verifies AC-1, AC-2, AC-3 of Step 3 in internet-ctf-competition-arena.plan.md
//   - Tests TSX and JS modules for ArenaLobby, MeshRadar200, ArenaScoreboard

import test, { describe, it } from "node:test";
import assert from "node:assert/strict";

// TypeScript imports
import {
  AVATAR_OPTIONS,
  DEFAULT_MATCH_CONFIG,
  INITIAL_LOBBY_PARTICIPANTS,
  renderArenaLobbyHtml,
  ArenaLobby,
} from "../client/src/components/ArenaLobby.ts";

import {
  generate200MeshNodes,
  filterMeshNodes,
  getMeshNodeVisual,
  renderMeshRadar200Html,
  MeshRadar200,
  MESH_FILTER_TABS,
  INITIAL_200_NODES,
} from "../client/src/components/MeshRadar200.ts";

import {
  INITIAL_SCOREBOARD_PLAYERS,
  INITIAL_ATTACK_TRACES,
  formatRemainingTime,
  getRankBadge,
  renderArenaScoreboardHtml,
  ArenaScoreboard,
} from "../client/src/components/ArenaScoreboard.ts";

// JavaScript runtime imports (to verify JS parity)
import * as ArenaLobbyJs from "../client/src/components/ArenaLobby.js";
import * as MeshRadar200Js from "../client/src/components/MeshRadar200.js";
import * as ArenaScoreboardJs from "../client/src/components/ArenaScoreboard.js";

const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

describe("Step 3: ArenaLobby Component (ArenaLobby.tsx & .js)", () => {
  it("AC-1: exports required configuration and default participants", () => {
    assert.equal(DEFAULT_MATCH_CONFIG.totalNodes, 200);
    assert.equal(DEFAULT_MATCH_CONFIG.vulnerableNodes, 60);
    assert.equal(DEFAULT_MATCH_CONFIG.hardenedNodes, 140);
    assert.equal(DEFAULT_MATCH_CONFIG.durationMinutes, 15);
    assert.equal(DEFAULT_MATCH_CONFIG.categoriesCount, 6);

    assert.ok(INITIAL_LOBBY_PARTICIPANTS.length >= 3);
    const host = INITIAL_LOBBY_PARTICIPANTS.find((p) => p.isHost);
    assert.ok(host, "Must contain a host participant");
    assert.equal(host.nickname, "RedCommander");

    assert.equal(AVATAR_OPTIONS.length, 6);
  });

  it("AC-1: renders match preparation lobby with Wi-Fi LAN access info", () => {
    const html = renderArenaLobbyHtml({
      config: { hostIp: "192.168.1.112", hostPort: 3000 },
    });

    assert.ok(html.includes("Wi-Fi LAN 접속 안내"), "Must display Wi-Fi LAN connection guidance");
    assert.ok(html.includes("http://192.168.1.112:3000/arena"), "Must display LAN access URL");
    assert.ok(html.includes("btn-copy-lobby-url"), "Must contain copy URL button");
    assert.ok(html.includes("가상 인터넷 200 노드 CTF 아레나 대기실"), "Must display match title");
  });

  it("AC-1: renders nickname input and avatar options", () => {
    const html = renderArenaLobbyHtml();

    assert.ok(html.includes("input-nickname"), "Must include nickname text input");
    assert.ok(html.includes("닉네임 입력"), "Must include nickname placeholder");
    assert.ok(html.includes("아바타 배지 선택"), "Must include avatar selection heading");

    for (const av of AVATAR_OPTIONS) {
      assert.ok(html.includes(av.label), `Must render avatar label ${av.label}`);
      assert.ok(html.includes(av.icon), `Must render avatar icon ${av.icon}`);
    }
  });

  it("AC-1: renders joined participants list with ready status badges", () => {
    const html = renderArenaLobbyHtml();

    assert.ok(html.includes("접속 중인 참가자 목록"));
    assert.ok(html.includes("RedCommander"));
    assert.ok(html.includes("CyberShadow"));
    assert.ok(html.includes("PacketHunter"));
    assert.ok(html.includes("준비 완료"));
    assert.ok(html.includes("준비 중"));
    assert.ok(html.includes("방장"));
  });

  it("AC-1: renders match configuration summary card", () => {
    const html = renderArenaLobbyHtml();

    assert.ok(html.includes("200개 가상 노드"));
    assert.ok(html.includes("60개 취약점"));
    assert.ok(html.includes("140개 완벽 보안"));
    assert.ok(html.includes("15분 제한"));
  });

  it("AC-1: renders '대회 시작' button with pulsing animation", () => {
    const html = renderArenaLobbyHtml();

    assert.ok(html.includes("btn-start-match"), "Must contain start button class");
    assert.ok(html.includes("animate-pulse"), "Start button must have pulsing animation");
    assert.ok(html.includes("대회 시작 (Start Competition)"));
  });

  it("AC-1: renders countdown animation when game transitions to starting", () => {
    const waitingHtml = renderArenaLobbyHtml({ status: "waiting" });
    assert.ok(!waitingHtml.includes("countdown-overlay"), "Waiting state must not show countdown banner");

    const startingHtml = renderArenaLobbyHtml({ status: "starting", countdown: 3 });
    assert.ok(startingHtml.includes("countdown-overlay"), "Starting state must render countdown banner");
    assert.ok(startingHtml.includes("경기 시작 카운트다운"));
    assert.ok(startingHtml.includes("3"));
  });

  it("AC-1: ArenaLobby component wrapper returns renderable object", () => {
    const comp = ArenaLobby({ status: "waiting" });
    assert.equal(comp.type, "ArenaLobby");
    const html = comp.renderHtml();
    assert.ok(html.includes("arena-lobby-root"));
  });

  it("AC-1: ES Module JS counterpart matches TSX implementation", () => {
    assert.equal(ArenaLobbyJs.DEFAULT_MATCH_CONFIG.totalNodes, 200);
    assert.equal(ArenaLobbyJs.AVATAR_OPTIONS.length, 6);
    const jsHtml = ArenaLobbyJs.renderArenaLobbyHtml();
    assert.ok(jsHtml.includes("Wi-Fi LAN 접속 안내"));
    assert.ok(jsHtml.includes("대회 시작 (Start Competition)"));
  });
});

describe("Step 3: MeshRadar200 Component (MeshRadar200.tsx & .js)", () => {
  it("AC-2: generates exactly 200 deterministic virtual internet nodes", () => {
    const nodes = generate200MeshNodes();
    assert.equal(nodes.length, 200);

    // Verify IP range 10.10.1.1 to 10.10.1.200
    assert.equal(nodes[0]?.ip, "10.10.1.1");
    assert.equal(nodes[199]?.ip, "10.10.1.200");

    // Exactly 6 categories with 10 nodes each = 60 vulnerable
    const whoisNodes = nodes.filter((n) => n.category === "whois");
    const dnsNodes = nodes.filter((n) => n.category === "dns-axfr");
    const webNodes = nodes.filter((n) => n.category === "web-banner");
    const mssqlNodes = nodes.filter((n) => n.category === "mssql");
    const s3Nodes = nodes.filter((n) => n.category === "s3-bucket");
    const legacyNodes = nodes.filter((n) => n.category === "legacy-service");
    const hardenedNodes = nodes.filter((n) => n.category === "hardened");

    assert.equal(whoisNodes.length, 10, "Must have exactly 10 whois nodes");
    assert.equal(dnsNodes.length, 10, "Must have exactly 10 dns-axfr nodes");
    assert.equal(webNodes.length, 10, "Must have exactly 10 web-banner nodes");
    assert.equal(mssqlNodes.length, 10, "Must have exactly 10 mssql nodes");
    assert.equal(s3Nodes.length, 10, "Must have exactly 10 s3-bucket nodes");
    assert.equal(legacyNodes.length, 10, "Must have exactly 10 legacy-service nodes");
    assert.equal(hardenedNodes.length, 140, "Must have exactly 140 hardened nodes");

    assert.equal(
      whoisNodes.length +
        dnsNodes.length +
        webNodes.length +
        mssqlNodes.length +
        s3Nodes.length +
        legacyNodes.length +
        hardenedNodes.length,
      200,
      "Sum of all categories must be exactly 200",
    );
  });

  it("AC-2: resolves visual styles for node statuses", () => {
    const nodes = generate200MeshNodes();

    // Compromised node (node 42)
    const compNode = nodes.find((n) => n.status === "compromised");
    assert.ok(compNode);
    const compVisual = getMeshNodeVisual(compNode);
    assert.ok(compVisual.bgClass.includes("bg-emerald-950"));
    assert.ok(compVisual.borderClass.includes("border-emerald-500"));
    assert.ok(compVisual.textClass.includes("text-emerald-400"));

    // Scanned node
    const scanNode = nodes.find((n) => n.status === "scanned");
    assert.ok(scanNode);
    const scanVisual = getMeshNodeVisual(scanNode);
    assert.ok(scanVisual.bgClass.includes("bg-cyan-950"));
    assert.ok(scanVisual.borderClass.includes("border-cyan-500"));

    // Hardened node
    const hardNode = nodes.find((n) => n.category === "hardened");
    assert.ok(hardNode);
    const hardVisual = getMeshNodeVisual(hardNode);
    assert.equal(hardVisual.icon, "fi-rr-shield-check");

    // Unprobed node
    const unprobedNode = nodes.find((n) => n.status === "unprobed" && n.category !== "hardened");
    assert.ok(unprobedNode);
    const unprobedVisual = getMeshNodeVisual(unprobedNode);
    assert.ok(unprobedVisual.bgClass.includes("bg-zinc-900"));
  });

  it("AC-2: filters nodes by category correctly", () => {
    const nodes = generate200MeshNodes();

    assert.equal(filterMeshNodes(nodes, "all").length, 200);
    assert.equal(filterMeshNodes(nodes, "whois").length, 10);
    assert.equal(filterMeshNodes(nodes, "dns-axfr").length, 10);
    assert.equal(filterMeshNodes(nodes, "web-banner").length, 10);
    assert.equal(filterMeshNodes(nodes, "mssql").length, 10);
    assert.equal(filterMeshNodes(nodes, "s3-bucket").length, 10);
    assert.equal(filterMeshNodes(nodes, "legacy-service").length, 10);
    assert.equal(filterMeshNodes(nodes, "hardened").length, 140);
  });

  it("AC-2: renders 200-node heatmap grid and category filter tabs", () => {
    const html = renderMeshRadar200Html();

    assert.ok(html.includes("200 가상 인터넷 노드 격자 히트맵 레이더"));
    assert.ok(html.includes("전체"));
    assert.ok(html.includes("Whois"));
    assert.ok(html.includes("DNS"));
    assert.ok(html.includes("Web"));
    assert.ok(html.includes("MSSQL"));
    assert.ok(html.includes("S3"));
    assert.ok(html.includes("Legacy"));
    assert.ok(html.includes("철통방어"));

    // Check count of cells rendered
    const matches = html.match(/class="mesh-node-cell/g);
    assert.equal(matches?.length, 200, "Must render exactly 200 node cells in grid");

    // Check selected node detail inspector
    assert.ok(html.includes("노드 정밀 진단"));
    assert.ok(html.includes("10.10.1."));
    assert.ok(html.includes("개방 포트"));
    assert.ok(html.includes("진단된 취약점 프로파일"));
  });

  it("AC-2: MeshRadar200 component wrapper returns renderable object", () => {
    const comp = MeshRadar200({});
    assert.equal(comp.type, "MeshRadar200");
    const html = comp.renderHtml();
    assert.ok(html.includes("mesh-radar-root"));
  });

  it("AC-2: ES Module JS counterpart matches TSX implementation", () => {
    const jsNodes = MeshRadar200Js.generate200MeshNodes();
    assert.equal(jsNodes.length, 200);
    const jsHtml = MeshRadar200Js.renderMeshRadar200Html();
    assert.ok(jsHtml.includes("200 가상 인터넷 노드 격자 히트맵 레이더"));
  });
});

describe("Step 3: ArenaScoreboard Component (ArenaScoreboard.tsx & .js)", () => {
  it("AC-2: formats countdown timer accurately", () => {
    assert.equal(formatRemainingTime(899), "14:59");
    assert.equal(formatRemainingTime(900), "15:00");
    assert.equal(formatRemainingTime(65), "01:05");
    assert.equal(formatRemainingTime(5), "00:05");
    assert.equal(formatRemainingTime(0), "00:00");
    assert.equal(formatRemainingTime(-10), "00:00");
  });

  it("AC-2: resolves gold/silver/bronze badges for top 3 ranks", () => {
    const rank1 = getRankBadge(1);
    assert.equal(rank1.rankText, "1ST");
    assert.ok(rank1.badgeHtml.includes("fi-rr-crown"));

    const rank2 = getRankBadge(2);
    assert.equal(rank2.rankText, "2ND");
    assert.ok(rank2.badgeHtml.includes("fi-rr-medal"));

    const rank3 = getRankBadge(3);
    assert.equal(rank3.rankText, "3RD");
    assert.ok(rank3.badgeHtml.includes("fi-rr-medal"));

    const rank4 = getRankBadge(4);
    assert.equal(rank4.rankText, "#4");
  });

  it("AC-2: renders active scoreboard with ranking table and live attack trace feed", () => {
    const html = renderArenaScoreboardHtml({
      status: "active",
      remainingSeconds: 885, // 14:45
      activePlayersCount: 4,
    });

    assert.ok(html.includes("14:45"), "Must render remaining time");
    assert.ok(html.includes("4명"), "Must render active player count");
    assert.ok(html.includes("실시간 리더보드 순위표"));
    assert.ok(html.includes("실시간 공격 추적 (Live Attack Trace)"));

    // Check player rows
    assert.ok(html.includes("공격자1"));
    assert.ok(html.includes("CyberShadow"));
    assert.ok(html.includes("+400 PT"));

    // Check trace feed entries
    assert.ok(html.includes("trace-001"));
    assert.ok(html.includes("10.10.1.42"));
    assert.ok(html.includes("DNS AXFR"));
    assert.ok(html.includes("FIRST BLOOD!"));
    assert.ok(html.includes("영역 전송 취약점을(를) 탈취했습니다!"));
  });

  it("AC-2: renders Hall of Fame modal/view when match status is 'finished'", () => {
    const html = renderArenaScoreboardHtml({ status: "finished" });

    assert.ok(html.includes("arena-hall-of-fame-root"));
    assert.ok(html.includes("명예의 전당 (Hall of Fame) 결과 발표"));
    assert.ok(html.includes("최종 우승자 (Grand Champion)"));
    assert.ok(html.includes("공격자1"));
    assert.ok(html.includes("총 탈취 노드"));
    assert.ok(html.includes("대기실(Lobby)로 복귀"));
  });

  it("AC-2: ArenaScoreboard component wrapper returns renderable object", () => {
    const comp = ArenaScoreboard({ status: "active" });
    assert.equal(comp.type, "ArenaScoreboard");
    const html = comp.renderHtml();
    assert.ok(html.includes("arena-scoreboard-root"));
  });

  it("AC-2: ES Module JS counterpart matches TSX implementation", () => {
    assert.equal(ArenaScoreboardJs.formatRemainingTime(899), "14:59");
    const jsHtml = ArenaScoreboardJs.renderArenaScoreboardHtml();
    assert.ok(jsHtml.includes("실시간 리더보드 순위표"));
  });
});

describe("Step 3: Design Rules & UI Standards Compliance (AC-3)", () => {
  const lobbyHtml = renderArenaLobbyHtml();
  const meshHtml = renderMeshRadar200Html();
  const scoreHtml = renderArenaScoreboardHtml({ status: "active" });
  const fameHtml = renderArenaScoreboardHtml({ status: "finished" });
  const allHtmls = [lobbyHtml, meshHtml, scoreHtml, fameHtml];

  it("AC-3: strictly enforces symmetrical borders (NO border-l-4 rounded-*)", () => {
    for (const html of allHtmls) {
      assert.ok(
        !html.includes("border-l-4 rounded"),
        "Must NOT contain asymmetrical cuticle border-l-4 rounded-*",
      );
      assert.ok(
        html.includes("border border-zinc-800") || html.includes("border border-"),
        "Must use symmetrical border styling",
      );
    }
  });

  it("AC-3: strictly enforces centered buttons and badges (inline-flex items-center justify-center leading-none)", () => {
    for (const html of allHtmls) {
      assert.ok(
        html.includes("inline-flex items-center justify-center leading-none"),
        "Must include perfect centering classes for buttons and badges",
      );
    }
  });

  it("AC-3: strictly enforces Flaticon UIcons regular rounded (fi fi-rr-*) only", () => {
    for (const html of allHtmls) {
      assert.ok(html.includes("fi fi-rr-"), "Must use Flaticon UIcons regular rounded");
      assert.ok(!html.includes("<svg"), "Must NOT include inline SVG elements");
      assert.ok(!html.includes("lucide-"), "Must NOT include Lucide icons");
      assert.ok(!EMOJI_REGEX.test(html), "Must NOT include any emoji characters");
    }
  });

  it("AC-3: strictly enforces Korean typography rules (break-keep, text-balance/text-pretty)", () => {
    for (const html of allHtmls) {
      assert.ok(html.includes("break-keep"), "Must include break-keep for syllable wrapping");
      assert.ok(
        html.includes("text-balance") || html.includes("text-pretty"),
        "Must include balanced or pretty line breaking for text",
      );
    }
  });

  it("AC-3: uses dark theme styling (bg-zinc-950, bg-zinc-900, border-zinc-800)", () => {
    for (const html of allHtmls) {
      assert.ok(
        html.includes("bg-zinc-950") || html.includes("bg-zinc-900"),
        "Must adopt dark theme background colors",
      );
      assert.ok(html.includes("border-zinc-800"), "Must adopt zinc-800 borders");
    }
  });
});
