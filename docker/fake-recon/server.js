/**
 * Fake Recon Service (Metasploit 2/e Chapter 3 Simulation)
 *
 * Provides:
 * 1. Fake Whois Server (TCP :43) - Corporate registry for megacorp.internal
 * 2. Fake Netcraft Server (HTTP :8080) - Web technology intelligence & server headers
 * 3. Fake DNS Server (UDP/TCP :53) - Answering queries and intentional AXFR Zone Transfer leak
 */

import net from 'node:net';
import http from 'node:http';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';

export const ZONE_NAME = 'megacorp.internal';

export const ZONE_RECORDS = [
  { name: 'megacorp.internal', type: 'A', ip: '172.28.0.15' },
  { name: 'ns1.megacorp.internal', type: 'A', ip: '172.28.0.15' },
  { name: 'whois.megacorp.internal', type: 'A', ip: '172.28.0.15' },
  { name: 'netcraft.megacorp.internal', type: 'A', ip: '172.28.0.15' },
  { name: 'recon.megacorp.internal', type: 'A', ip: '172.28.0.15' },
  { name: 'target-linux.megacorp.internal', type: 'A', ip: '172.28.0.20' },
  { name: 'www.megacorp.internal', type: 'A', ip: '172.28.0.20' },
  { name: 'mail.megacorp.internal', type: 'A', ip: '172.28.0.20' },
  { name: 'ftp.megacorp.internal', type: 'A', ip: '172.28.0.20' },
  { name: 'ssh.megacorp.internal', type: 'A', ip: '172.28.0.20' },
  { name: 'backup-s3.megacorp.internal', type: 'A', ip: '172.28.0.25' },
  { name: 's3.megacorp.internal', type: 'A', ip: '172.28.0.25' },
  { name: 'storage.megacorp.internal', type: 'A', ip: '172.28.0.25' },
  { name: 'backup.megacorp.internal', type: 'A', ip: '172.28.0.25' },
  { name: 'target-mssql.megacorp.internal', type: 'A', ip: '172.28.0.30' },
  { name: 'db-mssql.megacorp.internal', type: 'A', ip: '172.28.0.30' },
  { name: 'db.megacorp.internal', type: 'A', ip: '172.28.0.30' },
  { name: 'mssql.megacorp.internal', type: 'A', ip: '172.28.0.30' },
  { name: 'sql.megacorp.internal', type: 'A', ip: '172.28.0.30' },
  { name: 'gateway.megacorp.internal', type: 'A', ip: '172.28.0.1' },
  { name: 'router.megacorp.internal', type: 'A', ip: '172.28.0.1' },
  { name: 'attacker.megacorp.internal', type: 'A', ip: '172.28.0.10' },
  { name: 'kalibox.megacorp.internal', type: 'A', ip: '172.28.0.10' }
];

export const WHOIS_DATA = `% MegaCorp Whois Server v2.4 (Security Simulation)
% Query: megacorp.internal

Domain Name: MEGACORP.INTERNAL
Registry Domain ID: DOM-MEGA-982341
Registrar: MegaCorp Internal Network Authority
Registrar IANA ID: 9999
Registrar Abuse Contact Email: abuse@megacorp.internal
Registrar Abuse Contact Phone: +82.25551234
Domain Status: clientTransferProhibited
Registry Registrant ID: CR-8723912
Registrant Name: Security Operations Center
Registrant Organization: MegaCorp Industries Ltd.
Registrant Street: 42 Teheran-ro, Gangnam-gu
Registrant City: Seoul
Registrant State/Province: Seoul
Registrant Postal Code: 06234
Registrant Country: KR
Registrant Phone: +82.25551234
Registrant Email: admin@megacorp.internal
Admin Name: Infrastructure Team Leader
Admin Email: sysadmin@megacorp.internal
Tech Name: Network Security Team
Tech Email: netsec@megacorp.internal
Name Server: NS1.MEGACORP.INTERNAL (172.28.0.15)
Name Server: NS2.MEGACORP.INTERNAL (172.28.0.15)
DNSSEC: unsigned

# Network Block / IP Whois Information
NetRange:       172.28.0.0 - 172.28.255.255
CIDR:           172.28.0.0/16
NetName:        MEGACORP-PRIVATE-INFRA
NetHandle:      NET-172-28-0-0-1
Parent:         NET-172-16-0-0-0
NetType:        Direct Assignment
Organization:   MegaCorp Cyber Defense Labs (MCDL)
RegDate:        2021-03-10
Updated:        2024-01-15
Comment:        Metasploit 2/e Chapter 3 Simulation Target Environment
`;

