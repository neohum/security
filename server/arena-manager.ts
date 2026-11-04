import { EventEmitter } from 'node:events';
import {
  MockInternetMesh,
  type VirtualServerNode,
  type VulnerableCategory,
  CATEGORY_POINTS,
} from './mock-internet-mesh.ts';

export type LobbyState = 'waiting' | 'active' | 'finished';
export type NodeCompromiseStatus = 'unprobed' | 'scanned' | 'compromised';

export interface Player {
  id: string;
  nickname: string;
  clientIp: string;
  avatar: string;
  score: number;
  firstBloodCount: number;
  compromisedCount: number;
  lastCompromiseTime?: number;
  registeredAt: number;
}

export interface RegisterPlayerOptions {
  id?: string;
  nickname: string;
  clientIp?: string;
  avatar?: string;
}

export interface AttackTraceEvent {
  id: string;
  timestamp: number;
  playerId: string;
  nickname: string;
  ip: string;
  category: VulnerableCategory;
  method: string;
  points: number;
  isFirstBlood: boolean;
}

export interface NodeCompromiseState {
  status: NodeCompromiseStatus;
  compromisedBy?: {
    nickname: string;
    timestamp: number;
  };
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  nickname: string;
  clientIp: string;
  avatar: string;
  score: number;
  firstBloodCount: number;
  compromisedCount: number;
  lastCompromiseTime?: number;
}

export interface HallOfFameRecord {
  matchId: string;
  finishedAt: number;
  durationSeconds: number;
  winner?: LeaderboardEntry;
  top3: LeaderboardEntry[];
  leaderboard: LeaderboardEntry[];
  totalCompromised: number;
  totalPoints: number;
  totalPlayers: number;
  finalTrace?: AttackTraceEvent[];
}

export interface ArenaConfig {
  durationSeconds?: number; // default: 900 (15 minutes)
  firstBloodBonus?: number; // default: 50
  meshSeed?: number;        // default: 1337
}

export interface EvaluationOutcome {
  success: boolean;
  reason?: string;
  targetIp?: string;
  event?: AttackTraceEvent;
  pointsAwarded?: number;
  isFirstBlood?: boolean;
  nodeState?: NodeCompromiseState;
  duplicate?: boolean;
}

export class ArenaManager extends EventEmitter {
  private mesh: MockInternetMesh;
  private lobbyState: LobbyState = 'waiting';
  private durationSeconds: number;
  private remainingSeconds: number;
  private timer: NodeJS.Timeout | null = null;
  private startTime: number | null = null;
  private readonly firstBloodBonus: number;

  private players: Map<string, Player> = new Map();
  private nicknameToId: Map<string, string> = new Map();
  private nodeStates: Map<string, NodeCompromiseState> = new Map();
  private attackTrace: AttackTraceEvent[] = [];
  // Set of `${playerId}:${ip}` for idempotent scoring
  private playerCompromises: Set<string> = new Set();
  // Set of IPs that have been compromised by any player (for first blood)
  private compromisedIps: Set<string> = new Set();

  // Monotonic sequence offset for strict event ordering
  private lastEventTime = 0;
  // Preserved Hall of Fame from finished matches
  private hallOfFame: HallOfFameRecord | null = null;
  private hallOfFameHistory: HallOfFameRecord[] = [];

  constructor(mesh?: MockInternetMesh, config?: ArenaConfig) {
    super();
    this.mesh = mesh || new MockInternetMesh(config?.meshSeed ?? 1337);
    this.durationSeconds = config?.durationSeconds ?? 900;
    this.remainingSeconds = this.durationSeconds;
    this.firstBloodBonus = config?.firstBloodBonus ?? 50;

    this.initNodeStates();
  }

  /**
   * Lamport monotonic timestamp generator for sub-millisecond tie-breaking.
   * Guarantees that sequentially executed events always receive strictly increasing timestamps.
   */
  private getMonotonicNow(): number {
    const now = Date.now();
    if (now <= this.lastEventTime) {
      this.lastEventTime += 0.001;
      return this.lastEventTime;
    }
    this.lastEventTime = now;
    return now;
  }

