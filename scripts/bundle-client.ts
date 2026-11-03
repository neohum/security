import fs from "node:fs";
import path from "node:path";

import { renderAppHtml, parseRoleFromUrl } from "../client/src/App.js";
import { CH3_MISSIONS } from "../client/src/components/AttackerDashboard.js";
import { INITIAL_PACKET_ALERTS, INITIAL_PATCH_RECOMMENDATIONS } from "../client/src/components/DefenderDashboard.js";
import { INITIAL_TOPOLOGY_NODES } from "../client/src/components/TopologyRadar.js";

// Read all client modules
const ROOT = process.cwd();
const clientDir = path.resolve(ROOT, "client");

// We generate the initial static HTML for observer/attacker/defender
const initialHtml = renderAppHtml({
  role: "observer",
  missions: CH3_MISSIONS,
  alerts: INITIAL_PACKET_ALERTS,
  patches: INITIAL_PATCH_RECOMMENDATIONS,
  nodes: INITIAL_TOPOLOGY_NODES,
  activeMissionId: CH3_MISSIONS[0]?.id,
  selectedNodeId: INITIAL_TOPOLOGY_NODES[1]?.id,
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
    import { CH3_MISSIONS, evaluateSubmittedFlag } from './src/components/AttackerDashboard.js';
    import { INITIAL_PACKET_ALERTS, INITIAL_PATCH_RECOMMENDATIONS } from './src/components/DefenderDashboard.js';
    import { INITIAL_TOPOLOGY_NODES } from './src/components/TopologyRadar.js';

    // Application state store
    let currentRole = parseRoleFromUrl(window.location.search);
    let missionsState = JSON.parse(JSON.stringify(CH3_MISSIONS));
    let alertsState = JSON.parse(JSON.stringify(INITIAL_PACKET_ALERTS));
    let patchesState = JSON.parse(JSON.stringify(INITIAL_PATCH_RECOMMENDATIONS));
    let nodesState = JSON.parse(JSON.stringify(INITIAL_TOPOLOGY_NODES));
    let activeMissionId = missionsState[0]?.id;
    let selectedNodeId = nodesState[1]?.id;
    let flagStatus = 'idle';
    let statusMessage = '';
    let submittedFlag = '';

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
      input.spellcheck = false;

      promptRow.appendChild(promptLabel);
      promptRow.appendChild(input);
      container.appendChild(promptRow);

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = \`\${protocol}//\${location.host}/ws/terminal/\${role}?mock=true\`;
      let ws = null;

      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          appendLog(container, \`\x1b[32m[+] \${role.toUpperCase()} 실시간 PTY 게이트웨이에 연결되었습니다.\x1b[0m\`);
        };
        ws.onmessage = (event) => {
          appendLog(container, event.data);
        };
      } catch (err) {
        console.warn('WebSocket connection deferred:', err);
      }

      function appendLog(target, text) {
        const line = document.createElement('div');
        line.className = 'font-mono text-xs leading-relaxed text-[#e7e9ee] whitespace-pre-wrap';
        // strip ansi codes for clean display
        line.textContent = text.replace(/\\x1b\\[[0-9;]*m/g, '');
        container.insertBefore(line, promptRow);
        container.scrollTop = container.scrollHeight;
      }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const cmd = input.value.trim();
          if (!cmd) return;
          input.value = '';

          appendLog(container, \`\${promptLabel.textContent}\${cmd}\`);

          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(cmd + '\\r');
          } else {
            // Local fallback handler
            handleLocalMockCommand(cmd, role, (out) => appendLog(container, out));
          }
        }
      });
    }

    function handleLocalMockCommand(cmd, role, output) {
      if (cmd.includes('whois')) {
        output(\`% MegaCorp Internal Whois Database Server\\nDomain: megacorp.internal\\nRegistrant: MegaCorp Technologies, Inc.\\nTech Email: admin@megacorp.internal\\nCIDR: 172.28.0.0/16\\nStatus: ACTIVE\\nFLAG: FLAG{WHOIS_RECON_SUCCESS}\`);
      } else if (cmd.includes('axfr') || cmd.includes('dig')) {
        output(\`;; <<>> DiG 9.18.1 <<>> axfr @172.28.0.15 megacorp.internal\\nmegacorp.internal. IN SOA ns1.megacorp.internal.\\nns1.megacorp.internal. IN A 172.28.0.15\\ntarget-linux.megacorp.internal. IN A 172.28.0.20\\nbackup-s3.megacorp.internal. IN A 172.28.0.25\\ndb-mssql.megacorp.internal. IN A 172.28.0.30\\nFLAG: FLAG{ZONE_TRANSFER_EXPOSED}\`);
      } else if (cmd.includes('nmap')) {
        output(\`Starting Nmap 7.94 ( https://nmap.org )\\nNmap scan report for 172.28.0.20\\nPORT     STATE SERVICE\\n21/tcp   open  ftp\\n22/tcp   open  ssh\\n80/tcp   open  http\\n445/tcp  open  netbios-ssn\\nFLAG: FLAG{MSF_DB_NMAP_RECORDED}\`);
      } else {
        output(\`[*] Executed: \${cmd}\\n[+] Ready for next reconnaissance command.\`);
      }
    }

    function attachEventListeners() {
      // Role badge clicks to switch roles
      document.querySelectorAll('.role-switcher-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = btn.getAttribute('data-role');
          if (r) {
            currentRole = r;
            const url = new URL(window.location);
            url.searchParams.set('role', r);
            window.history.pushState({}, '', url);
            render();
          }
        });
      });

      // Mission clicks
      document.querySelectorAll('.mission-item').forEach(el => {
        el.addEventListener('click', () => {
          const mid = el.getAttribute('data-mission-id');
          if (mid) {
            activeMissionId = mid;
            render();
          }
        });
      });

      // Radar node clicks
      document.querySelectorAll('.radar-node-group').forEach(el => {
        el.addEventListener('click', () => {
          const nid = el.getAttribute('data-node-id');
          if (nid) {
            selectedNodeId = nid;
            render();
          }
        });
      });

      // Copy hint command button
      document.querySelectorAll('.btn-copy-command').forEach(btn => {
        btn.addEventListener('click', () => {
          const pre = btn.closest('.p-2\\.5')?.querySelector('pre code');
          if (pre) {
            navigator.clipboard.writeText(pre.textContent.trim());
            btn.innerHTML = '<span class="text-emerald-400">복사됨!</span>';
            setTimeout(() => { btn.innerHTML = '<i class="fi fi-rr-copy mr-1"></i>복사'; }, 1500);
          }
        });
      });

      // Reference Knowledge Copy Button
      document.querySelectorAll('.btn-copy-ref-cmd').forEach(btn => {
        btn.addEventListener('click', () => {
          const cmd = btn.getAttribute('data-cmd');
          if (cmd) {
            navigator.clipboard.writeText(cmd);
            const orig = btn.innerHTML;
            btn.innerHTML = '<span class="text-emerald-400">복사됨!</span>';
            setTimeout(() => { btn.innerHTML = orig; }, 1500);
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

      // Flag submit
      const submitBtn = document.querySelector('.btn-submit-flag');
      const flagInput = document.querySelector('.flag-input');
      if (submitBtn && flagInput) {
        submitBtn.addEventListener('click', () => {
          const val = flagInput.value.trim();
          submittedFlag = val;
          const result = evaluateSubmittedFlag(val, missionsState);
          missionsState = result.updatedMissions;
          flagStatus = result.success ? 'success' : 'error';
          statusMessage = result.message;

          if (result.success) {
            // Unlock topology nodes
            if (val.includes('MSSQL')) {
              const node = nodesState.find(n => n.id === 'vuln-mssql');
              if (node) node.status = 'compromised';
            } else if (val.includes('ZONE_TRANSFER')) {
              const node = nodesState.find(n => n.id === 'fake-recon');
              if (node) node.status = 'probed';
            } else if (val.includes('S3')) {
              const node = nodesState.find(n => n.id === 'fake-s3');
              if (node) node.status = 'compromised';
            }
          }
          render();
        });
      }

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
    }

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

    // Run render immediately
    render();
    initEventStream();
  </script>
</body>
</html>
`;

fs.writeFileSync(path.resolve(clientDir, "index.html"), bundleHtml, "utf8");
console.log("Wrote bundled client/index.html successfully!");
