import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ISocket } from "./pty-manager.ts";
import type { Role } from "./lan-manager.ts";

export type QuestStatus = "locked" | "active" | "completed";

export interface Quest {
  id: string;
  order: number;
  title: string;
  description: string;
  target: string;
  points: number;
  flag: string;
  status: QuestStatus;
  completedBy?: Role;
  completedAt?: string;
  mitigationHint?: string;
}

export interface FlagSubmission {
  flag: string;
  role: Role;
  submittedAt: string;
  questId: string;
  success: boolean;
}

export interface TimelineEntry {
  id: string;
  timestamp: string;
  role: Role;
  message: string;
  pointsDelta: number;
}

export interface ScenarioStateSnapshot {
  quests: Quest[];
  flagsFound: FlagSubmission[];
  scores: Record<"attacker" | "defender", number>;
  timeline: TimelineEntry[];
  totalQuests: number;
  completedQuests: number;
  updatedAt: string;
}

export const INITIAL_QUESTS: Quest[] = [
  {
    id: "quest-whois",
    order: 1,
    title: "수동 정보 수집: Whois 가상 기업 조회",
    description: "whois -h 172.28.0.15 megacorp.internal 명령을 실행하여 가상 기업 등록 정보와 네임서버를 수집하세요.",
    target: "172.28.0.15:43",
    points: 100,
    flag: "FLAG{whois_recon_success}",
    status: "active",
    mitigationHint: "방어자: Whois 개인정보보호 서비스(Privacy Guard)를 활성화하여 민감 담당자 노출을 차단하세요.",
  },
  {
    id: "quest-axfr",
    order: 2,
    title: "수동 정보 수집: DNS Zone Transfer(AXFR) 분석",
    description: "dig axfr @172.28.0.15 megacorp.internal 명령으로 네임서버의 존 전송 설정 오류를 이용해 내부 서브도메인을 탈취하세요.",
    target: "172.28.0.15:53",
    points: 150,
    flag: "FLAG{axfr_zone_transferred}",
    status: "locked",
    mitigationHint: "방어자: BIND DNS 설정에서 'allow-transfer { none; };'를 적용하여 허용되지 않은 존 전송을 거부하세요.",
  },
  {
    id: "quest-s3",
    order: 3,
    title: "수동 정보 수집: 모의 AWS S3 공개 버킷 탐색",
    description: "발견된 backup-s3.megacorp.internal (포트 9000) 버킷에서 config.env 및 데이터베이스 패스워드를 획득하세요.",
    target: "172.28.0.20:9000",
    points: 200,
    flag: "FLAG{s3_bucket_leaked_creds}",
    status: "locked",
    mitigationHint: "방어자: S3 버킷의 'Block Public Access' 설정을 켜고 IAM 역할 기반 최소 권한을 부여하세요.",
  },
  {
    id: "quest-nmap-syn",
    order: 4,
    title: "능동 정보 수집: Nmap 스텔스 SYN 포트 스캔",
    description: "nmap -sS -p- 172.28.0.10 명령으로 타깃 서버의 열린 포트를 3-Way Handshake를 완성하지 않고 은밀히 스캔하세요.",
    target: "172.28.0.10",
    points: 150,
    flag: "FLAG{syn_scan_detected}",
    status: "locked",
    mitigationHint: "방어자: iptables 연결 추적(conntrack) 및 Snort IDS를 구성하여 단시간 SYN 패킷 폭증을 자동차단하세요.",
  },
  {
    id: "quest-msf-services",
    order: 5,
    title: "타깃 스캔: SMB 및 MSSQL 보조 모듈 정찰",
    description: "msfconsole의 scanner/smb/smb_version 및 mssql/mssql_ping 모듈을 활용하여 취약한 서비스 버전을 정밀 식별하세요.",
    target: "172.28.0.10:445, 172.28.0.12:1433",
    points: 200,
    flag: "FLAG{service_version_discovered}",
    status: "locked",
    mitigationHint: "방어자: 레거시 SMBv1을 비활성화하고 MSSQL 기본 포트(1433)를 변경하거나 외부 인바운드를 차단하세요.",
  },
  {
    id: "quest-custom-scanner",
    order: 6,
    title: "커스텀 스캐너: Ruby 자체 정찰 모듈 제작",
    description: "교재 3장의 커스텀 TCP 배너 그래버 템플릿을 수정하여 전용 모듈을 제작하고 타깃 서비스 배너를 획득하세요.",
    target: "172.28.0.10:21",
    points: 250,
    flag: "FLAG{custom_scanner_ruby_win}",
    status: "locked",
    mitigationHint: "방어자: FTP/SSH 배너 노출 설정을 침묵(banner off) 또는 페이크 버전으로 위장(honeypot)하세요.",
  },
];

