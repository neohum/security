import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockInternetMesh,
  VULNERABLE_CATEGORIES,
  SIX_CATEGORIES,
  CATEGORY_POINTS,
  type VulnerableCategory,
  type VirtualServerNode,
} from '../server/mock-internet-mesh.ts';

test('Mesh Robustness: 200 Virtual Nodes Deterministic and Random Seed Generation', () => {
  // 1. Seeded determinism: identical seeds generate exact same mesh state
  const meshA = new MockInternetMesh(7777);
  const meshB = new MockInternetMesh(7777);

  const nodesA = meshA.getAllNodes();
  const nodesB = meshB.getAllNodes();

  assert.equal(nodesA.length, 200, 'Seeded mesh A must have 200 nodes');
  assert.equal(nodesB.length, 200, 'Seeded mesh B must have 200 nodes');

  for (let i = 0; i < 200; i++) {
    assert.equal(nodesA[i].id, nodesB[i].id);
    assert.equal(nodesA[i].ip, nodesB[i].ip);
    assert.equal(nodesA[i].hostname, nodesB[i].hostname);
    assert.equal(nodesA[i].category, nodesB[i].category);
    assert.equal(nodesA[i].isVulnerable, nodesB[i].isVulnerable);
    assert.equal(nodesA[i].flag, nodesB[i].flag);
    assert.deepEqual(nodesA[i].openPorts, nodesB[i].openPorts);
  }

  // 2. Different seeds produce distinct category distributions
  const meshC = new MockInternetMesh(8888);
  const nodesC = meshC.getAllNodes();
  let categoryMismatches = 0;
  for (let i = 0; i < 200; i++) {
    if (nodesA[i].category !== nodesC[i].category) {
      categoryMismatches++;
    }
  }
  assert.ok(
    categoryMismatches > 0,
    `Different seeds (7777 vs 8888) must produce distinct distributions (diff count: ${categoryMismatches})`
  );

  // 3. Unseeded instantiation generates valid 200 nodes
  const meshRandom = new MockInternetMesh();
  const randomNodes = meshRandom.getAllNodes();
  assert.equal(randomNodes.length, 200, 'Unseeded mesh must generate exactly 200 nodes');
  assert.equal(meshRandom.getVulnerableNodes().length, 60, 'Unseeded mesh must have 60 vulnerable nodes');
  assert.equal(meshRandom.getHardenedNodes().length, 140, 'Unseeded mesh must have 140 hardened nodes');

  // Verify full IP range 10.10.1.1 to 10.10.1.200 exists
  for (let i = 1; i <= 200; i++) {
    const ip = `10.10.1.${i}`;
    const id = `node-${String(i).padStart(3, '0')}`;
    const node = meshRandom.getNodeByIp(ip);
    assert.ok(node, `Node ${ip} must exist in unseeded mesh`);
    assert.equal(node.id, id);
    assert.equal(node.index, i);
  }

  // 4. resetMesh() reinitialization
  meshA.resetMesh(9999);
  const nodesReset = meshA.getAllNodes();
  assert.equal(nodesReset.length, 200);
});

test('Mesh Robustness: Strict 6-Category Allocation (10 nodes each = 60 vulnerable, 140 hardened)', () => {
  const mesh = new MockInternetMesh(55555);
  const allNodes = mesh.getAllNodes();

  assert.equal(allNodes.length, 200, 'Total node count must be 200');

  const vulnerableNodes = mesh.getVulnerableNodes();
  const hardenedNodes = mesh.getHardenedNodes();

  assert.equal(vulnerableNodes.length, 60, 'Vulnerable node count must be exactly 60');
  assert.equal(hardenedNodes.length, 140, 'Hardened node count must be exactly 140');

  // Test the 6 target categories: whois, dns-axfr, web-banner, mssql, s3-bucket, legacy-rce
  const testCategories: Array<VulnerableCategory | string> = [
    'whois',
    'dns-axfr',
    'web-banner',
    'mssql',
    's3-bucket',
    'legacy-rce',
  ];

  for (const cat of testCategories) {
    const nodes = mesh.getVulnerableNodesByCategory(cat);
    assert.equal(
      nodes.length,
      10,
      `Category '${cat}' must have exactly 10 vulnerable servers assigned`
    );

    for (const node of nodes) {
      assert.equal(node.isVulnerable, true, `Node ${node.id} must be marked vulnerable`);
      assert.ok(node.flag, `Node ${node.id} must have a secret flag`);
      assert.ok(node.flag.startsWith('FLAG{MESH_'), `Flag format mismatch: ${node.flag}`);
      assert.ok(node.openPorts.length > 0, `Node ${node.id} must have open ports`);
      assert.equal(
        node.points,
        CATEGORY_POINTS[cat as VulnerableCategory],
        `Node ${node.id} points mismatch for category ${cat}`
      );
    }
  }

  // Verify 'legacy-service' alias also returns the same 10 legacy nodes
  const legacyServiceNodes = mesh.getVulnerableNodesByCategory('legacy-service');
  const legacyRceNodes = mesh.getVulnerableNodesByCategory('legacy-rce');
  assert.equal(legacyServiceNodes.length, 10);
  assert.equal(legacyRceNodes.length, 10);
  assert.deepEqual(
    legacyServiceNodes.map(n => n.id).sort(),
    legacyRceNodes.map(n => n.id).sort(),
    'legacy-service and legacy-rce must reference the exact same 10 servers'
  );
});

