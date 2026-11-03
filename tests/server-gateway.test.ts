import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import crypto from "node:crypto";

import { detectLocalIp, LanManager, generateConnectionUrl } from "../server/lan-manager.ts";
import { PtyManager } from "../server/pty-manager.ts";
import { TrafficMonitor } from "../server/traffic-monitor.ts";
import { ScenarioState } from "../server/scenario-state.ts";
import { GatewayApp } from "../server/index.ts";

test("1. LAN Manager: local IP detection and role routing", async (t) => {
  await t.test("detectLocalIp returns valid IPv4 address", () => {
    const ip = detectLocalIp();
    assert.match(ip, /^(?:\d{1,3}\.){3}\d{1,3}$/);
    assert.notEqual(ip, "");
  });

  await t.test("detectLocalIp prioritizes Wi-Fi over virtual docker bridges", () => {
    const mockNets: any = {
      "docker0": [{ address: "172.17.0.1", family: "IPv4", internal: false }],
      "eth0": [{ address: "10.0.0.5", family: "IPv4", internal: false }],
      "Wi-Fi": [{ address: "192.168.1.120", family: "IPv4", internal: false }],
    };
    const detected = detectLocalIp(mockNets);
    assert.equal(detected, "192.168.1.120");
  });

  await t.test("generateConnectionUrl formats role query correctly", () => {
    const url = generateConnectionUrl("attacker", "192.168.1.50", 3000);
    assert.equal(url, "http://192.168.1.50:3000/?role=attacker");

    const defenderUrl = generateConnectionUrl("defender", "192.168.1.50", 3000);
    assert.equal(defenderUrl, "http://192.168.1.50:3000/?role=defender");
  });

  await t.test("LanManager session lifecycle", () => {
    const lan = new LanManager({ hostIp: "192.168.1.100", port: 3000, sshPort: 2222 });
    assert.equal(lan.hostIp, "192.168.1.100");

    const session = lan.registerSession("attacker", "192.168.1.150");
    assert.equal(session.role, "attacker");
    assert.equal(session.clientIp, "192.168.1.150");

    const counts = lan.getActiveSessionCount();
    assert.equal(counts.attacker, 1);
    assert.equal(counts.defender, 0);

    const touched = lan.touchSession(session.id);
    assert.equal(touched, true);

    const summary = lan.getSummary();
    assert.equal(summary.sshPort, 2222);
    assert.equal(summary.urls.attacker, "http://192.168.1.100:3000/?role=attacker");

    const removed = lan.removeSession(session.id);
    assert.equal(removed, true);
    assert.equal(lan.getSession(session.id), undefined);
  });
});

test("2. Scenario State: quest progression and flag verification", async (t) => {
  const scenario = new ScenarioState();

  await t.test("Initial state has 6 Chapter 3 quests, first quest active", () => {
    const state = scenario.getState();
    assert.equal(state.totalQuests, 6);
    assert.equal(state.completedQuests, 0);
    assert.equal(state.quests[0].status, "active");
    assert.equal(state.quests[1].status, "locked");
  });

  await t.test("Submitting correct flag completes quest and unlocks next quest", () => {
    const result = scenario.submitFlag("FLAG{whois_recon_success}", "attacker");
    assert.equal(result.success, true);
    assert.equal(result.pointsAwarded, 100);

    const state = scenario.getState();
    assert.equal(state.completedQuests, 1);
    assert.equal(state.scores.attacker, 100);
    assert.equal(state.quests[0].status, "completed");
    assert.equal(state.quests[1].status, "active"); // Next quest unlocked!
  });

  await t.test("Submitting invalid flag returns failure without modifying scores", () => {
    const result = scenario.submitFlag("FLAG{invalid_fake_flag}", "attacker");
    assert.equal(result.success, false);
    const state = scenario.getState();
    assert.equal(state.scores.attacker, 100);
  });

  await t.test("Submitting duplicate completed flag returns error", () => {
    const result = scenario.submitFlag("FLAG{whois_recon_success}", "attacker");
    assert.equal(result.success, false);
    assert.match(result.message, /이미 완료된/);
  });

  await t.test("Reset state restores initial quest locked states", () => {
    scenario.resetState();
    const state = scenario.getState();
    assert.equal(state.completedQuests, 0);
    assert.equal(state.scores.attacker, 0);
    assert.equal(state.quests[0].status, "active");
    assert.equal(state.quests[1].status, "locked");
  });
});

test("3. Traffic Monitor: event broadcasting and simulation", async (t) => {
  const monitor = new TrafficMonitor({ maxHistory: 10 });

  await t.test("Record and retrieve network events", () => {
    const event = monitor.recordEvent({
      type: "syn_scan",
      sourceIp: "172.28.0.5",
      destIp: "172.28.0.10",
      port: 445,
      protocol: "TCP",
      flag: "SYN",
      details: "SMB SYN scan detected",
      severity: "medium",
    });

    assert.ok(event.id);
    assert.ok(event.timestamp);
    assert.equal(event.port, 445);

    const history = monitor.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].id, event.id);
  });

  await t.test("Simulated scan generator creates valid event", () => {
    const simEvent = monitor.emitSimulatedScan({ port: 1433 });
    assert.equal(simEvent.port, 1433);
    assert.equal(simEvent.type, "syn_scan");
    assert.equal(monitor.getHistory().length, 2);
  });
});

