import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ISocket } from "./pty-manager.ts";
import type { Role } from "./lan-manager.ts";
import {
  isMssqlBruteforce,
  isS3BucketEnumeration,
  isCustomRubyScanner,
} from "./scenario-missions.ts";

export type QuestStatus = "locked" | "active" | "completed";

export interface Quest {
  id: string;
  order: number;
  title: string;
  description: string;
  target: string;
  points: number;
  flag: string;
  aliases?: string[];
  idAliases?: string[];
  status: QuestStatus;
  completedBy?: Role;
  completedAt?: string;
  mitigationHint?: string;
  validationPattern?: string;
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
    aliases: [
      "FLAG{WHOIS_RECON_SUCCESS}",
      "FLAG{whois_megacorp_admin_discovered}",
    ],
    idAliases: ["m1-whois", "recon-whois-01"],
    status: "active",
    mitigationHint: "방어자: Whois 개인정보보호 서비스(Privacy Guard)를 활성화하여 민감 담당자 노출을 차단하세요.",
    validationPattern: "(whois.*megacorp\\.internal|admin@megacorp\\.internal|OrgName:\\s*MegaCorp|whois_recon_success)",
  },
  {
    id: "quest-axfr",
    order: 2,
    title: "수동 정보 수집: DNS Zone Transfer(AXFR) 분석",
    description: "dig axfr @172.28.0.15 megacorp.internal 명령으로 네임서버의 존 전송 설정 오류를 이용해 내부 서브도메인을 탈취하세요.",
    target: "172.28.0.15:53",
    points: 150,
    flag: "FLAG{axfr_zone_transferred}",
    aliases: [
      "FLAG{ZONE_TRANSFER_EXPOSED}",
      "FLAG{axfr_zone_transfer_subdomains_leaked}",
    ],
    idAliases: ["m2-dns-axfr", "recon-dns-axfr-03"],
    status: "locked",
    mitigationHint: "방어자: BIND DNS 설정에서 'allow-transfer { none; };'를 적용하여 허용되지 않은 존 전송을 거부하세요.",
    validationPattern: "(dig\\s+axfr\\s+@172\\.28\\.0\\.15|host\\s+-l\\s+megacorp\\.internal|zone_transfer_exposed|axfr_zone_transferred)",
  },
  {
    id: "quest-nmap-syn",
    order: 3,
    title: "능동 정보 수집: Nmap 스텔스 SYN 포트 스캔 (db_nmap)",
    description: "nmap -sS -p- 172.28.0.10 또는 msf db_nmap 명령으로 타깃 서버의 열린 포트를 은밀히 스캔하세요.",
    target: "172.28.0.10",
    points: 150,
    flag: "FLAG{syn_scan_detected}",
    aliases: [
      "FLAG{MSF_DB_NMAP_RECORDED}",
      "FLAG{nmap_syn_stealth_scan_completed}",
      "FLAG{msf_auxiliary_portscan_tcp_success}",
    ],
    idAliases: ["m3-db-nmap", "scan-nmap-syn-04", "scan-msf-portscan-05"],
    status: "locked",
    mitigationHint: "방어자: iptables 연결 추적(conntrack) 및 Snort IDS를 구성하여 단시간 SYN 패킷 폭증을 자동차단하세요.",
    validationPattern: "(nmap.*-sS.*172\\.28\\.0\\.10|db_nmap.*|21/tcp\\s+open|22/tcp\\s+open|syn_scan_detected|msf_db_nmap_recorded)",
  },
  {
    id: "quest-mssql-login",
    order: 4,
    title: "타깃 스캔: MSSQL sa 관리자 브루트포스 (mssql_login)",
    description: "auxiliary/scanner/mssql/mssql_login 모듈 또는 mssql_ping을 활용해 취약한 MSSQL 인스턴스(172.28.0.30)의 관리자 비밀번호를 획득하세요.",
    target: "172.28.0.30:1433",
    points: 200,
    flag: "FLAG{MSSQL_SA_PWNED}",
    aliases: [
      "FLAG{mssql_instance_ping_confirmed}",
      "FLAG{service_version_discovered}",
      "FLAG{mssql_login_sa_success}",
      "FLAG{mssql_sa_pwned}",
    ],
    idAliases: ["quest-msf-services", "m4-mssql-login", "service-mssql-ping-07", "mssql"],
    status: "locked",
    mitigationHint: "방어자: sa 기본 계정을 비활성화하고 강력한 복합 암호를 설정하며 MSSQL 기본 포트(1433) 외부 인바운드를 차단하세요.",
    validationPattern: "(auxiliary/scanner/mssql/mssql_(?:ping|login)|172\\.28\\.0\\.30(?::1433)?|SQL\\s*Server|InstanceName|Login\\s+Successful|sa:Password123!|MSSQL_SA_PWNED)",
  },
  {
    id: "quest-s3",
    order: 5,
    title: "클라우드 스토리지: Fake S3 오픈 버킷 탐색 및 config.env 노출",
    description: "발견된 backup-s3.megacorp.internal (포트 9000) 버킷에서 curl 또는 aws cli로 config.env 및 데이터베이스 패스워드를 획득하세요.",
    target: "172.28.0.25:9000",
    points: 200,
    flag: "FLAG{S3_CONFIDENTIAL_LEAK}",
    aliases: [
      "FLAG{s3_open_bucket_config_env_leaked}",
      "FLAG{s3_bucket_leaked_creds}",
      "FLAG{s3_confidential_leak}",
    ],
    idAliases: ["m5-s3-leak", "service-s3-bucket-08", "s3"],
    status: "locked",
    mitigationHint: "방어자: S3 버킷의 'Block Public Access' 설정을 켜고 IAM 역할 기반 최소 권한을 부여하세요.",
    validationPattern: "(curl.*(?:172\\.28\\.0\\.(?:15|20|25):9000|backup-s3).*|s3://megacorp-backup|config\\.env|db_passwords\\.txt|S3_CONFIDENTIAL_LEAK|s3_bucket_leaked|AWS_ACCESS_KEY_ID)",
  },
  {
    id: "quest-custom-scanner",
    order: 6,
    title: "커스텀 스캐너: Ruby 자체 정찰 모듈 (banner.rb / custom_tcp_banner.rb) 제작 및 실행",
    description: "교재 3장의 Msf::Exploit::Remote::Tcp 믹스인을 사용한 custom_tcp_banner.rb (banner.rb) 스캐너 모듈을 작성하고 타깃 서비스 배너를 획득하세요.",
    target: "172.28.0.20:21",
    points: 250,
    flag: "FLAG{CUSTOM_RUBY_BANNER_GRABBED}",
    aliases: [
      "FLAG{custom_ruby_tcp_scanner_executed_successfully}",
      "FLAG{custom_scanner_ruby_win}",
      "FLAG{custom_ruby_banner_grabbed}",
    ],
    idAliases: ["m6-custom-scanner", "custom-scanner-ruby-12", "banner"],
    status: "locked",
    mitigationHint: "방어자: FTP/SSH 배너 노출 설정을 침묵(banner off) 또는 페이크 버전으로 위장(honeypot)하세요.",
    validationPattern: "(custom_tcp_banner|banner\\.rb|Msf::Auxiliary::Scanner|BANNER:.*172\\.28\\.0\\.20|Received\\s+banner|220\\s*\\(vsFTPd|CUSTOM_RUBY_BANNER_GRABBED|custom_ruby_tcp_scanner|custom_scanner_ruby)",
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
   * Finds a quest by order number, ID, or alias.
   */
  public getQuest(idOrOrder: string | number): Quest | undefined {
    const key = String(idOrOrder).trim().toLowerCase();
    return this.quests.find(
      (q) =>
        String(q.order) === key ||
        q.id.toLowerCase() === key ||
        q.idAliases?.some((a) => a.toLowerCase() === key)
    );
  }

  /**
   * Submits a flag for validation.
   */
  public submitFlag(
    flagInput: string,
    role: Role = "attacker",
    questIdOrOrder?: string | number
  ): {
    success: boolean;
    quest?: Quest;
    message: string;
    pointsAwarded: number;
  } {
    if (!flagInput || typeof flagInput !== "string") {
      return { success: false, message: "플래그가 비어있습니다.", pointsAwarded: 0 };
    }
    const cleanFlag = flagInput.trim();
    if (!cleanFlag) {
      return { success: false, message: "플래그가 비어있습니다.", pointsAwarded: 0 };
    }

    // Find quest matching flag
    let targetQuest: Quest | undefined;

    if (questIdOrOrder !== undefined) {
      const explicit = this.getQuest(questIdOrOrder);
      if (
        explicit &&
        (explicit.flag.toLowerCase() === cleanFlag.toLowerCase() ||
          explicit.aliases?.some((a) => a.toLowerCase() === cleanFlag.toLowerCase()))
      ) {
        targetQuest = explicit;
      }
    }

    if (!targetQuest) {
      targetQuest = this.quests.find(
        (q) =>
          q.flag.toLowerCase() === cleanFlag.toLowerCase() ||
          q.aliases?.some((a) => a.toLowerCase() === cleanFlag.toLowerCase())
      );
    }

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
   * Automatically evaluates terminal commands and stdout outputs against quests,
   * awarding points and completing quests on detection without manual flag entry.
   */
  public evaluateCommand(
    command: string,
    stdout = "",
    role: Role = "attacker"
  ): {
    matched: boolean;
    quest?: Quest;
    message: string;
    pointsAwarded: number;
    alreadyCompleted?: boolean;
  } {
    const cmd = (command || "").trim();
    const out = (stdout || "").trim();
    if (!cmd && !out) {
      return { matched: false, message: "명령어 또는 출력이 없습니다.", pointsAwarded: 0 };
    }

    // Search active quests first, then locked quests
    const candidates = [
      ...this.quests.filter((q) => q.status === "active"),
      ...this.quests.filter((q) => q.status === "locked"),
    ];

    for (const q of candidates) {
      let isMatch = false;

      if (q.order === 4 || q.id === "quest-mssql-login") {
        isMatch = isMssqlBruteforce(cmd, out);
      } else if (q.order === 5 || q.id === "quest-s3") {
        isMatch = isS3BucketEnumeration(cmd, out);
      } else if (q.order === 6 || q.id === "quest-custom-scanner") {
        isMatch = isCustomRubyScanner(cmd, out);
      } else if (q.validationPattern) {
        try {
          const regex = new RegExp(q.validationPattern, "i");
          isMatch = regex.test(`${cmd}\n${out}`);
        } catch {}
      }

      if (!isMatch) {
        if (out.includes(q.flag) || cmd.includes(q.flag)) {
          isMatch = true;
        } else if (q.aliases?.some((a) => out.includes(a) || cmd.includes(a))) {
          isMatch = true;
        }
      }

      if (isMatch) {
        const res = this.submitFlag(q.flag, role);
        return {
          matched: true,
          quest: q,
          message: res.message,
          pointsAwarded: res.pointsAwarded,
          alreadyCompleted: !res.success && res.message.includes("이미 완료"),
        };
      }
    }

    return {
      matched: false,
      message: "일치하는 퀘스트 진행 조건이 없습니다.",
      pointsAwarded: 0,
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
