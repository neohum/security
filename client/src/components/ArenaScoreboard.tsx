// ArenaScoreboard.tsx — Real-Time Leaderboard, Live Attack Trace & Hall of Fame for CTF Arena.
//
// Conforms to:
//   - Korean language first for UI copy.
//   - Symmetrical borders (border border-zinc-800), strictly NO border-l-4 rounded-*.
//   - Centered buttons/badges: inline-flex items-center justify-center leading-none.
//   - Flaticon UIcons regular rounded (fi fi-rr-*) only (NO inline SVG, NO Lucide, NO emoji).
//   - Korean line breaking (break-keep, text-balance, text-pretty, whitespace-nowrap).
//   - Dark theme styling (bg-zinc-950, bg-zinc-900, border-zinc-800, emerald/cyan/rose/amber accents).

export interface ScoreboardPlayer {
  rank: number;
  nickname: string;
  avatar: string; // e.g. "fi-rr-skull"
  points: number;
  compromisedCount: number;
  firstBloodCount: number;
  lastSubmissionTime?: string;
}

export interface AttackTraceEvent {
  id: string;
  timestamp: string; // e.g. "14:23:05"
  player: string;
  targetIp: string;
  category: string; // e.g. "DNS AXFR", "MSSQL"
  technique: string; // e.g. "영역 전송 취약점"
  points: number;
  isFirstBlood: boolean;
}

export type ScoreboardMatchStatus = "waiting" | "active" | "finished";

export interface ArenaScoreboardProps {
  status?: ScoreboardMatchStatus;
  remainingSeconds?: number;
  activePlayersCount?: number;
  players?: ScoreboardPlayer[];
  attackTraces?: AttackTraceEvent[];
  onBackToLobby?: () => void;
}

export const INITIAL_SCOREBOARD_PLAYERS: ScoreboardPlayer[] = [
  {
    rank: 1,
    nickname: "공격자1",
    avatar: "fi-rr-skull",
    points: 400,
    compromisedCount: 4,
    firstBloodCount: 2,
    lastSubmissionTime: "14:26:02",
  },
  {
    rank: 2,
    nickname: "CyberShadow",
    avatar: "fi-rr-ghost",
    points: 300,
    compromisedCount: 3,
    firstBloodCount: 1,
    lastSubmissionTime: "14:25:30",
  },
  {
    rank: 3,
    nickname: "PacketHunter",
    avatar: "fi-rr-bug",
    points: 200,
    compromisedCount: 2,
    firstBloodCount: 0,
    lastSubmissionTime: "14:24:55",
  },
  {
    rank: 4,
    nickname: "NetNinja",
    avatar: "fi-rr-user-secret",
    points: 100,
    compromisedCount: 1,
    firstBloodCount: 0,
    lastSubmissionTime: "14:23:40",
  },
];

export const INITIAL_ATTACK_TRACES: AttackTraceEvent[] = [
  {
    id: "trace-001",
    timestamp: "14:23:05",
    player: "공격자1",
    targetIp: "10.10.1.42",
    category: "DNS AXFR",
    technique: "영역 전송 취약점",
    points: 100,
    isFirstBlood: true,
  },
  {
    id: "trace-002",
    timestamp: "14:24:18",
    player: "CyberShadow",
    targetIp: "10.10.1.15",
    category: "Whois Recon",
    technique: "도메인 등록정보 취약점",
    points: 100,
    isFirstBlood: true,
  },
  {
    id: "trace-003",
    timestamp: "14:25:10",
    player: "PacketHunter",
    targetIp: "10.10.1.77",
    category: "Web Banner",
    technique: "경로 순회 배너 노출",
    points: 100,
    isFirstBlood: false,
  },
  {
    id: "trace-004",
    timestamp: "14:26:02",
    player: "공격자1",
    targetIp: "10.10.1.88",
    category: "MSSQL sa",
    technique: "관리자 인증 취약점",
    points: 100,
    isFirstBlood: false,
  },
];

/**
 * Format remaining seconds into mm:ss format.
 */