// ==========================================
// DNS Wire-Format Helpers (RFC 1035 / 5936)
// ==========================================

export function encodeDomain(name) {
  const clean = name.replace(/\.$/, '').toLowerCase();
  if (!clean) return Buffer.from([0x00]);
  const parts = clean.split('.');
  const buffers = [];
  for (const part of parts) {
    const len = Buffer.byteLength(part);
    const buf = Buffer.alloc(1 + len);
    buf.writeUInt8(len, 0);
    buf.write(part, 1, 'ascii');
    buffers.push(buf);
  }
  buffers.push(Buffer.from([0x00]));
  return Buffer.concat(buffers);
}

export function decodeDomain(buffer, offset = 0) {
  const labels = [];
  let curr = offset;
  let jumped = false;
  let nextOffset = -1;

  while (curr < buffer.length) {
    const len = buffer.readUInt8(curr);
    if (len === 0) {
      if (!jumped) nextOffset = curr + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) nextOffset = curr + 2;
      jumped = true;
      const ptr = ((len & 0x3f) << 8) | buffer.readUInt8(curr + 1);
      curr = ptr;
      continue;
    }
    curr += 1;
    labels.push(buffer.subarray(curr, curr + len).toString('ascii'));
    curr += len;
  }
  return {
    name: labels.join('.').toLowerCase(),
    nextOffset: nextOffset !== -1 ? nextOffset : curr + 1
  };
}

export function buildARdata(ip) {
  return Buffer.from(ip.split('.').map(Number));
}

export function buildSoaRdata(mname, rname, serial, refresh, retry, expire, minTtl) {
  const mnameBuf = encodeDomain(mname);
  const rnameBuf = encodeDomain(rname);
  const numBuf = Buffer.alloc(20);
  numBuf.writeUInt32BE(serial, 0);
  numBuf.writeUInt32BE(refresh, 4);
  numBuf.writeUInt32BE(retry, 8);
  numBuf.writeUInt32BE(expire, 12);
  numBuf.writeUInt32BE(minTtl, 16);
  return Buffer.concat([mnameBuf, rnameBuf, numBuf]);
}

export function encodeRR(name, type, classVal, ttl, rdata) {
  const nameBuf = encodeDomain(name);
  const metaBuf = Buffer.alloc(10);
  metaBuf.writeUInt16BE(type, 0);
  metaBuf.writeUInt16BE(classVal, 2);
  metaBuf.writeUInt32BE(ttl, 4);
  metaBuf.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([nameBuf, metaBuf, rdata]);
}

export function buildDnsResponse(queryBuf) {
  if (queryBuf.length < 12) return Buffer.alloc(0);

  const id = queryBuf.readUInt16BE(0);
  const queryFlags = queryBuf.readUInt16BE(2);
  const qdCount = queryBuf.readUInt16BE(4);

  if (qdCount === 0) return Buffer.alloc(0);

  const { name: qname, nextOffset } = decodeDomain(queryBuf, 12);
  const qtype = queryBuf.readUInt16BE(nextOffset);
  const qclass = queryBuf.readUInt16BE(nextOffset + 2);
  const questionBuf = queryBuf.subarray(12, nextOffset + 4);

  const isAxfr = qtype === 252; // AXFR
  const isA = qtype === 1;
  const isNs = qtype === 2;
  const isSoa = qtype === 6;
  const isAny = qtype === 255;

  const answers = [];

  const soaRdata = buildSoaRdata('ns1.megacorp.internal', 'admin.megacorp.internal', 2026021401, 3600, 600, 86400, 300);
  const soaRR = encodeRR(ZONE_NAME, 6, 1, 300, soaRdata);
  const nsRR = encodeRR(ZONE_NAME, 2, 1, 300, encodeDomain('ns1.megacorp.internal'));

  if (isAxfr) {
    // AXFR Zone Transfer format:
    // Starts with SOA, then NS, then all zone records, ending with SOA
    answers.push(soaRR);
    answers.push(nsRR);
    for (const rec of ZONE_RECORDS) {
      if (rec.type === 'A') {
        answers.push(encodeRR(rec.name, 1, 1, 300, buildARdata(rec.ip)));
      }
    }
    answers.push(soaRR); // Terminating SOA
  } else if (isSoa) {
    answers.push(soaRR);
  } else if (isNs) {
    answers.push(nsRR);
  } else if (isA || isAny) {
    const matched = ZONE_RECORDS.filter(r => r.name === qname || (qname === '' && r.name === ZONE_NAME));
    for (const rec of matched) {
      answers.push(encodeRR(rec.name, 1, 1, 300, buildARdata(rec.ip)));
    }
    if (isAny) {
      answers.push(soaRR);
      answers.push(nsRR);
    }
  }

  // Response Header:
  // QR = 1, AA = 1 (Authoritative), RD = query RD, RA = 0, RCODE = 0
  const rdFlag = queryFlags & 0x0100;
  const resFlags = 0x8400 | rdFlag;

  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(resFlags, 2);
  header.writeUInt16BE(1, 4); // QDCOUNT = 1
  header.writeUInt16BE(answers.length, 6); // ANCOUNT
  header.writeUInt16BE(0, 8); // NSCOUNT
  header.writeUInt16BE(0, 10); // ARCOUNT

  return Buffer.concat([header, questionBuf, ...answers]);
}

