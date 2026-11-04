import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ArenaManager,
  type Player,
  type AttackTraceEvent,
  type NodeCompromiseState,
} from '../server/arena-manager.ts';
import {
  MockInternetMesh,
  VULNERABLE_CATEGORIES,
} from '../server/mock-internet-mesh.ts';

test('ArenaManager: Player registration and session management', () => {
  const arena = new ArenaManager(new MockInternetMesh(42));

  // 1. Initial state
  assert.equal(arena.getLobbyState(), 'waiting');
  assert.equal(arena.getPlayerCount(), 0);
  assert.equal(arena.getDuration(), 900);
  assert.equal(arena.getTimeRemaining(), 900);

  // 2. Reject empty nickname
  assert.throws(() => {
    arena.registerPlayer({ nickname: '' });
  }, /Nickname cannot be empty/);

  // 3. Register player with custom avatar & IP
  const player1 = arena.registerPlayer({
    nickname: 'GhostSec',
    clientIp: '192.168.1.101',
    avatar: 'cyber-ninja',
  });

  assert.ok(player1.id.startsWith('p_'));
  assert.equal(player1.nickname, 'GhostSec');
  assert.equal(player1.clientIp, '192.168.1.101');
  assert.equal(player1.avatar, 'cyber-ninja');
  assert.equal(player1.score, 0);
  assert.equal(player1.firstBloodCount, 0);
  assert.equal(player1.compromisedCount, 0);
  assert.equal(arena.getPlayerCount(), 1);

  // 4. Register second player with defaults
  const player2 = arena.registerPlayer({
    nickname: 'BinaryBeast',
  });
  assert.equal(player2.nickname, 'BinaryBeast');
  assert.equal(player2.clientIp, '127.0.0.1');
  assert.equal(player2.avatar, 'avatar-1');
  assert.equal(arena.getPlayerCount(), 2);

  // 5. Lookups
  const foundById = arena.getPlayer(player1.id);
  assert.equal(foundById?.nickname, 'GhostSec');

  const foundByNick = arena.getPlayerByNickname('ghostsec');
  assert.equal(foundByNick?.id, player1.id);

  // 6. Reconnection returns same session
  const reconnected = arena.registerPlayer({
    nickname: 'GhostSec',
    clientIp: '192.168.1.150',
  });
  assert.equal(reconnected.id, player1.id);
  assert.equal(reconnected.clientIp, '192.168.1.150');
  assert.equal(arena.getPlayerCount(), 2);

  arena.destroy();
});

test('ArenaManager: Lobby transitions and timer control', () => {
  const arena = new ArenaManager(new MockInternetMesh(42), { durationSeconds: 60 });
  assert.equal(arena.getDuration(), 60);
  assert.equal(arena.getTimeRemaining(), 60);

  let startedEmitted = false;
  arena.on('match:started', () => {
    startedEmitted = true;
  });

  // Start match
  arena.startMatch();
  assert.equal(arena.getLobbyState(), 'active');
  assert.equal(startedEmitted, true);

  // Attempting to change duration while active throws
  assert.throws(() => {
    arena.setDuration(120);
  }, /Cannot change duration while match is active/);

  // Stop match
  let finishedEmitted = false;
  arena.on('match:finished', () => {
    finishedEmitted = true;
  });

  arena.stopMatch();
  assert.equal(arena.getLobbyState(), 'finished');
  assert.equal(finishedEmitted, true);

  // Reset match returns to waiting
  arena.resetMatch();
  assert.equal(arena.getLobbyState(), 'waiting');
  assert.equal(arena.getTimeRemaining(), 60);

  arena.destroy();
});

test('ArenaManager: 200-node compromise state map initialization', () => {
  const arena = new ArenaManager(new MockInternetMesh(42));
  const stateMap = arena.getNodeStateMap();

  // Exactly 200 nodes
  const ips = Object.keys(stateMap);
  assert.equal(ips.length, 200);

  // All nodes unprobed initially
  for (let i = 1; i <= 200; i++) {
    const ip = `10.10.1.${i}`;
    assert.ok(stateMap[ip], `IP ${ip} must be present in nodeStateMap`);
    assert.equal(stateMap[ip].status, 'unprobed');
    assert.equal(stateMap[ip].compromisedBy, undefined);
  }

  arena.destroy();
});