test('Mesh Robustness: 140 Hardened Servers Defense Integrity (Zero Leak, Zero State Mutation)', () => {
  const mesh = new MockInternetMesh(1234);
  const hardenedNodes = mesh.getHardenedNodes();

  assert.equal(hardenedNodes.length, 140, 'Must have exactly 140 hardened nodes');

  for (const node of hardenedNodes) {
    // 1. Invariable properties
    assert.equal(node.isVulnerable, false, `Hardened node ${node.id} must NOT be vulnerable`);
    assert.equal(node.category, 'hardened');
    assert.equal(node.points, 0);
    assert.equal(node.flag, undefined, `Hardened node ${node.id} must NOT have any flag assigned`);
    assert.equal(node.vulnerabilityType, undefined);
    assert.deepEqual(node.openPorts, [22], `Hardened node ${node.id} must only expose port 22`);
    assert.equal(node.compromisedBy.length, 0);

    // 2. Whois probe defense: GDPR privacy guard, flag MUST NOT leak
    const whoisRes = mesh.queryWhois(node.ip);
    assert.equal(whoisRes.leaked, false, `Hardened node ${node.ip} whois must NOT leak`);
    assert.equal(whoisRes.flag, undefined);
    assert.match(whoisRes.output, /REDACTED_FOR_PRIVACY/);
    assert.ok(!whoisRes.output.includes('FLAG{'));

    // 3. DNS AXFR probe defense: ACL refused, flag MUST NOT leak
    const axfrRes = mesh.queryDnsAxfr(node.ip, 'mega-infra.net');
    assert.equal(axfrRes.success, false, `Hardened node ${node.ip} AXFR must fail`);
    assert.equal(axfrRes.leaked, false);
    assert.equal(axfrRes.flag, undefined);
    assert.match(axfrRes.output, /Refused: AXFR not allowed/);
    assert.ok(!axfrRes.output.includes('FLAG{'));

    // 4. Port scan defense: Only port 22 open with hardened OpenSSH, all other attack ports closed
    const sshScan = mesh.scanPort(node.ip, 22);
    assert.equal(sshScan.open, true);
    assert.equal(sshScan.vulnerable, false);
    assert.match(sshScan.banner || '', /OpenSSH/);
    assert.ok(!sshScan.banner?.includes('FLAG{'));

    for (const attackPort of [21, 43, 53, 80, 1433, 1524, 8080, 9000]) {
      const portScan = mesh.scanPort(node.ip, attackPort);
      assert.equal(portScan.open, false, `Hardened node ${node.ip} port ${attackPort} must be closed`);
      assert.equal(portScan.vulnerable, false);
    }

    // 5. MSSQL brute force defense: Connection failed / denied
    const mssqlRes = mesh.attemptMssqlLogin(node.ip, 'sa', 'Password123!');
    assert.equal(mssqlRes.success, false);
    assert.equal(mssqlRes.flag, undefined);
    assert.match(mssqlRes.output, /Connection failed or login denied/);

    // 6. S3 bucket access defense: 403 Forbidden / Connection Refused
    const s3Res = mesh.accessS3Bucket(node.ip, 'config.env');
    assert.equal(s3Res.success, false);
    assert.equal(s3Res.flag, undefined);
    assert.match(s3Res.output, /403 Forbidden or Connection Refused/);

    // 7. Web banner access defense: 403 Forbidden
    const webRes = mesh.queryWeb(node.ip, 80);
    assert.equal(webRes.success, false);
    assert.equal(webRes.leaked, false);
    assert.equal(webRes.flag, undefined);
    assert.match(webRes.output, /403 Forbidden/);

    // 8. Legacy service exploit defense: Connection refused
    const legacyRes = mesh.exploitLegacy(node.ip, 1524);
    assert.equal(legacyRes.success, false);
    assert.equal(legacyRes.leaked, false);
    assert.equal(legacyRes.flag, undefined);
    assert.match(legacyRes.output, /Connection refused/);

    // 9. State tamper defense: Cannot compromise hardened node
    const markSuccess = mesh.markCompromised(node.ip, 'MaliciousAttacker');
    assert.equal(markSuccess, false, `markCompromised on hardened ${node.ip} must return false`);
    assert.equal(mesh.isCompromised(node.ip), false, `isCompromised on hardened ${node.ip} must be false`);
    assert.equal(node.compromisedBy.length, 0, `compromisedBy list must remain empty`);
  }
});

