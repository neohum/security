import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ISocket } from "./pty-manager.ts";

export type EventType =
  | "syn_scan"
  | "port_scan"
  | "connection"
  | "dns_query"
  | "whois_query"
  | "s3_access"
  | "alert";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface NetworkEvent {
  id: string;
  timestamp: string;
  type: EventType;
  sourceIp: string;
  destIp: string;
  port: number;
  protocol: "TCP" | "UDP" | "ICMP";
  flag?: string;
  details: string;
  severity: Severity;
}

export class TrafficMonitor extends EventEmitter {
  private history: NetworkEvent[] = [];
  private maxHistory: number;
  private subscribers = new Set<ISocket>();
  private simulationTimer: NodeJS.Timeout | null = null;

  constructor(options?: { maxHistory?: number }) {
    super();
    this.maxHistory = options?.maxHistory || 300;
  }

  /**
   * Records a network event and broadcasts it to all connected /ws/events clients.
   */
  public recordEvent(eventData: Omit<NetworkEvent, "id" | "timestamp">): NetworkEvent {
    const event: NetworkEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...eventData,
    };

    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    this.broadcast(event);
    this.emit("event", event);
    return event;
  }

  /**
   * Broadcasts a network event to all subscribed WebSocket clients.
   */
  public broadcast(event: NetworkEvent): void {
    const payload = JSON.stringify({
      type: "network_event",
      data: event,
    });

    for (const ws of this.subscribers) {
      try {
        ws.send(payload);
      } catch {
        this.subscribers.delete(ws);
      }
    }
  }

  /**
   * Emits a simulated scan event (e.g. SYN scan on port 445/1433, DNS query, etc.)
   */
  public emitSimulatedScan(override?: Partial<NetworkEvent>): NetworkEvent {
    const sampleTargets = [
      { port: 445, service: "SMB (Samba)", severity: "medium" as Severity },
      { port: 1433, service: "MSSQL Database", severity: "high" as Severity },
      { port: 80, service: "HTTP Web", severity: "info" as Severity },
      { port: 22, service: "SSH Remote Login", severity: "low" as Severity },
      { port: 21, service: "FTP Server", severity: "medium" as Severity },
    ];

    const pick = sampleTargets[Math.floor(Math.random() * sampleTargets.length)];

    return this.recordEvent({
      type: override?.type || "syn_scan",
      sourceIp: override?.sourceIp || "172.28.0.5", // kalibox
      destIp: override?.destIp || "172.28.0.10", // metasploitable2
      port: override?.port ?? pick.port,
      protocol: override?.protocol || "TCP",
      flag: override?.flag || "SYN",
      details: override?.details || `SYN stealth scan detected against ${pick.service} (port ${pick.port})`,
      severity: override?.severity || pick.severity,
    });
  }

  /**
   * Subscribes a WebSocket client to receive live network events.
   */
  public subscribe(ws: ISocket): void {
    this.subscribers.add(ws);

    // Send initial snapshot of recent events
    try {
      ws.send(
        JSON.stringify({
          type: "history_snapshot",
          data: this.history.slice(-50),
        })
      );
    } catch {
      this.subscribers.delete(ws);
      return;
    }

    ws.on("close", () => {
      this.subscribers.delete(ws);
    });

    ws.on("error", () => {
      this.subscribers.delete(ws);
    });
  }

  public unsubscribe(ws: ISocket): void {
    this.subscribers.delete(ws);
  }

  public getSubscriberCount(): number {
    return this.subscribers.size;
  }

  public getHistory(limit?: number): NetworkEvent[] {
    if (!limit) return [...this.history];
    return this.history.slice(-limit);
  }

  public clearHistory(): void {
    this.history = [];
  }

  /**
   * Starts periodic simulated traffic generation for testing.
   */
  public startAutoSimulation(intervalMs = 2000): void {
    if (this.simulationTimer) return;
    this.simulationTimer = setInterval(() => {
      this.emitSimulatedScan();
    }, intervalMs);
  }

  /**
   * Stops periodic simulation.
   */
  public stopAutoSimulation(): void {
    if (this.simulationTimer) {
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
  }
}
