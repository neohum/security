import fs from "node:fs";
import path from "node:path";

import { renderAppHtml, parseRoleFromUrl } from "../client/src/App.js";
import { CH3_MISSIONS } from "../client/src/components/AttackerDashboard.js";
import { INITIAL_PACKET_ALERTS, INITIAL_PATCH_RECOMMENDATIONS } from "../client/src/components/DefenderDashboard.js";
import { INITIAL_TOPOLOGY_NODES } from "../client/src/components/TopologyRadar.js";
import { INITIAL_LOBBY_PARTICIPANTS, DEFAULT_MATCH_CONFIG } from "../client/src/components/ArenaLobby.js";
import { INITIAL_200_NODES } from "../client/src/components/MeshRadar200.js";
import { INITIAL_SCOREBOARD_PLAYERS, INITIAL_ATTACK_TRACES } from "../client/src/components/ArenaScoreboard.js";
import { TUTORIAL_SLIDES } from "../client/src/components/TutorialSlides.js";

// Read all client modules
const ROOT = process.cwd();
const clientDir = path.resolve(ROOT, "client");

// Generate initial static HTML
const initialHtml = renderAppHtml({
  role: "observer",
  missions: CH3_MISSIONS,
  alerts: INITIAL_PACKET_ALERTS,
  patches: INITIAL_PATCH_RECOMMENDATIONS,
  nodes: INITIAL_TOPOLOGY_NODES,
  activeMissionId: CH3_MISSIONS[0]?.id,
  selectedNodeId: INITIAL_TOPOLOGY_NODES[1]?.id,
  arenaStatus: "waiting",
  remainingSeconds: 900,
  arenaParticipants: INITIAL_LOBBY_PARTICIPANTS,
  arenaPlayers: INITIAL_SCOREBOARD_PLAYERS,
  arenaTraces: INITIAL_ATTACK_TRACES,
  arenaNodes: INITIAL_200_NODES,
  arenaActiveFilter: "all",
  arenaSelectedNodeId: INITIAL_200_NODES[41]?.id || INITIAL_200_NODES[0]?.id,
  refActiveTab: "all",
  tutorialSlideStep: 1,
  isTutorialSlideOpen: false,
});

const bundleHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>메타스플로잇 2/e 3장 인텔리전스 수집 인터랙티브 시뮬레이션 게임</title>

  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    if (window.tailwind) {
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              bg: '#0b0c0f',
              fg: '#e7e9ee',
              muted: '#8a8f9c',
              accent: '#7c8cff',
              danger: '#ff5d6c',
            },
            fontFamily: {
              sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
              mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
            }
          }
        }
      }
    }
  </script>

  <!-- Flaticon UIcons CDN -->
  <link rel="stylesheet" href="https://cdn-uicons.flaticon.com/2.6.0/uicons-regular-rounded/css/uicons-regular-rounded.css">

  <!-- xterm.js CSS and Library -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>

  <style>
    :root {
      --color-bg: #0b0c0f;
      --color-fg: #e7e9ee;
      --color-muted: #8a8f9c;
      --color-accent: #7c8cff;
      --color-danger: #ff5d6c;
    }
    * { box-sizing: border-box; }
    body {
      background-color: var(--color-bg);
      color: var(--color-fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 0;
      overflow: hidden;
      height: 100vh;
      width: 100vw;
    }
    .break-keep { word-break: keep-all; }
    .text-balance { text-wrap: balance; }
    .text-pretty { text-wrap: pretty; }
    .whitespace-nowrap { white-space: nowrap; }
    .inline-flex-center { display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
    .symmetric-border { border: 1px solid rgba(138, 143, 156, 0.2); }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: #08090b; }
    ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }
    @keyframes radarSweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .radar-sweep-arm { transform-origin: 150px 150px; animation: radarSweep 4s linear infinite; }
    .cmd-line-input {
      background: transparent;
      outline: none;
      border: none;
      color: #38ef7d;
      font-family: ui-monospace, monospace;
      font-size: 12px;
      width: 100%;
    }
  </style>
</head>
<body class="bg-[#0b0c0f] text-[#e7e9ee]">
  <!-- Mount Root with Immediate Pre-rendered View -->
  <div id="root" class="h-screen w-screen flex flex-col">
    ${initialHtml}
  </div>

  <!-- SPA Client Engine -->
  <script type="module">
    import { renderAppHtml, parseRoleFromUrl } from './src/App.js';
    import { CH3_MISSIONS, evaluateSubmittedFlag, evaluateTerminalOutput } from './src/components/AttackerDashboard.js';
    import { INITIAL_PACKET_ALERTS, INITIAL_PATCH_RECOMMENDATIONS } from './src/components/DefenderDashboard.js';
    import { INITIAL_TOPOLOGY_NODES } from './src/components/TopologyRadar.js';
    import { INITIAL_LOBBY_PARTICIPANTS, DEFAULT_MATCH_CONFIG } from './src/components/ArenaLobby.js';
    import { INITIAL_200_NODES } from './src/components/MeshRadar200.js';
    import { INITIAL_SCOREBOARD_PLAYERS, INITIAL_ATTACK_TRACES } from './src/components/ArenaScoreboard.js';

    // Application state store
    let currentRole = parseRoleFromUrl(window.location.search || window.location.pathname);
    let missionsState = JSON.parse(JSON.stringify(CH3_MISSIONS));
    let alertsState = JSON.parse(JSON.stringify(INITIAL_PACKET_ALERTS));
    let patchesState = JSON.parse(JSON.stringify(INITIAL_PATCH_RECOMMENDATIONS));
    let nodesState = JSON.parse(JSON.stringify(INITIAL_TOPOLOGY_NODES));
    let activeMissionId = missionsState[0]?.id;
    let selectedNodeId = nodesState[1]?.id;
    let flagStatus = 'idle';
    let statusMessage = '';
    let submittedFlag = '';

    // Arena State
    let arenaStatus = 'waiting';
    let arenaRemainingSeconds = 900;
    let arenaCountdown = 5;
    let arenaParticipants = JSON.parse(JSON.stringify(INITIAL_LOBBY_PARTICIPANTS));
    let arenaPlayers = JSON.parse(JSON.stringify(INITIAL_SCOREBOARD_PLAYERS));
    let arenaTraces = JSON.parse(JSON.stringify(INITIAL_ATTACK_TRACES));
    let arenaNodes = JSON.parse(JSON.stringify(INITIAL_200_NODES));
    let arenaActiveFilter = 'all';
    let arenaSelectedNodeId = arenaNodes[41]?.id || arenaNodes[0]?.id;
    let refActiveTab = 'all';
    let myPlayerId = 'p-host';
    let arenaWs = null;
    let tutorialSlideStep = 1;
    let isTutorialSlideOpen = false;

    // Re-render when role or state changes
    function render() {
      const root = document.getElementById('root');
      if (!root) return;

      root.innerHTML = renderAppHtml({
        role: currentRole,
        missions: missionsState,
        alerts: alertsState,
        patches: patchesState,
        nodes: nodesState,
        activeMissionId,
        selectedNodeId,
        submittedFlag,
        flagStatus,
        statusMessage,
        arenaStatus,
        remainingSeconds: arenaRemainingSeconds,
        countdown: arenaCountdown,
        arenaParticipants,
        arenaPlayers,
        arenaTraces,
        arenaNodes,
        arenaActiveFilter,
        arenaSelectedNodeId,
        refActiveTab,
        tutorialSlideStep,
        isTutorialSlideOpen,
      });

      attachEventListeners();
      setupInteractiveTerminals();
    }

    function setupInteractiveTerminals() {
      setupSingleTerminal('terminal-attacker-container', 'attacker');
      setupSingleTerminal('terminal-defender-container', 'defender');
    }

    function setupSingleTerminal(containerId, role) {
      const container = document.getElementById(containerId);
      if (!container || container.getAttribute('data-cmd-bound')) return;
      container.setAttribute('data-cmd-bound', 'true');

      function checkAndApplyAutoEvaluation(cmd, outputText) {
        if (role !== 'attacker') return;

        // 1. Evaluate for tutorial mission
        const evalRes = evaluateTerminalOutput(cmd, outputText, missionsState);
        if (evalRes && evalRes.matched && evalRes.mission) {
          missionsState = evalRes.updatedMissions;
          flagStatus = 'success';
          statusMessage = evalRes.message;

          // Unlock topology node
          if (evalRes.mission.id === 'm1-whois' || evalRes.mission.id === 'm2-dns-axfr') {
            const node = nodesState.find(n => n.id === 'fake-recon');
            if (node) node.status = 'probed';
          } else if (evalRes.mission.id === 'm3-db-nmap') {
            const node1 = nodesState.find(n => n.id === 'metasploitable2');
            if (node1) node1.status = 'discovered';
            const node2 = nodesState.find(n => n.id === 'vuln-mssql');
            if (node2) node2.status = 'discovered';
          } else if (evalRes.mission.id === 'm4-mssql-login') {
            const node = nodesState.find(n => n.id === 'vuln-mssql');
            if (node) node.status = 'compromised';
          } else if (evalRes.mission.id === 'm5-s3-leak') {
            const node = nodesState.find(n => n.id === 'fake-s3');
            if (node) node.status = 'compromised';
          } else if (evalRes.mission.id === 'm6-custom-scanner') {
            const node = nodesState.find(n => n.id === 'metasploitable2');
            if (node) node.status = 'compromised';
          }

          const nextUnsolved = missionsState.find(m => !m.solved);
          if (nextUnsolved) {
            activeMissionId = nextUnsolved.id;
          }

          const victoryLine = document.createElement('div');
          victoryLine.className = 'font-mono text-xs text-emerald-400 font-bold py-1.5 my-1.5 px-2 rounded border border-emerald-500/50 bg-emerald-950/40 break-keep';
          victoryLine.textContent = '[+] 🎯 [퀘스트 자동 완료] ' + evalRes.mission.title + ' (+' + evalRes.mission.points + ' PT) 획득! (현재 총점: ' + evalRes.totalScore + '/600 PT)';
          container.insertBefore(victoryLine, promptRow);
          container.scrollTop = container.scrollHeight;

          setTimeout(() => render(), 400);
        }

        // 2. Evaluate against Arena 200 nodes if in arena mode or arena active
        if (arenaStatus === 'active') {
          fetch('/api/arena/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: myPlayerId, command: cmd, stdout: outputText }),
          })
            .then(res => res.json())
            .then(outcome => {
              if (outcome && outcome.success && outcome.event) {
                const arenaNotice = document.createElement('div');
                arenaNotice.className = 'font-mono text-xs text-amber-300 font-bold py-1.5 my-1.5 px-2 rounded border border-amber-500/50 bg-amber-950/40 break-keep';
                arenaNotice.textContent = '[+] 🏆 [아레나 탈취 성공] ' + outcome.event.ip + ' (' + outcome.event.category + ') 장악! (+' + outcome.pointsAwarded + ' PT' + (outcome.isFirstBlood ? ' FIRST BLOOD!' : '') + ')';
                container.insertBefore(arenaNotice, promptRow);
                container.scrollTop = container.scrollHeight;
              }
            })
            .catch(() => {});
        }
      }

      // Append interactive command prompt
      const promptRow = document.createElement('div');
      promptRow.className = 'mt-2 flex items-center gap-1 font-mono text-xs pt-1 border-t border-zinc-800/60';
      const promptLabel = document.createElement('span');
      promptLabel.className = role === 'attacker' ? 'text-emerald-400 font-bold' : 'text-blue-400 font-bold';
      promptLabel.textContent = role === 'attacker' ? 'root@kalibox:~# ' : 'secops@metasploitable2:~$ ';
      
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cmd-line-input flex-1 bg-transparent border-none outline-none text-[#e7e9ee] font-mono text-xs';
      input.placeholder = role === 'attacker' ? "명령어 입력 (예: whois -h 172.28.0.15 megacorp.internal, dig axfr ..., nmap ...)" : "방어 명령어 입력 (예: netstat -tuln, iptables -L)";
      input.autocomplete = 'off';

      promptRow.appendChild(promptLabel);
      promptRow.appendChild(input);
      container.appendChild(promptRow);

      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          const cmd = input.value.trim();
          if (!cmd) return;
          input.value = '';

          const userEcho = document.createElement('div');
          userEcho.className = 'font-mono text-xs text-zinc-300';
          userEcho.textContent = (role === 'attacker' ? 'root@kalibox:~# ' : 'secops@metasploitable2:~$ ') + cmd;
          container.insertBefore(userEcho, promptRow);

          const loading = document.createElement('div');
          loading.className = 'font-mono text-xs text-zinc-500 italic';
          loading.textContent = '[*] 명령 실행 중...';
          container.insertBefore(loading, promptRow);
          container.scrollTop = container.scrollHeight;

          try {
            const res = await fetch('/api/missions/evaluate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ command: cmd, role }),
            });
            const data = await res.json();
            loading.remove();

            let outText = '';
            if (Array.isArray(data) && data.length > 0) {
              outText = data.map(d => d.message).join('\\n');
            } else if (data.message) {
              outText = data.message;
            } else {
              outText = '[*] Command completed with code 0.';
            }

            const outDiv = document.createElement('div');
            outDiv.className = 'font-mono text-xs text-zinc-400 whitespace-pre-wrap py-1';
            outDiv.textContent = outText;
            container.insertBefore(outDiv, promptRow);

            checkAndApplyAutoEvaluation(cmd, outText);
          } catch {
            loading.textContent = '[-] 통신 오류 또는 PTY 응답 대기 중';
          }
          container.scrollTop = container.scrollHeight;
        }
      });
    }

    function attachEventListeners() {
      // Role switch buttons
      document.querySelectorAll('.role-switch-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const href = btn.getAttribute('href');
          currentRole = parseRoleFromUrl(href);
          history.pushState(null, '', href);
          render();
        });
      });

      // Mission list click
      document.querySelectorAll('.mission-card').forEach(card => {
        card.addEventListener('click', () => {
          const mId = card.getAttribute('data-mission-id');
          if (mId) {
            activeMissionId = mId;
            const targetMission = missionsState.find(m => m.id === mId);
            if (targetMission) {
              const matchedNode = nodesState.find(n => n.ip === targetMission.targetIp);
              if (matchedNode) selectedNodeId = matchedNode.id;
            }
            render();
          }
        });
      });

      // Copy command button
      document.querySelectorAll('.btn-copy-command').forEach(btn => {
        btn.addEventListener('click', () => {
          const activeMission = missionsState.find(m => m.id === activeMissionId);
          if (activeMission) {
            navigator.clipboard.writeText(activeMission.hintCommand);
            btn.innerHTML = '<span class="text-emerald-400">복사됨!</span>';
            setTimeout(() => {
              btn.innerHTML = '<i class="fi fi-rr-copy mr-1 flex items-center justify-center leading-none"></i>복사';
            }, 1500);
          }
        });
      });

      // Reference Knowledge Tab Switching
      document.querySelectorAll('.ref-knowledge-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const targetTab = tab.getAttribute('data-ref-tab');
          if (targetTab) {
            refActiveTab = targetTab;
            render();
          }
        });
      });

      // Shell Script Copy Guide Button
      document.querySelectorAll('.btn-copy-script-guide').forEach(btn => {
        btn.addEventListener('click', () => {
          const cmd = btn.getAttribute('data-script-cmd') || btn.getAttribute('data-cmd');
          if (cmd) {
            navigator.clipboard.writeText(cmd);
            btn.innerHTML = '<span class="text-emerald-400">복사 완료!</span>';
            setTimeout(() => {
              btn.innerHTML = '<i class="fi fi-rr-copy mr-1.5 flex items-center justify-center leading-none"></i>원클릭 스크립트 복사';
            }, 1500);
          }
        });
      });

      // Reference Knowledge Terminal Insert Button
      document.querySelectorAll('.btn-insert-ref-cmd').forEach(btn => {
        btn.addEventListener('click', () => {
          const cmd = btn.getAttribute('data-cmd');
          const role = btn.getAttribute('data-role');
          if (!cmd) return;

          const containerId = role === 'defender' ? 'terminal-defender-container' : 'terminal-attacker-container';
          const container = document.getElementById(containerId);
          const input = container?.querySelector('.cmd-line-input') || document.querySelector('.cmd-line-input');
          if (input) {
            input.value = cmd;
            input.focus();
            input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });
      });

      // Copy Single Reference Command
      document.querySelectorAll('.btn-copy-ref-cmd').forEach(btn => {
        btn.addEventListener('click', () => {
          const cmd = btn.getAttribute('data-cmd');
          if (cmd) {
            navigator.clipboard.writeText(cmd);
            btn.innerHTML = '<span class="text-emerald-400">복사됨!</span>';
            setTimeout(() => {
              btn.innerHTML = '<i class="fi fi-rr-copy mr-1 flex items-center justify-center leading-none"></i>복사';
            }, 1500);
          }
        });
      });

      // Arena: Start Match Button
      const startBtn = document.querySelector('.btn-start-match');
      if (startBtn) {
        startBtn.addEventListener('click', () => {
          arenaStatus = 'starting';
          render();

          // Start countdown
          let cd = 3;
          const cdTimer = setInterval(() => {
            cd--;
            arenaCountdown = cd;
            if (cd <= 0) {
              clearInterval(cdTimer);
              arenaStatus = 'active';
              fetch('/api/arena/start', { method: 'POST' }).catch(() => {});
              render();
            } else {
              render();
            }
          }, 1000);
        });
      }

      // Arena: Back to Lobby
      const backLobbyBtn = document.querySelector('.btn-back-to-lobby');
      if (backLobbyBtn) {
        backLobbyBtn.addEventListener('click', () => {
          arenaStatus = 'waiting';
          fetch('/api/arena/reset', { method: 'POST' }).catch(() => {});
          render();
        });
      }

      // Arena: Copy Lobby URL
      const copyLobbyBtn = document.querySelector('.btn-copy-lobby-url');
      if (copyLobbyBtn) {
        copyLobbyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(location.origin + '/arena');
          copyLobbyBtn.innerHTML = '<span class="text-emerald-400">복사 완료!</span>';
          setTimeout(() => {
            copyLobbyBtn.innerHTML = '<i class="fi fi-rr-copy mr-1 flex items-center justify-center leading-none"></i>초대 링크 복사';
          }, 1500);
        });
      }

      // Arena: Copy SSH Command
      const copySshBtn = document.querySelector('.btn-copy-ssh-cmd');
      if (copySshBtn) {
        copySshBtn.addEventListener('click', () => {
          const cmd = copySshBtn.getAttribute('data-cmd') || 'ssh -p 2222 player@' + location.hostname;
          navigator.clipboard.writeText(cmd);
          copySshBtn.innerHTML = '<span class="text-emerald-400">복사 완료!</span>';
          setTimeout(() => {
            copySshBtn.innerHTML = '<i class="fi fi-rr-copy mr-1 flex items-center justify-center leading-none"></i>복사';
          }, 1500);
        });
      }

      // Arena: Nickname Input Event
      const nickInput = document.querySelector('.input-nickname');
      if (nickInput) {
        nickInput.addEventListener('input', (e) => {
          const val = e.target.value;
          const me = arenaParticipants.find(p => p.id === myPlayerId);
          if (me) me.nickname = val || 'RedCommander';
        });
      }

      // Arena: Toggle Ready Button
      const toggleReadyBtn = document.querySelector('.btn-toggle-ready');
      if (toggleReadyBtn) {
        toggleReadyBtn.addEventListener('click', () => {
          const me = arenaParticipants.find(p => p.id === myPlayerId);
          if (me) {
            me.isReady = !me.isReady;
            render();
          }
        });
      }

      // Arena: Avatar select
      document.querySelectorAll('.avatar-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const avId = btn.getAttribute('data-avatar-id');
          const me = arenaParticipants.find(p => p.id === myPlayerId);
          if (me && avId) {
            const avatarMap = {
              skull: { label: '해커', icon: 'fi-rr-skull' },
              ghost: { label: '고스트', icon: 'fi-rr-ghost' },
              'user-secret': { label: '닌자', icon: 'fi-rr-user-secret' },
              bug: { label: '바이퍼', icon: 'fi-rr-bug' },
              bolt: { label: '볼트', icon: 'fi-rr-bolt' },
              shield: { label: '가디언', icon: 'fi-rr-shield' },
            };
            if (avatarMap[avId]) {
              me.avatar = avatarMap[avId].icon;
              me.avatarLabel = avatarMap[avId].label;
              render();
            }
          }
        });
      });

      // Arena: Mesh Filter Tabs
      document.querySelectorAll('.mesh-filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          arenaActiveFilter = tab.getAttribute('data-filter') || 'all';
          render();
        });
      });

      // Arena: Mesh Node Cell Click
      document.querySelectorAll('.mesh-node-cell').forEach(cell => {
        cell.addEventListener('click', () => {
          const nId = cell.getAttribute('data-node-id');
          if (nId) {
            arenaSelectedNodeId = nId;
            render();
          }
        });
      });

      // One-click patch buttons
      document.querySelectorAll('.btn-apply-patch').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const card = e.target.closest('.patch-card');
          const patchId = card?.getAttribute('data-patch-id');
          if (patchId) {
            patchesState = patchesState.map(p => p.id === patchId ? { ...p, applied: true } : p);
            render();
          }
        });
      });

      // Clear terminal buttons
      document.querySelectorAll('.btn-terminal-clear').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const panel = e.target.closest('.terminal-panel');
          const container = panel?.querySelector('[id$="-container"]');
          if (container) {
            const promptRow = container.querySelector('.cmd-line-input')?.parentElement;
            container.innerHTML = '<div class="text-zinc-500 font-mono text-xs">[*] 터미널 버퍼가 비워졌습니다.</div>';
            if (promptRow) container.appendChild(promptRow);
          }
        });
      });

      // Tutorial Slide Deck Modal Open Button
      const openSlidesBtn = document.getElementById('btn-open-tutorial-slides');
      if (openSlidesBtn) {
        openSlidesBtn.addEventListener('click', () => {
          isTutorialSlideOpen = true;
          render();
        });
      }

      // Tutorial Slide Deck Modal Close Button
      const closeSlidesBtn = document.getElementById('btn-close-tutorial-slides');
      if (closeSlidesBtn) {
        closeSlidesBtn.addEventListener('click', () => {
          isTutorialSlideOpen = false;
          render();
        });
      }

      // Backdrop click to close
      const modalBackdrop = document.getElementById('tutorial-slides-modal');
      if (modalBackdrop) {
        modalBackdrop.addEventListener('click', (e) => {
          if (e.target.id === 'tutorial-slides-modal') {
            isTutorialSlideOpen = false;
            render();
          }
        });
      }

      // Prev Slide Button
      const prevSlideBtn = document.getElementById('btn-slide-prev');
      if (prevSlideBtn) {
        prevSlideBtn.addEventListener('click', () => {
          if (tutorialSlideStep > 1) {
            tutorialSlideStep--;
            render();
          }
        });
      }

      // Next Slide Button
      const nextSlideBtn = document.getElementById('btn-slide-next');
      if (nextSlideBtn) {
        nextSlideBtn.addEventListener('click', () => {
          if (tutorialSlideStep < 6) {
            tutorialSlideStep++;
            render();
          }
        });
      }

      // Slide Step Tabs
      document.querySelectorAll('.slide-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const step = parseInt(btn.getAttribute('data-step') || '1', 10);
          if (step >= 1 && step <= 6) {
            tutorialSlideStep = step;
            render();
          }
        });
      });

      // Slide Dot Indicators
      document.querySelectorAll('.slide-dot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const step = parseInt(btn.getAttribute('data-step') || '1', 10);
          if (step >= 1 && step <= 6) {
            tutorialSlideStep = step;
            render();
          }
        });
      });

      // Slide Command Copy Button
      document.querySelectorAll('.btn-slide-copy-cmd').forEach(btn => {
        btn.addEventListener('click', () => {
          const cmd = btn.getAttribute('data-cmd');
          if (cmd) {
            navigator.clipboard.writeText(cmd);
            btn.innerHTML = '<span class="text-emerald-400">복사됨!</span>';
            setTimeout(() => {
              btn.innerHTML = '<i class="fi fi-rr-copy mr-1 flex items-center justify-center leading-none"></i><span>복사</span>';
            }, 1500);
          }
        });
      });
    }

    // Global Keydown Handler for Slide Keyboard Navigation
    window.addEventListener('keydown', (e) => {
      if (!isTutorialSlideOpen) return;
      if (e.key === 'Escape') {
        isTutorialSlideOpen = false;
        render();
      } else if (e.key === 'ArrowLeft') {
        if (tutorialSlideStep > 1) {
          tutorialSlideStep--;
          render();
        }
      } else if (e.key === 'ArrowRight') {
        if (tutorialSlideStep < 6) {
          tutorialSlideStep++;
          render();
        }
      }
    });

    function initEventStream() {
      try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(\`\${protocol}//\${location.host}/ws/events\`);
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.id && data.type && data.details) {
              alertsState.unshift({
                id: data.id,
                time: new Date(data.timestamp || Date.now()).toLocaleTimeString(),
                src: data.sourceIp || '172.28.0.10',
                dst: data.destIp || '172.28.0.20',
                port: data.port || 0,
                severity: data.severity === 'high' ? 'danger' : data.severity === 'medium' ? 'warning' : 'info',
                message: data.details,
              });
              if (alertsState.length > 25) alertsState.pop();
              render();
            }
          } catch {}
        };
      } catch {}
    }

    function initArenaStream() {
      try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        arenaWs = new WebSocket(\`\${protocol}//\${location.host}/ws/arena\`);
        arenaWs.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'init' && data.state) {
              arenaStatus = data.state.lobbyState;
              arenaRemainingSeconds = data.state.timeRemaining;
              if (data.state.players && data.state.players.length > 0) {
                arenaPlayers = data.state.leaderboard;
              }
              if (data.state.recentAttacks && data.state.recentAttacks.length > 0) {
                arenaTraces = data.state.recentAttacks;
              }
              render();
            } else if (data.type === 'match:tick') {
              arenaRemainingSeconds = data.remainingSeconds;
              render();
            } else if (data.type === 'match:started') {
              arenaStatus = 'active';
              arenaRemainingSeconds = data.remainingSeconds;
              render();
            } else if (data.type === 'match:finished') {
              arenaStatus = 'finished';
              if (data.leaderboard) arenaPlayers = data.leaderboard;
              render();
            } else if (data.type === 'attack:compromised') {
              if (data.event) arenaTraces.unshift(data.event);
              if (data.leaderboard) arenaPlayers = data.leaderboard;
              render();
            } else if (data.type === 'player:joined') {
              if (data.players) arenaParticipants = data.players;
              render();
            }
          } catch {}
        };
      } catch {}
    }

    // Run render immediately
    render();
    initEventStream();
    initArenaStream();
  </script>
</body>
</html>
`;

fs.writeFileSync(path.resolve(clientDir, "index.html"), bundleHtml, "utf8");
console.log("Wrote bundled client/index.html successfully!");
