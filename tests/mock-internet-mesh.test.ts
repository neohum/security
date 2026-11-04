import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockInternetMesh,
  VULNERABLE_CATEGORIES,
  type VulnerableCategory
} from '../server/mock-internet-mesh.ts';

test('MockInternetMesh: generates exactly 200 nodes with 60 vulnerable and 140 hardened', () => {
  const mesh = new MockInternetMesh(12345);
  const allNodes = mesh.getAllNodes();

  assert.equal(allNodes.length, 200, 'Must have exactly 200 nodes');

  // Verify IP ranges 10.10.1.1 ~ 10.10.1.200 and IDs node-001 ~ node-200
  for (let i = 1; i <= 200; i++) {
    const expectedId = `node-${String(i).padStart(3, '0')}`;
    const expectedIp = `10.10.1.${i}`;

    const byId = mesh.getNodeById(expectedId);
    assert.ok(byId, `Node with ID ${expectedId} must exist`);
    assert.equal(byId.id, expectedId);
    assert.equal(byId.ip, expectedIp);

    const byIp = mesh.getNodeByIp(expectedIp);
    assert.ok(byIp, `Node with IP ${expectedIp} must exist`);
    assert.equal(byIp.id, expectedId);
  }

  // Verify exactly 60 vulnerable nodes and 140 hardened nodes
  const vulnerableNodes = mesh.getVulnerableNodes();
  assert.equal(vulnerableNodes.length, 60, 'Must have exactly 60 vulnerable nodes');

  const hardenedNodes = allNodes.filter(n => n.category === 'hardened');
  assert.equal(hardenedNodes.length, 140, 'Must have exactly 140 hardened nodes');

  // Verify exactly 10 nodes for each of the 6 vulnerable categories
  for (const cat of VULNERABLE_CATEGORIES) {
    const nodesInCat = mesh.getVulnerableNodesByCategory(cat);
    assert.equal(
      nodesInCat.length,
      10,
      `Category '${cat}' must have exactly 10 vulnerable nodes`
    );

    for (const node of nodesInCat) {
      assert.equal(node.isVulnerable, true);
      assert.ok(node.flag, `Vulnerable node ${node.id} must have a flag`);
      assert.ok(node.flag.startsWith('FLAG{MESH_'), `Flag format invalid: ${node.flag}`);
      assert.ok(node.openPorts.length > 0, `Node ${node.id} must have open ports`);
    }
  }

  // Hardened nodes must not have flags and must not be vulnerable
  for (const node of hardenedNodes) {
    assert.equal(node.isVulnerable, false);
    assert.equal(node.flag, undefined);
    assert.equal(node.vulnerabilityType, undefined);
  }
});

test('MockInternetMesh: Determinism with seed vs randomized distribution', () => {
  const meshA = new MockInternetMesh(9999);
  const meshB = new MockInternetMesh(9999);

  const nodesA = meshA.getAllNodes();
  const nodesB = meshB.getAllNodes();

  for (let i = 0; i < 200; i++) {
    assert.equal(nodesA[i].id, nodesB[i].id);
    assert.equal(nodesA[i].ip, nodesB[i].ip);
    assert.equal(nodesA[i].category, nodesB[i].category);
    assert.equal(nodesA[i].flag, nodesB[i].flag);
  }

  // Different seeds should produce different category distributions
  const meshC = new MockInternetMesh(1111);
  const nodesC = meshC.getAllNodes();
  let differences = 0;
  for (let i = 0; i < 200; i++) {
    if (nodesA[i].category !== nodesC[i].category) {
      differences++;
    }
  }
  assert.ok(differences > 0, 'Different seeds must produce different distributions');

  // Unseeded resetMesh produces valid mesh
  const meshRandom = new MockInternetMesh();
  assert.equal(meshRandom.getAllNodes().length, 200);
  assert.equal(meshRandom.getVulnerableNodes().length, 60);
});

test('MockInternetMesh: queryWhois for vulnerable and hardened nodes', () => {
  const mesh = new MockInternetMesh(42);
  const whoisNodes = mesh.getVulnerableNodesByCategory('whois');
  assert.ok(whoisNodes.length >= 10);
  const vulnWhois = whoisNodes[0];

  // 1. Query vulnerable whois by IP
  const resIp = mesh.queryWhois(vulnWhois.ip);
  assert.equal(resIp.success, true);
  assert.equal(resIp.leaked, true);
  assert.equal(resIp.flag, vulnWhois.flag);
  assert.match(resIp.output, /admin@mega-infra\.net/);
  assert.match(resIp.output, /10\.10\.1\.0\/24/);

  // 2. Query vulnerable whois by hostname
  const resHost = mesh.queryWhois(vulnWhois.hostname);
  assert.equal(resHost.success, true);
  assert.equal(resHost.leaked, true);
  assert.equal(resHost.flag, vulnWhois.flag);

  // 3. Query hardened node
  const hardenedNode = mesh.getAllNodes().find(n => n.category === 'hardened')!;
  const resHardened = mesh.queryWhois(hardenedNode.ip);
  assert.equal(resHardened.success, true);
  assert.equal(resHardened.leaked, false);
  assert.equal(resHardened.flag, undefined);
  assert.match(resHardened.output, /REDACTED_FOR_PRIVACY/);

  // 4. Query non-existent IP
  const resMissing = mesh.queryWhois('192.168.99.99');
  assert.equal(resMissing.success, false);
  assert.equal(resMissing.leaked, false);
  assert.match(resMissing.output, /No whois record found/);
});

