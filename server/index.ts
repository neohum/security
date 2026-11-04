import http, { type IncomingMessage, type ServerResponse } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { EventEmitter } from "node:events";

import { LanManager, type Role } from "./lan-manager.ts";
import { PtyManager, type ISocket } from "./pty-manager.ts";
import { TrafficMonitor } from "./traffic-monitor.ts";
import { ScenarioState } from "./scenario-state.ts";
import { getAllMissions, getMissionById, evaluateFlag, evaluateCommand, evaluateSubmission } from "./mission-evaluator.ts";
import { evaluateTutorialQuest, evaluateAdvancedCommand } from "./scenario-missions.ts";
import { MockInternetMesh } from "./mock-internet-mesh.ts";
import { ArenaManager } from "./arena-manager.ts";
import { ArenaSshServer } from "./arena-ssh-server.ts";
import { ArenaScriptRunner } from "./arena-script-runner.ts";

/**
 * Minimal RFC 6455 WebSocket implementation on top of node:net.Socket.
 * Zero external dependencies, 100% compatible with browser WebSocket & Node WebSocket clients.
 */
export class NativeWebSocket extends EventEmitter implements ISocket {
  public socket: any;
  public readyState = 1; // 1 = OPEN
  private buffer = Buffer.alloc(0);

  constructor(socket: any) {
    super();
    this.socket = socket;

    // Suppress default unhandled exception crashes on ECONNRESET / EPIPE
    this.on("error", () => {});

    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.parseFrames();
    });

    socket.on("close", () => {
      this.readyState = 3; // CLOSED
      this.emit("close");
    });

    socket.on("error", (err: Error) => {
      this.readyState = 3;
      try {
        socket.destroy();
      } catch {}
      this.emit("close");
    });
  }

  public send(data: string | Uint8Array): void {
    if (this.readyState !== 1 || this.socket.destroyed) return;

    const payload = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
    const length = payload.length;

    let header: Buffer;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + text opcode
      header[1] = length; // Unmasked (server-to-client frames must NOT be masked)
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.close();
    }
  }

  public close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 2; // CLOSING

    const reasonBuf = Buffer.from(reason, "utf-8");
    const frame = Buffer.alloc(4 + reasonBuf.length);
    frame[0] = 0x88; // Close frame
    frame[1] = 2 + reasonBuf.length;
    frame.writeUInt16BE(code, 2);
    reasonBuf.copy(frame, 4);

    try {
      this.socket.write(frame);
      this.socket.end();
    } catch {
      // Ignore
    } finally {
      this.readyState = 3;
    }
  }

  private parseFrames(): void {
    while (this.buffer.length >= 2) {
      const byte0 = this.buffer[0];
      const byte1 = this.buffer[1];

      const opcode = byte0 & 0x0f;
      const isMasked = (byte1 & 0x80) !== 0;
      let payloadLen = byte1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskKeyLen = isMasked ? 4 : 0;
      const totalLen = offset + maskKeyLen + payloadLen;

      if (this.buffer.length < totalLen) {
        return; // Wait for more data
      }

      let maskKey: Buffer | null = null;
      if (isMasked) {
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLen));
      this.buffer = this.buffer.subarray(totalLen);

      // Unmask client payload
      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x8) {
        // Close frame
        this.close();
        return;
      } else if (opcode === 0x9) {
        // Ping -> respond with Pong
        const pong = Buffer.alloc(2 + payload.length);
        pong[0] = 0x8a;
        pong[1] = payload.length;
        payload.copy(pong, 2);
        this.socket.write(pong);
      } else if (opcode === 0x1) {
        // Text frame
        const text = payload.toString("utf-8");
        this.emit("message", text);
      } else if (opcode === 0x2) {
        // Binary frame
        this.emit("message", payload);
      }
    }
  }
}

/**
 * Perform RFC 6455 handshake on HTTP upgrade.
 */
export function handleUpgradeHandshake(req: IncomingMessage, socket: any): NativeWebSocket | null {
  const key = req.headers["sec-websocket-key"];
  if (!key || typeof key !== "string") {
    socket.destroy();
    return null;
  }

  const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");

  const responseHeaders = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n",
  ].join("\r\n");

  socket.write(responseHeaders);
  return new NativeWebSocket(socket);
}