// ==========================================
// 1. Fake Whois Server (TCP)
// ==========================================
export function createWhoisServer() {
  return net.createServer((socket) => {
    let received = '';
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      if (received.includes('\n')) {
        const query = received.trim().toLowerCase();
        console.log(`[fake-whois] Received query: "${query}" from ${socket.remoteAddress}`);
        socket.write(WHOIS_DATA);
        socket.end();
      }
    });
    socket.on('error', (err) => {
      // Ignore client abort
    });
  });
}

// ==========================================
// 2. Fake DNS Servers (UDP & TCP AXFR)
// ==========================================
export function createDnsUdpServer() {
  const socket = dgram.createSocket('udp4');
  socket.on('message', (msg, rinfo) => {
    try {
      const response = buildDnsResponse(msg);
      if (response.length > 0) {
        socket.send(response, rinfo.port, rinfo.address);
      }
    } catch (err) {
      console.error('[fake-dns-udp] Error parsing query:', err);
    }
  });
  return socket;
}

export function createDnsTcpServer() {
  return net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const msgLen = buffer.readUInt16BE(0);
        if (buffer.length < 2 + msgLen) {
          break; // Need more data
        }
        const dnsQuery = buffer.subarray(2, 2 + msgLen);
        buffer = buffer.subarray(2 + msgLen);

        try {
          const response = buildDnsResponse(dnsQuery);
          if (response.length > 0) {
            const lenBuf = Buffer.alloc(2);
            lenBuf.writeUInt16BE(response.length, 0);
            socket.write(Buffer.concat([lenBuf, response]));
          }
        } catch (err) {
          console.error('[fake-dns-tcp] Error processing AXFR query:', err);
        }
      }
    });
    socket.on('error', () => {});
  });
}