test('ArenaManager: Command evaluation requires active match', () => {
  const arena = new ArenaManager(new MockInternetMesh(42));
  const p1 = arena.registerPlayer({ nickname: 'Neo' });

  // Waiting state -> fails
  const resWait = arena.evaluateCommand(p1.id, 'whois 10.10.1.1');
  assert.equal(resWait.success, false);
  assert.equal(resWait.reason, 'match_not_active');

  // Start match -> active
  arena.startMatch();
  // Invalid player -> fails
  const resBadPlayer = arena.evaluateCommand('bad_id', 'whois 10.10.1.1');
  assert.equal(resBadPlayer.success, false);
  assert.equal(resBadPlayer.reason, 'player_not_found');

  // Stop match -> finished
  arena.stopMatch();
  const resFin = arena.evaluateCommand(p1.id, 'whois 10.10.1.1');
  assert.equal(resFin.success, false);
  assert.equal(resFin.reason, 'match_not_active');

  arena.destroy();
});

test('ArenaManager: Hardened nodes and generic scans update status to scanned', () => {
  const mesh = new MockInternetMesh(42);
  const arena = new ArenaManager(mesh);
  arena.startMatch();

  const player = arena.registerPlayer({ nickname: 'Scout' });
  const hardenedNode = mesh.getAllNodes().find(n => n.category === 'hardened')!;
  const vulnNode = mesh.getVulnerableNodes()[0];

  // 1. Probing hardened node
  const resHardened = arena.evaluateCommand(player.id, `nmap -sS -p 22 ${hardenedNode.ip}`);
  assert.equal(resHardened.success, false);
  assert.equal(resHardened.reason, 'node_hardened');

  const hardenedState = arena.getNodeState(hardenedNode.ip);
  assert.equal(hardenedState?.status, 'scanned');
  assert.equal(hardenedState?.compromisedBy, undefined);

  // 2. Generic probe against vulnerable node that does not trigger exploit
  const resProbe = arena.evaluateCommand(player.id, `ping -c 3 ${vulnNode.ip}`);
  assert.equal(resProbe.success, false);
  assert.equal(resProbe.reason, 'node_scanned');

  const vulnState = arena.getNodeState(vulnNode.ip);
  assert.equal(vulnState?.status, 'scanned');
  assert.equal(vulnState?.compromisedBy, undefined);

  arena.destroy();
});

test('ArenaManager: Automated evaluation and scoring across all 6 vulnerable categories', () => {
  const mesh = new MockInternetMesh(42);
  const arena = new ArenaManager(mesh);
  arena.startMatch();

  const player = arena.registerPlayer({ nickname: 'HackerPro' });

  // 1. Whois: 50 pts base + 50 FB = 100 pts
  const whoisNode = mesh.getVulnerableNodesByCategory('whois')[0];
  const resWhois = arena.evaluateCommand(player.id, `whois -h whois.mega-infra.net ${whoisNode.ip}`);
  assert.equal(resWhois.success, true);
  assert.equal(resWhois.pointsAwarded, 100); // 50 + 50 FB
  assert.equal(resWhois.isFirstBlood, true);
  assert.equal(player.score, 100);
  assert.equal(player.firstBloodCount, 1);
  assert.equal(player.compromisedCount, 1);

  // 2. DNS AXFR: 100 pts base + 50 FB = 150 pts
  const dnsNode = mesh.getVulnerableNodesByCategory('dns-axfr')[0];
  const resDns = arena.evaluateCommand(player.id, `dig axfr @${dnsNode.ip} mega-infra.net`);
  assert.equal(resDns.success, true);
  assert.equal(resDns.pointsAwarded, 150); // 100 + 50 FB
  assert.equal(resDns.isFirstBlood, true);
  assert.equal(player.score, 250);
  assert.equal(player.firstBloodCount, 2);

  // 3. Web Banner: 100 pts base + 50 FB = 150 pts
  const webNode = mesh.getVulnerableNodesByCategory('web-banner')[0];
  const resWeb = arena.evaluateCommand(player.id, `curl -I http://${webNode.ip}`);
  assert.equal(resWeb.success, true);
  assert.equal(resWeb.pointsAwarded, 150);
  assert.equal(resWeb.isFirstBlood, true);
  assert.equal(player.score, 400);

  // 4. MSSQL: 150 pts base + 50 FB = 200 pts
  const mssqlNode = mesh.getVulnerableNodesByCategory('mssql')[0];
  const resMssql = arena.evaluateCommand(player.id, `sqsh -S ${mssqlNode.ip}:1433 -U sa -P Password123!`);
  assert.equal(resMssql.success, true);
  assert.equal(resMssql.pointsAwarded, 200); // 150 + 50 FB
  assert.equal(resMssql.isFirstBlood, true);
  assert.equal(player.score, 600);

  // 5. S3 Bucket: 150 pts base + 50 FB = 200 pts
  const s3Node = mesh.getVulnerableNodesByCategory('s3-bucket')[0];
  const resS3 = arena.evaluateCommand(player.id, `aws --endpoint-url http://${s3Node.ip}:9000 s3 cp s3://backup/config.env .`);
  assert.equal(resS3.success, true);
  assert.equal(resS3.pointsAwarded, 200); // 150 + 50 FB
  assert.equal(resS3.isFirstBlood, true);
  assert.equal(player.score, 800);

  // 6. Legacy Backdoor: 200 pts base + 50 FB = 250 pts
  const legacyNode = mesh.getVulnerableNodesByCategory('legacy-service')[0];
  const resLegacy = arena.evaluateCommand(player.id, `nc ${legacyNode.ip} 1524`);
  assert.equal(resLegacy.success, true);
  assert.equal(resLegacy.pointsAwarded, 250); // 200 + 50 FB
  assert.equal(resLegacy.isFirstBlood, true);
  assert.equal(player.score, 1050);
  assert.equal(player.firstBloodCount, 6);
  assert.equal(player.compromisedCount, 6);

  arena.destroy();
});

