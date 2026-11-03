import os from "node:os";
import { randomUUID } from "node:crypto";

export type Role = "attacker" | "defender" | "observer";

export interface RoleSession {
  id: string;
  role: Role;
  clientIp: string;
  connectedAt: number;
  lastSeenAt: number;
  userAgent?: string;
  meta?: Record<string, unknown>;
}

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  isWifi: boolean;
  isInternal: boolean;
}

export interface LanSummary {
  hostIp: string;
  port: number;
  interfaces: NetworkInterfaceInfo[];
  activeSessions: Record<Role, number>;
  urls: Record<Role, string>;
  sshPort: number;
}

const WIFI_REGEX = /wi-?fi|wlan|wireless|airport|en0|무선/i;
const VIRTUAL_REGEX = /docker|veth|br-|cni|flannel|vEthernet|hyper-v|tailscale/i;

/**
 * Detects the most appropriate local IPv4 address.
 * Prioritizes Wi-Fi interfaces for LAN simulation setups, followed by physical Ethernet,
 * while deprioritizing Docker/virtual network bridges. Falls back to 127.0.0.1.
 */
export function detectLocalIp(customInterfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string {
  const nets = customInterfaces || os.networkInterfaces();
  let bestIp: string | null = null;
  let bestScore = -1;

  for (const [name, netList] of Object.entries(nets)) {
    if (!netList) continue;
    for (const net of netList) {
      // IPv4 only, exclude internal loopback
      const family = typeof net.family === "string" ? net.family : (net as any).family;
      if (family !== "IPv4" && family !== 4) continue;
      if (net.internal) continue;
      if (net.address.startsWith("127.")) continue;
      if (net.address.startsWith("169.254.")) continue; // APIPA auto-assigned

      let score = 10;
      const isWifi = WIFI_REGEX.test(name);
      const isVirtual = VIRTUAL_REGEX.test(name);

      if (isWifi) {
        score += 80; // Highest priority: Wi-Fi LAN
      } else if (!isVirtual) {
        score += 40; // Physical Ethernet
      } else {
        score -= 20; // Virtual adapters (WSL, Docker bridge)
      }

      // Private subnet preference (192.168.x.x > 10.x.x.x > 172.16-31.x.x)
      if (net.address.startsWith("192.168.")) {
        score += 15;
      } else if (net.address.startsWith("10.")) {
        score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIp = net.address;
      }
    }
  }

  return bestIp || "127.0.0.1";
}

/**
 * Lists all active IPv4 interfaces with Wi-Fi detection tags.
 */
export function getAllInterfaces(customInterfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>): NetworkInterfaceInfo[] {
  const nets = customInterfaces || os.networkInterfaces();
  const results: NetworkInterfaceInfo[] = [];

  for (const [name, netList] of Object.entries(nets)) {
    if (!netList) continue;
    for (const net of netList) {
      const family = typeof net.family === "string" ? net.family : (net as any).family;
      if (family !== "IPv4" && family !== 4) continue;

      results.push({
        name,
        address: net.address,
        isWifi: WIFI_REGEX.test(name),
        isInternal: Boolean(net.internal),
      });
    }
  }

  return results;
}

/**
 * Helper to construct the access URL for a given role.
 */
export function generateConnectionUrl(role: Role, hostIp: string, port = 3000): string {
  const cleanHost = hostIp.includes(":") ? `[${hostIp}]` : hostIp;
  return `http://${cleanHost}:${port}/?role=${role}`;
}

export class LanManager {
  public hostIp: string;
  public port: number;
  public sshPort: number;
  private sessions = new Map<string, RoleSession>();

  constructor(options?: { hostIp?: string; port?: number; sshPort?: number }) {
    this.hostIp = options?.hostIp || detectLocalIp();
    this.port = options?.port || 3000;
    this.sshPort = options?.sshPort || 2222;
  }

  /**
   * Refreshes the detected local IP (e.g. after network change).
   */
  public refreshHostIp(): string {
    this.hostIp = detectLocalIp();
    return this.hostIp;
  }

  /**
   * Registers a role session for a participant.
   */
  public registerSession(
    role: Role,
    clientIp = "127.0.0.1",
    sessionId?: string,
    meta?: Record<string, unknown>
  ): RoleSession {
    const id = sessionId || randomUUID();
    const now = Date.now();
    const session: RoleSession = {
      id,
      role,
      clientIp,
      connectedAt: now,
      lastSeenAt: now,
      meta,
    };
    this.sessions.set(id, session);
    return session;
  }

  /**
   * Updates last-seen timestamp for session keep-alive.
   */
  public touchSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.lastSeenAt = Date.now();
    return true;
  }

  /**
   * Removes a session upon disconnect.
   */
  public removeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Gets session by ID.
   */
  public getSession(sessionId: string): RoleSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Lists active sessions, optionally filtered by role.
   */
  public listSessions(role?: Role): RoleSession[] {
    const all = Array.from(this.sessions.values());
    if (!role) return all;
    return all.filter((s) => s.role === role);
  }

  /**
   * Counts active sessions per role.
   */
  public getActiveSessionCount(): Record<Role, number> {
    const counts: Record<Role, number> = { attacker: 0, defender: 0, observer: 0 };
    for (const session of this.sessions.values()) {
      counts[session.role] = (counts[session.role] || 0) + 1;
    }
    return counts;
  }

  /**
   * Generates role connection URL.
   */
  public getConnectionUrl(role: Role, customHost?: string): string {
    return generateConnectionUrl(role, customHost || this.hostIp, this.port);
  }

  /**
   * Generates role connection URLs for all 3 roles.
   */
  public getAllUrls(customHost?: string): Record<Role, string> {
    const targetHost = customHost || this.hostIp;
    return {
      attacker: this.getConnectionUrl("attacker", targetHost),
      defender: this.getConnectionUrl("defender", targetHost),
      observer: this.getConnectionUrl("observer", targetHost),
    };
  }

  /**
   * Complete LAN status summary.
   */
  public getSummary(): LanSummary {
    return {
      hostIp: this.hostIp,
      port: this.port,
      sshPort: this.sshPort,
      interfaces: getAllInterfaces(),
      activeSessions: this.getActiveSessionCount(),
      urls: this.getAllUrls(),
    };
  }
}
