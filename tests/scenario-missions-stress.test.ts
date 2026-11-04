import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCommand, evaluateFlag, evaluateSubmission, loadMissions, getMissionById } from '../server/mission-evaluator.ts';
import { ScenarioState, INITIAL_QUESTS } from '../server/scenario-state.ts';
import { GatewayApp } from '../server/index.ts';
import { evaluateTerminalOutput, evaluateSubmittedFlag, CH3_MISSIONS } from '../client/src/components/AttackerDashboard.ts';

test('1. Scenario Missions Stress: Quest 1 (Whois Recon)', async (t) => {
  const whoisMissionId = 'recon-whois-01';
  const validFlag = 'FLAG{whois_megacorp_admin_discovered}';

  await t.test('Case-insensitivity and extra whitespace on evaluateFlag', () => {
    assert.equal(evaluateFlag('   FLAG{whois_megacorp_admin_discovered}   ').matched, true);
    assert.equal(evaluateFlag('flag{whois_megacorp_admin_discovered}').matched, true);
    assert.equal(evaluateFlag('FLAG{WHOIS_MEGACORP_ADMIN_DISCOVERED}').matched, true);
    assert.equal(evaluateFlag('\n\tFLAG{whois_megacorp_admin_discovered}\r\n').matched, true);
  });

  await t.test('Targeted submission with flag', () => {
    assert.equal(evaluateSubmission(whoisMissionId, '  FLAG{whois_megacorp_admin_discovered}  ').matched, true);
    assert.equal(evaluateSubmission(whoisMissionId, 'flag{whois_megacorp_admin_discovered}').matched, true);
  });

  await t.test('Various command variations and flags for whois', () => {
    const variations = [
      'whois -h 172.28.0.15 megacorp.internal',
      'whois -h 172.28.0.15:43 megacorp.internal',
      'WHOIS -H 172.28.0.15 MEGACORP.INTERNAL',
      '  whois   -h   172.28.0.15    megacorp.internal  ',
      'whois megacorp.internal',
      'whois -v -h 172.28.0.15 megacorp.internal',
      'whois -p 43 -h 172.28.0.15 megacorp.internal',
    ];
    for (const cmd of variations) {
      const results = evaluateCommand(cmd);
      const match = results.find(r => r.mission?.id === whoisMissionId);
      assert.ok(match, `Command failed to match Whois quest: ${cmd}`);
      assert.equal(match.matched, true);
    }
  });

  await t.test('Stdout variations for whois', () => {
    const outputs = [
      'Admin Email: admin@megacorp.internal',
      'admin@megacorp.internal',
      'OrgName: MegaCorp Global',
      'OrgName:   MegaCorp',
      'Tech Email: security-admin@megacorp.internal\nDomain: megacorp.internal',
    ];
    for (const stdout of outputs) {
      const results = evaluateCommand('dummy_cmd', stdout);
      const match = results.find(r => r.mission?.id === whoisMissionId);
      assert.ok(match, `Stdout failed to match Whois quest: ${stdout}`);
      assert.equal(match.matched, true);
    }
  });
});