test('MockInternetMesh: queryDnsAxfr for vulnerable and hardened nodes', () => {
  const mesh = new MockInternetMesh(42);
  const dnsNodes = mesh.getVulnerableNodesByCategory('dns-axfr');
  assert.ok(dnsNodes.length >= 10);
  const vulnDns = dnsNodes[0];

  // 1. Vulnerable AXFR transfer
  const resVuln = mesh.queryDnsAxfr(vulnDns.ip, 'mega-infra.net');
  assert.equal(resVuln.success, true);
  assert.equal(resVuln.leaked, true);
  assert.equal(resVuln.flag, vulnDns.flag);
  assert.match(resVuln.output, /admin-vault\.mega-infra\.net/);
  assert.match(resVuln.output, /secret-gateway\.mega-infra\.net/);
  assert.match(resVuln.output, /flag-bearer\.mega-infra\.net/);

  // 2. Hardened node refusal
  const hardenedNode = mesh.getAllNodes().find(n => n.category === 'hardened')!;
  const resHardened = mesh.queryDnsAxfr(hardenedNode.ip, 'mega-infra.net');
  assert.equal(resHardened.success, false);
  assert.equal(resHardened.leaked, false);
  assert.match(resHardened.output, /Refused: AXFR not allowed by ACL/);

  // 3. Unreachable host
  const resMissing = mesh.queryDnsAxfr('10.10.99.1', 'mega-infra.net');
  assert.equal(resMissing.success, false);
  assert.match(resMissing.output, /connection timed out/);
});

test('MockInternetMesh: scanPort on various node types', () => {
  const mesh = new MockInternetMesh(42);

  // Web banner node
  const webNodes = mesh.getVulnerableNodesByCategory('web-banner');
  const webNode = webNodes[0];
  const scanWeb80 = mesh.scanPort(webNode.ip, 80);
  assert.equal(scanWeb80.open, true);
  assert.equal(scanWeb80.vulnerable, true);
  assert.match(scanWeb80.banner || '', /Apache\/2\.2\.8/);

  // Closed port on web node
  const scanWebClosed = mesh.scanPort(webNode.ip, 3306);
  assert.equal(scanWebClosed.open, false);
  assert.equal(scanWebClosed.vulnerable, false);

  // Legacy service node
  const legacyNode = mesh.getVulnerableNodesByCategory('legacy-service')[0];
  const scanFtp21 = mesh.scanPort(legacyNode.ip, 21);
  assert.equal(scanFtp21.open, true);
  assert.equal(scanFtp21.vulnerable, true);
  assert.match(scanFtp21.banner || '', /vsftpd 2\.3\.4/);

  // Hardened node port 22
  const hardenedNode = mesh.getAllNodes().find(n => n.category === 'hardened')!;
  const scanHardened22 = mesh.scanPort(hardenedNode.ip, 22);
  assert.equal(scanHardened22.open, true);
  assert.equal(scanHardened22.vulnerable, false);
  assert.match(scanHardened22.banner || '', /OpenSSH/);

  // Unknown host
  const scanMissing = mesh.scanPort('10.10.99.99', 80);
  assert.equal(scanMissing.open, false);
  assert.equal(scanMissing.vulnerable, false);
});

test('MockInternetMesh: scanSubnet CIDR range detection', () => {
  const mesh = new MockInternetMesh(42);

  // 1. Scan entire /24 subnet containing all 200 nodes (10.10.1.1 ~ 10.10.1.200)
  const fullSubnet = mesh.scanSubnet('10.10.1.0/24');
  assert.equal(fullSubnet.total, 200);
  assert.equal(fullSubnet.hostsUp.length, 200);
  assert.ok(fullSubnet.hostsUp.includes('10.10.1.1'));
  assert.ok(fullSubnet.hostsUp.includes('10.10.1.200'));

  // 2. Scan smaller /28 subnet (16 IPs: 10.10.1.0 to 10.10.1.15)
  // Inside 10.10.1.0/28, nodes 10.10.1.1 through 10.10.1.15 exist (15 nodes total)
  const smallSubnet = mesh.scanSubnet('10.10.1.0/28');
  assert.equal(smallSubnet.total, 15);
  assert.ok(smallSubnet.hostsUp.includes('10.10.1.1'));
  assert.ok(smallSubnet.hostsUp.includes('10.10.1.15'));
  assert.ok(!smallSubnet.hostsUp.includes('10.10.1.16'));

  // 3. Scan a single host /32
  const singleHost = mesh.scanSubnet('10.10.1.50/32');
  assert.equal(singleHost.total, 1);
  assert.deepEqual(singleHost.hostsUp, ['10.10.1.50']);

  // 4. Invalid CIDR format
  const invalidCidr = mesh.scanSubnet('invalid-cidr');
  assert.equal(invalidCidr.total, 0);
  assert.deepEqual(invalidCidr.hostsUp, []);
});