/**
 * Express-compatible mini HTTP application with JSON routing and static file serving.
 */
export class GatewayApp {
  public lanManager: LanManager;
  public ptyManager: PtyManager;
  public trafficMonitor: TrafficMonitor;
  public scenarioState: ScenarioState;
  public mockMesh: MockInternetMesh;
  public arenaManager: ArenaManager;
  public scriptRunner: ArenaScriptRunner;
  public sshServer: ArenaSshServer;
  public server: http.Server;
  private routes: Array<{ method: string; path: RegExp; handler: Function }> = [];
  private openSockets = new Set<net.Socket>();
  private arenaSockets = new Set<NativeWebSocket>();

  constructor(options?: { port?: number; hostIp?: string; sshPort?: number }) {
    this.lanManager = new LanManager({ port: options?.port, hostIp: options?.hostIp, sshPort: options?.sshPort });
    this.ptyManager = new PtyManager();
    this.trafficMonitor = new TrafficMonitor();
    this.scenarioState = new ScenarioState();
    this.mockMesh = new MockInternetMesh();
    this.arenaManager = new ArenaManager(this.mockMesh);
    this.scriptRunner = new ArenaScriptRunner(this.mockMesh, this.arenaManager);
    this.sshServer = new ArenaSshServer({
      port: options?.sshPort || this.lanManager.sshPort || 2222,
      host: options?.hostIp || "0.0.0.0",
      arenaManager: this.arenaManager,
      mockMesh: this.mockMesh,
      lanManager: this.lanManager,
    });

    this.server = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.server.on("connection", (sock: net.Socket) => {
      this.openSockets.add(sock);
      sock.on("close", () => this.openSockets.delete(sock));
    });
    this.setupArenaEvents();
    this.bindWebSocketUpgrades();
    this.setupRoutes();
  }

  private broadcastArena(payload: any) {
    const msg = JSON.stringify(payload);
    for (const ws of this.arenaSockets) {
      if (ws.readyState === 1) {
        ws.send(msg);
      }
    }
  }

  private setupArenaEvents() {
    this.arenaManager.on("player:joined", (player) => {
      this.broadcastArena({
        type: "player:joined",
        player,
        players: this.arenaManager.getPlayers(),
      });
    });

    this.arenaManager.on("match:started", () => {
      this.broadcastArena({
        type: "match:started",
        remainingSeconds: this.arenaManager.getTimeRemaining(),
        duration: this.arenaManager.getDuration(),
      });
    });

    this.arenaManager.on("match:tick", (remainingSeconds) => {
      this.broadcastArena({
        type: "match:tick",
        remainingSeconds,
      });
    });

    this.arenaManager.on("match:finished", (data) => {
      this.broadcastArena({
        type: "match:finished",
        leaderboard: data.leaderboard,
        finalTrace: data.finalTrace,
        hallOfFame: data.hallOfFame,
      });
    });

    this.arenaManager.on("attack:compromised", (event) => {
      this.broadcastArena({
        type: "attack:compromised",
        event,
        leaderboard: this.arenaManager.getLeaderboard(),
        nodeStates: this.arenaManager.getNodeStateMap(),
      });
    });

    this.arenaManager.on("node:updated", (data) => {
      this.broadcastArena({
        type: "node:updated",
        ip: data.ip,
        nodeState: data.nodeState,
      });
    });

    this.arenaManager.on("match:reset", () => {
      this.broadcastArena({
        type: "match:reset",
        state: this.arenaManager.getLobbyState(),
        remainingSeconds: this.arenaManager.getDuration(),
      });
    });
  }

  public get(pathPattern: string, handler: (req: any, res: any) => void) {
    this.registerRoute("GET", pathPattern, handler);
  }

  public post(pathPattern: string, handler: (req: any, res: any) => void) {
    this.registerRoute("POST", pathPattern, handler);
  }