test('2. Scenario Missions Stress: Quest 2 (DNS AXFR Zone Transfer)', async (t) => {
  const axfrMissionId = 'recon-dns-axfr-03';
  const validFlag = 'FLAG{axfr_zone_transfer_subdomains_leaked}';

  await t.test('Case-insensitivity and extra whitespace on evaluateFlag', () => {
    assert.equal(evaluateFlag('   FLAG{axfr_zone_transfer_subdomains_leaked}  ').matched, true);
    assert.equal(evaluateFlag('flag{axfr_zone_transfer_subdomains_leaked}').matched, true);
    assert.equal(evaluateFlag('FLAG{AXFR_ZONE_TRANSFER_SUBDOMAINS_LEAKED}').matched, true);
  });

  await t.test('Various dig and host command variations for AXFR', () => {
    const variations = [
      'dig axfr @172.28.0.15 megacorp.internal',
      'DIG AXFR @172.28.0.15 MEGACORP.INTERNAL',
      'dig -t axfr @172.28.0.15 megacorp.internal',
      'dig   axfr   @172.28.0.15   megacorp.internal',
      'dig @172.28.0.15 megacorp.internal axfr',
      'dig @172.28.0.15 -t AXFR megacorp.internal',
      'host -l megacorp.internal 172.28.0.15',
      'host -t axfr megacorp.internal 172.28.0.15',
      'HOST -L MEGACORP.INTERNAL 172.28.0.15',
      'nslookup -type=any megacorp.internal 172.28.0.15',
      'nslookup -type=axfr megacorp.internal 172.28.0.15',
    ];
    for (const cmd of variations) {
      const results = evaluateCommand(cmd);
      const match = results.find(r => r.mission?.id === axfrMissionId);
      assert.ok(match, `Command failed to match AXFR quest: ${cmd}`);
      assert.equal(match.matched, true);
    }
  });

  await t.test('Stdout leaked subdomain outputs for AXFR', () => {
    const outputs = [
      'db-mssql.megacorp.internal. 3600 IN A 172.28.0.12',
      'backup-s3.megacorp.internal. 3600 IN A 172.28.0.20',
      'gw.megacorp.internal. IN A 172.28.0.1',
      'Zone Transfer Complete! Flag: FLAG{axfr_zone_transferred}',
      'XFR size: 7 records (messages 1, bytes 320)',
    ];
    for (const stdout of outputs) {
      const results = evaluateCommand('dig', stdout);
      const match = results.find(r => r.mission?.id === axfrMissionId);
      assert.ok(match, `Stdout failed to match AXFR quest: ${stdout}`);
      assert.equal(match.matched, true);
    }
  });
});

test('3. Scenario Missions Stress: Quest 3 / Nmap Port Scanning', async (t) => {
  const nmapMissionId = 'scan-nmap-syn-04';
  const msfPortscanId = 'scan-msf-portscan-05';

  await t.test('Nmap command variations (syn, port ranges, db_nmap, uppercase, spacing)', () => {
    const variations = [
      'nmap -sS -Pn 172.28.0.20',
      'nmap -sS -p 21,22,80,139,445 172.28.0.20',
      'nmap -sS -p- 172.28.0.20',
      'NMAP -SS -PN 172.28.0.20',
      'nmap   -sS   172.28.0.20',
      'nmap -sS -sV 172.28.0.20',
      'nmap -Pn -sS -T4 172.28.0.20',
      'nmap 172.28.0.20 -sS',
      'nmap 172.28.0.20 -p 1-1000',
      'nmap -sS 172.28.0.10',
      'db_nmap -sS -sV 172.28.0.20',
      'msfconsole -x "db_nmap -sS 172.28.0.20"',
    ];
    for (const cmd of variations) {
      const results = evaluateCommand(cmd);
      const match = results.find(r => r.mission?.id === nmapMissionId || r.mission?.id === msfPortscanId);
      assert.ok(match, `Command failed to match Nmap quest: ${cmd}`);
      assert.equal(match.matched, true);
    }
  });

  await t.test('Nmap stdout banner & port outputs', () => {
    const outputs = [
      '21/tcp open ftp vsftpd 2.3.4',
      '22/tcp  open  ssh',
      '445/tcp open  netbios-ssn',
      'Nmap scan report for target (172.28.0.10)\nHost is up\nPORT STATE SERVICE\n21/tcp open ftp',
      'FLAG{syn_scan_detected}',
      'FLAG{nmap_syn_stealth_scan_completed}',
    ];
    for (const stdout of outputs) {
      const results = evaluateCommand('nmap', stdout);
      const match = results.find(r => r.mission?.id === nmapMissionId || r.mission?.id === msfPortscanId);
      assert.ok(match, `Stdout failed to match Nmap quest: ${stdout}`);
      assert.equal(match.matched, true);
    }
  });
});

