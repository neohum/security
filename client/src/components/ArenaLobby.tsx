// ArenaLobby.tsx — Match preparation lobby component for CTF Competition Arena.
//
// Conforms to:
//   - Korean language first for UI copy.
//   - Symmetrical borders (border border-zinc-800), strictly NO border-l-4 rounded-*.
//   - Centered buttons/badges: inline-flex items-center justify-center leading-none.
//   - Flaticon UIcons regular rounded (fi fi-rr-*) only (NO inline SVG, NO Lucide, NO emoji).
//   - Korean line breaking (break-keep, text-balance, text-pretty, whitespace-nowrap).
//   - Dark theme styling (bg-zinc-950, bg-zinc-900, border-zinc-800, emerald/cyan/rose/amber accents).

export interface ArenaParticipant {
  id: string;
  nickname: string;
  ip: string;
  avatar: string; // e.g. "fi-rr-skull"
  avatarLabel: string; // e.g. "해커"
  isReady: boolean;
  isHost: boolean;
  joinedAt: string;
}

export interface ArenaMatchConfig {
  title: string;
  hostIp: string;
  hostPort: number;
  sshPort: number;
  totalNodes: number;
  vulnerableNodes: number;
  hardenedNodes: number;
  durationMinutes: number;
  categoriesCount: number;
}

export type LobbyStatus = "waiting" | "starting" | "active" | "finished";

export interface AvatarOption {
  id: string;
  label: string;
  icon: string;
}

export const AVATAR_OPTIONS: AvatarOption[] = [
  { id: "skull", label: "해커", icon: "fi-rr-skull" },
  { id: "ghost", label: "고스트", icon: "fi-rr-ghost" },
  { id: "user-secret", label: "닌자", icon: "fi-rr-user-secret" },
  { id: "bug", label: "바이퍼", icon: "fi-rr-bug" },
  { id: "bolt", label: "볼트", icon: "fi-rr-bolt" },
  { id: "shield", label: "가디언", icon: "fi-rr-shield" },
];

export const DEFAULT_MATCH_CONFIG: ArenaMatchConfig = {
  title: "가상 인터넷 200 노드 CTF 아레나 대기실",
  hostIp: "192.168.1.112",
  hostPort: 3000,
  sshPort: 2222,
  totalNodes: 200,
  vulnerableNodes: 60,
  hardenedNodes: 140,
  durationMinutes: 15,
  categoriesCount: 6,
};

export const INITIAL_LOBBY_PARTICIPANTS: ArenaParticipant[] = [
  {
    id: "p-host",
    nickname: "RedCommander",
    ip: "192.168.1.112",
    avatar: "fi-rr-skull",
    avatarLabel: "해커",
    isReady: true,
    isHost: true,
    joinedAt: "14:20:00",
  },
  {
    id: "p-02",
    nickname: "CyberShadow",
    ip: "192.168.1.105",
    avatar: "fi-rr-ghost",
    avatarLabel: "고스트",
    isReady: true,
    isHost: false,
    joinedAt: "14:21:12",
  },
  {
    id: "p-03",
    nickname: "PacketHunter",
    ip: "192.168.1.118",
    avatar: "fi-rr-bug",
    avatarLabel: "바이퍼",
    isReady: false,
    isHost: false,
    joinedAt: "14:21:45",
  },
];

export interface ArenaLobbyProps {
  status?: LobbyStatus;
  countdown?: number; // countdown seconds when starting (e.g. 5, 4, 3, 2, 1)
  config?: Partial<ArenaMatchConfig>;
  participants?: ArenaParticipant[];
  currentUserId?: string;
  selectedAvatar?: string;
  nicknameInput?: string;
  onStartMatch?: () => void;
  onToggleReady?: () => void;
  onJoin?: (nickname: string, avatar: string) => void;
}

/**
 * Pure HTML string generator for ArenaLobby component (SSR & headless rendering).
 */
