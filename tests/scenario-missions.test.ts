import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadMissions,
  getAllMissions,
  getMissionById,
  getMissionsByCategory,
  evaluateFlag,
  evaluateCommand,
  evaluateSubmission,
  generateDefenderAlert
} from '../server/mission-evaluator.ts';

test('Scenario Missions: JSON schema and required fields', () => {
  const missionsPath = path.resolve(process.cwd(), 'scenarios/ch3-missions.json');
  assert.ok(fs.existsSync(missionsPath), 'scenarios/ch3-missions.json must exist');

  const raw = fs.readFileSync(missionsPath, 'utf-8');
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed.missions), 'missions array must exist');
  assert.ok(parsed.missions.length >= 10, 'must have at least 10 textbook missions');

  const requiredFields = [
    'id',
    'category',
    'order',
    'title',
    'description',
    'target',
    'hint',
    'flag',
    'validationPattern',
    'defenderExplanation',
    'defenderPatch'
  ];

  for (const mission of parsed.missions) {
    for (const field of requiredFields) {
      assert.ok(
        mission[field] !== undefined && mission[field] !== null && String(mission[field]).length > 0,
        `Mission ${mission.id} missing required field '${field}'`
      );
    }
  }
});

test('Scenario Missions: Coverage of Metasploit Ch. 3 categories', () => {
  const missions = loadMissions();

  // 1. Passive Recon: Whois, Netcraft, DNS AXFR
  const whois = missions.find(m => m.id === 'recon-whois-01');
  const netcraft = missions.find(m => m.id === 'recon-netcraft-02');
  const dnsAxfr = missions.find(m => m.id === 'recon-dns-axfr-03');
  assert.ok(whois, 'Passive recon Whois quest must exist');
  assert.ok(netcraft, 'Passive recon Netcraft quest must exist');
  assert.ok(dnsAxfr, 'Passive recon DNS AXFR quest must exist');

  // 2. Active Scanning: Nmap SYN, MSF portscan
  const nmap = missions.find(m => m.id === 'scan-nmap-syn-04');
  const msfPortscan = missions.find(m => m.id === 'scan-msf-portscan-05');
  assert.ok(nmap, 'Active scan Nmap quest must exist');
  assert.ok(msfPortscan, 'Active scan MSF portscan quest must exist');

  // 3. Target Services: SMB, MSSQL, S3, SSH, FTP, SNMP
  const smb = missions.find(m => m.id === 'service-smb-version-06');
  const mssql = missions.find(m => m.id === 'service-mssql-ping-07');
  const s3 = missions.find(m => m.id === 'service-s3-bucket-08');
  const ssh = missions.find(m => m.id === 'service-ssh-version-09');
  const ftp = missions.find(m => m.id === 'service-ftp-version-10');
  const snmp = missions.find(m => m.id === 'service-snmp-enum-11');
  assert.ok(smb, 'SMB version quest must exist');
  assert.ok(mssql, 'MSSQL ping quest must exist');
  assert.ok(s3, 'S3 open bucket quest must exist');
  assert.ok(ssh, 'SSH version quest must exist');
  assert.ok(ftp, 'FTP version quest must exist');
  assert.ok(snmp, 'SNMP enum quest must exist');

  // 4. Custom Scanner: Ruby MSF Scanner
  const customRuby = missions.find(m => m.id === 'custom-scanner-ruby-12');
  assert.ok(customRuby, 'Custom Ruby scanner quest must exist');
});

test('Scenario Missions: Custom Ruby scanner template validation', () => {
  const templatePath = path.resolve(process.cwd(), 'scenarios/custom-scanner-template.rb');
  assert.ok(fs.existsSync(templatePath), 'custom-scanner-template.rb must exist');

  const content = fs.readFileSync(templatePath, 'utf-8');
  assert.match(content, /require\s+['"]msf\/core['"]/);
  assert.match(content, /Msf::Auxiliary::Scanner/);
  assert.match(content, /Msf::Exploit::Remote::Tcp/);
  assert.match(content, /def\s+run_host\s*\(\s*ip\s*\)/);
  assert.match(content, /report_service/);
  assert.match(content, /print_good/);
});

test('Mission Evaluator: Helper lookups and filtering', () => {
  const all = getAllMissions();
  assert.equal(all.length, 12);

  const smb = getMissionById('service-smb-version-06');
  assert.ok(smb);
  assert.equal(smb?.title, 'SMB 서비스 버전 및 OS 탐지 (auxiliary/scanner/smb/smb_version)');

  const targetServices = getMissionsByCategory('target-services');
  assert.equal(targetServices.length, 6);
});

test('Mission Evaluator: evaluateFlag', () => {
  const valid = evaluateFlag('FLAG{whois_megacorp_admin_discovered}');
  assert.equal(valid.matched, true);
  assert.equal(valid.matchedBy, 'flag');
  assert.equal(valid.mission?.id, 'recon-whois-01');
  assert.ok(valid.defenderAlert);
  assert.equal(valid.defenderAlert?.severity, 'low');
  assert.match(valid.defenderAlert?.explanation ?? '', /공개 Whois/);

  const invalid = evaluateFlag('FLAG{incorrect_dummy_flag}');
  assert.equal(invalid.matched, false);
  assert.equal(invalid.matchedBy, 'none');
  assert.equal(invalid.defenderAlert, undefined);
});

test('Mission Evaluator: evaluateCommand and stdout matching', () => {
  const cmdResults = evaluateCommand('whois -h 172.28.0.15 megacorp.internal');
  assert.ok(cmdResults.length > 0);
  assert.equal(cmdResults[0].mission?.id, 'recon-whois-01');
  assert.equal(cmdResults[0].matchedBy, 'command');

  // Multi-line terminal output matching
  const outputResults = evaluateCommand(
    'msfconsole',
    '[*] 172.28.0.20:445 - Host is running Samba 3.0.20-Debian\n[+] 172.28.0.20:445 - SMB Version Found'
  );
  const smbMatch = outputResults.find(r => r.mission?.id === 'service-smb-version-06');
  assert.ok(smbMatch, 'Must match SMB version from terminal output');
  assert.equal(smbMatch?.matchedBy, 'output');
});

test('Mission Evaluator: evaluateSubmission for specific quest', () => {
  const flagSub = evaluateSubmission(
    'service-mssql-ping-07',
    'FLAG{mssql_instance_ping_confirmed}'
  );
  assert.equal(flagSub.matched, true);
  assert.equal(flagSub.matchedBy, 'flag');

  const patternSub = evaluateSubmission(
    'service-mssql-ping-07',
    'use auxiliary/scanner/mssql/mssql_ping\nset RHOSTS 172.28.0.30\nrun'
  );
  assert.equal(patternSub.matched, true);
  assert.equal(patternSub.matchedBy, 'output');

  const failSub = evaluateSubmission('service-mssql-ping-07', 'ls -la /tmp');
  assert.equal(failSub.matched, false);

  const nonExistent = evaluateSubmission('non-existent-id', 'test');
  assert.equal(nonExistent.matched, false);
});

test('Mission Evaluator: Defender alert formatting and patch commands', () => {
  const mission = getMissionById('service-s3-bucket-08');
  assert.ok(mission);
  const alert = generateDefenderAlert(mission);
  assert.equal(alert.missionId, 'service-s3-bucket-08');
  assert.equal(alert.severity, 'high');
  assert.match(alert.patch, /Block all public access/);
  assert.match(alert.explanation, /클라우드 스토리지 버킷/);
});