test("4. PTY Manager: mock shell emulation and command responses", async (t) => {
  const pty = new PtyManager();

  await t.test("Creates mock shell session for attacker", async () => {
    const session = await pty.createSession("attacker", { forceMock: true });
    assert.equal(session.role, "attacker");
    assert.equal(session.isMock, true);

    let output = "";
    session.onData((data) => {
      output += data;
    });

    // Write command: whois -h 172.28.0.15 megacorp.internal
    session.write("whois -h 172.28.0.15 megacorp.internal\r");

    // Wait short tick for output
    await new Promise((r) => setTimeout(r, 60));
    assert.match(output, /megacorp\.internal/i);
    assert.match(output, /FLAG\{whois_recon_success\}/);

    session.close();
  });

  await t.test("Creates mock shell session for defender", async () => {
    const session = await pty.createSession("defender", { forceMock: true });
    assert.equal(session.role, "defender");

    let output = "";
    session.onData((data) => {
      output += data;
    });

    session.write("netstat\r");
    await new Promise((r) => setTimeout(r, 60));
    assert.match(output, /Active Internet connections/);

    session.close();
  });

  pty.closeAll();
});

test("5. Gateway Server: HTTP API Endpoints and WebSocket streaming", async (t) => {
  const app = new GatewayApp({ port: 0, hostIp: "127.0.0.1" });
  const actualPort = await app.listen(0, "127.0.0.1");

  const baseUrl = `http://127.0.0.1:${actualPort}`;

  try {
    await t.test("GET /api/health returns 200 OK and LAN info", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, "ok");
      assert.ok(json.lan);
      assert.equal(json.lan.sshPort, 2222);
      assert.equal(json.lan.port, actualPort);
    });

    await t.test("GET /api/lan returns role URLs", async () => {
      const res = await fetch(`${baseUrl}/api/lan`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.urls.attacker);
      assert.ok(json.urls.defender);
      assert.ok(json.urls.observer);
    });

    await t.test("POST /api/scenario/flag validates flag and updates state", async () => {
      const res = await fetch(`${baseUrl}/api/scenario/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag: "FLAG{whois_recon_success}", role: "attacker" }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.pointsAwarded, 100);

      // Verify state reflects change
      const stateRes = await fetch(`${baseUrl}/api/scenario`);
      const stateJson = await stateRes.json();
      assert.equal(stateJson.completedQuests, 1);
    });

    await t.test("POST /api/traffic/simulate emits network event", async () => {
      const res = await fetch(`${baseUrl}/api/traffic/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: 80, details: "HTTP scan test" }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.event.port, 80);
    });

    await t.test("GET / renders portal HTML with role cards", async () => {
      const res = await fetch(`${baseUrl}/`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /메타스플로잇 3장 인텔리전스 수집/);
      assert.match(html, /공격자 \(Attacker\)/);
      assert.match(html, /방어자 \(Defender\)/);
      assert.match(html, new RegExp(`0\\.0\\.0\\.0:${actualPort}`));
    });

    await t.test("WebSocket /ws/events live streaming test", async () => {
      const client = new net.Socket();
      await new Promise<void>((resolve) => client.connect(actualPort, "127.0.0.1", resolve));

      const secKey = crypto.randomBytes(16).toString("base64");
      const handshake = [
        "GET /ws/events HTTP/1.1",
        `Host: 127.0.0.1:${actualPort}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${secKey}`,
        "Sec-WebSocket-Version: 13",
        "\r\n",
      ].join("\r\n");

      client.write(handshake);

      const snapshotReceived = await new Promise<boolean>((resolve) => {
        let buffer = Buffer.alloc(0);
        const timer = setTimeout(() => resolve(false), 1000);
        client.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          const str = buffer.toString("utf-8");
          if (str.includes("HTTP/1.1 101 Switching Protocols") && str.includes("history_snapshot")) {
            clearTimeout(timer);
            resolve(true);
          }
        });
      });

      assert.equal(snapshotReceived, true, "WebSocket handshake and history snapshot received");
      client.destroy();
    });

    await t.test("WebSocket /ws/terminal/attacker interactive test", async () => {
      const client = new net.Socket();
      await new Promise<void>((resolve) => client.connect(actualPort, "127.0.0.1", resolve));

      const secKey = crypto.randomBytes(16).toString("base64");
      const handshake = [
        "GET /ws/terminal/attacker?mock=true HTTP/1.1",
        `Host: 127.0.0.1:${actualPort}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${secKey}`,
        "Sec-WebSocket-Version: 13",
        "\r\n",
      ].join("\r\n");

      client.write(handshake);

      const bannerReceived = await new Promise<boolean>((resolve) => {
        let buffer = Buffer.alloc(0);
        const timer = setTimeout(() => resolve(false), 2000);
        client.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          const str = buffer.toString("utf-8");
          if (str.includes("Kali") || str.includes("kalibox")) {
            clearTimeout(timer);
            resolve(true);
          }
        });
      });

      assert.equal(bannerReceived, true, "Received Kali terminal banner over WebSocket");
      client.destroy();
    });
  } finally {
    await app.close();
  }
});