  private registerRoute(method: string, pathPattern: string, handler: Function) {
    const escaped = pathPattern.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`^${escaped}$`, "i");
    this.routes.push({ method, path: regex, handler });
  }

  private setupRoutes() {
    // API: Health check
    this.get("/api/health", (_req, res) => {
      res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        lan: this.lanManager.getSummary(),
      });
    });

    // API: LAN status and access URLs
    this.get("/api/lan", (_req, res) => {
      res.json(this.lanManager.getSummary());
    });

    // API: Scenario state
    this.get("/api/scenario", (_req, res) => {
      res.json(this.scenarioState.getState());
    });

    // API: Chapter 3 Missions
    this.get("/api/missions", (_req, res) => {
      try {
        res.json(getAllMissions());
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // API: Evaluate mission flag or command
    this.post("/api/missions/evaluate", (req, res) => {
      const body = req.body;
      if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
        res.status(400).json({ error: "Missing or empty request body" });
        return;
      }
      const { missionId, flag, command, stdout } = body;
      if (missionId && (flag || command)) {
        let result = evaluateSubmission(missionId, flag || command);
        if (!result.matched) {
          result = evaluateTutorialQuest(missionId, flag || command, stdout);
        }
        res.json(result);
      } else if (flag) {
        const result = evaluateFlag(flag);
        res.json(result);
      } else if (command) {
        let results = evaluateCommand(command, stdout);
        if (results.length === 0) {
          results = evaluateAdvancedCommand(command, stdout);
        }
        res.json(results);
      } else {
        res.status(400).json({ error: "Missing missionId, flag, or command" });
      }
    });

    // API: Evaluate scenario command or terminal output
    this.post("/api/scenario/evaluate", (req, res) => {
      const body = req.body || {};
      const { command, stdout, role = "attacker" } = body;
      if (!command && !stdout) {
        res.status(400).json({ error: "Missing command or stdout in request body" });
        return;
      }
      const outcome = this.scenarioState.evaluateCommand(command || "", stdout || "", role as Role);
      res.json(outcome);
    });

    // API: Submit flag
    this.post("/api/scenario/flag", (req, res) => {
      const body = req.body;
      if (!body || typeof body !== "object" || Object.keys(body).length === 0 || !body.flag || typeof body.flag !== "string" || !body.flag.trim()) {
        res.status(400).json({ success: false, error: "Missing or invalid flag in request body", message: "플래그가 비어있습니다.", pointsAwarded: 0 });
        return;
      }
      const { flag, role = "attacker" } = body;
      const result = this.scenarioState.submitFlag(flag, role as Role);
      res.status(result.success ? 200 : 400).json(result);
    });

    // API: Reset scenario
    this.post("/api/scenario/reset", (_req, res) => {
      this.scenarioState.resetState();
      res.json({ success: true, message: "시나리오가 초기화되었습니다." });
    });

    // API: Traffic history
    this.get("/api/traffic/events", (req, res) => {
      const limit = Number(req.query.limit) || 100;
      res.json(this.trafficMonitor.getHistory(limit));
    });

    // API: Simulate scan event
    this.post("/api/traffic/simulate", (req, res) => {
      const event = this.trafficMonitor.emitSimulatedScan(req.body);
      res.json({ success: true, event });
    });

    // API: Arena state
    this.get("/api/arena/state", (_req, res) => {
      res.json({
        lobbyState: this.arenaManager.getLobbyState(),
        duration: this.arenaManager.getDuration(),
        timeRemaining: this.arenaManager.getTimeRemaining(),
        players: this.arenaManager.getPlayers(),
        leaderboard: this.arenaManager.getLeaderboard(),
        recentAttacks: this.arenaManager.getRecentAttackTraces(25),
        nodeStates: this.arenaManager.getNodeStateMap(),
        vulnerableCount: this.mockMesh.getVulnerableNodes().length,
        totalNodes: this.mockMesh.getAllNodes().length,
        hallOfFame: this.arenaManager.getHallOfFame(),
      });
    });

    // API: Arena join
    this.post("/api/arena/join", (req, res) => {
      const body = req.body;
      if (!body || typeof body !== "object" || Object.keys(body).length === 0 || !body.nickname || typeof body.nickname !== "string" || !body.nickname.trim()) {
        res.status(400).json({ error: "Nickname is required" });
        return;
      }
      try {
        const player = this.arenaManager.registerPlayer(body);
        res.json({ success: true, player });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // API: Arena start
    this.post("/api/arena/start", (_req, res) => {
      try {
        this.arenaManager.startMatch();
        res.json({ success: true, state: this.arenaManager.getLobbyState() });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // API: Arena reset
    this.post("/api/arena/reset", (_req, res) => {
      this.arenaManager.resetMatch();
      res.json({ success: true, state: this.arenaManager.getLobbyState() });
    });

    // API: Arena evaluate command/output
    this.post("/api/arena/evaluate", async (req, res) => {
      const body = req.body;
      if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
        res.status(400).json({ error: "Missing or empty request body" });
        return;
      }
      const { playerId, command, stdout } = body;
      const targetPlayerId = playerId || (this.arenaManager.getPlayers()[0]?.id ?? "guest");
      const cmdStr = (typeof command === "string" ? command : typeof stdout === "string" ? stdout : "").trim();

      if (!cmdStr) {
        res.status(400).json({ error: "Missing command or stdout" });
        return;
      }

      // Check if this is an automation script / bash loop
      if (this.scriptRunner.isScriptCommand(cmdStr)) {
        const scriptRes = await this.scriptRunner.execute(cmdStr, targetPlayerId);
        if (scriptRes.handled) {
          res.json({
            success: true,
            isScript: true,
            output: scriptRes.output,
            totalScoreGained: scriptRes.totalScoreGained,
          });
          return;
        }
      }

      const outcome = this.arenaManager.evaluateCommand(targetPlayerId, cmdStr);
      res.json(outcome);
    });

    // API: Programmatic probing endpoint for Python / Bash recon scripts
    this.get("/api/arena/probe", (req, res) => {
      const query = (req as any).query || {};
      const ip = query.ip;
      if (!ip || typeof ip !== "string" || !ip.trim()) {
        res.status(400).json({ error: "Missing required query parameter: ip" });
        return;
      }

      const cleanIp = ip.trim();
      const node = this.mockMesh.getNodeByIp(cleanIp);
      if (!node) {
        res.status(404).json({ error: "Host unreachable", ip: cleanIp });
        return;
      }

      const service = (query.service || "whois").toLowerCase().trim();
      const port = Number(query.port) || 80;

      if (service === "whois") {
        const result = this.mockMesh.queryWhois(cleanIp);
        res.json({
          ip: cleanIp,
          service: "whois",
          vulnerable: node.isVulnerable && node.category === "whois",
          adminEmail: node.isVulnerable ? "admin@mega-infra.net" : "privacy-guard@icann.org",
          cidr: "10.10.1.0/24",
          flag: node.isVulnerable && node.category === "whois" ? node.flag : undefined,
          output: result.output,
        });
      } else if (service === "dns-axfr" || service === "dns") {
        const result = this.mockMesh.queryDnsAxfr(cleanIp, "mega-infra.net");
        res.json({
          ip: cleanIp,
          service: "dns-axfr",
          vulnerable: node.isVulnerable && node.category === "dns-axfr",
          flag: node.isVulnerable && node.category === "dns-axfr" ? node.flag : undefined,
          output: result.output,
        });
      } else if (service === "nmap" || service === "port") {
        const result = this.mockMesh.scanPort(cleanIp, port);
        res.json({
          ip: cleanIp,
          service: "nmap",
          port,
          open: result.open,
          vulnerable: result.vulnerable,
          banner: result.banner,
        });
      } else if (service === "mssql") {
        const result = this.mockMesh.attemptMssqlLogin(cleanIp, query.user || "sa", query.pass || "Password123!");
        res.json({
          ip: cleanIp,
          service: "mssql",
          vulnerable: result.success,
          flag: result.flag,
          output: result.output,
        });
      } else if (service === "s3") {
        const result = this.mockMesh.accessS3Bucket(cleanIp, query.bucket || "config.env");
        res.json({
          ip: cleanIp,
          service: "s3",
          vulnerable: result.success,
          flag: result.flag,
          output: result.output,
        });
      } else {
        res.status(400).json({ error: "Unknown service", service });
      }
    });

    // API: 200 Virtual Internet Nodes
    this.get("/api/arena/nodes", (req, res) => {
      const category = (req as any).query?.category;
      if (category && category !== "all") {
        res.json(this.mockMesh.getVulnerableNodesByCategory(category));
      } else {
        res.json(this.mockMesh.getAllNodes());
      }
    });

    // Route: /arena directly serves the CTF competition portal
    this.get("/arena", (_req, res) => {
      const clientIndex = path.resolve(process.cwd(), "client/index.html");
      const distIndex = path.resolve(process.cwd(), "client/dist/index.html");
      if (fs.existsSync(clientIndex)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(fs.readFileSync(clientIndex));
        return;
      }
      if (fs.existsSync(distIndex)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(fs.readFileSync(distIndex));
        return;
      }
      res.status(404).json({ error: "Client index not found" });
    });

    // Root portal page & client app
    this.get("/", (req, res) => {
      const role = (req as any).query?.role;
      const clientIndex = path.resolve(process.cwd(), "client/index.html");
      const distIndex = path.resolve(process.cwd(), "client/dist/index.html");

      // When a specific role is requested, serve the interactive SPA console
      if (role && (role === "attacker" || role === "defender" || role === "observer" || role === "arena")) {
        if (fs.existsSync(clientIndex)) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(fs.readFileSync(clientIndex));
          return;
        }
        if (fs.existsSync(distIndex)) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(fs.readFileSync(distIndex));
          return;
        }
      }

      // Default landing: portal dashboard with role cards & LAN status
      const summary = this.lanManager.getSummary();
      const html = this.renderPortalHtml(summary);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
    });
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = parsedUrl.pathname;
    const method = req.method || "GET";

    (res as any).json = (data: any) => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
    };
    (res as any).status = (code: number) => {
      res.statusCode = code;
      return res;
    };

    (req as any).query = Object.fromEntries(parsedUrl.searchParams.entries());

    let bodyData = "";
    req.on("data", (chunk) => {
      bodyData += chunk;
    });

    req.on("end", () => {
      if (bodyData) {
        try {
          (req as any).body = JSON.parse(bodyData);
        } catch {
          (req as any).body = { raw: bodyData };
        }
      } else {
        (req as any).body = {};
      }

      for (const route of this.routes) {
        if (route.method === method && route.path.test(pathname)) {
          try {
            const ret = route.handler(req, res);
            if (ret && typeof ret.catch === "function") {
              ret.catch((err: any) => {
                if (!res.headersSent) {
                  res.statusCode = 500;
                  (res as any).json({ error: "Internal Server Error", message: err?.message || String(err) });
                }
              });
            }
          } catch (err: any) {
            if (!res.headersSent) {
              res.statusCode = 500;
              (res as any).json({ error: "Internal Server Error", message: err?.message || String(err) });
            }
          }
          return;
        }
      }

      // Static file serving fallback for client assets
      if (method === "GET") {
        let filePath = "";
        if (pathname.startsWith("/src/")) {
          filePath = path.resolve(process.cwd(), "client", pathname.slice(1));
        } else if (pathname.startsWith("/client/")) {
          filePath = path.resolve(process.cwd(), pathname.slice(1));
        }

        if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            ".js": "application/javascript; charset=utf-8",
            ".ts": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".html": "text/html; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
          };
          res.setHeader("Content-Type", mimeTypes[ext] || "text/plain; charset=utf-8");
          res.end(fs.readFileSync(filePath));
          return;
        }
      }

      res.statusCode = 404;
      (res as any).json({ error: "Not Found", path: pathname });
    });
  }

  private bindWebSocketUpgrades() {
    this.server.on("upgrade", (req: IncomingMessage, socket: any, _head: Buffer) => {
      const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const pathname = parsedUrl.pathname;

      const ws = handleUpgradeHandshake(req, socket);
      if (!ws) return;
      ws.on("error", () => {});

      const forceMock = parsedUrl.searchParams.get("mock") === "true" || process.env.SIM_FORCE_MOCK === "true";

      if (pathname === "/ws/terminal/attacker") {
        this.ptyManager.attachWebSocket(ws, "attacker", { forceMock }).then((session) => {
          session.onData((data: string) => {
            try {
              this.scenarioState.evaluateCommand("", data, "attacker");
            } catch {}
          });
        });
      } else if (pathname === "/ws/terminal/defender") {
        this.ptyManager.attachWebSocket(ws, "defender", { forceMock });
      } else if (pathname === "/ws/events") {
        this.trafficMonitor.subscribe(ws);
      } else if (pathname === "/ws/scenario") {
        this.scenarioState.subscribe(ws);
      } else if (pathname === "/ws/arena") {
        this.arenaSockets.add(ws);
        ws.on("close", () => this.arenaSockets.delete(ws));

        // Send initial state immediately
        ws.send(
          JSON.stringify({
            type: "init",
            state: {
              lobbyState: this.arenaManager.getLobbyState(),
              duration: this.arenaManager.getDuration(),
              timeRemaining: this.arenaManager.getTimeRemaining(),
              players: this.arenaManager.getPlayers(),
              leaderboard: this.arenaManager.getLeaderboard(),
              recentAttacks: this.arenaManager.getRecentAttackTraces(25),
              nodeStates: this.arenaManager.getNodeStateMap(),
              hallOfFame: this.arenaManager.getHallOfFame(),
            },
          })
        );

        ws.on("message", (msgStr: string) => {
          try {
            const data = JSON.parse(msgStr);
            if (data.action === "join") {
              const player = this.arenaManager.registerPlayer(data);
              ws.send(JSON.stringify({ type: "player:registered", player }));
            } else if (data.action === "start") {
              this.arenaManager.startMatch();
            } else if (data.action === "reset") {
              this.arenaManager.resetMatch();
            } else if (data.action === "evaluate") {
              const outcome = this.arenaManager.evaluateCommand(data.playerId, data.command || data.stdout || "");
              ws.send(JSON.stringify({ type: "eval:result", outcome }));
            }
          } catch {}
        });
      } else {
        ws.close(1008, "Unknown WebSocket path");
      }
    });
  }

  private renderPortalHtml(summary: ReturnType<LanManager["getSummary"]>): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>메타스플로잇 3장 인텔리전스 수집 훈련 게이트웨이</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #131b2e;
      --border: #223152;
      --accent: #38bdf8;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --green: #22c55e;
      --red: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 2.5rem 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container { max-width: 860px; width: 100%; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.825rem;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: var(--accent);
      margin-bottom: 1rem;
    }
    .pulse-dot {
      width: 8px; height: 8px; border-radius: 50%; background: var(--green);
      box-shadow: 0 0 8px var(--green);
    }
    h1 { font-size: 1.85rem; font-weight: 700; margin-bottom: 0.5rem; }
    p.desc { color: var(--muted); font-size: 0.975rem; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.25rem; margin-bottom: 2rem; }
    .role-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .role-card:hover { transform: translateY(-2px); border-color: var(--accent); }
    .role-card h3 { font-size: 1.2rem; margin-bottom: 0.5rem; }
    .role-card p { color: var(--muted); font-size: 0.875rem; line-height: 1.4; margin-bottom: 1.25rem; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.65rem 1.25rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.9rem;
      text-decoration: none;
      color: #fff;
      background: #0284c7;
      border: none;
      cursor: pointer;
    }
    .btn.defender { background: #059669; }
    .btn.observer { background: #475569; }
    .info-box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
      font-size: 0.875rem;
    }
    .info-row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
    .info-row:last-child { border-bottom: none; }
    code { font-family: ui-monospace, SFMono-Regular, monospace; background: #0a0f1d; padding: 0.2rem 0.4rem; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge"><span class="pulse-dot"></span> LAN 게이트웨이 기동 중 (호스트 IP: ${summary.hostIp})</div>
    <h1>메타스플로잇 3장 인텔리전스 수집 훈련장</h1>
    <p class="desc">동일 Wi-Fi LAN 참가자는 아래 역할 링크를 클릭하여 별도 설치 없이 브라우저로 실습에 참여하세요.</p>
    <div class="grid">
      <div class="role-card">
        <div>
          <h3>🔴 공격자 (Attacker)</h3>
          <p>Kali Linux 웹 터미널, 실시간 토폴로지 레이더, 침투 정찰 퀘스트 수행</p>
        </div>
        <a href="${summary.urls.attacker}" class="btn">공격자 접속하기</a>
      </div>
      <div class="role-card">
        <div>
          <h3>🛡️ 방어자 (Defender)</h3>
          <p>Snort/iptables 실시간 침입 탐지 모니터, 방어자 터미널, 단계별 방어 가이드</p>
        </div>
        <a href="${summary.urls.defender}" class="btn defender">방어자 접속하기</a>
      </div>
      <div class="role-card">
        <div>
          <h3>👁️ 관제자 (Observer)</h3>
          <p>공격/방어 트윈 분할 뷰, 패킷 스트림, 전체 실시간 현황 관제</p>
        </div>
        <a href="${summary.urls.observer}" class="btn observer">관제자 접속하기</a>
      </div>
      <div class="role-card">
        <div>
          <h3>🏁 CTF 아레나 (Arena)</h3>
          <p>200개 노드 가상 인터넷 침투 경진대회 및 실시간 순위표</p>
        </div>
        <a href="/arena" class="btn" style="background:#0891b2;">대회장 입장하기</a>
      </div>
    </div>
    <div class="info-box">
      <div class="info-row"><span>게이트웨이 포트:</span><code>0.0.0.0:${summary.port}</code></div>
      <div class="info-row"><span>외부 SSH 접속:</span><code>ssh -p ${summary.sshPort} {닉네임}@${summary.hostIp}</code></div>
      <div class="info-row"><span>탐지된 호스트 IP:</span><code>${summary.hostIp}</code></div>
    </div>
  </div>
</body>
</html>`;
  }

  public async listen(port = 3000, host = "0.0.0.0", sshPort?: number): Promise<number> {
    const actualHttpPort = await new Promise<number>((resolve) => {
      this.server.listen(port, host, () => {
        const addr = this.server.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : port;
        this.lanManager.port = actualPort;
        resolve(actualPort);
      });
    });

    const targetSshPort = sshPort !== undefined ? sshPort : (this.lanManager.sshPort || 2222);
    if (targetSshPort > 0) {
      try {
        await this.sshServer.listen(targetSshPort, host);
        this.lanManager.sshPort = this.sshServer.port;
      } catch (err: any) {
        console.warn(`[SSH Server] Could not bind on port ${targetSshPort}: ${err.message}`);
      }
    }

    return actualHttpPort;
  }

  public async close(): Promise<void> {
    try {
      await this.sshServer.close();
    } catch {}

    return new Promise((resolve) => {
      this.arenaManager.destroy();
      for (const ws of this.arenaSockets) {
        try {
          ws.close();
        } catch {}
      }
      this.arenaSockets.clear();
      this.ptyManager.closeAll();
      this.trafficMonitor.stopAutoSimulation();
      for (const sock of this.openSockets) {
        sock.destroy();
      }
      this.openSockets.clear();
      if (typeof (this.server as any).closeAllConnections === "function") {
        (this.server as any).closeAllConnections();
      }
      this.server.close(() => {
        resolve();
      });
    });
  }
}

/**
 * Factory function to create and optionally start the gateway.
 */
export function createGatewayServer(port = 3000, hostIp?: string, sshPort?: number): GatewayApp {
  return new GatewayApp({ port, hostIp, sshPort });
}

export const defaultApp = new GatewayApp();
export default defaultApp;

const isMain = process.argv[1] && (process.argv[1].endsWith("server/index.ts") || process.argv[1].endsWith("server\\index.ts"));
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "0.0.0.0";
  defaultApp.listen(port, host).then((actualPort) => {
    const summary = defaultApp.lanManager.getSummary();
    console.log(`\n======================================================`);
    console.log(`🚀 [Metasploit Ch3 Simulation] LAN Gateway Server Ready`);
    console.log(`🌐 Host LAN IP : ${summary.hostIp}`);
    console.log(`🔌 Listening   : http://${host}:${actualPort}`);
    console.log(`🔴 Attacker    : ${summary.urls.attacker}`);
    console.log(`🛡️ Defender    : ${summary.urls.defender}`);
    console.log(`👁️ Observer    : ${summary.urls.observer}`);
    console.log(`🏁 CTF Arena   : http://${summary.hostIp}:${actualPort}/arena`);
    console.log(`💻 Direct SSH  : ssh -p ${summary.sshPort} {참가자닉네임}@${summary.hostIp}`);
    console.log(`======================================================\n`);
  });
}
