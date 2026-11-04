// tests/frontend-components.test.ts — Comprehensive Test Suite for Step 3: sim-frontend-grid.
//
// Conforms to:
//   - Tier 2 automated testing with node:test & node:assert/strict
//   - Verifies AC-1, AC-2, AC-3, AC-4 of Step 3 in metasploit-ch3-simulation.plan.md

import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parseRoleFromUrl, renderAppHtml } from "../client/src/App.ts";
import {
  CH3_MISSIONS,
  evaluateSubmittedFlag,
  evaluateTerminalOutput,
  renderAttackerDashboardHtml,
} from "../client/src/components/AttackerDashboard.ts";
import {
  INITIAL_PACKET_ALERTS,
  INITIAL_PATCH_RECOMMENDATIONS,
  getSeverityBadge,
  renderDefenderDashboardHtml,
} from "../client/src/components/DefenderDashboard.ts";
import {
  TERMINAL_CONFIGS,
  renderTwinTerminalHtml,
} from "../client/src/components/TwinTerminal.ts";
import {
  INITIAL_TOPOLOGY_NODES,
  getStatusColor,
  renderTopologyRadarHtml,
} from "../client/src/components/TopologyRadar.ts";

describe("Frontend Role-Based Routing (App.tsx)", () => {
  it("AC-2: parses ?role=attacker to 'attacker'", () => {
    assert.equal(parseRoleFromUrl("?role=attacker"), "attacker");
    assert.equal(parseRoleFromUrl("https://192.168.1.100:3000/?role=attacker"), "attacker");
  });

  it("AC-3: parses ?role=defender to 'defender'", () => {
    assert.equal(parseRoleFromUrl("?role=defender"), "defender");
    assert.equal(parseRoleFromUrl("/?foo=bar&role=defender"), "defender");
  });

  it("AC-1: parses ?role=observer to 'observer'", () => {
    assert.equal(parseRoleFromUrl("?role=observer"), "observer");
  });

  it("AC-1: parses /arena or ?role=arena to 'arena'", () => {
    assert.equal(parseRoleFromUrl("?role=arena"), "arena");
    assert.equal(parseRoleFromUrl("http://172.31.1.112:3000/arena"), "arena");
    assert.equal(parseRoleFromUrl("/arena"), "arena");
  });

  it("AC-1: defaults to 'observer' when role is missing or invalid", () => {
    assert.equal(parseRoleFromUrl(""), "observer");
    assert.equal(parseRoleFromUrl("?something=else"), "observer");
    assert.equal(parseRoleFromUrl("?role=hacker"), "observer");
  });
});