export class ScenarioState extends EventEmitter {
  private quests: Quest[];
  private flagsFound: FlagSubmission[] = [];
  private scores: Record<"attacker" | "defender", number> = { attacker: 0, defender: 0 };
  private timeline: TimelineEntry[] = [];
  private subscribers = new Set<ISocket>();

  constructor(initialQuests?: Quest[]) {
    super();
    this.quests = JSON.parse(JSON.stringify(initialQuests || INITIAL_QUESTS));
  }

  /**
   * Returns current synchronized snapshot.
   */
  public getState(): ScenarioStateSnapshot {
    const completedCount = this.quests.filter((q) => q.status === "completed").length;
    return {
      quests: this.quests.map((q) => ({ ...q })),
      flagsFound: [...this.flagsFound],
      scores: { ...this.scores },
      timeline: [...this.timeline],
      totalQuests: this.quests.length,
      completedQuests: completedCount,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Submits a flag for validation.
   */
  public submitFlag(flagInput: string, role: Role = "attacker"): {
    success: boolean;
    quest?: Quest;
    message: string;
    pointsAwarded: number;
  } {
    const cleanFlag = flagInput.trim();
    if (!cleanFlag) {
      return { success: false, message: "플래그가 비어있습니다.", pointsAwarded: 0 };
    }

    // Find quest matching flag
    const targetQuest = this.quests.find((q) => q.flag.toLowerCase() === cleanFlag.toLowerCase());

    if (!targetQuest) {
      return { success: false, message: "유효하지 않은 플래그입니다.", pointsAwarded: 0 };
    }

    if (targetQuest.status === "completed") {
      return {
        success: false,
        quest: targetQuest,
        message: `이미 완료된 퀘스트입니다: ${targetQuest.title}`,
        pointsAwarded: 0,
      };
    }

    // Mark quest completed
    targetQuest.status = "completed";
    targetQuest.completedBy = role;
    targetQuest.completedAt = new Date().toISOString();

    const scoreRole = role === "observer" ? "attacker" : role;
    this.scores[scoreRole] += targetQuest.points;

    // Record submission
    const submission: FlagSubmission = {
      flag: targetQuest.flag,
      role,
      submittedAt: new Date().toISOString(),
      questId: targetQuest.id,
      success: true,
    };
    this.flagsFound.push(submission);

    // Record timeline
    this.timeline.push({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      role,
      message: `[${targetQuest.title}] 플래그 획득! (+${targetQuest.points}점)`,
      pointsDelta: targetQuest.points,
    });

    // Unlock next quest in order
    const nextQuest = this.quests.find((q) => q.order === targetQuest.order + 1);
    if (nextQuest && nextQuest.status === "locked") {
      nextQuest.status = "active";
    }

    // Broadcast state update
    this.broadcastState();
    this.emit("change", this.getState());

    return {
      success: true,
      quest: targetQuest,
      message: `정답입니다! '${targetQuest.title}' 클리어 (+${targetQuest.points}점)`,
      pointsAwarded: targetQuest.points,
    };
  }

  /**
   * Resets all quests to initial starting state.
   */
  public resetState(): void {
    this.quests = JSON.parse(JSON.stringify(INITIAL_QUESTS));
    this.flagsFound = [];
    this.scores = { attacker: 0, defender: 0 };
    this.timeline = [];
    this.broadcastState();
    this.emit("change", this.getState());
  }

  /**
   * Subscribes a WebSocket client to scenario updates.
   */
  public subscribe(ws: ISocket): void {
    this.subscribers.add(ws);

    // Send immediate snapshot
    try {
      ws.send(
        JSON.stringify({
          type: "scenario_snapshot",
          data: this.getState(),
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

  /**
   * Broadcasts the updated state to all connected scenario clients.
   */
  public broadcastState(): void {
    const payload = JSON.stringify({
      type: "scenario_snapshot",
      data: this.getState(),
    });

    for (const ws of this.subscribers) {
      try {
        ws.send(payload);
      } catch {
        this.subscribers.delete(ws);
      }
    }
  }
}