export function renderArenaLobbyHtml(props: ArenaLobbyProps = {}): string {
  const status = props.status ?? "waiting";
  const countdown = props.countdown ?? 5;
  const config: ArenaMatchConfig = {
    ...DEFAULT_MATCH_CONFIG,
    ...(props.config ?? {}),
  };
  const participants = props.participants ?? INITIAL_LOBBY_PARTICIPANTS;
  const selectedAvatar = props.selectedAvatar ?? "skull";
  const nicknameInput = props.nicknameInput ?? "";
  const currentUserId = props.currentUserId ?? "p-host";

  const accessUrl = `http://${config.hostIp}:${config.hostPort}/arena`;
  const sshCmd = `ssh -p ${config.sshPort || 2222} ${nicknameInput || "player"}@${config.hostIp}`;
  const readyCount = participants.filter((p) => p.isReady).length;
  const isStarting = status === "starting";
  const isActive = status === "active";

  const participantsListHtml = participants
    .map((p) => {
      const isCurrentUser = p.id === currentUserId;
      const readyBadge = p.isReady
        ? `<span class="inline-flex items-center justify-center leading-none px-2 py-0.5 text-[11px] font-mono rounded border border-emerald-500/50 bg-emerald-950/40 text-emerald-400 whitespace-nowrap">
             <i class="fi fi-rr-check mr-1 flex items-center justify-center leading-none"></i>준비 완료
           </span>`
        : `<span class="inline-flex items-center justify-center leading-none px-2 py-0.5 text-[11px] font-mono rounded border border-amber-500/50 bg-amber-950/40 text-amber-400 whitespace-nowrap">
             <i class="fi fi-rr-clock mr-1 flex items-center justify-center leading-none"></i>준비 중
           </span>`;

      const hostBadge = p.isHost
        ? `<span class="inline-flex items-center justify-center leading-none px-1.5 py-0.5 text-[10px] font-mono rounded border border-indigo-500/50 bg-indigo-950/40 text-indigo-300 whitespace-nowrap">
             <i class="fi fi-rr-crown mr-1 flex items-center justify-center leading-none text-indigo-400"></i>방장
           </span>`
        : "";

      return `
        <div class="participant-item flex items-center justify-between p-3 rounded border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 transition-colors" data-participant-id="${p.id}">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 rounded border border-zinc-700 bg-zinc-800 flex items-center justify-center text-cyan-400 shrink-0">
              <i class="fi ${p.avatar} flex items-center justify-center leading-none text-base"></i>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-xs text-zinc-100 truncate">${p.nickname}</span>
                ${isCurrentUser ? '<span class="inline-flex items-center justify-center leading-none px-1.5 py-0.2 text-[9px] rounded border border-cyan-500/40 bg-cyan-950/30 text-cyan-300">나</span>' : ""}
                ${hostBadge}
              </div>
              <div class="text-[11px] text-zinc-500 font-mono flex items-center gap-2 mt-0.5">
                <span>IP: ${p.ip}</span>
                <span>•</span>
                <span>입장: ${p.joinedAt}</span>
              </div>
            </div>
          </div>
          <div class="shrink-0 ml-3">
            ${readyBadge}
          </div>
        </div>
      `;
    })
    .join("");

  const avatarSelectorHtml = AVATAR_OPTIONS.map((av) => {
    const isSelected = av.id === selectedAvatar;
    const border = isSelected
      ? "border-cyan-400 bg-cyan-950/50 text-cyan-300 ring-1 ring-cyan-400/50"
      : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200";

    return `
      <button type="button" class="avatar-option-btn inline-flex items-center justify-center leading-none flex-col gap-1 p-2 rounded border ${border} transition-all" data-avatar-id="${av.id}">
        <i class="fi ${av.icon} flex items-center justify-center leading-none text-base"></i>
        <span class="text-[10px] font-sans break-keep">${av.label}</span>
      </button>
    `;
  }).join("");

  // Countdown overlay banner when transitioning to active
  const countdownBannerHtml = isStarting
    ? `
      <div class="countdown-overlay mb-6 p-4 rounded border border-amber-500/60 bg-amber-950/40 text-center animate-pulse">
        <div class="inline-flex items-center justify-center leading-none text-amber-400 text-xs font-mono uppercase tracking-wider mb-1">
          <i class="fi fi-rr-flame mr-1.5 flex items-center justify-center leading-none text-amber-400"></i>
          경기 시작 카운트다운
        </div>
        <div class="text-3xl font-extrabold text-amber-300 font-mono tracking-tight my-1">
          ${countdown}
        </div>
        <p class="text-xs text-amber-200/90 break-keep text-balance">
          잠시 후 200개 가상 모의 인터넷 서버가 전면 개방됩니다. 콘솔을 준비하세요!
        </p>
      </div>
    `
    : "";

  return `
    <div class="arena-lobby-root w-full h-full p-4 md:p-6 bg-zinc-950 text-zinc-100 flex flex-col overflow-y-auto">
      <!-- Lobby Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-zinc-800 gap-4 mb-6">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="inline-flex items-center justify-center leading-none px-2 py-0.5 text-[10px] font-mono rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-400 uppercase">
              <i class="fi fi-rr-wifi mr-1 flex items-center justify-center leading-none"></i>Wi-Fi LAN ARENA
            </span>
            <span class="text-xs text-zinc-500 font-mono">15-MINUTE TIMED MATCH</span>
          </div>
          <h1 class="text-xl md:text-2xl font-bold text-zinc-100 tracking-tight break-keep text-balance">
            ${config.title}
          </h1>
          <p class="text-xs text-zinc-400 mt-1 break-keep text-pretty">
            윈도우 단일 호스트 초경량 가상 인터넷 기반 실시간 침투 경쟁 아레나입니다. 참가자 전원이 준비되면 방장이 대회를 시작합니다.
          </p>
        </div>

        <!-- Connection Info Boxes (Web + Native SSH) -->
        <div class="flex flex-col sm:flex-row gap-3">
          <!-- Wi-Fi Web Access -->
          <div class="p-3 rounded border border-zinc-800 bg-zinc-900/80 flex flex-col justify-center min-w-[240px]">
            <div class="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
              <span class="font-semibold text-zinc-300 flex items-center gap-1.5 break-keep">
                <i class="fi fi-rr-wifi text-cyan-400 flex items-center justify-center leading-none"></i>Wi-Fi LAN 접속 안내
              </span>
              <span class="text-[10px] font-mono text-emerald-400">포트: ${config.hostPort}</span>
            </div>
            <div class="flex items-center justify-between gap-2 p-1.5 rounded border border-zinc-800 bg-zinc-950 font-mono text-xs text-cyan-400">
              <span class="truncate selection-all font-semibold">${accessUrl}</span>
              <button type="button" class="btn-copy-lobby-url inline-flex items-center justify-center leading-none px-2 py-1 text-[10px] text-zinc-300 hover:text-white bg-zinc-800 rounded border border-zinc-700 whitespace-nowrap" data-url="${accessUrl}">
                <i class="fi fi-rr-copy mr-1 flex items-center justify-center leading-none"></i>복사
              </button>
            </div>
          </div>

          <!-- Native SSH Terminal Access -->
          <div class="p-3 rounded border border-indigo-500/40 bg-indigo-950/20 flex flex-col justify-center min-w-[260px]">
            <div class="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
              <span class="font-semibold text-indigo-300 flex items-center gap-1.5 break-keep">
                <i class="fi fi-rr-terminal text-indigo-400 flex items-center justify-center leading-none"></i>개인 터미널 SSH 접속
              </span>
              <span class="text-[10px] font-mono text-indigo-400">포트: ${config.sshPort || 2222}</span>
            </div>
            <div class="flex items-center justify-between gap-2 p-1.5 rounded border border-indigo-500/30 bg-zinc-950 font-mono text-xs text-indigo-300">
              <span class="truncate selection-all font-semibold">${sshCmd}</span>
              <button type="button" class="btn-copy-ssh-cmd inline-flex items-center justify-center leading-none px-2 py-1 text-[10px] text-zinc-300 hover:text-white bg-indigo-950/80 hover:bg-indigo-900 rounded border border-indigo-500/40 whitespace-nowrap" data-cmd="${sshCmd}">
                <i class="fi fi-rr-copy mr-1 flex items-center justify-center leading-none"></i>복사
              </button>
            </div>
          </div>
        </div>
      </div>

      ${countdownBannerHtml}

      <!-- Main Lobby Grid: Nickname/Config & Participants -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        <!-- Column 1 & 2: Match Config Summary & Nickname Setup -->
        <div class="lg:col-span-1 space-y-6 flex flex-col">
          <!-- Nickname & Avatar Card -->
          <div class="p-4 rounded border border-zinc-800 bg-zinc-900/50 space-y-4">
            <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2">
              <h2 class="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5 break-keep">
                <i class="fi fi-rr-user text-cyan-400 flex items-center justify-center leading-none"></i>참가자 프로필 설정
              </h2>
              <span class="text-[10px] text-zinc-500 font-mono">STEP 1</span>
            </div>

            <div>
              <label class="block text-[11px] text-zinc-400 mb-1 break-keep">참가자 닉네임</label>
              <input type="text" class="input-nickname w-full px-3 py-2 rounded border border-zinc-800 bg-zinc-950 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 font-mono" value="${nicknameInput}" placeholder="닉네임 입력 (예: RedGhost, CyberNinja)" />
            </div>

            <div>
              <label class="block text-[11px] text-zinc-400 mb-1.5 break-keep">아바타 배지 선택</label>
              <div class="grid grid-cols-3 gap-2">
                ${avatarSelectorHtml}
              </div>
            </div>

            <div class="pt-2 flex items-center gap-2">
              <button type="button" class="btn-toggle-ready flex-1 inline-flex items-center justify-center leading-none px-4 py-2.5 rounded border border-emerald-500/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50 text-xs font-semibold transition-colors whitespace-nowrap">
                <i class="fi fi-rr-check mr-1.5 flex items-center justify-center leading-none"></i>준비 상태 변경
              </button>
            </div>
          </div>

          <!-- Match Configuration Summary -->
          <div class="p-4 rounded border border-zinc-800 bg-zinc-900/50 space-y-3">
            <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2">
              <h2 class="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5 break-keep">
                <i class="fi fi-rr-network text-indigo-400 flex items-center justify-center leading-none"></i>대회 환경 구성 스펙
              </h2>
              <span class="text-[10px] text-zinc-500 font-mono">SPEC</span>
            </div>

            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="p-2 rounded border border-zinc-800 bg-zinc-950">
                <div class="text-[10px] text-zinc-500 break-keep">가상 인터넷 노드</div>
                <div class="font-mono font-bold text-zinc-200 text-sm mt-0.5">${config.totalNodes}개 가상 노드</div>
                <div class="text-[10px] text-zinc-500 font-mono mt-0.5">10.10.1.1 ~ 10.10.1.200</div>
              </div>

              <div class="p-2 rounded border border-zinc-800 bg-zinc-950">
                <div class="text-[10px] text-zinc-500 break-keep">취약 서버 분배</div>
                <div class="font-mono font-bold text-rose-400 text-sm mt-0.5">${config.vulnerableNodes}개 취약점</div>
                <div class="text-[10px] text-zinc-500 break-keep mt-0.5">6개 분야 각 10개 랜덤</div>
              </div>

              <div class="p-2 rounded border border-zinc-800 bg-zinc-950">
                <div class="text-[10px] text-zinc-500 break-keep">완벽 보안 방어 노드</div>
                <div class="font-mono font-bold text-emerald-400 text-sm mt-0.5">${config.hardenedNodes}개 완벽 보안</div>
                <div class="text-[10px] text-zinc-500 break-keep mt-0.5">DROP / 필터링 차단</div>
              </div>

              <div class="p-2 rounded border border-zinc-800 bg-zinc-950">
                <div class="text-[10px] text-zinc-500 break-keep">제한 시간</div>
                <div class="font-mono font-bold text-amber-400 text-sm mt-0.5">${config.durationMinutes}분 제한</div>
                <div class="text-[10px] text-zinc-500 font-mono mt-0.5">900초 카운트다운</div>
              </div>
            </div>

            <div class="p-2.5 rounded border border-zinc-800 bg-zinc-950 text-[11px] text-zinc-400 space-y-1">
              <div class="flex items-center gap-1.5 text-zinc-300 font-medium break-keep">
                <i class="fi fi-rr-trophy text-amber-400 flex items-center justify-center leading-none"></i>
                실시간 자동 채점 및 First Blood
              </div>
              <p class="text-[10px] text-zinc-500 break-keep text-pretty">
                취약 노드 침투 성공 시 플래그 수동 입력 없이 백엔드 가상 소켓이 실시간 감지하여 자동 채점(+100 PT) 및 최초 탈취자에게 First Blood 보너스를 부여합니다.
              </p>
            </div>
          </div>
        </div>

        <!-- Column 3: Joined Participants & Start Competition -->
        <div class="lg:col-span-2 flex flex-col space-y-6">
          <div class="p-4 rounded border border-zinc-800 bg-zinc-900/50 flex-1 flex flex-col">
            <div class="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-4">
              <div>
                <h2 class="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5 break-keep">
                  <i class="fi fi-rr-users text-emerald-400 flex items-center justify-center leading-none"></i>접속 중인 참가자 목록
                </h2>
                <p class="text-[11px] text-zinc-500 mt-0.5 break-keep">
                  실시간 LAN 접속 중인 해커 명단입니다.
                </p>
              </div>
              <div class="flex items-center gap-2">
                <span class="inline-flex items-center justify-center leading-none px-2 py-1 text-[11px] font-mono rounded border border-zinc-700 bg-zinc-800 text-zinc-300">
                  <span class="text-emerald-400 font-bold mr-1">${readyCount}</span> / ${participants.length} 준비 완료
                </span>
              </div>
            </div>

            <!-- Participants List -->
            <div class="space-y-2 flex-1 overflow-y-auto max-h-[380px] pr-1">
              ${participantsListHtml}
            </div>

            <!-- Start Match Control Section -->
            <div class="mt-6 pt-4 border-t border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div class="text-[11px] text-zinc-400 break-keep">
                <span class="text-zinc-300 font-semibold">대회 시작 조건:</span> 방장은 참가자들의 준비 완료 상태를 확인한 후 대회를 시작할 수 있습니다.
              </div>

              <button type="button" class="btn-start-match inline-flex items-center justify-center leading-none px-6 py-3 rounded border border-emerald-500/80 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-[0_0_20px_rgba(16,185,129,0.3)] animate-pulse transition-all whitespace-nowrap ${isActive ? "opacity-50 cursor-not-allowed" : ""}">
                <i class="fi fi-rr-play mr-2 flex items-center justify-center leading-none text-base"></i>
                <span>대회 시작 (Start Competition)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Interactive React component wrapper for ArenaLobby.
 */
export function ArenaLobby(props: ArenaLobbyProps) {
  return {
    type: "ArenaLobby",
    props,
    renderHtml: () => renderArenaLobbyHtml(props),
  };
}

export default ArenaLobby;
