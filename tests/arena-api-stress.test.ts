// tests/arena-api-stress.test.ts — High-Concurrency Stress & Safety Verification for CTF Arena & Tutorial APIs
//
// Conforms to:
//   - Target: HTTP REST API & WebSocket endpoints (server/index.ts)
//   - Feature: CTF Arena and Tutorial API reliability verification:
//       1. GET /api/arena/probe?ip=...&service=... (200 nodes parallel probing: whois, dns-axfr, nmap, mssql, s3)
//       2. POST /api/arena/evaluate (multi-player concurrent command evaluation & first-blood contention)
//       3. GET /api/health, GET /api/lan, POST /api/scenario/flag (quest progression & status)
//       4. Invalid parameters safety (missing IP, unknown service, empty body -> 400/404 without crash)

import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { createGatewayServer, type GatewayApp } from "../server/index.ts";

describe("CTF Arena & Tutorial API Stress & Safety Test Suite", () => {
  let app: GatewayApp;
  let port: number;
  let baseUrl: string;

  before(async () => {
    app = createGatewayServer(0, "127.0.0.1", 0);
    port = await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${port}`;
    app.arenaManager.startMatch();
  });

  after(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. GET /api/arena/probe: 200 Virtual Nodes Async Parallel Probing Stress
  // =========================================================================
  describe("1. GET /api/arena/probe — 200 Virtual Nodes Parallel Probing Stress", () => {
    it("probes all 200 nodes in parallel with 'whois' service", async () => {
      const probePromises = [];
      for (let i = 1; i <= 200; i++) {
        const ip = `10.10.1.${i}`;
        probePromises.push(
          fetch(`${baseUrl}/api/arena/probe?ip=${ip}&service=whois`).then(async (res) => {
            assert.equal(res.status, 200, `Node ${ip} whois probe should return 200`);
            return res.json();
          })
        );
      }

      const results = await Promise.all(probePromises);
      assert.equal(results.length, 200);

      const vulnerableNodes = results.filter((r) => r.vulnerable);
      assert.equal(vulnerableNodes.length, 10, "Exactly 10 nodes must be vulnerable to whois recon");

      for (const vuln of vulnerableNodes) {
        assert.equal(vuln.service, "whois");
        assert.equal(vuln.adminEmail, "admin@mega-infra.net");
        assert.ok(vuln.flag && vuln.flag.includes("WHOIS"));
      }
    });

    it("probes all 200 nodes in parallel with 'dns-axfr' service", async () => {
      const probePromises = [];
      for (let i = 1; i <= 200; i++) {
        const ip = `10.10.1.${i}`;
        probePromises.push(
          fetch(`${baseUrl}/api/arena/probe?ip=${ip}&service=dns-axfr`).then(async (res) => {
            assert.equal(res.status, 200, `Node ${ip} dns-axfr probe should return 200`);
            return res.json();
          })
        );
      }

      const results = await Promise.all(probePromises);
      assert.equal(results.length, 200);

      const vulnerableNodes = results.filter((r) => r.vulnerable);
      assert.equal(vulnerableNodes.length, 10, "Exactly 10 nodes must be vulnerable to DNS AXFR");

      for (const vuln of vulnerableNodes) {
        assert.equal(vuln.service, "dns-axfr");
        assert.ok(vuln.flag && vuln.flag.includes("DNS_AXFR"));
      }
    });

    it("probes all 200 nodes in parallel with 'nmap' service", async () => {
      const probePromises = [];
      for (let i = 1; i <= 200; i++) {
        const ip = `10.10.1.${i}`;
        probePromises.push(
          fetch(`${baseUrl}/api/arena/probe?ip=${ip}&service=nmap&port=80`).then(async (res) => {
            assert.equal(res.status, 200, `Node ${ip} nmap probe should return 200`);
            return res.json();
          })
        );
      }

      const results = await Promise.all(probePromises);
      assert.equal(results.length, 200);

      for (const r of results) {
        assert.equal(r.service, "nmap");
        assert.equal(typeof r.open, "boolean");
        assert.equal(typeof r.vulnerable, "boolean");
      }
    });

    it("probes all 200 nodes in parallel with 'mssql' service", async () => {
      const probePromises = [];
      for (let i = 1; i <= 200; i++) {
        const ip = `10.10.1.${i}`;
        probePromises.push(
          fetch(`${baseUrl}/api/arena/probe?ip=${ip}&service=mssql&user=sa&pass=Password123!`).then(async (res) => {
            assert.equal(res.status, 200, `Node ${ip} mssql probe should return 200`);
            return res.json();
          })
        );
      }

      const results = await Promise.all(probePromises);
      assert.equal(results.length, 200);

      const vulnerableNodes = results.filter((r) => r.vulnerable);
      assert.equal(vulnerableNodes.length, 10, "Exactly 10 nodes must be vulnerable to MSSQL default login");

      for (const vuln of vulnerableNodes) {
        assert.equal(vuln.service, "mssql");
        assert.ok(vuln.flag && vuln.flag.includes("MSSQL"));
      }
    });

    it("probes all 200 nodes in parallel with 's3' service", async () => {
      const probePromises = [];
      for (let i = 1; i <= 200; i++) {
        const ip = `10.10.1.${i}`;
        probePromises.push(
          fetch(`${baseUrl}/api/arena/probe?ip=${ip}&service=s3&bucket=config.env`).then(async (res) => {
            assert.equal(res.status, 200, `Node ${ip} s3 probe should return 200`);
            return res.json();
          })
        );
      }

      const results = await Promise.all(probePromises);
      assert.equal(results.length, 200);

      const vulnerableNodes = results.filter((r) => r.vulnerable);
      assert.equal(vulnerableNodes.length, 10, "Exactly 10 nodes must be vulnerable to public S3 leak");

      for (const vuln of vulnerableNodes) {
        assert.equal(vuln.service, "s3");
        assert.ok(vuln.flag && vuln.flag.includes("S3_BUCKET"));
      }
    });

    it("handles mixed parallel multi-service stress load across random nodes", async () => {
      const services = ["whois", "dns-axfr", "nmap", "mssql", "s3"];
      const mixedRequests = [];

      for (let i = 0; i < 100; i++) {
        const nodeIndex = (i % 200) + 1;
        const service = services[i % services.length];
        const ip = `10.10.1.${nodeIndex}`;

        mixedRequests.push(
          fetch(`${baseUrl}/api/arena/probe?ip=${ip}&service=${service}`).then(async (res) => {
            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.ip, ip);
            return data;
          })
        );
      }

      const outcomes = await Promise.all(mixedRequests);
      assert.equal(outcomes.length, 100);
    });
  });

  // =========================================================================
  // 2. POST /api/arena/evaluate: Multi-Player Concurrent Command Evaluation
  // =========================================================================
  describe("2. POST /api/arena/evaluate — Multi-Player Concurrent Evaluation", () => {
    it("handles simultaneous evaluation requests from multiple registered players", async () => {
      // Register 5 players
      const players = [];
      for (let i = 1; i <= 5; i++) {
        const joinRes = await fetch(`${baseUrl}/api/arena/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nickname: `Player_Stress_${i}`,
            avatar: `avatar-${i}`,
            clientIp: `192.168.1.${100 + i}`,
          }),
        });
        assert.equal(joinRes.status, 200);
        const joinData = await joinRes.json();
        players.push(joinData.player);
      }

      assert.equal(players.length, 5);

      // Target different vulnerable nodes
      const vulnWhois = app.mockMesh.getVulnerableNodesByCategory("whois")[0];
      const vulnAxfr = app.mockMesh.getVulnerableNodesByCategory("dns-axfr")[0];
      const vulnMssql = app.mockMesh.getVulnerableNodesByCategory("mssql")[0];
      const vulnS3 = app.mockMesh.getVulnerableNodesByCategory("s3-bucket")[0];
      const vulnLegacy = app.mockMesh.getVulnerableNodesByCategory("legacy-service")[0];

      // Dispatch 5 concurrent evaluations
      const evalPromises = [
        fetch(`${baseUrl}/api/arena/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: players[0].id,
            command: `whois -h ${vulnWhois.ip} megacorp.internal`,
            stdout: `Admin Email: admin@mega-infra.net\nCIDR: 10.10.1.0/24`,
          }),
        }),
        fetch(`${baseUrl}/api/arena/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: players[1].id,
            command: `dig axfr @${vulnAxfr.ip} megacorp.internal`,
            stdout: `mega-infra.net. IN AXFR ... dev.mega-infra.net.`,
          }),
        }),
        fetch(`${baseUrl}/api/arena/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: players[2].id,
            command: `sqsh -S ${vulnMssql.ip} -U sa -P Password123!`,
            stdout: `1> SELECT @@version\nMicrosoft SQL Server Login Success`,
          }),
        }),
        fetch(`${baseUrl}/api/arena/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: players[3].id,
            command: `curl -s http://${vulnS3.ip}:9000/config.env`,
            stdout: `DATABASE_URL=postgres://app:sec@${vulnS3.ip}:5432/megacorp`,
          }),
        }),
        fetch(`${baseUrl}/api/arena/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: players[4].id,
            command: `nc -vn ${vulnLegacy.ip} 21`,
            stdout: `220 (vsftpd 2.3.4 - vsFTPd backdoor)\nuid=0(root) gid=0(root)`,
          }),
        }),
      ];

      const responses = await Promise.all(evalPromises);
      for (const res of responses) {
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.ok(data.pointsAwarded > 0);
      }

      // Verify arena leaderboard state
      const stateRes = await fetch(`${baseUrl}/api/arena/state`);
      assert.equal(stateRes.status, 200);
      const state = await stateRes.json();
      assert.ok(state.leaderboard.length >= 5);

      for (let i = 0; i < 5; i++) {
        const ranked = state.leaderboard.find((p: any) => p.playerId === players[i].id);
        assert.ok(ranked, `Player ${players[i].nickname} must be in leaderboard`);
        assert.ok(ranked.score > 0, `Player ${players[i].nickname} score must be > 0`);
      }
    });

    it("resolves first-blood contention correctly under simultaneous attack on the same node", async () => {
      // Pick an uncompromised vulnerable whois node
      const vulnWhois = app.mockMesh.getVulnerableNodesByCategory("whois")[1];

      // Register two new competing players
      const join1 = await fetch(`${baseUrl}/api/arena/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: "Racer_One", clientIp: "192.168.1.201" }),
      });
      const p1 = (await join1.json()).player;

      const join2 = await fetch(`${baseUrl}/api/arena/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: "Racer_Two", clientIp: "192.168.1.202" }),
      });
      const p2 = (await join2.json()).player;

      // Simultaneous exploit of the exact same target node
      const req1 = fetch(`${baseUrl}/api/arena/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: p1.id,
          command: `whois -h ${vulnWhois.ip} megacorp.internal`,
          stdout: `Admin Email: admin@mega-infra.net`,
        }),
      });

      const req2 = fetch(`${baseUrl}/api/arena/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: p2.id,
          command: `whois -h ${vulnWhois.ip} megacorp.internal`,
          stdout: `Admin Email: admin@mega-infra.net`,
        }),
      });

      const [res1, res2] = await Promise.all([req1, req2]);
      assert.equal(res1.status, 200);
      assert.equal(res2.status, 200);

      const out1 = await res1.json();
      const out2 = await res2.json();

      assert.equal(out1.success, true);
      assert.equal(out2.success, true);

      // Exactly one player MUST receive First Blood
      const firstBloods = [out1.isFirstBlood, out2.isFirstBlood].filter(Boolean);
      assert.equal(firstBloods.length, 1, "Exactly one player must get First Blood bonus");

      // The first blood winner got 50 bonus points
      const fbPoints = out1.isFirstBlood ? out1.pointsAwarded : out2.pointsAwarded;
      const normalPoints = out1.isFirstBlood ? out2.pointsAwarded : out1.pointsAwarded;
      assert.equal(fbPoints, normalPoints + 50);
    });
  });

  // =========================================================================
  // 3. GET /api/health, GET /api/lan, POST /api/scenario/flag
  // =========================================================================
  describe("3. Core Tutorial & Infrastructure Endpoints", () => {
    it("GET /api/health responds with 200 and system health snapshot under load", async () => {
      const healthPromises = [];
      for (let i = 0; i < 20; i++) {
        healthPromises.push(
          fetch(`${baseUrl}/api/health`).then(async (res) => {
            assert.equal(res.status, 200);
            return res.json();
          })
        );
      }

      const results = await Promise.all(healthPromises);
      assert.equal(results.length, 20);
      for (const data of results) {
        assert.equal(data.status, "ok");
        assert.equal(typeof data.uptime, "number");
        assert.ok(data.timestamp);
        assert.ok(data.lan);
      }
    });

    it("GET /api/lan responds with 200 and LAN configuration summary", async () => {
      const res = await fetch(`${baseUrl}/api/lan`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.hostIp);
      assert.ok(data.port);
      assert.ok(data.urls.attacker);
      assert.ok(data.urls.defender);
      assert.ok(data.urls.observer);
    });

    it("POST /api/scenario/flag validates correct, incorrect, and duplicate flags", async () => {
      // Reset scenario first to ensure clean state
      await fetch(`${baseUrl}/api/scenario/reset`, { method: "POST" });

      // 1. Submit correct flag for Quest 1
      const res1 = await fetch(`${baseUrl}/api/scenario/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag: "FLAG{whois_recon_success}", role: "attacker" }),
      });
      assert.equal(res1.status, 200);
      const data1 = await res1.json();
      assert.equal(data1.success, true);
      assert.equal(data1.pointsAwarded, 100);

      // Verify scenario state unlocked next quest
      const stateRes = await fetch(`${baseUrl}/api/scenario`);
      const state = await stateRes.json();
      assert.equal(state.completedQuests, 1);
      assert.equal(state.scores.attacker, 100);
      assert.equal(state.quests[0].status, "completed");
      assert.equal(state.quests[1].status, "active");

      // 2. Duplicate submission of already completed flag returns 400
      const resDup = await fetch(`${baseUrl}/api/scenario/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag: "FLAG{whois_recon_success}", role: "attacker" }),
      });
      assert.equal(resDup.status, 400);
      const dataDup = await resDup.json();
      assert.equal(dataDup.success, false);

      // 3. Invalid flag submission returns 400
      const resInvalid = await fetch(`${baseUrl}/api/scenario/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag: "FLAG{completely_wrong_flag}", role: "attacker" }),
      });
      assert.equal(resInvalid.status, 400);
      const dataInvalid = await resInvalid.json();
      assert.equal(dataInvalid.success, false);
    });
  });

  // =========================================================================
  // 4. Invalid Parameters Safety & Error Handling (400/404 Safe Returns)
  // =========================================================================
  describe("4. Invalid Parameters Safety & Anti-Crash Verification", () => {
    it("returns 404 for non-existent host IP in probe request", async () => {
      const nonExistentIps = [
        "999.999.999.999",
        "10.99.99.99",
        "192.168.254.254",
        "10.10.1.201",
      ];

      for (const ip of nonExistentIps) {
        const res = await fetch(`${baseUrl}/api/arena/probe?ip=${ip}&service=whois`);
        assert.equal(res.status, 404, `Querying non-existent IP ${ip} must return 404`);
        const data = await res.json();
        assert.equal(data.error, "Host unreachable");
        assert.equal(data.ip, ip);
      }
    });

    it("returns 400 for missing or empty IP in probe request", async () => {
      const badUrls = [
        `${baseUrl}/api/arena/probe`,
        `${baseUrl}/api/arena/probe?ip=`,
        `${baseUrl}/api/arena/probe?service=whois`,
      ];

      for (const url of badUrls) {
        const res = await fetch(url);
        assert.equal(res.status, 400, `URL ${url} missing IP must return 400`);
        const data = await res.json();
        assert.ok(data.error);
      }
    });

    it("returns 400 for unknown service in probe request", async () => {
      const unknownServices = [
        "telnet",
        "unknown_service_xyz",
        "exploit_kit",
        "random_param",
      ];

      for (const svc of unknownServices) {
        const res = await fetch(`${baseUrl}/api/arena/probe?ip=10.10.1.1&service=${svc}`);
        assert.equal(res.status, 400, `Unknown service ${svc} must return 400`);
        const data = await res.json();
        assert.equal(data.error, "Unknown service");
        assert.equal(data.service, svc);
      }
    });

    it("returns 400 for empty or invalid body in POST /api/scenario/flag", async () => {
      // 1. Completely empty body
      const resEmpty = await fetch(`${baseUrl}/api/scenario/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
      });
      assert.equal(resEmpty.status, 400);

      // 2. Empty JSON object {}
      const resObj = await fetch(`${baseUrl}/api/scenario/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(resObj.status, 400);

      // 3. Empty flag string
      const resBlank = await fetch(`${baseUrl}/api/scenario/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag: "   " }),
      });
      assert.equal(resBlank.status, 400);
    });

    it("returns 400 for empty or invalid body in POST /api/arena/evaluate", async () => {
      // 1. Completely empty body
      const resEmpty = await fetch(`${baseUrl}/api/arena/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
      });
      assert.equal(resEmpty.status, 400);

      // 2. Empty JSON object {}
      const resObj = await fetch(`${baseUrl}/api/arena/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(resObj.status, 400);

      // 3. Body with playerId but empty command
      const resNoCmd = await fetch(`${baseUrl}/api/arena/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: "some_player", command: "  " }),
      });
      assert.equal(resNoCmd.status, 400);
    });

    it("returns 400 for empty or invalid body in POST /api/arena/join", async () => {
      // 1. Empty body
      const resEmpty = await fetch(`${baseUrl}/api/arena/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
      });
      assert.equal(resEmpty.status, 400);

      // 2. Empty nickname
      const resBlankNick = await fetch(`${baseUrl}/api/arena/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: "" }),
      });
      assert.equal(resBlankNick.status, 400);
    });

    it("maintains server integrity and responsiveness after all error injections", async () => {
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);
      const health = await healthRes.json();
      assert.equal(health.status, "ok");
    });
  });
});