test('4. ScenarioState and Client AttackerDashboard Stress Testing', async (t) => {
  await t.test('ScenarioState: submitFlag case & spacing tolerance', () => {
    const scenario = new ScenarioState();
    // Quest 1
    const res1 = scenario.submitFlag('  flag{whois_recon_success}  ');
    assert.equal(res1.success, true);
    assert.equal(res1.quest?.id, 'quest-whois');

    // Quest 2
    const res2 = scenario.submitFlag('FLAG{AXFR_ZONE_TRANSFERRED}');
    assert.equal(res2.success, true);
    assert.equal(res2.quest?.id, 'quest-axfr');

    // Cross-check: submit alternative ch3-missions flag
    const res3 = scenario.submitFlag('FLAG{s3_bucket_leaked_creds}');
    assert.equal(res3.success, true);
  });

  await t.test('Client AttackerDashboard: evaluateTerminalOutput for Whois, AXFR, Nmap', () => {
    // Whois
    const wRes = evaluateTerminalOutput('WHOIS -H 172.28.0.15 MEGACORP.INTERNAL', '');
    assert.equal(wRes.matched, true);
    assert.equal(wRes.mission?.id, 'm1-whois');

    // AXFR
    const aRes = evaluateTerminalOutput('dig   axfr   @172.28.0.15   megacorp.internal', '');
    assert.equal(aRes.matched, true);
    assert.equal(aRes.mission?.id, 'm2-dns-axfr');

    // Nmap / db_nmap
    const nRes = evaluateTerminalOutput('db_nmap -sS 172.28.0.20', '');
    assert.equal(nRes.matched, true);
    assert.equal(nRes.mission?.id, 'm3-db-nmap');
  });

  await t.test('Client AttackerDashboard: evaluateSubmittedFlag case and whitespace', () => {
    const fRes = evaluateSubmittedFlag('  flag{whois_recon_success}  ');
    assert.equal(fRes.success, true);

    const fRes2 = evaluateSubmittedFlag('flag{zone_transfer_exposed}');
    assert.equal(fRes2.success, true);

    const fRes3 = evaluateSubmittedFlag('FLAG{msf_db_nmap_recorded}');
    assert.equal(fRes3.success, true);
  });
});

test('5. HTTP API Gateway: /api/missions/evaluate and /api/scenario/flag Stress', async (t) => {
  const app = new GatewayApp({ port: 0 });
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const port = (app.server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await t.test('POST /api/missions/evaluate with varied command formats', async () => {
      // 1. Whois with extra space and flags
      const res1 = await fetch(`${baseUrl}/api/missions/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: '   whois   -h   172.28.0.15    megacorp.internal   ' }),
      });
      assert.equal(res1.status, 200);
      const data1: any = await res1.json();
      assert.ok(Array.isArray(data1));
      assert.ok(data1.some((m: any) => m.mission?.id === 'recon-whois-01'));

      // 2. DNS AXFR with dig
      const res2 = await fetch(`${baseUrl}/api/missions/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'DIG AXFR @172.28.0.15 MEGACORP.INTERNAL' }),
      });
      assert.equal(res2.status, 200);
      const data2: any = await res2.json();
      assert.ok(Array.isArray(data2));
      assert.ok(data2.some((m: any) => m.mission?.id === 'recon-dns-axfr-03'));

      // 3. db_nmap
      const res3 = await fetch(`${baseUrl}/api/missions/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'db_nmap -sS -sV 172.28.0.20' }),
      });
      assert.equal(res3.status, 200);
      const data3: any = await res3.json();
      assert.ok(Array.isArray(data3));
      assert.ok(data3.some((m: any) => m.mission?.id === 'scan-nmap-syn-04' || m.mission?.id === 'scan-msf-portscan-05'));
    });

    await t.test('POST /api/missions/evaluate with targeted missionId and whitespace flag', async () => {
      const res = await fetch(`${baseUrl}/api/missions/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: 'recon-whois-01',
          flag: '   flag{whois_megacorp_admin_discovered}  ',
        }),
      });
      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.matched, true);
      assert.equal(data.matchedBy, 'flag');
      assert.equal(data.mission?.id, 'recon-whois-01');
    });

    await t.test('POST /api/scenario/flag with case-insensitive and spaced flag', async () => {
      const res = await fetch(`${baseUrl}/api/scenario/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flag: '   flag{whois_recon_success}   ',
          role: 'attacker',
        }),
      });
      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.quest?.id, 'quest-whois');
      assert.equal(data.pointsAwarded, 100);
    });
  } finally {
    app.server.close();
  }
});