describe("Attacker Dashboard & Mission Scoring (AttackerDashboard.tsx)", () => {
  it("initializes with 6 structured Chapter 3 missions", () => {
    assert.equal(CH3_MISSIONS.length, 6);
    const missionIds = CH3_MISSIONS.map((m) => m.id);
    assert.ok(missionIds.includes("m1-whois"));
    assert.ok(missionIds.includes("m2-dns-axfr"));
    assert.ok(missionIds.includes("m3-db-nmap"));
    assert.ok(missionIds.includes("m4-mssql-login"));
    assert.ok(missionIds.includes("m5-s3-leak"));
    assert.ok(missionIds.includes("m6-custom-scanner"));
  });

  it("evaluates valid flag and updates mission state & score", () => {
    const result = evaluateSubmittedFlag("FLAG{ZONE_TRANSFER_EXPOSED}", CH3_MISSIONS);
    assert.equal(result.success, true);
    assert.ok(result.totalScore >= 100);
    assert.ok(result.message.includes("정답입니다"));

    const solvedMission = result.updatedMissions.find((m) => m.id === "m2-dns-axfr");
    assert.ok(solvedMission?.solved);
  });

  it("rejects invalid flag with informative feedback", () => {
    const result = evaluateSubmittedFlag("FLAG{INVALID_GUESS}", CH3_MISSIONS);
    assert.equal(result.success, false);
    assert.ok(result.message.includes("일치하지 않는 플래그입니다"));
  });

  it("automatically evaluates terminal commands and stdout outputs without manual flag entry", () => {
    // 1단계 Whois command and output auto evaluation
    const whoisRes = evaluateTerminalOutput(
      "whois -h 172.28.0.15 megacorp.internal",
      "% MegaCorp Internal Whois Database Server\nDomain: megacorp.internal\nTech Email: admin@megacorp.internal\nFLAG: FLAG{WHOIS_RECON_SUCCESS}",
      CH3_MISSIONS,
    );
    assert.equal(whoisRes.matched, true);
    assert.equal(whoisRes.mission?.id, "m1-whois");
    assert.equal(whoisRes.totalScore, 100);
    assert.ok(whoisRes.message?.includes("자동 완료"));

    // 2단계 DNS AXFR command auto evaluation
    const axfrRes = evaluateTerminalOutput(
      "dig axfr @172.28.0.15 megacorp.internal",
      ";; <<>> DiG 9.18.1 <<>> axfr @172.28.0.15 megacorp.internal\nns1.megacorp.internal. IN A 172.28.0.15",
      whoisRes.updatedMissions,
    );
    assert.equal(axfrRes.matched, true);
    assert.equal(axfrRes.mission?.id, "m2-dns-axfr");
    assert.equal(axfrRes.totalScore, 200);

    // 3단계 db_nmap scan auto evaluation
    const nmapRes = evaluateTerminalOutput(
      "nmap -sS -p 21,22,80 172.28.0.20",
      "PORT STATE SERVICE\n21/tcp open ftp\n22/tcp open ssh",
      axfrRes.updatedMissions,
    );
    assert.equal(nmapRes.matched, true);
    assert.equal(nmapRes.mission?.id, "m3-db-nmap");
    assert.equal(nmapRes.totalScore, 300);
  });

  it("AC-4: renders dashboard HTML with Korean typography & button centering standards", () => {
    const html = renderAttackerDashboardHtml();
    assert.ok(html.includes("공격자 작전 대시보드"));
    assert.ok(html.includes("break-keep"), "Must include break-keep for Korean syllables");
    assert.ok(html.includes("text-balance"), "Must include text-balance for headings");
    assert.ok(html.includes("inline-flex items-center justify-center leading-none"), "Buttons must have perfect centering");
    assert.ok(html.includes("FLAG{...}"), "Must render flag input container");
    assert.ok(!html.includes("border-l-4 rounded"), "Must NOT include cuticle fingernail borders");
  });
});

describe("Defender Dashboard & IDS Alert Stream (DefenderDashboard.tsx)", () => {
  it("initializes with packet alerts and one-click patch recommendations", () => {
    assert.ok(INITIAL_PACKET_ALERTS.length >= 4);
    assert.ok(INITIAL_PATCH_RECOMMENDATIONS.length >= 3);

    const patchIds = INITIAL_PATCH_RECOMMENDATIONS.map((p) => p.id);
    assert.ok(patchIds.includes("patch-axfr"));
    assert.ok(patchIds.includes("patch-mssql"));
    assert.ok(patchIds.includes("patch-s3-acl"));
  });

  it("correctly resolves severity badge colors", () => {
    const critBadge = getSeverityBadge("critical");
    assert.equal(critBadge.label, "CRITICAL");
    assert.ok(critBadge.borderClass.includes("border-red"));

    const highBadge = getSeverityBadge("high");
    assert.equal(highBadge.label, "HIGH");

    const infoBadge = getSeverityBadge("info");
    assert.equal(infoBadge.label, "INFO");
  });

  it("renders defender dashboard HTML with telemetry metrics and patch buttons", () => {
    const html = renderDefenderDashboardHtml();
    assert.ok(html.includes("방어자 관제 센터"));
    assert.ok(html.includes("실시간 IDS 탐지 패킷 스트림"));
    assert.ok(html.includes("원클릭 패치 적용"));
    assert.ok(html.includes("break-keep"));
    assert.ok(html.includes("inline-flex items-center justify-center leading-none"));
  });
});