test('ArenaManager: First blood bonus and idempotent scoring', () => {
  const mesh = new MockInternetMesh(42);
  const arena = new ArenaManager(mesh);
  arena.startMatch();

  const alice = arena.registerPlayer({ nickname: 'Alice' });
  const bob = arena.registerPlayer({ nickname: 'Bob' });

  const mssqlNode = mesh.getVulnerableNodesByCategory('mssql')[0];

  // 1. Alice is first blood -> 150 base + 50 FB = 200 pts
  const resAlice1 = arena.evaluateCommand(alice.id, `mssql sa:Password123! on ${mssqlNode.ip}`);
  assert.equal(resAlice1.success, true);
  assert.equal(resAlice1.pointsAwarded, 200);
  assert.equal(resAlice1.isFirstBlood, true);
  assert.equal(alice.score, 200);
  assert.equal(alice.firstBloodCount, 1);

  // 2. Alice repeats the exploit -> Idempotent! 0 pts
  const resAliceDup = arena.evaluateCommand(alice.id, `mssql sa:Password123! on ${mssqlNode.ip}`);
  assert.equal(resAliceDup.success, false);
  assert.equal(resAliceDup.duplicate, true);
  assert.equal(resAliceDup.reason, 'already_compromised_by_player');
  assert.equal(alice.score, 200); // Score remains 200

  // 3. Bob compromises the same node -> Gets base points (150 pts), NO first blood bonus
  const resBob1 = arena.evaluateCommand(bob.id, `mssql sa:Password123! on ${mssqlNode.ip}`);
  assert.equal(resBob1.success, true);
  assert.equal(resBob1.pointsAwarded, 150);
  assert.equal(resBob1.isFirstBlood, false);
  assert.equal(bob.score, 150);
  assert.equal(bob.firstBloodCount, 0);

  // 4. Bob repeats -> Idempotent! 0 pts
  const resBobDup = arena.evaluateCommand(bob.id, `mssql sa:Password123! on ${mssqlNode.ip}`);
  assert.equal(resBobDup.success, false);
  assert.equal(resBobDup.duplicate, true);
  assert.equal(bob.score, 150);

  // Check node state: compromised by Alice (first blood)
  const nodeState = arena.getNodeState(mssqlNode.ip);
  assert.equal(nodeState?.status, 'compromised');
  assert.equal(nodeState?.compromisedBy?.nickname, 'Alice');

  arena.destroy();
});