test('Mesh Robustness: Out-of-Bounds IP Range Boundaries (10.10.1.201, 10.10.2.1, etc.)', () => {
  const mesh = new MockInternetMesh(42);

  const outOfBoundsIps = [
    '10.10.1.0',     // Lower bound network
    '10.10.1.201',   // Immediate upper bound overflow
    '10.10.1.202',   // Upper overflow
    '10.10.1.254',   // Subnet edge
    '10.10.1.255',   // Subnet broadcast
    '10.10.2.1',     // Adjacent /24 subnet
    '10.10.2.50',    // Adjacent subnet
    '192.168.1.1',   // Private C class
    '127.0.0.1',     // Loopback
    '8.8.8.8',       // Public DNS
    'node-000',      // Invalid node ID
    'node-201',      // Out of range ID
    'node-999',      // Out of range ID
  ];

  for (const badTarget of outOfBoundsIps) {
    // 1. Lookups must return undefined
    assert.equal(mesh.getNode(badTarget), undefined, `getNode(${badTarget}) must be undefined`);
    assert.equal(mesh.getNodeByIp(badTarget), undefined, `getNodeByIp(${badTarget}) must be undefined`);
    assert.equal(mesh.getNodeById(badTarget), undefined, `getNodeById(${badTarget}) must be undefined`);

    // 2. Whois query on missing target
    const whois = mesh.queryWhois(badTarget);
    assert.equal(whois.success, false);
    assert.equal(whois.leaked, false);
    assert.equal(whois.flag, undefined);
    assert.match(whois.output, /No whois record found/);

    // 3. DNS AXFR on missing IP
    const axfr = mesh.queryDnsAxfr(badTarget, 'mega-infra.net');
    assert.equal(axfr.success, false);
    assert.equal(axfr.leaked, false);
    assert.equal(axfr.flag, undefined);
    assert.match(axfr.output, /connection timed out/);

    // 4. Port scan on missing IP
    const portScan = mesh.scanPort(badTarget, 80);
    assert.equal(portScan.open, false);
    assert.equal(portScan.vulnerable, false);

    // 5. MSSQL login on missing IP
    const mssql = mesh.attemptMssqlLogin(badTarget, 'sa', 'Password123!');
    assert.equal(mssql.success, false);
    assert.equal(mssql.flag, undefined);
    assert.match(mssql.output, /unreachable/);

    // 6. S3 bucket access on missing IP
    const s3 = mesh.accessS3Bucket(badTarget, 'config.env');
    assert.equal(s3.success, false);
    assert.equal(s3.flag, undefined);
    assert.match(s3.output, /unreachable/);

    // 7. Web probe on missing IP
    const web = mesh.queryWeb(badTarget, 80);
    assert.equal(web.success, false);
    assert.equal(web.leaked, false);
    assert.match(web.output, /Connection refused/);

    // 8. Legacy exploit on missing IP
    const legacy = mesh.exploitLegacy(badTarget, 1524);
    assert.equal(legacy.success, false);
    assert.equal(legacy.leaked, false);
    assert.match(legacy.output, /Connection refused/);

    // 9. Compromise tracking on missing IP
    assert.equal(mesh.markCompromised(badTarget, 'Attacker'), false);
    assert.equal(mesh.isCompromised(badTarget), false);
  }
});