describe("Topology Radar & Discovered Nodes (TopologyRadar.tsx)", () => {
  it("contains all 5 Docker LAN subnet nodes", () => {
    assert.equal(INITIAL_TOPOLOGY_NODES.length, 5);

    const nodeIps = INITIAL_TOPOLOGY_NODES.map((n) => n.ip);
    assert.ok(nodeIps.includes("172.28.0.10"), "Attacker Kalibox IP missing");
    assert.ok(nodeIps.includes("172.28.0.15"), "Fake Recon/DNS IP missing");
    assert.ok(nodeIps.includes("172.28.0.20"), "Metasploitable2 IP missing");
    assert.ok(nodeIps.includes("172.28.0.25"), "Fake S3 MinIO IP missing");
    assert.ok(nodeIps.includes("172.28.0.30"), "Vuln MSSQL IP missing");
  });

  it("maps status colors properly", () => {
    const compromised = getStatusColor("compromised");
    assert.equal(compromised.color, "#ff5d6c");
    const discovered = getStatusColor("discovered");
    assert.equal(discovered.color, "#7c8cff");
  });

  it("renders SVG radar coordinates and host details", () => {
    const html = renderTopologyRadarHtml();
    assert.ok(html.includes("<svg viewBox=\"0 0 300 300\""));
    assert.ok(html.includes("네트워크 토폴로지 레이더"));
    assert.ok(html.includes("172.28.0.0/16"));
  });
});

describe("Twin Terminal & WebSocket Endpoints (TwinTerminal.tsx)", () => {
  it("configures attacker and defender WebSocket routes correctly", () => {
    assert.equal(TERMINAL_CONFIGS.attacker.wsEndpoint, "/ws/terminal/attacker");
    assert.equal(TERMINAL_CONFIGS.defender.wsEndpoint, "/ws/terminal/defender");
  });

  it("renders dual split terminals for observer mode", () => {
    const html = renderTwinTerminalHtml({ role: "both" });
    assert.ok(html.includes("terminal-attacker-container"));
    assert.ok(html.includes("terminal-defender-container"));
    assert.ok(html.includes("지우기"));
    assert.ok(html.includes("재연결"));
  });

  it("renders single terminal when scoped to attacker or defender", () => {
    const attackerHtml = renderTwinTerminalHtml({ role: "attacker" });
    assert.ok(attackerHtml.includes("terminal-attacker-container"));
    assert.ok(!attackerHtml.includes("terminal-defender-container"));
    assert.ok(attackerHtml.includes("공격자(Red Team) 핵심 명령어 &amp; 정찰 지식 레퍼런스") || attackerHtml.includes("공격자(Red Team) 핵심 명령어 & 정찰 지식 레퍼런스"));
    assert.ok(attackerHtml.includes("whois -h 172.28.0.15 megacorp.internal"));
    assert.ok(attackerHtml.includes("btn-copy-ref-cmd"));
    assert.ok(attackerHtml.includes("btn-insert-ref-cmd"));

    const defenderHtml = renderTwinTerminalHtml({ role: "defender" });
    assert.ok(defenderHtml.includes("terminal-defender-container"));
    assert.ok(!defenderHtml.includes("terminal-attacker-container"));
    assert.ok(defenderHtml.includes("방어자(Blue Team) 관제 명령어 &amp; 보안 대응 지식 레퍼런스") || defenderHtml.includes("방어자(Blue Team) 관제 명령어 & 보안 대응 지식 레퍼런스"));
    assert.ok(defenderHtml.includes("netstat -tuln"));
    assert.ok(defenderHtml.includes("named.conf -> allow-transfer { none; };"));
    assert.ok(defenderHtml.includes("btn-copy-ref-cmd"));
    assert.ok(defenderHtml.includes("btn-insert-ref-cmd"));
  });
});