test('ArenaManager: Attack Trace timeline event logging', () => {
  const mesh = new MockInternetMesh(42);
  const arena = new ArenaManager(mesh);
  arena.startMatch();

  const player = arena.registerPlayer({ nickname: 'Cipher' });
  const vulnNode = mesh.getVulnerableNodesByCategory('legacy-service')[0];

  let eventCaptured: AttackTraceEvent | null = null;
  arena.on('attack:compromise', (evt: AttackTraceEvent) => {
    eventCaptured = evt;
  });

  const res = arena.evaluateCommand(player.id, `vsftpd 2.3.4 backdoor exploit on ${vulnNode.ip}`);
  assert.equal(res.success, true);

  const trace = arena.getAttackTrace();
  assert.equal(trace.length, 1);
  const event = trace[0];

  assert.ok(event.id.startsWith('trace_'));
  assert.equal(typeof event.timestamp, 'number');
  assert.equal(event.playerId, player.id);
  assert.equal(event.nickname, 'Cipher');
  assert.equal(event.ip, vulnNode.ip);
  assert.equal(event.category, 'legacy-service');
  assert.equal(event.method, 'Legacy Service Backdoor Exploit');
  assert.equal(event.points, 250); // 200 + 50 FB
  assert.equal(event.isFirstBlood, true);

  assert.equal(eventCaptured?.id, event.id);

  arena.destroy();
});

test('ArenaManager: Real-time leaderboard ranking with score and time tie-breaking', async () => {
  const mesh = new MockInternetMesh(42);
  const arena = new ArenaManager(mesh);
  arena.startMatch();

  const p1 = arena.registerPlayer({ nickname: 'PlayerOne' });
  const p2 = arena.registerPlayer({ nickname: 'PlayerTwo' });
  const p3 = arena.registerPlayer({ nickname: 'PlayerThree' });

  const whoisNodes = mesh.getVulnerableNodesByCategory('whois');
  const webNodes = mesh.getVulnerableNodesByCategory('web-banner');

  // PlayerOne compromises node 1 (whois) -> 100 pts
  arena.evaluateCommand(p1.id, `whois ${whoisNodes[0].ip}`);
  assert.equal(p1.score, 100);

  // Small delay so timestamps differ
  await new Promise(r => setTimeout(r, 10));

  // PlayerTwo compromises node 2 (whois) -> 100 pts
  arena.evaluateCommand(p2.id, `whois ${whoisNodes[1].ip}`);
  assert.equal(p2.score, 100);

  // PlayerThree compromises web node -> 150 pts
  arena.evaluateCommand(p3.id, `curl http://${webNodes[0].ip}`);
  assert.equal(p3.score, 150);

  const leaderboard = arena.getLeaderboard();
  assert.equal(leaderboard.length, 3);

  // Rank 1: PlayerThree (150 pts)
  assert.equal(leaderboard[0].rank, 1);
  assert.equal(leaderboard[0].nickname, 'PlayerThree');
  assert.equal(leaderboard[0].score, 150);

  // Rank 2: PlayerOne (100 pts, reached earlier)
  assert.equal(leaderboard[1].rank, 2);
  assert.equal(leaderboard[1].nickname, 'PlayerOne');
  assert.equal(leaderboard[1].score, 100);

  // Rank 3: PlayerTwo (100 pts, reached later)
  assert.equal(leaderboard[2].rank, 3);
  assert.equal(leaderboard[2].nickname, 'PlayerTwo');
  assert.equal(leaderboard[2].score, 100);

  arena.destroy();
});

test('ArenaManager: Flag direct input in command or output string', () => {
  const mesh = new MockInternetMesh(42);
  const arena = new ArenaManager(mesh);
  arena.startMatch();

  const player = arena.registerPlayer({ nickname: 'FlagHunter' });
  const s3Node = mesh.getVulnerableNodesByCategory('s3-bucket')[0];

  assert.ok(s3Node.flag);

  // Submitting terminal output containing the leaked flag
  const terminalOutput = `Output from curl:\nCONFIDENTIAL_FLAG=${s3Node.flag}\nConnection closed.`;
  const res = arena.evaluateCommand(player.id, terminalOutput);

  assert.equal(res.success, true);
  assert.equal(res.targetIp, s3Node.ip);
  assert.equal(res.pointsAwarded, 200); // 150 + 50 FB

  arena.destroy();
});