test('Mesh Robustness: Abnormal Requests and Invalid Parameter Edge Cases', () => {
  const mesh = new MockInternetMesh(42);

  // 1. Non-string / null / undefined / empty string handling
  const invalidInputs = [null, undefined, '', '   ', 12345, NaN, {}, []];

  for (const bad of invalidInputs) {
    assert.equal(mesh.getNode(bad as any), undefined);
    assert.equal(mesh.getNodeByIp(bad as any), undefined);
    assert.equal(mesh.getNodeById(bad as any), undefined);

    const whois = mesh.queryWhois(bad as any);
    assert.equal(whois.success, false);
    assert.equal(whois.leaked, false);

    const axfr = mesh.queryDnsAxfr(bad as any);
    assert.equal(axfr.success, false);
    assert.equal(axfr.leaked, false);

    const portScan = mesh.scanPort(bad as any, 80);
    assert.equal(portScan.open, false);

    const mssql = mesh.attemptMssqlLogin(bad as any, 'sa', 'Password123!');
    assert.equal(mssql.success, false);

    const s3 = mesh.accessS3Bucket(bad as any, 'config.env');
    assert.equal(s3.success, false);

    assert.equal(mesh.markCompromised(bad as any, 'player1'), false);
    assert.equal(mesh.isCompromised(bad as any), false);
  }

  // 2. Port boundary edge cases
  const validIp = '10.10.1.1';
  const invalidPorts = [-100, -1, 0, 65536, 70000, 99999, NaN, 3.14, null as any, undefined as any];

  for (const port of invalidPorts) {
    const res = mesh.scanPort(validIp, port);
    assert.equal(res.open, false, `Port ${port} must be closed`);
    assert.equal(res.vulnerable, false);
  }

  // 3. Subnet scanning CIDR boundary validation
  // Entire range scan contains all 200 nodes
  const fullSubnet = mesh.scanSubnet('10.10.1.0/24');
  assert.equal(fullSubnet.total, 200);
  assert.equal(fullSubnet.hostsUp.length, 200);

  // Partial subnet near the boundary: 10.10.1.192/28 spans 10.10.1.192 to 10.10.1.207
  // Mesh only contains up to 10.10.1.200, so exactly 9 nodes (192..200) should be up
  const boundarySubnet = mesh.scanSubnet('10.10.1.192/28');
  assert.equal(boundarySubnet.total, 9);
  assert.ok(boundarySubnet.hostsUp.includes('10.10.1.192'));
  assert.ok(boundarySubnet.hostsUp.includes('10.10.1.200'));
  assert.ok(!boundarySubnet.hostsUp.includes('10.10.1.201'));

  // Invalid CIDR forms
  assert.equal(mesh.scanSubnet('10.10.2.0/24').total, 0); // Out of scope subnet
  assert.equal(mesh.scanSubnet('10.10.1.0/33').total, 0); // Prefix > 32
  assert.equal(mesh.scanSubnet('10.10.1.0/-1').total, 0); // Prefix < 0
  assert.equal(mesh.scanSubnet('not-a-cidr').total, 0);
  assert.equal(mesh.scanSubnet('').total, 0);
  assert.equal(mesh.scanSubnet(null as any).total, 0);

  // 4. SQL Injection and abnormal credentials on MSSQL
  const mssqlNode = mesh.getVulnerableNodesByCategory('mssql')[0];
  const sqliAttempt = mesh.attemptMssqlLogin(mssqlNode.ip, "' OR 1=1 --", "' OR '1'='1");
  assert.equal(sqliAttempt.success, false);
  assert.equal(sqliAttempt.flag, undefined);

  // 5. Path traversal / abnormal key on S3 bucket
  const s3Node = mesh.getVulnerableNodesByCategory('s3-bucket')[0];
  const traversalAttempt = mesh.accessS3Bucket(s3Node.ip, '../../../../etc/passwd');
  assert.equal(traversalAttempt.success, false);
  assert.equal(traversalAttempt.flag, undefined);
  assert.match(traversalAttempt.output, /NoSuchBucket/);

  // 6. markCompromised with empty / blank participant
  assert.equal(mesh.markCompromised(mssqlNode.ip, ''), false);
  assert.equal(mesh.markCompromised(mssqlNode.ip, '   '), false);
  assert.equal(mesh.markCompromised(mssqlNode.ip, null as any), false);
});

