// tests/arena-e2e-integration.test.ts — Comprehensive End-to-End Integration Suite for CTF Arena Gateway.
//
// Conforms to:
//   - Step 4 of internet-ctf-competition-arena.plan.md
//   - Verifies AC-1 & AC-2:
//     * HTTP /arena routing and /api/arena REST endpoints
//     * WebSocket /ws/arena real-time state broadcast and command evaluation
//     * Multi-user join, start match, automated scoring, and attack trace timeline

import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";

import { createGatewayServer, type GatewayApp } from "../server/index.ts";

describe("Step 4: CTF Competition Arena Gateway Integration", () => {
  let app: GatewayApp;
  let port: number;
  let baseUrl: string;

  before(async () => {
    app = createGatewayServer(0, "127.0.0.1");
    port = await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await app.close();
  });

  it("AC-1: GET /arena serves the CTF Arena client SPA HTML", async () => {
    const res = await fetch(`${baseUrl}/arena`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("<!DOCTYPE html>"));
    assert.ok(text.includes("메타스플로잇"));
    assert.ok(text.includes("CTF"));
  });

  it("AC-1: GET /api/arena/state returns initial arena state and 200 nodes spec", async () => {
    const res = await fetch(`${baseUrl}/api/arena/state`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.lobbyState, "waiting");
    assert.equal(data.duration, 900);
    assert.equal(data.timeRemaining, 900);
    assert.equal(data.totalNodes, 200);
    assert.equal(data.vulnerableCount, 60);
    assert.ok(Array.isArray(data.players));
    assert.ok(Array.isArray(data.leaderboard));
    assert.ok(typeof data.nodeStates === "object");
  });

  it("AC-1: GET /api/arena/nodes returns 200 virtual nodes and supports category filtering", async () => {
    // All 200 nodes
    const resAll = await fetch(`${baseUrl}/api/arena/nodes`);
    assert.equal(resAll.status, 200);
    const allNodes = await resAll.json();
    assert.equal(allNodes.length, 200);

    // Filter by DNS AXFR (exactly 10 nodes)
    const resDns = await fetch(`${baseUrl}/api/arena/nodes?category=dns-axfr`);
    assert.equal(resDns.status, 200);
    const dnsNodes = await resDns.json();
    assert.equal(dnsNodes.length, 10);
  });

  it("AC-1: POST /api/arena/join registers participants with nickname, IP, and avatar", async () => {
    const res = await fetch(`${baseUrl}/api/arena/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "AlphaHacker",
        avatar: "fi-rr-skull",
        clientIp: "192.168.1.55",
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.player.nickname, "AlphaHacker");
    assert.equal(data.player.avatar, "fi-rr-skull");
    assert.equal(data.player.clientIp, "192.168.1.55");
  });

  it("AC-1: POST /api/arena/start begins match and transitions state to active", async () => {
    const res = await fetch(`${baseUrl}/api/arena/start`, { method: "POST" });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.state, "active");
  });

  it("AC-2: POST /api/arena/evaluate automatically evaluates terminal attacks and awards points", async () => {
    // Retrieve registered player
    const stateRes = await fetch(`${baseUrl}/api/arena/state`);
    const state = await stateRes.json();
    const player = state.players.find((p: any) => p.nickname === "AlphaHacker");
    assert.ok(player, "AlphaHacker must be registered");

    // Target a vulnerable whois node
    const vulnWhois = app.mockMesh.getVulnerableNodesByCategory("whois")[0];
    assert.ok(vulnWhois, "Vulnerable whois node must exist");

    // Simulate attacker terminal running whois query against the target IP
    const command = `whois -h ${vulnWhois.ip} megacorp.internal`;
    const evalRes = await fetch(`${baseUrl}/api/arena/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: player.id,
        command,
        stdout: `Admin Email: admin@mega-infra.net\nNotice: Internal IP CIDR leaked in WHOIS!`,
      }),
    });

    assert.equal(evalRes.status, 200);
    const outcome = await evalRes.json();

    assert.equal(outcome.success, true);
    assert.equal(outcome.targetIp, vulnWhois.ip);
    assert.equal(outcome.isFirstBlood, true);
    assert.equal(outcome.pointsAwarded, 100); // 50 base + 50 FB
    assert.ok(outcome.event);
    assert.equal(outcome.event.nickname, "AlphaHacker");
    assert.equal(outcome.event.category, "whois");

    // Check leaderboard updated
    const updatedStateRes = await fetch(`${baseUrl}/api/arena/state`);
    const updatedState = await updatedStateRes.json();
    const topPlayer = updatedState.leaderboard[0];
    assert.equal(topPlayer.nickname, "AlphaHacker");
    assert.equal(topPlayer.score, 100);
    assert.equal(topPlayer.compromisedCount, 1);
    assert.equal(topPlayer.firstBloodCount, 1);
  });

  it("AC-1: WebSocket /ws/arena connects, receives init packet, and processes real-time events", async () => {
    await new Promise<void>((resolve, reject) => {
      const key = crypto.randomBytes(16).toString("base64");
      const client = net.createConnection({ host: "127.0.0.1", port }, () => {
        client.write(
          `GET /ws/arena HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${port}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n\r\n`
        );
      });

      let receivedHandshake = false;
      let buffer = Buffer.alloc(0);

      client.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (!receivedHandshake) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd !== -1) {
            const headers = buffer.slice(0, headerEnd).toString("utf-8");
            assert.ok(headers.includes("101 Switching Protocols"));
            assert.ok(headers.includes("Upgrade: websocket"));
            receivedHandshake = true;
            buffer = buffer.slice(headerEnd + 4);
          }
        }

        // Parse WebSocket frame if received
        if (receivedHandshake && buffer.length >= 2) {
          const len = buffer[1] & 0x7f;
          let offset = 2;
          let payloadLen = len;
          if (len === 126) {
            payloadLen = buffer.readUInt16BE(2);
            offset = 4;
          }

          if (buffer.length >= offset + payloadLen) {
            const payload = buffer.slice(offset, offset + payloadLen).toString("utf-8");
            try {
              const msg = JSON.parse(payload);
              assert.equal(msg.type, "init");
              assert.ok(msg.state);
              assert.equal(msg.state.lobbyState, "active");
              client.destroy();
              resolve();
            } catch (err) {
              client.destroy();
              reject(err);
            }
          }
        }
      });

      client.on("error", (err) => {
        reject(err);
      });
    });
  });

  it("AC-1: POST /api/arena/reset restores match to waiting state", async () => {
    const res = await fetch(`${baseUrl}/api/arena/reset`, { method: "POST" });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.state, "waiting");

    const stateRes = await fetch(`${baseUrl}/api/arena/state`);
    const state = await stateRes.json();
    assert.equal(state.lobbyState, "waiting");
    assert.equal(state.leaderboard[0]?.score ?? 0, 0);
  });
});