describe("Full Application Grid Layouts (App.tsx)", () => {
  it("AC-1: renders 2x2 grid layout in observer mode", () => {
    const html = renderAppHtml({ role: "observer" });
    assert.ok(html.includes("2x2 다중 협업 분할 뷰"));
    assert.ok(html.includes("grid-resizer-bar"));
    assert.ok(html.includes("terminal-attacker-container"));
    assert.ok(html.includes("terminal-defender-container"));
  });

  it("AC-2: renders fullscreen Red Team view in attacker mode", () => {
    const html = renderAppHtml({ role: "attacker" });
    assert.ok(html.includes("공격자 작전 대시보드"));
    assert.ok(html.includes("terminal-attacker-container"));
    assert.ok(!html.includes("grid-resizer-bar"), "Observer resizer should not be rendered in attacker mode");
  });

  it("AC-3: renders fullscreen Blue Team view in defender mode", () => {
    const html = renderAppHtml({ role: "defender" });
    assert.ok(html.includes("방어자 관제 센터"));
    assert.ok(html.includes("terminal-defender-container"));
    assert.ok(!html.includes("grid-resizer-bar"), "Observer resizer should not be rendered in defender mode");
  });

  it("AC-1: renders CTF Arena lobby in arena mode when waiting", () => {
    const html = renderAppHtml({ role: "arena", arenaStatus: "waiting" });
    assert.ok(html.includes("CTF 아레나 대기실") || html.includes("Wi-Fi LAN 접속 안내"));
    assert.ok(html.includes("대회 시작"));
  });

  it("AC-1: renders CTF Arena match view with 200 nodes and scoreboard when active", () => {
    const html = renderAppHtml({ role: "arena", arenaStatus: "active" });
    assert.ok(html.includes("200 가상 인터넷 노드 격자 히트맵 레이더") || html.includes("200-NODE MESH"));
    assert.ok(html.includes("실시간 순위표") || html.includes("실시간 공격 추적 피드"));
    assert.ok(html.includes("terminal-attacker-container"));
  });
});

describe("Design Specification & HTML5 Compliance (client/index.html)", () => {
  const indexPath = path.resolve(process.cwd(), "client/index.html");

  it("HTML5 entry file exists on disk", () => {
    assert.ok(fs.existsSync(indexPath), "client/index.html must exist");
  });

  it("AC-4: client/index.html satisfies DESIGN.md conventions", () => {
    const content = fs.readFileSync(indexPath, "utf-8");

    // Standard HTML5 & Korean declarations
    assert.ok(content.includes('<!DOCTYPE html>'), "Must include DOCTYPE html");
    assert.ok(content.includes('<html lang="ko">'), "Must declare lang=\"ko\"");
    assert.ok(content.includes('<meta charset="utf-8">'), "Must declare charset utf-8");
    assert.ok(content.includes('name="viewport"'), "Must include responsive viewport meta");

    // xterm.js CDN & styling
    assert.ok(content.includes("@xterm/xterm"), "Must link xterm.js resources");

    // Flaticon UIcons regular rounded
    assert.ok(content.includes("uicons-regular-rounded"), "Must link Flaticon UIcons");

    // Theme Tokens
    assert.ok(content.includes("#0b0c0f"), "Must include color.bg token");
    assert.ok(content.includes("#e7e9ee"), "Must include color.fg token");
    assert.ok(content.includes("#7c8cff"), "Must include color.accent token");
    assert.ok(content.includes("#ff5d6c"), "Must include color.danger token");

    // Typography rules defined in stylesheet
    assert.ok(content.includes(".break-keep"), "Must define .break-keep rule");
    assert.ok(content.includes(".text-balance"), "Must define .text-balance rule");

    // Root mount element
    assert.ok(content.includes('<div id="root"'), "Must provide #root mount container");
  });
});
