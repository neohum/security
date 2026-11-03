import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import {
  startAllServers,
  stopAllServers,
  encodeDomain,
  decodeDomain,
  buildDnsResponse,
  ZONE_RECORDS,
  WHOIS_DATA
} from '../docker/fake-recon/server.js';

const ROOT_DIR = path.resolve('.');

function makeDnsQuery(name: string, qtype: number, id: number = 0x4321): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // RD=1
  header.writeUInt16BE(1, 4);      // QDCOUNT=1
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);

  const nameBuf = encodeDomain(name);
  const qmeta = Buffer.alloc(4);
  qmeta.writeUInt16BE(qtype, 0);
  qmeta.writeUInt16BE(1, 2); // QCLASS = IN

  return Buffer.concat([header, nameBuf, qmeta]);
}

describe('Step 1: sim-mock-infrastructure', () => {

  describe('Docker Compose Overlay Configuration', () => {
    const composePath = path.join(ROOT_DIR, 'docker-compose.sim.yaml');

    it('docker-compose.sim.yaml exists and is valid UTF-8', () => {
      assert.ok(fs.existsSync(composePath), 'docker-compose.sim.yaml must exist');
      const content = fs.readFileSync(composePath, 'utf8');
      assert.ok(content.length > 0, 'file should not be empty');
    });

    it('overlays lab/lab/compose.yaml and defines vnet 172.28.0.0/16', () => {
      const content = fs.readFileSync(composePath, 'utf8');
      assert.match(content, /include:\s*\n\s*-\s*lab\/lab\/compose\.yaml/, 'Must include lab/lab/compose.yaml');
      assert.match(content, /subnet:\s*172\.28\.0\.0\/16/, 'Subnet must be 172.28.0.0/16');
    });

    it('exposes Windows host ports 0.0.0.0:3000 and 0.0.0.0:2222', () => {
      const content = fs.readFileSync(composePath, 'utf8');
      assert.match(content, /0\.0\.0\.0:3000:3000/, 'Web dashboard port 3000 must be exposed');
      assert.match(content, /0\.0\.0\.0:2222:22/, 'Attacker kalibox SSH port 2222 must be exposed');
    });

    it('defines fake-recon service with IP 172.28.0.15 and required ports', () => {
      const content = fs.readFileSync(composePath, 'utf8');
      assert.match(content, /fake-recon:/, 'fake-recon service must be defined');
      assert.match(content, /ipv4_address:\s*172\.28\.0\.15/, 'fake-recon IP must be 172.28.0.15');
      assert.match(content, /"43:43"/, 'Port 43 (whois) must be exposed');
      assert.match(content, /"53:53\/udp"/, 'Port 53/udp (dns) must be exposed');
      assert.match(content, /"53:53\/tcp"/, 'Port 53/tcp (dns axfr) must be exposed');
      assert.match(content, /"8080:8080"/, 'Port 8080 (netcraft) must be exposed');
    });

    it('defines fake-s3 MinIO service with IP 172.28.0.25 and ports 9000, 9001', () => {
      const content = fs.readFileSync(composePath, 'utf8');
      assert.match(content, /fake-s3:/, 'fake-s3 service must be defined');
      assert.match(content, /ipv4_address:\s*172\.28\.0\.25/, 'fake-s3 IP must be 172.28.0.25');
      assert.match(content, /"9000:9000"/, 'Port 9000 (MinIO API) must be exposed');
      assert.match(content, /"9001:9001"/, 'Port 9001 (MinIO Console) must be exposed');
      assert.match(content, /fake-s3-init:/, 'fake-s3-init seeder must be defined');
    });
  });

  describe('DNS Zone & BIND Configuration (named.conf)', () => {
    const namedConfPath = path.join(ROOT_DIR, 'docker', 'fake-recon', 'named.conf');
    const zoneFilePath = path.join(ROOT_DIR, 'docker', 'fake-recon', 'megacorp.internal.zone');

    it('named.conf configures unrestricted AXFR zone transfer for megacorp.internal', () => {
      assert.ok(fs.existsSync(namedConfPath), 'named.conf must exist');
      const content = fs.readFileSync(namedConfPath, 'utf8');
      assert.match(content, /zone\s*"megacorp\.internal"/, 'Must define zone megacorp.internal');
      assert.match(content, /allow-transfer\s*\{\s*any;\s*\};/, 'Must allow unrestricted zone transfer');
    });

    it('zone file exposes internal infrastructure hosts for intelligence gathering', () => {
      assert.ok(fs.existsSync(zoneFilePath), 'megacorp.internal.zone must exist');
      const content = fs.readFileSync(zoneFilePath, 'utf8');
      assert.match(content, /db-mssql\s+IN\s+A\s+172\.28\.0\.30/, 'db-mssql must point to 172.28.0.30');
      assert.match(content, /backup-s3\s+IN\s+A\s+172\.28\.0\.25/, 'backup-s3 must point to 172.28.0.25');
      assert.match(content, /target-linux\s+IN\s+A\s+172\.28\.0\.20/, 'target-linux must point to 172.28.0.20');
      assert.match(content, /ns1\s+IN\s+A\s+172\.28\.0\.15/, 'ns1 must point to 172.28.0.15');
    });
  });

  describe('Mock S3 Public Bucket Seeding Files', () => {
    const initScriptPath = path.join(ROOT_DIR, 'docker', 'fake-s3', 'init-buckets.sh');
    const configEnvPath = path.join(ROOT_DIR, 'docker', 'fake-s3', 'config.env');
    const passwordsPath = path.join(ROOT_DIR, 'docker', 'fake-s3', 'db_passwords.txt');

    it('init-buckets.sh creates megacorp-backup bucket with public download policy', () => {
      assert.ok(fs.existsSync(initScriptPath), 'init-buckets.sh must exist');
      const content = fs.readFileSync(initScriptPath, 'utf8');
      assert.match(content, /mc mb.*megacorp-backup/, 'Must create bucket megacorp-backup');
      assert.match(content, /mc anonymous set download.*megacorp-backup/, 'Must set anonymous download policy');
      assert.match(content, /config\.env/, 'Must copy config.env');
      assert.match(content, /db_passwords\.txt/, 'Must copy db_passwords.txt');
    });

    it('sample confidential files contain realistic target credentials', () => {
      assert.ok(fs.existsSync(configEnvPath), 'config.env must exist');
      assert.ok(fs.existsSync(passwordsPath), 'db_passwords.txt must exist');

      const configEnv = fs.readFileSync(configEnvPath, 'utf8');
      assert.match(configEnv, /DB_HOST=172\.28\.0\.30/, 'config.env must reference MSSQL host');
      assert.match(configEnv, /DB_PASSWORD=password123!/, 'config.env must contain sa password');
      assert.match(configEnv, /AWS_BUCKET=megacorp-backup/, 'config.env must reference backup bucket');

      const passwords = fs.readFileSync(passwordsPath, 'utf8');
      assert.match(passwords, /172\.28\.0\.30/, 'db_passwords.txt must reference MSSQL target');
      assert.match(passwords, /172\.28\.0\.20/, 'db_passwords.txt must reference Metasploitable2 target');
    });
  });

  describe('Live Fake Recon Service Behavior', () => {
    const WHOIS_TEST_PORT = 14043;
    const NETCRAFT_TEST_PORT = 18080;
    const DNS_TEST_PORT = 15353;

    let servers: any;

    before(async () => {
      servers = startAllServers({
        whoisPort: WHOIS_TEST_PORT,
        netcraftPort: NETCRAFT_TEST_PORT,
        dnsPort: DNS_TEST_PORT
      });
      // Allow servers to bind
      await new Promise(resolve => setTimeout(resolve, 200));
    });

    after(async () => {
      if (servers) {
        stopAllServers(servers);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('AC-2: Whois TCP server on port 43 returns corporate registry information', async () => {
      const response = await new Promise<string>((resolve, reject) => {
        const client = net.createConnection({ port: WHOIS_TEST_PORT, host: '127.0.0.1' }, () => {
          client.write('megacorp.internal\r\n');
        });
        let data = '';
        client.on('data', chunk => { data += chunk.toString('utf8'); });
        client.on('end', () => resolve(data));
        client.on('error', reject);
      });

      assert.match(response, /Domain Name:\s*MEGACORP\.INTERNAL/i);
      assert.match(response, /CIDR:\s*172\.28\.0\.0\/16/);
      assert.match(response, /Registrant Organization:\s*MegaCorp Industries Ltd\./);
      assert.match(response, /admin@megacorp\.internal/);
    });

    it('Fake Netcraft HTTP server returns Server header and tech intelligence', async () => {
      const res = await fetch(`http://127.0.0.1:${NETCRAFT_TEST_PORT}/api/recon`);
      assert.equal(res.status, 200);

      const serverHeader = res.headers.get('server');
      assert.match(serverHeader || '', /Netcraft-Mock-Intelligence/);

      const body = await res.json() as any;
      assert.equal(body.domain, 'megacorp.internal');
      assert.equal(body.ip_range, '172.28.0.0/16');
      assert.equal(body.services.database.ip, '172.28.0.30');
      assert.equal(body.services.storage.public_bucket, 'megacorp-backup');
    });

    it('Fake DNS UDP answers standard A record queries', async () => {
      const query = makeDnsQuery('db-mssql.megacorp.internal', 1, 0x1111);

      const response = await new Promise<Buffer>((resolve, reject) => {
        const client = dgram.createSocket('udp4');
        client.on('message', (msg) => {
          client.close();
          resolve(msg);
        });
        client.on('error', (err) => {
          client.close();
          reject(err);
        });
        client.send(query, DNS_TEST_PORT, '127.0.0.1');
      });

      assert.ok(response.length > 12, 'Response must contain DNS header and payload');
      const id = response.readUInt16BE(0);
      assert.equal(id, 0x1111, 'Response transaction ID must match query');
      const flags = response.readUInt16BE(2);
      assert.ok((flags & 0x8000) !== 0, 'QR flag must be set to 1 (response)');
      assert.ok((flags & 0x0400) !== 0, 'AA flag must be set to 1 (Authoritative)');

      const anCount = response.readUInt16BE(6);
      assert.ok(anCount >= 1, 'Should return at least 1 answer record');

      // The returned IP should be 172.28.0.30
      const last4 = response.subarray(response.length - 4);
      assert.deepEqual(Array.from(last4), [172, 28, 0, 30]);
    });

    it('AC-3: Fake DNS TCP AXFR query reproduces Zone Transfer vulnerability', async () => {
      // QTYPE 252 = AXFR
      const axfrQuery = makeDnsQuery('megacorp.internal', 252, 0x9999);

      const response = await new Promise<Buffer>((resolve, reject) => {
        const client = net.createConnection({ port: DNS_TEST_PORT, host: '127.0.0.1' }, () => {
          const lenBuf = Buffer.alloc(2);
          lenBuf.writeUInt16BE(axfrQuery.length, 0);
          client.write(Buffer.concat([lenBuf, axfrQuery]));
        });

        let data = Buffer.alloc(0);
        client.on('data', chunk => {
          data = Buffer.concat([data, chunk]);
          if (data.length >= 2) {
            const expectedLen = data.readUInt16BE(0);
            if (data.length >= 2 + expectedLen) {
              client.end();
            }
          }
        });
        client.on('end', () => {
          if (data.length >= 2) {
            resolve(data.subarray(2)); // Strip TCP length prefix
          } else {
            resolve(Buffer.alloc(0));
          }
        });
        client.on('error', reject);
      });

      assert.ok(response.length > 12, 'AXFR response must be received');
      const id = response.readUInt16BE(0);
      assert.equal(id, 0x9999, 'Transaction ID must match AXFR query');

      const anCount = response.readUInt16BE(6);
      assert.ok(anCount >= 10, `AXFR must return full zone records (found ${anCount})`);

      // Verify that the response payload includes db-mssql and backup-s3 records
      const responseStr = response.toString('ascii');
      assert.ok(responseStr.includes('db-mssql'), 'Zone transfer must expose db-mssql');
      assert.ok(responseStr.includes('backup-s3'), 'Zone transfer must expose backup-s3');
      assert.ok(responseStr.includes('target-mssql'), 'Zone transfer must expose target-mssql');
    });
  });

});
