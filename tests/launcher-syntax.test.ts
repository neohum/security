import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Launcher scripts: UTF-8 BOM verification', () => {
  const runHostPath = path.resolve(process.cwd(), 'run-host.ps1');
  const cleanupHostPath = path.resolve(process.cwd(), 'cleanup-host.ps1');

  assert.ok(fs.existsSync(runHostPath), 'run-host.ps1 must exist');
  assert.ok(fs.existsSync(cleanupHostPath), 'cleanup-host.ps1 must exist');

  const runHostBuf = fs.readFileSync(runHostPath);
  const cleanupHostBuf = fs.readFileSync(cleanupHostPath);

  // UTF-8 BOM must be [0xEF, 0xBB, 0xBF]
  assert.equal(
    runHostBuf[0],
    0xef,
    'run-host.ps1 must start with UTF-8 BOM byte 0 (0xEF)'
  );
  assert.equal(
    runHostBuf[1],
    0xbb,
    'run-host.ps1 must start with UTF-8 BOM byte 1 (0xBB)'
  );
  assert.equal(
    runHostBuf[2],
    0xbf,
    'run-host.ps1 must start with UTF-8 BOM byte 2 (0xBF)'
  );

  assert.equal(
    cleanupHostBuf[0],
    0xef,
    'cleanup-host.ps1 must start with UTF-8 BOM byte 0 (0xEF)'
  );
  assert.equal(
    cleanupHostBuf[1],
    0xbb,
    'cleanup-host.ps1 must start with UTF-8 BOM byte 1 (0xBB)'
  );
  assert.equal(
    cleanupHostBuf[2],
    0xbf,
    'cleanup-host.ps1 must start with UTF-8 BOM byte 2 (0xBF)'
  );
});

test('Launcher scripts: run-host.ps1 PowerShell logic and syntax requirements', () => {
  const content = fs.readFileSync(path.resolve(process.cwd(), 'run-host.ps1'), 'utf-8');

  // Network IP detection
  assert.match(content, /Get-NetIPAddress/);
  assert.match(content, /IPv4/);

  // Firewall configuration
  assert.match(content, /Get-NetFirewallRule/);
  assert.match(content, /New-NetFirewallRule/);
  assert.match(content, /3000/);
  assert.match(content, /2222/);

  // Docker availability check
  assert.match(content, /docker\s+info/);
  assert.match(content, /docker\s+compose/);

  // Formatted URLs banner
  assert.match(content, /role=attacker/);
  assert.match(content, /role=defender/);
  assert.match(content, /role=observer/);
});

test('Launcher scripts: cleanup-host.ps1 PowerShell logic and syntax requirements', () => {
  const content = fs.readFileSync(path.resolve(process.cwd(), 'cleanup-host.ps1'), 'utf-8');

  // Docker shutdown
  assert.match(content, /docker\s+compose.*down/);

  // Firewall rule removal
  assert.match(content, /Remove-NetFirewallRule/);
  assert.match(content, /Metasploit-Sim-Web-3000/);
  assert.match(content, /Metasploit-Sim-SSH-2222/);
});

test('LAN Client Guide: documentation completeness', () => {
  const guidePath = path.resolve(process.cwd(), 'docs/lan-client-guide.md');
  assert.ok(fs.existsSync(guidePath), 'docs/lan-client-guide.md must exist');

  const content = fs.readFileSync(guidePath, 'utf-8');

  // Check multi-OS coverage
  assert.match(content, /Mac/i);
  assert.match(content, /Linux/i);
  assert.match(content, /Windows/i);

  // Check role URLs
  assert.match(content, /\?role=attacker/);
  assert.match(content, /\?role=defender/);
  assert.match(content, /\?role=observer/);

  // Check SSH instructions
  assert.match(content, /2222/);
  assert.match(content, /ssh/i);

  // Check troubleshooting items
  assert.match(content, /방화벽/);
  assert.match(content, /Wi-Fi/i);
});

test('Launcher scripts: macOS & Linux run-host.sh and cleanup-host.sh validity', () => {
  const runShPath = path.resolve(process.cwd(), 'run-host.sh');
  const cleanShPath = path.resolve(process.cwd(), 'cleanup-host.sh');

  assert.ok(fs.existsSync(runShPath), 'run-host.sh must exist');
  assert.ok(fs.existsSync(cleanShPath), 'cleanup-host.sh must exist');

  const runSh = fs.readFileSync(runShPath, 'utf-8');
  assert.match(runSh, /#!\/usr\/bin\/env bash/);
  assert.match(runSh, /ipconfig getifaddr/); // macOS detection
  assert.match(runSh, /hostname -I/);        // Linux detection
  assert.match(runSh, /npm install/);
  assert.match(runSh, /server\/index\.ts/);

  const cleanSh = fs.readFileSync(cleanShPath, 'utf-8');
  assert.match(cleanSh, /#!\/usr\/bin\/env bash/);
  assert.match(cleanSh, /docker compose/);
});