test('Mesh Robustness: Vulnerable Exploitability Across All 6 Domains', () => {
  const mesh = new MockInternetMesh(999);

  // 1. Whois recon (10 nodes)
  const whoisNodes = mesh.getVulnerableNodesByCategory('whois');
  assert.equal(whoisNodes.length, 10);
  for (const node of whoisNodes) {
    const res = mesh.queryWhois(node.ip);
    assert.equal(res.success, true);
    assert.equal(res.leaked, true);
    assert.equal(res.flag, node.flag);
    assert.match(res.output, /admin@mega-infra\.net/);
  }

  // 2. DNS AXFR zone transfer (10 nodes)
  const dnsNodes = mesh.getVulnerableNodesByCategory('dns-axfr');
  assert.equal(dnsNodes.length, 10);
  for (const node of dnsNodes) {
    const res = mesh.queryDnsAxfr(node.ip, 'mega-infra.net');
    assert.equal(res.success, true);
    assert.equal(res.leaked, true);
    assert.equal(res.flag, node.flag);
    assert.match(res.output, /admin-vault\.mega-infra\.net/);
  }

  // 3. Web banner discovery (10 nodes)
  const webNodes = mesh.getVulnerableNodesByCategory('web-banner');
  assert.equal(webNodes.length, 10);
  for (const node of webNodes) {
    const portRes = mesh.scanPort(node.ip, 80);
    assert.equal(portRes.open, true);
    assert.equal(portRes.vulnerable, true);
    assert.match(portRes.banner || '', /Apache\/2\.2\.8/);

    const webRes = mesh.queryWeb(node.ip, 80);
    assert.equal(webRes.success, true);
    assert.equal(webRes.leaked, true);
    assert.equal(webRes.flag, node.flag);
  }

  // 4. MSSQL sa login (10 nodes)
  const mssqlNodes = mesh.getVulnerableNodesByCategory('mssql');
  assert.equal(mssqlNodes.length, 10);
  for (const node of mssqlNodes) {
    const res = mesh.attemptMssqlLogin(node.ip, 'sa', 'Password123!');
    assert.equal(res.success, true);
    assert.equal(res.flag, node.flag);
    assert.match(res.output, /xp_cmdshell is ENABLED/);
  }

  // 5. S3 config.env leak (10 nodes)
  const s3Nodes = mesh.getVulnerableNodesByCategory('s3-bucket');
  assert.equal(s3Nodes.length, 10);
  for (const node of s3Nodes) {
    const res = mesh.accessS3Bucket(node.ip, 'config.env');
    assert.equal(res.success, true);
    assert.equal(res.flag, node.flag);
    assert.match(res.output, /AWS_ACCESS_KEY_ID/);
  }

  // 6. Legacy RCE backdoor (10 nodes)
  const legacyNodes = mesh.getVulnerableNodesByCategory('legacy-rce');
  assert.equal(legacyNodes.length, 10);
  for (const node of legacyNodes) {
    const ftpRes = mesh.scanPort(node.ip, 21);
    assert.equal(ftpRes.open, true);
    assert.equal(ftpRes.vulnerable, true);
    assert.match(ftpRes.banner || '', /vsftpd 2\.3\.4/);

    const exploitRes = mesh.exploitLegacy(node.ip, 1524);
    assert.equal(exploitRes.success, true);
    assert.equal(exploitRes.leaked, true);
    assert.equal(exploitRes.flag, node.flag);
    assert.match(exploitRes.output, /Ingreslock 1524 Backdoor/);
  }

  // Verify compromise state lifecycle
  const testNode = whoisNodes[0];
  assert.equal(mesh.isCompromised(testNode.id), false);
  assert.equal(mesh.markCompromised(testNode.id, 'WhiteHat_01'), true);
  assert.equal(mesh.isCompromised(testNode.id), true);
  assert.equal(mesh.isCompromised(testNode.ip), true);
});