export function formatRemainingTime(seconds: number): string {
  const safeSec = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Resolve rank badge display element.
 */
export function getRankBadge(rank: number): {
  badgeHtml: string;
  rankText: string;
  borderClass: string;
} {
  switch (rank) {
    case 1:
      return {
        badgeHtml: `<span class="inline-flex items-center justify-center leading-none w-6 h-6 rounded border border-amber-500/60 bg-amber-950/60 text-amber-400 font-bold text-xs"><i class="fi fi-rr-crown flex items-center justify-center leading-none text-xs"></i></span>`,
        rankText: "1ST",
        borderClass: "border-amber-500/40 bg-amber-950/20",
      };
    case 2:
      return {
        badgeHtml: `<span class="inline-flex items-center justify-center leading-none w-6 h-6 rounded border border-slate-500/60 bg-slate-800/80 text-slate-200 font-bold text-xs"><i class="fi fi-rr-medal flex items-center justify-center leading-none text-xs"></i></span>`,
        rankText: "2ND",
        borderClass: "border-slate-700 bg-slate-900/30",
      };
    case 3:
      return {
        badgeHtml: `<span class="inline-flex items-center justify-center leading-none w-6 h-6 rounded border border-amber-800/60 bg-amber-950/30 text-amber-600 font-bold text-xs"><i class="fi fi-rr-medal flex items-center justify-center leading-none text-xs"></i></span>`,
        rankText: "3RD",
        borderClass: "border-zinc-800 bg-zinc-900/40",
      };
    default:
      return {
        badgeHtml: `<span class="inline-flex items-center justify-center leading-none w-6 h-6 rounded border border-zinc-800 bg-zinc-900 text-zinc-500 font-mono text-xs font-semibold">#${rank}</span>`,
        rankText: `#${rank}`,
        borderClass: "border-zinc-800 bg-zinc-900/20",
      };
  }
}

/**
 * Pure HTML string generator for ArenaScoreboard component.
 */
export function renderArenaScoreboardHtml(props: ArenaScoreboardProps = {}): string {
  const status: ScoreboardMatchStatus = props.status ?? "active";
  const remainingSeconds = props.remainingSeconds ?? 899; // 14:59 default
  const activePlayersCount = props.activePlayersCount ?? 4;
  const players = props.players ?? INITIAL_SCOREBOARD_PLAYERS;
  const attackTraces = props.attackTraces ?? INITIAL_ATTACK_TRACES;

  const formattedTimer = formatRemainingTime(remainingSeconds);
  const isFinished = status === "finished";

  // Hall of Fame view when match finishes
  if (isFinished) {
    const winner = players[0] || INITIAL_SCOREBOARD_PLAYERS[0]!;
    const top3 = players.slice(0, 3);
    const totalCompromised = players.reduce((sum, p) => sum + p.compromisedCount, 0);
    const totalPoints = players.reduce((sum, p) => sum + p.points, 0);

    const podiumHtml = top3
      .map((p) => {
        const rankInfo = getRankBadge(p.rank);
        return `
          <div class="podium-card p-4 rounded border ${rankInfo.borderClass} flex flex-col items-center justify-between text-center space-y-2">
            <div class="flex items-center justify-center">
              ${rankInfo.badgeHtml}
            </div>
            <div class="w-12 h-12 rounded border border-zinc-700 bg-zinc-800 flex items-center justify-center text-cyan-400">
              <i class="fi ${p.avatar} flex items-center justify-center leading-none text-xl"></i>
            </div>
            <div>
              <div class="font-bold text-sm text-zinc-100">${p.nickname}</div>
              <div class="text-[11px] font-mono text-emerald-400 font-semibold mt-0.5">${p.points} PT</div>
            </div>
            <div class="text-[10px] text-zinc-400 font-mono space-y-0.5 border-t border-zinc-800/80 pt-2 w-full">
              <div>탈취 서버: ${p.compromisedCount}개</div>
              <div>First Blood: ${p.firstBloodCount}회</div>
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <div class="arena-hall-of-fame-root w-full h-full p-6 bg-zinc-950 text-zinc-100 flex flex-col justify-between overflow-y-auto space-y-6">
        <!-- Hall of Fame Header -->
        <div class="text-center space-y-2">
          <div class="inline-flex items-center justify-center leading-none px-3 py-1 rounded border border-amber-500/50 bg-amber-950/40 text-amber-300 font-mono text-xs uppercase tracking-wider">
            <i class="fi fi-rr-crown mr-1.5 flex items-center justify-center leading-none text-amber-400"></i>
            CTF ARENA CHAMPIONSHIP — 공식 경기 종료
          </div>
          <h1 class="text-2xl md:text-3xl font-extrabold text-zinc-100 tracking-tight break-keep text-balance">
            명예의 전당 (Hall of Fame) 결과 발표
          </h1>
          <p class="text-xs text-zinc-400 max-w-xl mx-auto break-keep text-pretty">
            15분간의 치열한 가상 인터넷 200 노드 침투 경쟁이 종료되었습니다. 최종 순위와 최고 득점자 명단입니다.
          </p>
        </div>

        <!-- Champion Spotlight Banner -->
        <div class="p-6 rounded border border-amber-500/60 bg-amber-950/30 text-center relative overflow-hidden space-y-3">
          <div class="inline-flex items-center justify-center leading-none w-14 h-14 rounded border border-amber-400/80 bg-amber-900/50 text-amber-300 mx-auto">
            <i class="fi fi-rr-trophy flex items-center justify-center leading-none text-2xl text-amber-300"></i>
          </div>
          <div>
            <span class="inline-flex items-center justify-center leading-none px-2 py-0.5 text-[10px] font-mono rounded border border-amber-500/50 bg-amber-950/60 text-amber-300 uppercase mb-1">
              최종 우승자 (Grand Champion)
            </span>
            <div class="text-2xl font-black text-amber-200 tracking-tight">${winner.nickname}</div>
            <div class="text-sm font-mono text-emerald-400 font-bold mt-1">
              총 ${winner.points} PT 획득 • 노드 ${winner.compromisedCount}개 탈취 • First Blood ${winner.firstBloodCount}회
            </div>
          </div>
        </div>

        <!-- Top 3 Podium Grid -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${podiumHtml}
        </div>

        <!-- Aggregate Match Stats -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded border border-zinc-800 bg-zinc-900/40 text-center">
          <div>
            <div class="text-[10px] text-zinc-500 break-keep">총 탈취 노드</div>
            <div class="text-base font-bold font-mono text-emerald-400 mt-0.5">${totalCompromised} / 60</div>
          </div>
          <div>
            <div class="text-[10px] text-zinc-500 break-keep">누적 점수</div>
            <div class="text-base font-bold font-mono text-cyan-400 mt-0.5">${totalPoints} PT</div>
          </div>
          <div>
            <div class="text-[10px] text-zinc-500 break-keep">참가자 수</div>
            <div class="text-base font-bold font-mono text-zinc-200 mt-0.5">${players.length}명</div>
          </div>
          <div>
            <div class="text-[10px] text-zinc-500 break-keep">철통보안 방어율</div>
            <div class="text-base font-bold font-mono text-indigo-400 mt-0.5">100% (140/140)</div>
          </div>
        </div>

        <!-- Bottom Action Button -->
        <div class="flex items-center justify-center pt-2">
          <button type="button" class="btn-back-to-lobby inline-flex items-center justify-center leading-none px-6 py-3 rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition-colors whitespace-nowrap">
            <i class="fi fi-rr-arrow-left mr-2 flex items-center justify-center leading-none"></i>
            대기실(Lobby)로 복귀
          </button>
        </div>
      </div>
    `;
  }

  // Active / Waiting match view
  const rankingRowsHtml = players
    .map((p) => {
      const rankInfo = getRankBadge(p.rank);
      const isTop3 = p.rank <= 3;
      const rowBg = isTop3 ? "bg-zinc-900/80" : "bg-zinc-950/40";

      return `
        <tr class="ranking-row border-b border-zinc-800/80 ${rowBg} hover:bg-zinc-800/50 transition-colors" data-rank="${p.rank}" data-player="${p.nickname}">
          <td class="py-2.5 px-3 whitespace-nowrap">
            <div class="flex items-center gap-1.5">
              ${rankInfo.badgeHtml}
            </div>
          </td>
          <td class="py-2.5 px-3">
            <div class="flex items-center gap-2 min-w-0">
              <i class="fi ${p.avatar} flex items-center justify-center leading-none text-sm text-cyan-400"></i>
              <span class="font-semibold text-xs text-zinc-200 truncate">${p.nickname}</span>
            </div>
          </td>
          <td class="py-2.5 px-3 text-right font-mono font-bold text-xs text-emerald-400 whitespace-nowrap">
            +${p.points} PT
          </td>
          <td class="py-2.5 px-3 text-center font-mono text-xs text-zinc-300 whitespace-nowrap">
            ${p.compromisedCount}개
          </td>
          <td class="py-2.5 px-3 text-center whitespace-nowrap">
            ${
              p.firstBloodCount > 0
                ? `<span class="inline-flex items-center justify-center leading-none px-1.5 py-0.5 rounded border border-rose-500/50 bg-rose-950/40 text-rose-400 font-mono text-[10px] font-bold">
                     <i class="fi fi-rr-flame mr-1 flex items-center justify-center leading-none text-[9px]"></i>${p.firstBloodCount}
                   </span>`
                : `<span class="text-zinc-600 font-mono text-xs">-</span>`
            }
          </td>
        </tr>
      `;
    })
    .join("");

  const attackTraceFeedHtml = attackTraces
    .map((trace) => {
      const firstBloodBadge = trace.isFirstBlood
        ? `<span class="inline-flex items-center justify-center leading-none px-1.5 py-0.5 rounded border border-rose-500/60 bg-rose-950/60 text-rose-300 font-mono text-[9px] font-black tracking-wide whitespace-nowrap">
             <i class="fi fi-rr-flame mr-1 flex items-center justify-center leading-none text-[9px]"></i>FIRST BLOOD!
           </span>`
        : "";

      return `
        <div class="attack-trace-item p-2.5 rounded border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 transition-colors space-y-1" data-trace-id="${trace.id}">
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-mono text-zinc-500 text-[10px]">[${trace.timestamp}]</span>
              <span class="font-bold text-cyan-300 truncate">[${trace.player}]</span>
              <span class="text-zinc-400 break-keep">님이</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <span class="inline-flex items-center justify-center leading-none px-1.5 py-0.5 rounded border border-emerald-500/50 bg-emerald-950/40 font-mono text-emerald-400 text-[10px] font-bold">
                +${trace.points} PT
              </span>
              ${firstBloodBadge}
            </div>
          </div>
          <div class="text-xs text-zinc-300 break-keep text-pretty">
            <span class="font-mono text-emerald-400 font-semibold">${trace.targetIp}</span>
            <span class="text-zinc-400">(${trace.category})</span>
            <span>${trace.technique}을(를) 탈취했습니다!</span>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="arena-scoreboard-root w-full h-full p-4 md:p-6 bg-zinc-950 text-zinc-100 flex flex-col space-y-4 overflow-y-auto">
      <!-- Match Header with Countdown & Player Stats -->
      <div class="flex flex-col md:flex-row md:items-center justify-between pb-3 border-b border-zinc-800 gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded border border-zinc-800 bg-zinc-900 flex items-center justify-center text-amber-400 shrink-0">
            <i class="fi fi-rr-trophy flex items-center justify-center leading-none text-lg"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center justify-center leading-none px-2 py-0.5 text-[10px] font-mono rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-400">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5"></span>대회 진행 중 (Active)
              </span>
              <span class="text-xs text-zinc-500 font-mono">15 MIN TIMELIMIT</span>
            </div>
            <h2 class="text-base md:text-lg font-bold text-zinc-100 tracking-tight mt-0.5 break-keep text-balance">
              실시간 순위표 및 실시간 공격 추적 피드
            </h2>
          </div>
        </div>

        <!-- Timer & Player Counter -->
        <div class="flex items-center gap-3">
          <!-- Countdown Timer Box -->
          <div class="p-2 px-3 rounded border border-zinc-800 bg-zinc-900/80 flex items-center gap-2.5">
            <i class="fi fi-rr-clock text-amber-400 flex items-center justify-center leading-none text-base"></i>
            <div>
              <div class="text-[9px] text-zinc-500 uppercase font-mono leading-none">남은 시간</div>
              <div class="text-base font-extrabold font-mono text-amber-300 leading-tight">${formattedTimer}</div>
            </div>
          </div>

          <!-- Active Players Box -->
          <div class="p-2 px-3 rounded border border-zinc-800 bg-zinc-900/80 flex items-center gap-2.5">
            <i class="fi fi-rr-users text-cyan-400 flex items-center justify-center leading-none text-base"></i>
            <div>
              <div class="text-[9px] text-zinc-500 uppercase font-mono leading-none">접속 인원</div>
              <div class="text-base font-extrabold font-mono text-cyan-300 leading-tight">${activePlayersCount}명</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Layout: Real-Time Ranking Table (Left) + Attack Trace Feed (Right) -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1">
        <!-- Ranking Table Card -->
        <div class="p-4 rounded border border-zinc-800 bg-zinc-900/40 flex flex-col justify-between space-y-3">
          <div>
            <div class="flex items-center justify-between pb-2 border-b border-zinc-800">
              <h3 class="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5 break-keep">
                <i class="fi fi-rr-crown text-amber-400 flex items-center justify-center leading-none"></i>실시간 리더보드 순위표
              </h3>
              <span class="text-[10px] text-zinc-500 font-mono">LIVE RANKING</span>
            </div>

            <!-- Table -->
            <div class="overflow-x-auto mt-2">
              <table class="w-full text-left text-xs border-collapse">
                <thead>
                  <tr class="border-b border-zinc-800 text-[10px] uppercase font-mono text-zinc-500">
                    <th class="py-2 px-3">순위</th>
                    <th class="py-2 px-3">참가자</th>
                    <th class="py-2 px-3 text-right">점수</th>
                    <th class="py-2 px-3 text-center">탈취</th>
                    <th class="py-2 px-3 text-center">First Blood</th>
                  </tr>
                </thead>
                <tbody>
                  ${rankingRowsHtml}
                </tbody>
              </table>
            </div>
          </div>

          <div class="text-[10px] text-zinc-500 border-t border-zinc-800/80 pt-2 flex items-center justify-between break-keep">
            <span>취약 서버 탈취 시 +100 PT (First Blood 달성 시 추가 보너스)</span>
            <span class="font-mono">동점 시 최단 시간 우선</span>
          </div>
        </div>

        <!-- Live Attack Trace Feed Card -->
        <div class="p-4 rounded border border-zinc-800 bg-zinc-900/40 flex flex-col space-y-3">
          <div class="flex items-center justify-between pb-2 border-b border-zinc-800">
            <h3 class="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5 break-keep">
              <i class="fi fi-rr-flame text-rose-400 flex items-center justify-center leading-none"></i>실시간 공격 추적 (Live Attack Trace)
            </h3>
            <span class="inline-flex items-center justify-center leading-none px-2 py-0.5 text-[10px] font-mono rounded border border-rose-500/40 bg-rose-950/30 text-rose-400">
              <span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping mr-1"></span>TRACE STREAM
            </span>
          </div>

          <div class="text-[11px] text-zinc-400 break-keep">
            누가 어느 단계를 통해 어느 서버를 탈취했는지 실시간 타임라인으로 기록됩니다:
          </div>

          <!-- Scrolling Trace Feed -->
          <div class="attack-trace-feed space-y-2 overflow-y-auto max-h-[380px] pr-1 flex-1">
            ${attackTraceFeedHtml}
          </div>

          <div class="text-[10px] text-zinc-500 border-t border-zinc-800/80 pt-2 flex items-center justify-between font-mono">
            <span>실시간 백엔드 가상 소켓 이벤트 수신 중</span>
            <span>최근 25건 기록 보관</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Interactive React component wrapper for ArenaScoreboard.
 */
export function ArenaScoreboard(props: ArenaScoreboardProps) {
  return {
    type: "ArenaScoreboard",
    props,
    renderHtml: () => renderArenaScoreboardHtml(props),
  };
}

export default ArenaScoreboard;