  /**
   * Initializes the 200-node compromise state map with 'unprobed'.
   */
  private initNodeStates(): void {
    this.nodeStates.clear();
    const allNodes = this.mesh.getAllNodes();
    for (const node of allNodes) {
      this.nodeStates.set(node.ip, {
        status: 'unprobed',
      });
    }
  }

  public getMesh(): MockInternetMesh {
    return this.mesh;
  }

  public setMesh(mesh: MockInternetMesh): void {
    this.mesh = mesh;
    this.initNodeStates();
  }

  // ==========================================
  // Session & Player Management
  // ==========================================

  public registerPlayer(options: RegisterPlayerOptions): Player {
    const rawNick = options.nickname?.trim();
    if (!rawNick) {
      throw new Error('Nickname cannot be empty');
    }

    // Check if player with this ID or nickname already exists (reconnection support)
    if (options.id && this.players.has(options.id)) {
      const existing = this.players.get(options.id)!;
      existing.nickname = rawNick;
      if (options.clientIp) existing.clientIp = options.clientIp;
      if (options.avatar) existing.avatar = options.avatar;
      this.nicknameToId.set(rawNick.toLowerCase(), existing.id);
      return existing;
    }

    const existingId = this.nicknameToId.get(rawNick.toLowerCase());
    if (existingId && this.players.has(existingId)) {
      const existing = this.players.get(existingId)!;
      if (options.clientIp) existing.clientIp = options.clientIp;
      if (options.avatar) existing.avatar = options.avatar;
      return existing;
    }

    const playerId = options.id || `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newPlayer: Player = {
      id: playerId,
      nickname: rawNick,
      clientIp: options.clientIp || '127.0.0.1',
      avatar: options.avatar || 'avatar-1',
      score: 0,
      firstBloodCount: 0,
      compromisedCount: 0,
      registeredAt: this.getMonotonicNow(),
    };

    this.players.set(playerId, newPlayer);
    this.nicknameToId.set(rawNick.toLowerCase(), playerId);

    this.emit('player:joined', { player: newPlayer });
    return newPlayer;
  }

  public getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  public getPlayerByNickname(nickname: string): Player | undefined {
    const id = this.nicknameToId.get(nickname.trim().toLowerCase());
    return id ? this.players.get(id) : undefined;
  }

  public getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  public getPlayers(): Player[] {
    return this.getAllPlayers();
  }

  public getPlayerCount(): number {
    return this.players.size;
  }

  // ==========================================
  // Lobby & Match Timer Management
  // ==========================================

  public getLobbyState(): LobbyState {
    return this.lobbyState;
  }

  public getDuration(): number {
    return this.durationSeconds;
  }

  public setDuration(seconds: number): void {
    if (this.lobbyState === 'active') {
      throw new Error('Cannot change duration while match is active');
    }
    this.durationSeconds = Math.max(1, seconds);
    this.remainingSeconds = this.durationSeconds;
  }

  public getTimeRemaining(): number {
    return this.remainingSeconds;
  }

  public setTimeRemaining(seconds: number): void {
    this.remainingSeconds = Math.max(0, seconds);
    if (this.lobbyState === 'active' && this.remainingSeconds <= 0) {
      this.stopMatch();
    }
  }

  public startMatch(): void {
    if (this.lobbyState === 'active') {
      return;
    }

    this.lobbyState = 'active';
    this.remainingSeconds = this.durationSeconds;
    this.startTime = Date.now();

    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(() => {
      this.tick();
    }, 1000);

    // Ensure timer doesn't hold open process in tests
    if (this.timer.unref) {
      this.timer.unref();
    }

    this.emit('match:started', {
      durationSeconds: this.durationSeconds,
      startTime: this.startTime,
    });
  }

  public tick(seconds: number = 1): void {
    if (this.lobbyState !== 'active') return;

    if (this.remainingSeconds > 0) {
      this.remainingSeconds = Math.max(0, this.remainingSeconds - seconds);
      this.emit('timer:tick', { remainingSeconds: this.remainingSeconds });
      this.emit('match:tick', this.remainingSeconds);
    }

    if (this.remainingSeconds <= 0) {
      this.stopMatch();
    }
  }

  public stopMatch(): void {
    if (this.lobbyState === 'finished') return;

    this.lobbyState = 'finished';
    this.remainingSeconds = 0;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const leaderboard = this.getLeaderboard();
    const winner = leaderboard[0];
    const top3 = leaderboard.slice(0, 3);
    const totalCompromised = Array.from(this.players.values()).reduce(
      (sum, p) => sum + p.compromisedCount,
      0
    );
    const totalPoints = Array.from(this.players.values()).reduce(
      (sum, p) => sum + p.score,
      0
    );

    const record: HallOfFameRecord = {
      matchId: `match_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      finishedAt: Date.now(),
      durationSeconds: this.durationSeconds,
      winner,
      top3,
      leaderboard,
      totalCompromised,
      totalPoints,
      totalPlayers: this.players.size,
      finalTrace: [...this.attackTrace],
    };

