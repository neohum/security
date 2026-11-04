// tests/arena-concurrency-leaderboard.test.ts
// Comprehensive Concurrency & Leaderboard Engine Test Suite for CTF Arena.
//
// Conforms to:
//   - 10+ concurrent players competing on identical and distinct nodes
//   - First Blood bonus (+50 PT) awarded exactly once to the first compromiser
//   - Idempotent scoring preventing duplicate point awards under high concurrency
//   - Score tie-breaking by earliest last compromise timestamp
//   - Match timer expiration transitioning to finished and preserving Hall of Fame across resets

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ArenaManager,
  type Player,
  type AttackTraceEvent,
  type LeaderboardEntry,
  type HallOfFameRecord,
} from '../server/arena-manager.ts';
import {
  MockInternetMesh,
  VULNERABLE_CATEGORIES,
} from '../server/mock-internet-mesh.ts';

describe('CTF Arena Concurrency & Leaderboard Engine (server/arena-manager.ts)', () => {
  it('1. First Blood (+50 PT) 동시성 검증: 12인 플레이어가 동일 노드를 동시 탈취할 때 최초 1회만 보너스 부여', async () => {
    const mesh = new MockInternetMesh(777);
    const arena = new ArenaManager(mesh, { durationSeconds: 600, firstBloodBonus: 50 });
    arena.startMatch();

    // 12 players register
    const players: Player[] = [];
    for (let i = 1; i <= 12; i++) {
      const p = arena.registerPlayer({
        nickname: `Agent_${String(i).padStart(2, '0')}`,
        clientIp: `192.168.10.${100 + i}`,
      });
      players.push(p);
    }
    assert.equal(arena.getPlayerCount(), 12);

    // Pick a vulnerable MSSQL node (150 base pts)
    const mssqlNode = mesh.getVulnerableNodesByCategory('mssql')[0];
    assert.ok(mssqlNode);
    const exploitCmd = `sqsh -S ${mssqlNode.ip}:1433 -U sa -P Password123!`;

    // 12 players simultaneously execute exploit on the exact same node
    const outcomes = await Promise.all(
      players.map(async (player) => {
        return arena.evaluateCommand(player.id, exploitCmd);
      })
    );

    // All 12 commands succeeded in capturing the node
    assert.equal(outcomes.length, 12);
    outcomes.forEach((res) => {
      assert.equal(res.success, true, 'All players should successfully exploit the node');
    });

    // Exactly ONE outcome had isFirstBlood === true
    const fbOutcomes = outcomes.filter((res) => res.isFirstBlood === true);
    assert.equal(fbOutcomes.length, 1, 'Exactly one player must get First Blood');

    const nonFbOutcomes = outcomes.filter((res) => res.isFirstBlood === false);
    assert.equal(nonFbOutcomes.length, 11, 'All other 11 players must NOT get First Blood');

    // Winner gets 150 (base) + 50 (bonus) = 200 pts
    assert.equal(fbOutcomes[0].pointsAwarded, 200);
    // Others get 150 base pts
    nonFbOutcomes.forEach((res) => {
      assert.equal(res.pointsAwarded, 150);
    });

    // Verify node compromise state in arena
    const nodeState = arena.getNodeState(mssqlNode.ip);
    assert.equal(nodeState?.status, 'compromised');
    assert.ok(nodeState?.compromisedBy?.nickname);

    // The nickname in compromisedBy must match the first blood winner
    const winnerPlayer = players.find(
      (p) => p.nickname === nodeState?.compromisedBy?.nickname
    );
    assert.ok(winnerPlayer);
    assert.equal(winnerPlayer.score, 200);
    assert.equal(winnerPlayer.firstBloodCount, 1);
    assert.equal(winnerPlayer.compromisedCount, 1);

    // All other players have score 150 and firstBloodCount 0
    const otherPlayers = players.filter((p) => p.id !== winnerPlayer.id);
    for (const p of otherPlayers) {
      assert.equal(p.score, 150);
      assert.equal(p.firstBloodCount, 0);
      assert.equal(p.compromisedCount, 1);
    }

    // Verify attack trace has exactly one first blood event for this IP
    const traces = arena.getAttackTrace().filter((t) => t.ip === mssqlNode.ip);
    assert.equal(traces.length, 12);
    const fbTraces = traces.filter((t) => t.isFirstBlood);
    assert.equal(fbTraces.length, 1);
    assert.equal(fbTraces[0].playerId, winnerPlayer.id);

    arena.destroy();
  });

  it('2. 중복 탈취 시 점수 중복 지급 차단 (Idempotency 동시성 검증)', async () => {
    const mesh = new MockInternetMesh(888);
    const arena = new ArenaManager(mesh);
    arena.startMatch();

    // 10 players register
    const players: Player[] = [];
    for (let i = 1; i <= 10; i++) {
      players.push(arena.registerPlayer({ nickname: `Hacker_${i}` }));
    }

    // Target a whois node (50 base pts)
    const whoisNode = mesh.getVulnerableNodesByCategory('whois')[0];
    const exploitCmd = `whois -h whois.mega-infra.net ${whoisNode.ip}`;

    // First round: all 10 compromise the node once
    await Promise.all(players.map((p) => arena.evaluateCommand(p.id, exploitCmd)));

    // Snapshot scores after initial compromise
    const scoresBefore = players.map((p) => p.score);
    const compCountBefore = players.map((p) => p.compromisedCount);
    const traceCountBefore = arena.getAttackTrace().length;
    assert.equal(traceCountBefore, 10);

    // Second round: all 10 players send 3 duplicate requests simultaneously (30 concurrent calls)
    const duplicatePromises: Promise<any>[] = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const p of players) {
        duplicatePromises.push(
          Promise.resolve().then(() => arena.evaluateCommand(p.id, exploitCmd))
        );
      }
    }

    const dupResults = await Promise.all(duplicatePromises);
    assert.equal(dupResults.length, 30);

    // Every duplicate request MUST be rejected with idempotency response
    for (const res of dupResults) {
      assert.equal(res.success, false);
      assert.equal(res.duplicate, true);
      assert.equal(res.reason, 'already_compromised_by_player');
      assert.equal(res.pointsAwarded, undefined);
    }

    // Verify player scores, compromise counts, and trace length did NOT change
    players.forEach((p, idx) => {
      assert.equal(p.score, scoresBefore[idx], `Player ${p.nickname} score must not change`);
      assert.equal(
        p.compromisedCount,
        compCountBefore[idx],
        `Player ${p.nickname} compromise count must not change`
      );
    });
    assert.equal(arena.getAttackTrace().length, traceCountBefore);

    arena.destroy();
  });

  it('3. 10인 플레이어가 서로 다른 취약 노드를 동시 탈취할 때 각각 First Blood 부여 검증', async () => {
    const mesh = new MockInternetMesh(999);
    const arena = new ArenaManager(mesh);
    arena.startMatch();

    // 10 players register
    const players: Player[] = [];
    for (let i = 1; i <= 10; i++) {
      players.push(arena.registerPlayer({ nickname: `Squad_${i}` }));
    }

    // Collect 10 distinct vulnerable nodes across multiple categories
    const allVulns = mesh.getVulnerableNodes();
    assert.ok(allVulns.length >= 10);
    const targetNodes = allVulns.slice(0, 10);

    // Each player concurrently targets their own distinct node
    const outcomes = await Promise.all(
      players.map(async (player, idx) => {
        const node = targetNodes[idx];
        return arena.evaluateCommand(player.id, `${node.flag} on ${node.ip}`);
      })
    );

    // Every player compromised a distinct fresh node -> ALL 10 get First Blood
    outcomes.forEach((outcome, idx) => {
      assert.equal(outcome.success, true);
      assert.equal(outcome.isFirstBlood, true, `Player ${players[idx].nickname} must receive First Blood`);
      assert.ok((outcome.pointsAwarded ?? 0) > 0);
    });

    // Each player has firstBloodCount = 1 and compromisedCount = 1
    players.forEach((player) => {
      assert.equal(player.firstBloodCount, 1);
      assert.equal(player.compromisedCount, 1);
      assert.ok(player.score >= 100); // 50 base + 50 FB minimum
    });

    // All 10 nodes are marked compromised
    targetNodes.forEach((node) => {
      const state = arena.getNodeState(node.ip);
      assert.equal(state?.status, 'compromised');
    });

    arena.destroy();
  });

  it('4. 점수 타이브레이킹: 동점일 경우 마지막 득점 시각이 빠른 순서로 랭킹 정렬', async () => {
    const mesh = new MockInternetMesh(1234);
    const arena = new ArenaManager(mesh);
    arena.startMatch();

    // Register 4 players
    const p1 = arena.registerPlayer({ nickname: 'Speedy' });
    const p2 = arena.registerPlayer({ nickname: 'Tardy' });
    const p3 = arena.registerPlayer({ nickname: 'HighRoller' });
    const p4 = arena.registerPlayer({ nickname: 'LateComer' });

    const whoisNodes = mesh.getVulnerableNodesByCategory('whois');
    const legacyNodes = mesh.getVulnerableNodesByCategory('legacy-service');

    // Case A: Speedy scores 100 PT at T1
    arena.evaluateCommand(p1.id, `whois ${whoisNodes[0].ip}`);
    assert.equal(p1.score, 100);

    // Artificially wait a small delay so T2 > T1
    await new Promise((r) => setTimeout(r, 20));

    // Tardy scores 100 PT at T2 (T2 > T1)
    arena.evaluateCommand(p2.id, `whois ${whoisNodes[1].ip}`);
    assert.equal(p2.score, 100);

    // HighRoller scores 250 PT (200 base + 50 FB)
    arena.evaluateCommand(p3.id, `vsftpd 2.3.4 backdoor on ${legacyNodes[0].ip}`);
    assert.equal(p3.score, 250);

    // LateComer has 0 points
    assert.equal(p4.score, 0);

    const leaderboard = arena.getLeaderboard();
    assert.equal(leaderboard.length, 4);

    // Rank 1: HighRoller (250 PT - highest score wins outright)
    assert.equal(leaderboard[0].rank, 1);
    assert.equal(leaderboard[0].nickname, 'HighRoller');
    assert.equal(leaderboard[0].score, 250);

    // Rank 2: Speedy (100 PT, reached before Tardy)
    assert.equal(leaderboard[1].rank, 2);
    assert.equal(leaderboard[1].nickname, 'Speedy');
    assert.equal(leaderboard[1].score, 100);

    // Rank 3: Tardy (100 PT, reached after Speedy)
    assert.equal(leaderboard[2].rank, 3);
    assert.equal(leaderboard[2].nickname, 'Tardy');
    assert.equal(leaderboard[2].score, 100);

    // Rank 4: LateComer (0 PT)
    assert.equal(leaderboard[3].rank, 4);
    assert.equal(leaderboard[3].nickname, 'LateComer');
    assert.equal(leaderboard[3].score, 0);

    arena.destroy();
  });

  it('4-B. 동점 타이브레이킹: 다단계 득점 후 동점 시 최종 득점 달성 시각 기준 검증', async () => {
    const mesh = new MockInternetMesh(555);
    const arena = new ArenaManager(mesh);
    arena.startMatch();

    const pEarly = arena.registerPlayer({ nickname: 'EarlyAchiever' });
    const pLate = arena.registerPlayer({ nickname: 'LateAchiever' });

    const mssqlNodes = mesh.getVulnerableNodesByCategory('mssql');
    const whoisNodes = mesh.getVulnerableNodesByCategory('whois');

    // pEarly reaches 200 pts in a single exploit at T_early (150 base + 50 FB = 200)
    arena.evaluateCommand(pEarly.id, `mssql sa:Password123! on ${mssqlNodes[0].ip}`);
    assert.equal(pEarly.score, 200);

    await new Promise((r) => setTimeout(r, 15));

    // pLate reaches 100 pts at T_step1 (50 base + 50 FB = 100)
    arena.evaluateCommand(pLate.id, `whois ${whoisNodes[0].ip}`);
    assert.equal(pLate.score, 100);

    await new Promise((r) => setTimeout(r, 15));

    // pLate reaches 200 pts at T_step2 (50 base + 50 FB = 100 -> total 200)
    arena.evaluateCommand(pLate.id, `whois ${whoisNodes[1].ip}`);
    assert.equal(pLate.score, 200);

    // Both players have 200 points.
    // EarlyAchiever reached 200 PT at T_early.
    // LateAchiever reached 200 PT at T_step2 (T_step2 > T_early).
    const lb = arena.getLeaderboard();
    assert.equal(lb[0].nickname, 'EarlyAchiever', 'EarlyAchiever must win tie-break');
    assert.equal(lb[0].rank, 1);
    assert.equal(lb[1].nickname, 'LateAchiever');
    assert.equal(lb[1].rank, 2);

    arena.destroy();
  });

  it('4-C. 동점 타이브레이킹: 동일 밀리초 내 동시 실행 시 단조 타임스탬프로 선행 처리 선수 우대', () => {
    const mesh = new MockInternetMesh(444);
    const arena = new ArenaManager(mesh);
    arena.startMatch();

    // Register pFirst then pSecond
    const pFirst = arena.registerPlayer({ nickname: 'FirstInMs' });
    const pSecond = arena.registerPlayer({ nickname: 'SecondInMs' });

    const dnsNodes = mesh.getVulnerableNodesByCategory('dns-axfr');

    // Both execute consecutively in the same JS tick / millisecond
    arena.evaluateCommand(pFirst.id, `dig axfr @${dnsNodes[0].ip} mega-infra.net`);
    arena.evaluateCommand(pSecond.id, `dig axfr @${dnsNodes[1].ip} mega-infra.net`);

    assert.equal(pFirst.score, 150);
    assert.equal(pSecond.score, 150);

    // Verify pFirst.lastCompromiseTime < pSecond.lastCompromiseTime strictly
    assert.ok(
      (pFirst.lastCompromiseTime ?? 0) < (pSecond.lastCompromiseTime ?? 0),
      'FirstInMs must have strictly earlier monotonic timestamp'
    );

    const lb = arena.getLeaderboard();
    assert.equal(lb[0].nickname, 'FirstInMs');
    assert.equal(lb[0].rank, 1);
    assert.equal(lb[1].nickname, 'SecondInMs');
    assert.equal(lb[1].rank, 2);

    arena.destroy();
  });

  it('5. 매치 타이머 종료 시 finished 상태 전환 및 명예의 전당(Hall of Fame) 보존 검증', async () => {
    const mesh = new MockInternetMesh(789);
    // 2-second match
    const arena = new ArenaManager(mesh, { durationSeconds: 2 });

    const champion = arena.registerPlayer({ nickname: 'ChampionAlice' });
    const runnerUp = arena.registerPlayer({ nickname: 'RunnerUpBob' });

    let matchStartedEmitted = false;
    let matchFinishedEmitted = false;
    let finishedData: any = null;

    arena.on('match:started', () => {
      matchStartedEmitted = true;
    });

    arena.on('match:finished', (data) => {
      matchFinishedEmitted = true;
      finishedData = data;
    });

    // Start match
    arena.startMatch();
    assert.equal(arena.getLobbyState(), 'active');
    assert.equal(arena.getTimeRemaining(), 2);
    assert.equal(matchStartedEmitted, true);

    // Score points during active match
    const vulnNode = mesh.getVulnerableNodesByCategory('legacy-service')[0];
    arena.evaluateCommand(champion.id, `vsftpd 2.3.4 backdoor on ${vulnNode.ip}`);
    assert.equal(champion.score, 250);

    const whoisNode = mesh.getVulnerableNodesByCategory('whois')[0];
    arena.evaluateCommand(runnerUp.id, `whois ${whoisNode.ip}`);
    assert.equal(runnerUp.score, 100);

    // Tick the timer to 0 to simulate countdown expiration
    arena.tick(1);
    assert.equal(arena.getTimeRemaining(), 1);
    assert.equal(arena.getLobbyState(), 'active');

    arena.tick(1); // Reaches 0 -> triggers stopMatch()
    assert.equal(arena.getTimeRemaining(), 0);
    assert.equal(arena.getLobbyState(), 'finished');
    assert.equal(matchFinishedEmitted, true);

    // Verify Hall of Fame snapshot
    const hof = arena.getHallOfFame();
    assert.ok(hof, 'Hall of Fame must be created on match finished');
    assert.equal(hof.durationSeconds, 2);
    assert.equal(hof.winner?.nickname, 'ChampionAlice');
    assert.equal(hof.winner?.score, 250);
    assert.equal(hof.top3.length, 2);
    assert.equal(hof.totalPoints, 350);
    assert.equal(hof.totalCompromised, 2);
    assert.equal(hof.totalPlayers, 2);
    assert.ok(hof.finishedAt > 0);

    // Finished event payload also carries Hall of Fame
    assert.equal(finishedData?.hallOfFame?.winner?.nickname, 'ChampionAlice');

    // Commands submitted after match finish must be rejected
    const postMatchRes = arena.evaluateCommand(champion.id, `whois 10.10.1.1`);
    assert.equal(postMatchRes.success, false);
    assert.equal(postMatchRes.reason, 'match_not_active');

    // ==========================================
    // CRITICAL: Hall of Fame Preservation Across Reset
    // ==========================================
    arena.resetMatch();
    assert.equal(arena.getLobbyState(), 'waiting');
    assert.equal(arena.getTimeRemaining(), 2);

    // Player scores are reset for the new match
    assert.equal(champion.score, 0);
    assert.equal(runnerUp.score, 0);

    // BUT the Hall of Fame from the finished match is PRESERVED!
    const preservedHof = arena.getHallOfFame();
    assert.ok(preservedHof, 'Hall of Fame must survive match reset');
    assert.equal(preservedHof.winner?.nickname, 'ChampionAlice');
    assert.equal(preservedHof.winner?.score, 250);
    assert.equal(preservedHof.totalPoints, 350);

    const history = arena.getHallOfFameHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].winner?.nickname, 'ChampionAlice');

    arena.destroy();
  });

  it('6. 15인 동시 다발적 경합 & 실시간 리더보드 이벤트 동기화 스트레스 테스트', async () => {
    const mesh = new MockInternetMesh(333);
    const arena = new ArenaManager(mesh);
    arena.startMatch();

    const playerCount = 15;
    const players: Player[] = [];
    for (let i = 1; i <= playerCount; i++) {
      players.push(
        arena.registerPlayer({
          nickname: `Contender_${String(i).padStart(2, '0')}`,
          avatar: `avatar-${(i % 6) + 1}`,
        })
      );
    }
    assert.equal(arena.getPlayerCount(), 15);

    let compromiseEventCount = 0;
    let leaderboardUpdateCount = 0;
    let nodeUpdateCount = 0;

    arena.on('attack:compromise', () => {
      compromiseEventCount++;
    });
    arena.on('leaderboard:updated', () => {
      leaderboardUpdateCount++;
    });
    arena.on('node:updated', () => {
      nodeUpdateCount++;
    });

    const vulnNodes = mesh.getVulnerableNodes();
    const commonNode = vulnNodes[0];

    // Stage 1: All 15 players simultaneously attack commonNode
    const stage1Outcomes = await Promise.all(
      players.map((p) =>
        arena.evaluateCommand(p.id, `${commonNode.flag} on ${commonNode.ip}`)
      )
    );

    // 15 successful compromises
    assert.equal(stage1Outcomes.length, 15);
    const fbCount = stage1Outcomes.filter((o) => o.isFirstBlood).length;
    assert.equal(fbCount, 1, 'Only 1 player gets First Blood for common node');

    // Stage 2: Players 1..10 each compromise their own unique node
    const stage2Outcomes = await Promise.all(
      players.slice(0, 10).map((p, idx) => {
        const uniqueNode = vulnNodes[idx + 1];
        return arena.evaluateCommand(
          p.id,
          `${uniqueNode.flag} on ${uniqueNode.ip}`
        );
      })
    );

    // 10 unique nodes compromised -> all 10 get First Blood
    assert.equal(stage2Outcomes.filter((o) => o.isFirstBlood).length, 10);

    // Verify leaderboard ranking consistency
    const lb = arena.getLeaderboard();
    assert.equal(lb.length, 15);

    // All ranks 1..15 are assigned without gaps
    for (let i = 0; i < lb.length; i++) {
      assert.equal(lb[i].rank, i + 1);
      if (i > 0) {
        // Must be in descending score order or tie-broken
        assert.ok(
          lb[i - 1].score >= lb[i].score,
          `Leaderboard must be sorted: rank ${lb[i - 1].rank} score (${lb[i - 1].score}) >= rank ${lb[i].rank} score (${lb[i].score})`
        );
      }
    }

    // Verify total compromise events match total successful compromises (15 in stage 1 + 10 in stage 2 = 25)
    assert.equal(compromiseEventCount, 25);
    assert.equal(leaderboardUpdateCount, 25);
    assert.ok(nodeUpdateCount >= 25);

    arena.stopMatch();
    const finalHof = arena.getHallOfFame();
    assert.ok(finalHof);
    assert.equal(finalHof.winner?.nickname, lb[0].nickname);
    assert.equal(finalHof.totalPlayers, 15);

    arena.destroy();
  });
});