// ==========================================
// 3. Fake Netcraft Server (HTTP)
// ==========================================
export function createNetcraftServer() {
  return http.createServer((req, res) => {
    console.log(`[fake-netcraft] ${req.method} ${req.url}`);

    res.setHeader('Server', 'Netcraft-Mock-Intelligence/2.0 (Ubuntu; Linux x86_64)');
    res.setHeader('X-Powered-By', 'Metasploit-Ch3-Recon-Engine');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const isJson = req.url?.startsWith('/api') || req.headers['accept']?.includes('application/json');

    if (isJson) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const payload = {
        site: 'www.megacorp.internal',
        domain: 'megacorp.internal',
        netblock_owner: 'MegaCorp Industries Ltd.',
        ip_range: '172.28.0.0/16',
        primary_dns: '172.28.0.15',
        services: {
          web: {
            server: 'Apache/2.2.8 (Ubuntu) DAV/2',
            technologies: ['PHP 5.2.4', 'OpenSSL 0.9.8g', 'Perl 5.8.8'],
            ip: '172.28.0.20',
            port: 80
          },
          database: {
            engine: 'Microsoft SQL Server 2022 Express',
            ip: '172.28.0.30',
            port: 1433
          },
          storage: {
            engine: 'MinIO S3 Compatible Object Storage',
            ip: '172.28.0.25',
            ports: [9000, 9001],
            public_bucket: 'megacorp-backup'
          }
        },
        os: 'Linux 2.6.x (Ubuntu Hardy) / Linux 6.x (Container host)',
        last_reboot: '2026-02-14 00:00:00',
        uptime_days: 182
      };
      res.writeHead(200);
      res.end(JSON.stringify(payload, null, 2));
      return;
    }

    // HTML Report
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>Netcraft Site Report - megacorp.internal</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #f8fafc; }
    h1 { color: #38bdf8; font-size: 24px; margin-bottom: 8px; }
    .badge { display: inline-block; background: #0284c7; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #334155; }
    th { background: #0f172a; color: #94a3b8; font-size: 13px; text-transform: uppercase; }
    td { font-size: 14px; }
    .vuln { color: #f43f5e; font-weight: bold; }
    .code { font-family: monospace; background: #020617; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Netcraft Intelligence Report: megacorp.internal</h1>
  <span class="badge">Metasploit 2/e Chapter 3 Passive Reconnaissance Simulation</span>
  <p>Site report for domain <strong>megacorp.internal</strong> on target network <strong>172.28.0.0/16</strong>.</p>

  <table>
    <thead>
      <tr><th>Property</th><th>Observed Value</th><th>Security Assessment</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>Web Server</td>
        <td><span class="code">Apache/2.2.8 (Ubuntu) DAV/2 PHP/5.2.4-2ubuntu5.10</span></td>
        <td class="vuln">Outdated legacy web stack detected</td>
      </tr>
      <tr>
        <td>Operating System</td>
        <td>Linux 2.6.x (Ubuntu 8.04 LTS Hardy Heron)</td>
        <td class="vuln">End of Life OS target</td>
      </tr>
      <tr>
        <td>Database Server</td>
        <td>Microsoft SQL Server 2022 Express (<span class="code">172.28.0.30:1433</span>)</td>
        <td>Active MSSQL listener detected</td>
      </tr>
      <tr>
        <td>Backup Storage</td>
        <td>MinIO S3 (<span class="code">http://172.28.0.25:9000</span>)</td>
        <td class="vuln">Bucket megacorp-backup publicly accessible</td>
      </tr>
      <tr>
        <td>Nameserver</td>
        <td>ns1.megacorp.internal (<span class="code">172.28.0.15:53</span>)</td>
        <td class="vuln">AXFR Zone Transfer Permitted</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;
    res.writeHead(200);
    res.end(html);
  });
}

// ==========================================
// Process Runner
// ==========================================
export function startAllServers(options = {}) {
  const whoisPort = options.whoisPort || Number(process.env.WHOIS_PORT) || 43;
  const netcraftPort = options.netcraftPort || Number(process.env.NETCRAFT_PORT) || 8080;
  const dnsPort = options.dnsPort || Number(process.env.DNS_PORT) || 53;

  const whois = createWhoisServer();
  const netcraft = createNetcraftServer();
  const dnsUdp = createDnsUdpServer();
  const dnsTcp = createDnsTcpServer();

  whois.listen(whoisPort, '0.0.0.0', () => {
    console.log(`[fake-recon] Whois TCP listening on 0.0.0.0:${whoisPort}`);
  });

  netcraft.listen(netcraftPort, '0.0.0.0', () => {
    console.log(`[fake-recon] Netcraft HTTP listening on 0.0.0.0:${netcraftPort}`);
  });

  dnsUdp.bind(dnsPort, '0.0.0.0', () => {
    console.log(`[fake-recon] DNS UDP listening on 0.0.0.0:${dnsPort}`);
  });

  dnsTcp.listen(dnsPort, '0.0.0.0', () => {
    console.log(`[fake-recon] DNS TCP (AXFR) listening on 0.0.0.0:${dnsPort}`);
  });

  return { whois, netcraft, dnsUdp, dnsTcp };
}

export function stopAllServers(servers) {
  if (servers.whois) servers.whois.close();
  if (servers.netcraft) servers.netcraft.close();
  if (servers.dnsUdp) servers.dnsUdp.close();
  if (servers.dnsTcp) servers.dnsTcp.close();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  console.log('🚀 Starting Metasploit Ch3 Fake Recon Service...');
  startAllServers();
}