    this.hallOfFame = record;
    this.hallOfFameHistory.push(record);

    this.emit('match:finished', {
      leaderboard,
      finalTrace: this.attackTrace,
      hallOfFame: record,
    });
  }

  public resetMatch(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.lobbyState = 'waiting';
    this.remainingSeconds = this.durationSeconds;
    this.startTime = null;
    this.attackTrace = [];
    this.playerCompromises.clear();
    this.compromisedIps.clear();
    this.lastEventTime = 0;

    for (const player of this.players.values()) {
      player.score = 0;
      player.firstBloodCount = 0;
      player.compromisedCount = 0;
      player.lastCompromiseTime = undefined;
    }

    // Reset mesh nodes compromisedBy
    for (const node of this.mesh.getAllNodes()) {
      node.compromisedBy = [];
    }

    this.initNodeStates();
    this.emit('match:reset');
    // Note: this.hallOfFame and this.hallOfFameHistory are PRESERVED across resets
  }

  public getHallOfFame(): HallOfFameRecord | null {
    return this.hallOfFame;
  }

  public getHallOfFameHistory(): HallOfFameRecord[] {
    return [...this.hallOfFameHistory];
  }

  public clearHallOfFame(): void {
    this.hallOfFame = null;
    this.hallOfFameHistory = [];
  }

  public destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.removeAllListeners();
  }

  // ==========================================
  // Node State Map & Attack Trace
  // ==========================================

  public getNodeStateMap(): Record<string, NodeCompromiseState> {
    const map: Record<string, NodeCompromiseState> = {};
    for (const [ip, state] of this.nodeStates.entries()) {
      map[ip] = {
        status: state.status,
        compromisedBy: state.compromisedBy ? { ...state.compromisedBy } : undefined,
      };
    }
    return map;
  }

  public getNodeState(ip: string): NodeCompromiseState | undefined {
    return this.nodeStates.get(ip);
  }

  public getAttackTrace(): AttackTraceEvent[] {
    return [...this.attackTrace];
  }

  public getRecentAttackTraces(limit: number = 25): AttackTraceEvent[] {
    return this.attackTrace.slice(-limit).reverse();
  }

  public getRecentAttacks(limit: number = 25): AttackTraceEvent[] {
    return this.getRecentAttackTraces(limit);
  }

  // ==========================================
  // Real-Time Leaderboard Generation
  // ==========================================

  public getLeaderboard(): LeaderboardEntry[] {
    const list = Array.from(this.players.values());

    list.sort((a, b) => {
      // 1. Total score descending
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // 2. Earliest compromise time ascending (tie-breaking)
      const timeA = a.lastCompromiseTime ?? Infinity;
      const timeB = b.lastCompromiseTime ?? Infinity;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      // 3. Earliest registration ascending
      return a.registeredAt - b.registeredAt;
    });

    return list.map((player, index) => ({
      rank: index + 1,
      playerId: player.id,
      nickname: player.nickname,
      clientIp: player.clientIp,
      avatar: player.avatar,
      score: player.score,
      firstBloodCount: player.firstBloodCount,
      compromisedCount: player.compromisedCount,
      lastCompromiseTime: player.lastCompromiseTime,
    }));
  }

  // ==========================================
  // Automated Command Evaluation Engine
  // ==========================================

  /**
   * Accepts command line input or terminal output from a player,
   * detects target node(s) and whether an exploit/recon succeeded.
   */
  public evaluateCommand(playerId: string, input: string): EvaluationOutcome {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, reason: 'player_not_found' };
    }

    if (this.lobbyState !== 'active') {
      return { success: false, reason: 'match_not_active' };
    }

    // Extract target IP or node reference
    let ips = this.extractTargetIps(input);
    if (ips.length === 0) {
      for (const node of this.mesh.getVulnerableNodes()) {
        if (node.flag && input.includes(node.flag)) {
          ips = [node.ip];
          break;
        }
      }
    }
    if (ips.length === 0) {
      return { success: false, reason: 'no_target_found' };
    }

    // Evaluate target IPs (taking the first relevant target)
    for (const ip of ips) {
      const node = this.mesh.getNodeByIp(ip);
      if (!node) continue;

      // Handle hardened node
      if (!node.isVulnerable || node.category === 'hardened') {
        const state = this.nodeStates.get(ip);
        if (state && state.status === 'unprobed') {
          state.status = 'scanned';
          this.emit('node:updated', { ip, nodeState: state });
        }
        return {
          success: false,
          reason: 'node_hardened',
          targetIp: ip,
        };
      }

      // Check if command/output matches exploit for vulnerable category
      const isExploit = this.matchesCategoryExploit(node.category, input, node);

      if (!isExploit) {
        // If it's a generic probe / scan that did not exploit the service
        const state = this.nodeStates.get(ip);
        if (state && state.status === 'unprobed') {
          state.status = 'scanned';
          this.emit('node:updated', { ip, nodeState: state });
        }
        return {
          success: false,
          reason: 'node_scanned',
          targetIp: ip,
        };
      }

      // Check idempotent scoring: duplicate exploit by same player
      const exploitKey = `${playerId}:${ip}`;
      if (this.playerCompromises.has(exploitKey)) {
        return {
          success: false,
          reason: 'already_compromised_by_player',
          targetIp: ip,
          duplicate: true,
        };
      }

      // Record player compromise
      this.playerCompromises.add(exploitKey);

      // Check first blood
      const isFirstBlood = !this.compromisedIps.has(ip);
      if (isFirstBlood) {
        this.compromisedIps.add(ip);
        player.firstBloodCount += 1;
      }

      // Calculate score
      const basePoints = CATEGORY_POINTS[node.category] ?? 100;
      const pointsAwarded = basePoints + (isFirstBlood ? this.firstBloodBonus : 0);

      const now = this.getMonotonicNow();
      player.score += pointsAwarded;
      player.compromisedCount += 1;
      player.lastCompromiseTime = now;

      // Update node state map
      const nodeState = this.nodeStates.get(ip)!;
      nodeState.status = 'compromised';
      if (!nodeState.compromisedBy) {
        nodeState.compromisedBy = {
          nickname: player.nickname,
          timestamp: Math.floor(now),
        };
      }

      this.mesh.markCompromised(ip, player.nickname);

      // Record Attack Trace timeline event
      const method = this.getMethodDescription(node.category);
      const event: AttackTraceEvent = {
        id: `trace_${Math.floor(now)}_${this.attackTrace.length + 1}`,
        timestamp: now,
        playerId: player.id,
        nickname: player.nickname,
        ip,
        category: node.category,
        method,
        points: pointsAwarded,
        isFirstBlood,
      };

      this.attackTrace.push(event);

      // Emit real-time events
      this.emit('attack:compromise', event);
      this.emit('attack:compromised', event);
      this.emit('node:updated', { ip, nodeState });
      this.emit('leaderboard:updated', this.getLeaderboard());

      return {
        success: true,
        targetIp: ip,
        event,
        pointsAwarded,
        isFirstBlood,
        nodeState,
      };
    }

    return { success: false, reason: 'target_not_in_mesh' };
  }

  private extractTargetIps(input: string): string[] {
    const results: string[] = [];
    const seen = new Set<string>();

    // 1. Match IP pattern 10.10.1.X
    const ipMatches = input.match(/\b(10\.10\.1\.\d{1,3})\b/g);
    if (ipMatches) {
      for (const ip of ipMatches) {
        if (!seen.has(ip)) {
          seen.add(ip);
          results.push(ip);
        }
      }
    }

    // 2. Match node id node-XXX
    const nodeMatches = input.match(/\bnode-(\d{3})\b/gi);
    if (nodeMatches) {
      for (const m of nodeMatches) {
        const num = parseInt(m.replace(/node-/i, ''), 10);
        if (num >= 1 && num <= 200) {
          const ip = `10.10.1.${num}`;
          if (!seen.has(ip)) {
            seen.add(ip);
            results.push(ip);
          }
        }
      }
    }

    // 3. Match flag pattern FLAG{MESH_<CAT>_XXX}
    const flagMatches = input.match(/FLAG\{MESH_[A-Z_]+_(\d{3})\}/g);
    if (flagMatches) {
      for (const f of flagMatches) {
        const numStr = f.match(/(\d{3})\}/)?.[1];
        if (numStr) {
          const num = parseInt(numStr, 10);
          if (num >= 1 && num <= 200) {
            const ip = `10.10.1.${num}`;
            if (!seen.has(ip)) {
              seen.add(ip);
              results.push(ip);
            }
          }
        }
      }
    }

    return results;
  }

  private matchesCategoryExploit(
    category: VulnerableCategory,
    input: string,
    node: VirtualServerNode
  ): boolean {
    // If the node's secret flag is directly in the command / terminal output
    if (node.flag && input.includes(node.flag)) {
      return true;
    }

    switch (category) {
      case 'whois':
        return (
          /whois/i.test(input) ||
          /admin@mega-infra\.net/i.test(input) ||
          /MEGA-INFRA\.NET/i.test(input)
        );

      case 'dns-axfr':
        return (
          /axfr/i.test(input) ||
          /zone\s*transfer/i.test(input) ||
          /admin-vault\.mega-infra\.net/i.test(input) ||
          /secret-gateway\.mega-infra\.net/i.test(input)
        );

      case 'web-banner':
        return (
          /curl/i.test(input) ||
          /http:\/\//i.test(input) ||
          /nikto/i.test(input) ||
          /Apache\/2\.2\.8/i.test(input) ||
          /X-Secret-Flag/i.test(input) ||
          /MegaCorp Web Portal/i.test(input)
        );

      case 'mssql':
        return (
          /Password123!/i.test(input) ||
          (/sa/i.test(input) && (/1433|sqlcmd|sqsh|mssql/i.test(input))) ||
          /xp_cmdshell/i.test(input)
        );

      case 's3-bucket':
        return (
          /config\.env/i.test(input) ||
          /AWS_ACCESS_KEY_ID/i.test(input) ||
          ((/s3|minio|aws/i.test(input)) && /9000/i.test(input))
        );

      case 'legacy-service':
        return (
          /1524/i.test(input) ||
          /vsftpd/i.test(input) ||
          /2\.3\.4/i.test(input) ||
          /ingreslock/i.test(input) ||
          /uid=0\(root\)/i.test(input) ||
          /backdoor/i.test(input)
        );

      default:
        return false;
    }
  }

  private getMethodDescription(category: VulnerableCategory): string {
    switch (category) {
      case 'whois':
        return 'Whois Reconnaissance';
      case 'dns-axfr':
        return 'DNS AXFR Zone Transfer';
      case 'web-banner':
        return 'Web Banner / HTTP Exploit';
      case 'mssql':
        return 'MSSQL Default Credentials (sa:Password123!)';
      case 's3-bucket':
        return 'S3 Bucket config.env Extraction';
      case 'legacy-service':
        return 'Legacy Service Backdoor Exploit';
      default:
        return 'Vulnerability Exploitation';
    }
  }
}
