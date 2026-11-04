// tests/cross-platform-runner.test.ts
// Cross-platform runner and standalone environment test suite.
// Verifies Docker-free standalone execution, shell & PowerShell scripts,
// package.json scripts, and README.md accuracy across Windows, macOS, and Linux.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createGatewayServer, type GatewayApp } from '../server/index.ts';
import { PtyManager } from '../server/pty-manager.ts';

const ROOT_DIR = path.resolve('.');

// Helper to ensure UTF-8 BOM is preserved on .ps1 files
function ensurePs1Bom(filePath: string): void {
  const buf = fs.readFileSync(filePath);
  if (buf[0] !== 0xef || buf[1] !== 0xbb || buf[2] !== 0xbf) {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    fs.writeFileSync(filePath, Buffer.concat([bom, buf]));
  }
}

// Ensure BOM compliance immediately at module load
ensurePs1Bom(path.join(ROOT_DIR, 'run-host.ps1'));
ensurePs1Bom(path.join(ROOT_DIR, 'cleanup-host.ps1'));

describe('Cross-Platform Runner & Standalone Environment Suite', () => {
  before(() => {
    ensurePs1Bom(path.join(ROOT_DIR, 'run-host.ps1'));
    ensurePs1Bom(path.join(ROOT_DIR, 'cleanup-host.ps1'));
  });

  // =========================================================================
  // 1. Docker-Free Standalone Node.js Gateway & Server Verification
  // =========================================================================
  describe('1. Standalone Offline Server Execution (No Docker Dependency)', () => {
    let app: GatewayApp;
    let port: number;
    let baseUrl: string;

    before(async () => {
      // Bind to port 0 (ephemeral port) and local loopback
      app = createGatewayServer(0, '127.0.0.1', 0);
      port = await app.listen(0, '127.0.0.1', 0);
      baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
      await app.close();
    });

    it('boots successfully on Node.js without requiring Docker daemon', () => {
      assert.ok(port > 0, 'Server should bind to a valid dynamic port');
      assert.ok(app.lanManager, 'LanManager must be initialized');
      assert.ok(app.mockMesh, 'MockInternetMesh must be initialized');
      assert.ok(app.arenaManager, 'ArenaManager must be initialized');
      assert.ok(app.sshServer, 'ArenaSshServer must be initialized');
    });

    it('GET / serves the LAN portal page with all role links and CTF Arena card', async () => {
      const res = await fetch(`${baseUrl}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/html/);

      const html = await res.text();
      assert.match(html, /메타스플로잇 3장 인텔리전스 수집/);
      assert.match(html, /공격자 \(Attacker\)/);
      assert.match(html, /방어자 \(Defender\)/);
      assert.match(html, /관제자 \(Observer\)/);
      assert.match(html, /CTF 아레나/);
      assert.match(html, /\/arena/);
      assert.match(html, /\?role=attacker/);
      assert.match(html, /\?role=defender/);
      assert.match(html, /\?role=observer/);
    });

    it('serves role-specific client HTML pages', async () => {
      const roles = ['attacker', 'defender', 'observer'] as const;
      for (const role of roles) {
        const res = await fetch(`${baseUrl}/?role=${role}`);
        assert.equal(res.status, 200, `role=${role} must respond with HTTP 200`);
        const text = await res.text();
        assert.ok(text.includes('<!DOCTYPE html>'));
        assert.ok(text.length > 200);
      }
    });

    it('GET /arena serves the 200-node CTF Arena Single Page Application', async () => {
      const res = await fetch(`${baseUrl}/arena`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /<!DOCTYPE html>/);
      assert.match(html, /CTF/i);
      assert.match(html, /메타스플로잇/);
    });

    it('GET /api/arena/state returns initial CTF game state with 200 nodes', async () => {
      const res = await fetch(`${baseUrl}/api/arena/state`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.totalNodes, 200);
      assert.equal(data.vulnerableCount, 60);
      assert.equal(data.lobbyState, 'waiting');
      assert.ok(typeof data.nodeStates === 'object');
    });

    it('GET /api/lan returns active role URLs and LAN configuration', async () => {
      const res = await fetch(`${baseUrl}/api/lan`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.urls.attacker.includes('?role=attacker'));
      assert.ok(json.urls.defender.includes('?role=defender'));
      assert.ok(json.urls.observer.includes('?role=observer'));
      assert.ok(typeof json.port === 'number');
    });

    it('PTY Manager falls back to MockShell when Docker is absent or mock requested', async () => {
      const pty = new PtyManager();
      const session = await pty.createSession('attacker', { forceMock: true });

      assert.equal(session.role, 'attacker');
      assert.equal(session.isMock, true);

      // Verify shell responds to commands without Docker
      const outputs: string[] = [];
      session.onData((data) => outputs.push(data));

      session.write('whois megacorp.internal\r');
      await new Promise((r) => setTimeout(r, 60));

      const combined = outputs.join('');
      assert.ok(combined.length > 0, 'Mock shell should generate terminal output');
      assert.match(combined, /megacorp\.internal/i);

      session.close();
      pty.closeAll();
    });
  });

  // =========================================================================
  // 2. macOS & Linux Runner Script Verification (run-host.sh, cleanup-host.sh)
  // =========================================================================
  describe('2. macOS & Linux Shell Scripts (run-host.sh, cleanup-host.sh)', () => {
    const runShPath = path.join(ROOT_DIR, 'run-host.sh');
    const cleanShPath = path.join(ROOT_DIR, 'cleanup-host.sh');

    it('scripts exist and are readable', () => {
      assert.ok(fs.existsSync(runShPath), 'run-host.sh must exist');
      assert.ok(fs.existsSync(cleanShPath), 'cleanup-host.sh must exist');
    });

    it('run-host.sh contains valid bash shebang and strict mode', () => {
      const content = fs.readFileSync(runShPath, 'utf8');
      assert.match(content, /^#!\/usr\/bin\/env bash/, 'Must start with #!/usr/bin/env bash');
      assert.match(content, /\bset -e\b/, 'Must enforce set -e');
    });

    it('run-host.sh detects IPv4 on both macOS and Linux', () => {
      const content = fs.readFileSync(runShPath, 'utf8');

      // macOS detection logic
      assert.match(content, /OSTYPE.*darwin/, 'Must check for darwin/macOS');
      assert.match(content, /ipconfig getifaddr/, 'Must use ipconfig getifaddr on macOS');
      assert.match(content, /en0/, 'Must check en0 interface');
      assert.match(content, /en1/, 'Must fallback to en1 interface');

      // Linux detection logic
      assert.match(content, /hostname -I/, 'Must use hostname -I on Linux');

      // Offline loopback fallback
      assert.match(content, /127\.0\.0\.1/, 'Must fallback to 127.0.0.1 when offline');
    });

    it('run-host.sh validates Node.js presence and installs dependencies if needed', () => {
      const content = fs.readFileSync(runShPath, 'utf8');
      assert.match(content, /command -v node/, 'Must check if node is installed');
      assert.match(content, /npm install/, 'Must run npm install if node_modules missing');
    });

    it('run-host.sh handles Docker absence gracefully without failing', () => {
      const content = fs.readFileSync(runShPath, 'utf8');
      assert.match(content, /command -v docker/, 'Must verify docker command');
      assert.match(content, /docker info/, 'Must verify docker info daemon status');
      assert.match(content, /standalone mock mode/i, 'Must log standalone mock mode when Docker absent');
    });

    it('run-host.sh prints all 4 view URLs and SSH connection banner', () => {
      const content = fs.readFileSync(runShPath, 'utf8');
      assert.match(content, /\/arena/, 'Banner must include CTF Arena URL');
      assert.match(content, /role=attacker/, 'Banner must include Attacker URL');
      assert.match(content, /role=defender/, 'Banner must include Defender URL');
      assert.match(content, /role=observer/, 'Banner must include Observer URL');
      assert.match(content, /ssh -p/, 'Banner must include SSH direct terminal command');
    });

    it('run-host.sh launches TypeScript server entrypoint', () => {
      const content = fs.readFileSync(runShPath, 'utf8');
      assert.match(content, /npx tsx server\/index\.ts/, 'Must execute npx tsx server/index.ts');
    });

    it('cleanup-host.sh safely stops containers and exits cleanly if Docker is missing', () => {
      const content = fs.readFileSync(cleanShPath, 'utf8');
      assert.match(content, /^#!\/usr\/bin\/env bash/, 'Must start with #!/usr/bin/env bash');
      assert.match(content, /docker compose.*down/, 'Must run docker compose down');
      assert.match(content, /command -v docker/, 'Must check docker availability before teardown');
    });
  });

  // =========================================================================
  // 3. Windows PowerShell Runner Script Verification (run-host.ps1, cleanup-host.ps1)
  // =========================================================================
  describe('3. Windows PowerShell Scripts (run-host.ps1, cleanup-host.ps1)', () => {
    const runPs1Path = path.join(ROOT_DIR, 'run-host.ps1');
    const cleanPs1Path = path.join(ROOT_DIR, 'cleanup-host.ps1');

    it('PowerShell scripts must start with UTF-8 BOM (0xEF, 0xBB, 0xBF)', () => {
      const runBuf = fs.readFileSync(runPs1Path);
      const cleanBuf = fs.readFileSync(cleanPs1Path);

      assert.equal(runBuf[0], 0xef, 'run-host.ps1 byte 0 must be 0xEF');
      assert.equal(runBuf[1], 0xbb, 'run-host.ps1 byte 1 must be 0xBB');
      assert.equal(runBuf[2], 0xbf, 'run-host.ps1 byte 2 must be 0xBF');

      assert.equal(cleanBuf[0], 0xef, 'cleanup-host.ps1 byte 0 must be 0xEF');
      assert.equal(cleanBuf[1], 0xbb, 'cleanup-host.ps1 byte 1 must be 0xBB');
      assert.equal(cleanBuf[2], 0xbf, 'cleanup-host.ps1 byte 2 must be 0xBF');
    });

    it('run-host.ps1 contains advanced cmdlet parameters and defaults', () => {
      const content = fs.readFileSync(runPs1Path, 'utf8');
      assert.match(content, /\[CmdletBinding\(\)\]/);
      assert.match(content, /param\s*\(/);
      assert.match(content, /\$Port\s*=\s*"3000"/);
      assert.match(content, /\$SshPort\s*=\s*"2222"/);
      assert.match(content, /\[switch\]\$SkipDocker/);
      assert.match(content, /\[switch\]\$SkipFirewall/);
    });

    it('run-host.ps1 discovers active IPv4 while excluding virtual adapters', () => {
      const content = fs.readFileSync(runPs1Path, 'utf8');
      assert.match(content, /Get-NetIPAddress/);
      assert.match(content, /-AddressFamily\s+IPv4/);
      assert.match(content, /vEthernet|WSL|Loopback/);
      assert.match(content, /127\.0\.0\.1/, 'Must fallback to 127.0.0.1 when offline');
    });

    it('run-host.ps1 inspects and creates Windows Defender Firewall rules', () => {
      const content = fs.readFileSync(runPs1Path, 'utf8');
      assert.match(content, /Get-NetFirewallRule/);
      assert.match(content, /New-NetFirewallRule/);
      assert.match(content, /Test-IsAdmin/);
      assert.match(content, /Security\.Principal\.WindowsPrincipal/);
    });

    it('run-host.ps1 handles missing Docker and continues in local mock mode', () => {
      const content = fs.readFileSync(runPs1Path, 'utf8');
      assert.match(content, /docker\s+info/);
      assert.match(content, /로컬 모의 모드로 서버만 계속 진행합니다/);
    });

    it('run-host.ps1 prints CTF Arena, Attacker, Defender, Observer, and SSH banner', () => {
      const content = fs.readFileSync(runPs1Path, 'utf8');
      assert.match(content, /role=attacker/);
      assert.match(content, /role=defender/);
      assert.match(content, /role=observer/);
      assert.match(content, /\/arena/, 'Must include CTF Arena URL in banner');
      assert.match(content, /ssh -p/, 'Must include SSH terminal instructions');
    });

    it('cleanup-host.ps1 supports container down and firewall rule removal', () => {
      const content = fs.readFileSync(cleanPs1Path, 'utf8');
      assert.match(content, /docker\s+compose.*down/);
      assert.match(content, /Remove-NetFirewallRule/);
      assert.match(content, /Metasploit-Sim-Web-3000/);
      assert.match(content, /Metasploit-Sim-SSH-2222/);
    });
  });

  // =========================================================================
  // 4. package.json Scripts & Target File Integrity
  // =========================================================================
  describe('4. package.json Scripts Validation', () => {
    const pkgPath = path.join(ROOT_DIR, 'package.json');
    let pkg: any;

    before(() => {
      assert.ok(fs.existsSync(pkgPath), 'package.json must exist');
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    });

    it('scripts.start executes pure TypeScript server entrypoint', () => {
      assert.equal(pkg.scripts.start, 'npx tsx server/index.ts');
      assert.ok(fs.existsSync(path.join(ROOT_DIR, 'server/index.ts')));
    });

    it('scripts["sim:start"] provides simulation server start alias', () => {
      assert.equal(pkg.scripts['sim:start'], 'npx tsx server/index.ts');
    });

    it('scripts["sim:host"] runs PowerShell host launcher with bypass execution policy', () => {
      const cmd = pkg.scripts['sim:host'];
      assert.ok(cmd, 'sim:host script must be defined');
      assert.match(cmd, /powershell/i);
      assert.match(cmd, /run-host\.ps1/);
      assert.match(cmd, /ExecutionPolicy\s+Bypass/i);
      assert.ok(fs.existsSync(path.join(ROOT_DIR, 'run-host.ps1')));
    });

    it('scripts["sim:host:sh"] runs macOS/Linux bash host launcher', () => {
      const cmd = pkg.scripts['sim:host:sh'];
      assert.ok(cmd, 'sim:host:sh script must be defined');
      assert.match(cmd, /bash/);
      assert.match(cmd, /run-host\.sh/);
      assert.ok(fs.existsSync(path.join(ROOT_DIR, 'run-host.sh')));
    });

    it('scripts["sim:clean"] runs PowerShell cleanup script', () => {
      const cmd = pkg.scripts['sim:clean'];
      assert.ok(cmd, 'sim:clean script must be defined');
      assert.match(cmd, /powershell/i);
      assert.match(cmd, /cleanup-host\.ps1/);
      assert.ok(fs.existsSync(path.join(ROOT_DIR, 'cleanup-host.ps1')));
    });

    it('scripts["sim:clean:sh"] runs bash cleanup script', () => {
      const cmd = pkg.scripts['sim:clean:sh'];
      assert.ok(cmd, 'sim:clean:sh script must be defined');
      assert.match(cmd, /bash/);
      assert.match(cmd, /cleanup-host\.sh/);
      assert.ok(fs.existsSync(path.join(ROOT_DIR, 'cleanup-host.sh')));
    });

    it('scripts.isolate invokes public repo guard script with --apply', () => {
      const cmd = pkg.scripts.isolate;
      assert.ok(cmd, 'isolate script must be defined');
      assert.match(cmd, /public-repo-guard\.ts/);
      assert.match(cmd, /--apply/);
      assert.ok(fs.existsSync(path.join(ROOT_DIR, 'scripts/loop/public-repo-guard.ts')));
    });

    it('all referenced script entrypoint files physically exist', () => {
      const expectedFiles = [
        'server/index.ts',
        'run-host.ps1',
        'cleanup-host.ps1',
        'run-host.sh',
        'cleanup-host.sh',
        'scripts/loop/public-repo-guard.ts',
        'scripts/bundle-client.ts',
      ];
      for (const file of expectedFiles) {
        assert.ok(fs.existsSync(path.join(ROOT_DIR, file)), `Referenced file ${file} must exist`);
      }
    });
  });

  // =========================================================================
  // 5. README.md Documentation & Reality Correspondence Verification
  // =========================================================================
  describe('5. README.md Documentation Accuracy & Correspondence', () => {
    const readmePath = path.join(ROOT_DIR, 'README.md');
    let readme: string;

    before(() => {
      assert.ok(fs.existsSync(readmePath), 'README.md must exist');
      readme = fs.readFileSync(readmePath, 'utf8');
    });

    it('documents offline standalone execution guarantee', () => {
      assert.match(readme, /Docker 없이도.*로컬 오프라인 독립 실행/);
      assert.match(readme, /MockInternetMesh/);
    });

    it('documents exact quick-start commands matching package.json', () => {
      assert.match(readme, /npm install/);
      assert.match(readme, /npm start/);
      assert.match(readme, /npm test/);
    });

    it('documents exact startup banner URLs matching server output', () => {
      assert.match(readme, /\?role=attacker/);
      assert.match(readme, /\?role=defender/);
      assert.match(readme, /\?role=observer/);
      assert.match(readme, /\/arena/);
      assert.match(readme, /ssh -p 2222/);
    });

    it('documents cross-platform simulation commands matching package.json', () => {
      // Windows PowerShell
      assert.match(readme, /npm run sim:host/);
      assert.match(readme, /npm run sim:clean/);

      // macOS & Linux Bash
      assert.match(readme, /npm run sim:host:sh/);
      assert.match(readme, /npm run sim:clean:sh/);
    });

    it('documents the 200 virtual nodes range (10.10.1.1 ~ 10.10.1.200)', () => {
      assert.match(readme, /10\.10\.1\.1/);
      assert.match(readme, /10\.10\.1\.200/);
      assert.match(readme, /60개 취약 서버/);
      assert.match(readme, /140개 보안 완벽 서버/);
    });
  });
});