test('MockInternetMesh: attemptMssqlLogin authentication', () => {
  const mesh = new MockInternetMesh(42);
  const mssqlNodes = mesh.getVulnerableNodesByCategory('mssql');
  const targetNode = mssqlNodes[0];

  // 1. Successful login with default sa credentials
  const successLogin = mesh.attemptMssqlLogin(targetNode.ip, 'sa', 'Password123!');
  assert.equal(successLogin.success, true);
  assert.equal(successLogin.flag, targetNode.flag);
  assert.match(successLogin.output, /xp_cmdshell is ENABLED/);

  // 2. Failed login with wrong password
  const failedPass = mesh.attemptMssqlLogin(targetNode.ip, 'sa', 'WrongPassword');
  assert.equal(failedPass.success, false);
  assert.equal(failedPass.flag, undefined);
  assert.match(failedPass.output, /Login failed for user/);

  // 3. Login attempt against hardened node
  const hardenedNode = mesh.getAllNodes().find(n => n.category === 'hardened')!;
  const hardenedAttempt = mesh.attemptMssqlLogin(hardenedNode.ip, 'sa', 'Password123!');
  assert.equal(hardenedAttempt.success, false);
  assert.match(hardenedAttempt.output, /Connection failed or login denied/);

  // 4. Non-existent host
  const missingHost = mesh.attemptMssqlLogin('10.10.99.1', 'sa', 'Password123!');
  assert.equal(missingHost.success, false);
  assert.match(missingHost.output, /unreachable/);
});

test('MockInternetMesh: accessS3Bucket authorization', () => {
  const mesh = new MockInternetMesh(42);
  const s3Nodes = mesh.getVulnerableNodesByCategory('s3-bucket');
  const targetNode = s3Nodes[0];

  // 1. Successful bucket access for config.env
  const successAccess = mesh.accessS3Bucket(targetNode.ip, 'config.env');
  assert.equal(successAccess.success, true);
  assert.equal(successAccess.flag, targetNode.flag);
  assert.match(successAccess.output, /MinIO\/S3 Bucket 'config\.env' is publicly accessible/);
  assert.match(successAccess.output, /AWS_ACCESS_KEY_ID/);

  // 2. Access to non-existent bucket
  const missingBucket = mesh.accessS3Bucket(targetNode.ip, 'secret-vault-private');
  assert.equal(missingBucket.success, false);
  assert.equal(missingBucket.flag, undefined);
  assert.match(missingBucket.output, /NoSuchBucket/);

  // 3. Access to S3 on hardened node
  const hardenedNode = mesh.getAllNodes().find(n => n.category === 'hardened')!;
  const hardenedAccess = mesh.accessS3Bucket(hardenedNode.ip, 'config.env');
  assert.equal(hardenedAccess.success, false);
  assert.match(hardenedAccess.output, /403 Forbidden or Connection Refused/);

  // 4. Non-existent host
  const unreachableHost = mesh.accessS3Bucket('10.10.99.1', 'config.env');
  assert.equal(unreachableHost.success, false);
  assert.match(unreachableHost.output, /unreachable/);
});

test('MockInternetMesh: markCompromised and isCompromised tracking', () => {
  const mesh = new MockInternetMesh(42);
  const vulnerableNode = mesh.getVulnerableNodes()[0];

  assert.equal(mesh.isCompromised(vulnerableNode.id), false);
  assert.equal(mesh.isCompromised(vulnerableNode.ip), false);

  const marked = mesh.markCompromised(vulnerableNode.id, 'Alice');
  assert.equal(marked, true);
  assert.equal(mesh.isCompromised(vulnerableNode.id), true);
  assert.equal(mesh.isCompromised(vulnerableNode.ip), true);

  const node = mesh.getNodeById(vulnerableNode.id);
  assert.deepEqual(node?.compromisedBy, ['Alice']);

  // Additional participant
  mesh.markCompromised(vulnerableNode.ip, 'Bob');
  assert.deepEqual(node?.compromisedBy, ['Alice', 'Bob']);

  // Cannot mark hardened node
  const hardened = mesh.getAllNodes().find(n => n.category === 'hardened')!;
  const hardenedMark = mesh.markCompromised(hardened.id, 'Alice');
  assert.equal(hardenedMark, false);
  assert.equal(mesh.isCompromised(hardened.id), false);
});
