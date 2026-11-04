/**
 * Mock Internet Mesh Engine (200 Virtual Nodes)
 *
 * Emulates 200 virtual IP nodes (10.10.1.1 - 10.10.1.200) on a local simulated internet.
 * Exactly 60 nodes have specific vulnerabilities across 6 categories (10 nodes each):
 *   1. Whois recon (50 pts)
 *   2. DNS AXFR zone transfer (100 pts)
 *   3. Web banner discovery / HTTP exploit (100 pts)
 *   4. MSSQL sa login success (150 pts)
 *   5. S3 bucket config.env leak extraction (150 pts)
 *   6. Legacy backdoor / RCE banner exploit (200 pts)
 * The remaining 140 nodes are hardened (DROP / filtered / hardened responses).
 */

export const VULNERABLE_CATEGORIES = [
  'whois',
  'dns-axfr',
  'web-banner',
  'mssql',
  's3-bucket',
  'legacy-service',
] as const;

export const SIX_CATEGORIES = [
  'whois',
  'dns-axfr',
  'web-banner',
  'mssql',
  's3-bucket',
  'legacy-rce',
] as const;

export type StandardVulnerableCategory = (typeof VULNERABLE_CATEGORIES)[number];
export type VulnerableCategory = StandardVulnerableCategory | 'legacy-rce';
export type VulnerabilityCategory = VulnerableCategory;

export const CATEGORY_POINTS: Record<VulnerableCategory, number> = {
  'whois': 50,
  'dns-axfr': 100,
  'web-banner': 100,
  'mssql': 150,
  's3-bucket': 150,
  'legacy-service': 200,
  'legacy-rce': 200,
};

export interface VirtualServerNode {
  id: string;               // e.g. "node-001" ~ "node-200"
  index: number;            // 1 ~ 200
  ip: string;               // "10.10.1.1" ~ "10.10.1.200"
  hostname: string;         // e.g. "srv-001.mega-infra.net"
  isVulnerable: boolean;
  category: VulnerableCategory | 'hardened';
  vulnerabilityType?: VulnerableCategory;
  points: number;
  flag?: string;
  openPorts: number[];
  banner?: string;
  compromisedBy: string[];  // participants who compromised this node
  details?: Record<string, unknown>;
}

export type VirtualNode = VirtualServerNode;

export interface ScanPortResult {
  open: boolean;
  vulnerable: boolean;
  banner?: string;
}

export interface SubnetScanResult {
  total: number;
  hostsUp: string[];
}

export interface QueryResult {
  success: boolean;
  leaked: boolean;
  flag?: string;
  output: string;
}

export interface LoginResult {
  success: boolean;
  flag?: string;
  output: string;
}

export interface S3AccessResult {
  success: boolean;
  flag?: string;
  output: string;
}

/**
 * Deterministic pseudo-random number generator (Mulberry32).
 */
function createPrng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Normalize category name to standard category identifier ('legacy-rce' <-> 'legacy-service').
 */
function normalizeCategory(cat: string): StandardVulnerableCategory | string {
  if (cat === 'legacy-rce') return 'legacy-service';
  return cat;
}

export class MockInternetMesh {
  private nodesById: Map<string, VirtualServerNode> = new Map();
  private nodesByIp: Map<string, VirtualServerNode> = new Map();
  private nodesByHostname: Map<string, VirtualServerNode> = new Map();
  private seed?: number;

  constructor(seed?: number) {
    this.seed = seed;
    this.initMesh(seed);
  }

  public resetMesh(seed?: number): void {
    this.seed = seed !== undefined ? seed : this.seed;
    this.initMesh(this.seed);
  }

  private initMesh(seed?: number): void {
    this.nodesById.clear();
    this.nodesByIp.clear();
    this.nodesByHostname.clear();

    const prng = seed !== undefined ? createPrng(seed) : Math.random;

    // Indices 1..200
    const indices: number[] = [];
    for (let i = 1; i <= 200; i++) {
      indices.push(i);
    }

    // Fisher-Yates shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      const temp = indices[i];
      indices[i] = indices[j];
      indices[j] = temp;
    }

    // Assign 10 vulnerable nodes per category across all 6 categories
    const vulnAssignment = new Map<number, StandardVulnerableCategory>();
    let ptr = 0;
    for (const cat of VULNERABLE_CATEGORIES) {
      for (let c = 0; c < 10; c++) {
        vulnAssignment.set(indices[ptr], cat);
        ptr++;
      }
    }

    // Construct exactly 200 nodes
    for (let i = 1; i <= 200; i++) {
      const id = `node-${String(i).padStart(3, '0')}`;
      const ip = `10.10.1.${i}`;
      const hostname = `srv-${String(i).padStart(3, '0')}.mega-infra.net`;
      const cat = vulnAssignment.get(i);
      const isVulnerable = cat !== undefined;

      let node: VirtualServerNode;
      if (isVulnerable && cat) {
        const flag = `FLAG{MESH_${cat.toUpperCase().replace(/-/g, '_')}_${String(i).padStart(3, '0')}}`;
        const openPorts = this.getPortsForCategory(cat);
        const banner = this.getBannerForCategory(cat, ip, hostname, flag);
        node = {
          id,
          index: i,
          ip,
          hostname,
          isVulnerable: true,
          category: cat,
          vulnerabilityType: cat,
          points: CATEGORY_POINTS[cat],
          flag,
          openPorts,
          banner,
          compromisedBy: [],
          details: {
            category: cat,
            status: 'vulnerable',
            legacyAlias: cat === 'legacy-service' ? 'legacy-rce' : undefined,
          },
        };
      } else {
        node = {
          id,
          index: i,
          ip,
          hostname,
          isVulnerable: false,
          category: 'hardened',
          points: 0,
          openPorts: [22], // Standard hardened port with OpenSSH
          banner: 'OpenSSH 8.9p1 Ubuntu-3ubuntu0.4 (Hardened, Key-based auth only)',
          compromisedBy: [],
          details: { category: 'hardened', status: 'hardened' },
        };
      }

      this.nodesById.set(id, node);
      this.nodesByIp.set(ip, node);
      this.nodesByHostname.set(hostname, node);
    }
  }

  private getPortsForCategory(cat: VulnerableCategory | string): number[] {
    const normalized = normalizeCategory(cat);
    switch (normalized) {
      case 'whois':
        return [43];
      case 'dns-axfr':
        return [53];
      case 'web-banner':
        return [80, 8080];
      case 'mssql':
        return [1433];
      case 's3-bucket':
        return [9000];
      case 'legacy-service':
      case 'legacy-rce':
        return [21, 1524];
      default:
        return [];
    }
  }

  private getBannerForCategory(
    cat: VulnerableCategory | string,
    ip: string,
    hostname: string,
    flag: string
  ): string {
    const normalized = normalizeCategory(cat);
    switch (normalized) {
      case 'whois':
        return (
          `Domain Name: MEGA-INFRA.NET\n` +
          `Registry Domain ID: 20261103-INTERNAL\n` +
          `Registrar WHOIS Server: whois.mega-infra.net\n` +
          `Registrar: MegaCorp Infrastructure Registrar\n` +
          `Admin Email: admin@mega-infra.net\n` +
          `CIDR Range: 10.10.1.0/24\n` +
          `Tech Hostname: ${hostname}\n` +
          `Whois Recon Flag: ${flag}\n`
        );
      case 'dns-axfr':
        return (
          `;; Zone Transfer (AXFR) for mega-infra.net\n` +
          `mega-infra.net. IN SOA ns1.mega-infra.net. hostmaster.mega-infra.net. 2026110301 7200 3600 1209600 3600\n` +
          `admin-vault.mega-infra.net. IN A ${ip}\n` +
          `secret-gateway.mega-infra.net. IN A ${ip}\n` +
          `flag-bearer.mega-infra.net. IN TXT "${flag}"\n` +
          `;; AXFR completed\n`
        );
      case 'web-banner':
        return (
          `HTTP/1.1 200 OK\r\n` +
          `Server: Apache/2.2.8 (Ubuntu) DAV/2 mod_ssl/2.2.8 OpenSSL/0.9.8g\r\n` +
          `X-Powered-By: PHP/5.2.4-2ubuntu5.10\r\n` +
          `X-Secret-Flag: ${flag}\r\n\r\n` +
          `<html><body><h1>MegaCorp Web Portal</h1><!-- ${flag} --></body></html>`
        );
      case 'mssql':
        return (
          `Microsoft SQL Server 2008 R2 (RTM) - 10.50.1600.1 (X64)\n` +
          `[+] sa authentication success: Password123!\n` +
          `[+] xp_cmdshell is ENABLED.\n` +
          `[+] Flag: ${flag}\n`
        );
      case 's3-bucket':
        return (
          `MinIO/S3 Bucket 'config.env' is publicly accessible:\n` +
          `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n` +
          `AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n` +
          `DATABASE_URL=postgres://app:sec@${ip}:5432/megacorp\n` +
          `CONFIDENTIAL_FLAG=${flag}\n`
        );
      case 'legacy-service':
      case 'legacy-rce':
        return (
          `220 vsftpd 2.3.4 (vsFTPd 2.3.4 - backdoor smiley enabled)\n` +
          `Ingreslock 1524 Backdoor root shell:\n` +
          `uid=0(root) gid=0(root) groups=0(root)\n` +
          `Flag: ${flag}\n`
        );
      default:
        return '';
    }
  }

  public getAllNodes(): VirtualServerNode[] {
    return Array.from(this.nodesById.values());
  }

  public getNodeById(id: string): VirtualServerNode | undefined {
    if (!id || typeof id !== 'string') return undefined;
    return this.nodesById.get(id.trim());
  }

  public getNodeByIp(ip: string): VirtualServerNode | undefined {
    if (!ip || typeof ip !== 'string') return undefined;
    return this.nodesByIp.get(ip.trim());
  }

  public getNode(target: string): VirtualServerNode | undefined {
    if (!target || typeof target !== 'string') return undefined;
    const clean = target.trim();
    return (
      this.nodesById.get(clean) ||
      this.nodesByIp.get(clean) ||
      this.nodesByHostname.get(clean)
    );
  }

  public getVulnerableNodes(): VirtualServerNode[] {
    return this.getAllNodes().filter((n) => n.isVulnerable);
  }

  public getVulnerableNodesByCategory(cat: VulnerableCategory | string): VirtualServerNode[] {
    if (!cat || typeof cat !== 'string') return [];
    const target = normalizeCategory(cat);
    return this.getAllNodes().filter((n) => {
      if (!n.isVulnerable) return false;
      const nodeCat = normalizeCategory(n.category);
      return nodeCat === target;
    });
  }

  public getHardenedNodes(): VirtualServerNode[] {
    return this.getAllNodes().filter((n) => n.category === 'hardened');
  }

  public queryWhois(target: string): QueryResult {
    if (!target || typeof target !== 'string') {
      return {
        success: false,
        leaked: false,
        output: `% Invalid whois query: "${target}". Host unreachable.`,
      };
    }

    const node = this.getNode(target);
    if (!node) {
      return {
        success: false,
        leaked: false,
        output: `% No whois record found for query "${target}". Host unreachable.`,
      };
    }

    if (node.isVulnerable && node.category === 'whois') {
      return {
        success: true,
        leaked: true,
        flag: node.flag,
        output: node.banner || '',
      };
    }

    // Hardened or non-whois node: protected by GDPR privacy guard, NEVER leaks flag
    return {
      success: true,
      leaked: false,
      output: `% REDACTED_FOR_PRIVACY: Whois information for ${node.hostname} (${node.ip}) is protected by GDPR privacy guard.`,
    };
  }

  public queryDnsAxfr(ip: string, domain = 'mega-infra.net'): QueryResult {
    if (!ip || typeof ip !== 'string') {
      return {
        success: false,
        leaked: false,
        output: `;; connection timed out; no servers could be reached at invalid IP`,
      };
    }

    const cleanIp = ip.trim();
    const node = this.getNodeByIp(cleanIp);
    if (!node) {
      return {
        success: false,
        leaked: false,
        output: `;; connection timed out; no servers could be reached at ${cleanIp}`,
      };
    }

    if (node.isVulnerable && node.category === 'dns-axfr') {
      return {
        success: true,
        leaked: true,
        flag: node.flag,
        output: node.banner || '',
      };
    }

    // Hardened or non-AXFR node: Transfer refused, NEVER leaks flag
    const targetDomain = (domain && typeof domain === 'string') ? domain.trim() : 'mega-infra.net';
    return {
      success: false,
      leaked: false,
      output: `;; Transfer failed: Refused: AXFR not allowed by ACL for zone ${targetDomain} on ${cleanIp}`,
    };
  }

  public scanPort(ip: string, port: number): ScanPortResult {
    if (!ip || typeof ip !== 'string') {
      return { open: false, vulnerable: false };
    }

    if (typeof port !== 'number' || isNaN(port) || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { open: false, vulnerable: false };
    }

    const cleanIp = ip.trim();
    const node = this.getNodeByIp(cleanIp);
    if (!node) {
      return { open: false, vulnerable: false };
    }

    if (node.openPorts.includes(port)) {
      if (node.isVulnerable) {
        let banner = node.banner;
        if ((node.category === 'legacy-service' || (node.category as string) === 'legacy-rce') && port === 21) {
          banner = '220 (vsftpd 2.3.4 - vsFTPd backdoor)';
        }
        return { open: true, vulnerable: true, banner };
      }
      // Hardened node: OpenSSH key-based auth only, NEVER vulnerable, NEVER leaks flag
      return { open: true, vulnerable: false, banner: node.banner };
    }

    return { open: false, vulnerable: false };
  }

  public scanSubnet(cidr: string): SubnetScanResult {
    if (!cidr || typeof cidr !== 'string') {
      return { total: 0, hostsUp: [] };
    }

    const match = cidr.trim().match(/^10\.10\.1\.(\d+)\/(\d+)$/);
    if (!match) {
      return { total: 0, hostsUp: [] };
    }

    const baseOctet = parseInt(match[1], 10);
    const prefixLen = parseInt(match[2], 10);

    if (isNaN(baseOctet) || isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32 || baseOctet < 0 || baseOctet > 255) {
      return { total: 0, hostsUp: [] };
    }

    const hostsCount = prefixLen === 32 ? 1 : Math.pow(2, 32 - prefixLen);
    const startOctet = baseOctet;
    const endOctet = Math.min(255, baseOctet + hostsCount - 1);

    const hostsUp: string[] = [];
    for (let i = 1; i <= 200; i++) {
      if (i >= startOctet && i <= endOctet) {
        hostsUp.push(`10.10.1.${i}`);
      }
    }

    return { total: hostsUp.length, hostsUp };
  }

  public attemptMssqlLogin(ip: string, user: string, pass: string): LoginResult {
    if (!ip || typeof ip !== 'string') {
      return {
        success: false,
        output: 'Sqlcmd: Error: Network host unreachable.',
      };
    }

    const cleanIp = ip.trim();
    const node = this.getNodeByIp(cleanIp);
    if (!node) {
      return {
        success: false,
        output: `Sqlcmd: Error: Network host ${cleanIp} unreachable.`,
      };
    }

    const safeUser = typeof user === 'string' ? user : '';
    const safePass = typeof pass === 'string' ? pass : '';

    if (!node.isVulnerable || node.category !== 'mssql') {
      return {
        success: false,
        output: `Sqlcmd: Error: Connection failed or login denied for ${safeUser || 'anonymous'}@${cleanIp}.`,
      };
    }

    if (safeUser === 'sa' && safePass === 'Password123!') {
      return {
        success: true,
        flag: node.flag,
        output: node.banner || '',
      };
    }

    return {
      success: false,
      output: `Msg 18456, Level 14, State 1: Login failed for user '${safeUser}'.`,
    };
  }

  public accessS3Bucket(ip: string, bucketOrKey: string): S3AccessResult {
    if (!ip || typeof ip !== 'string') {
      return {
        success: false,
        output: 'fatal error: Endpoint unreachable.',
      };
    }

    const cleanIp = ip.trim();
    const node = this.getNodeByIp(cleanIp);
    if (!node) {
      return {
        success: false,
        output: `fatal error: Endpoint ${cleanIp} unreachable.`,
      };
    }

    if (!node.isVulnerable || node.category !== 's3-bucket') {
      return {
        success: false,
        output: `fatal error: An error occurred (403 Forbidden or Connection Refused) when connecting to ${cleanIp}:9000.`,
      };
    }

    const safeKey = typeof bucketOrKey === 'string' ? bucketOrKey.trim() : '';

    if (safeKey === 'config.env') {
      return {
        success: true,
        flag: node.flag,
        output: node.banner || '',
      };
    }

    return {
      success: false,
      output: `fatal error: An error occurred (NoSuchBucket) when accessing bucket '${safeKey}' on ${cleanIp}:9000.`,
    };
  }

  public queryWeb(ip: string, port = 80, path = '/'): QueryResult {
    if (!ip || typeof ip !== 'string') {
      return {
        success: false,
        leaked: false,
        output: 'curl: (7) Failed to connect: invalid IP',
      };
    }

    const cleanIp = ip.trim();
    const node = this.getNodeByIp(cleanIp);
    if (!node) {
      return {
        success: false,
        leaked: false,
        output: `curl: (7) Failed to connect to ${cleanIp} port ${port}: Connection refused`,
      };
    }

    if (!node.isVulnerable || node.category !== 'web-banner' || !node.openPorts.includes(port)) {
      return {
        success: false,
        leaked: false,
        output: `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nAccess denied to ${path} on ${cleanIp}:${port}`,
      };
    }

    return {
      success: true,
      leaked: true,
      flag: node.flag,
      output: node.banner || '',
    };
  }

  public exploitLegacy(ip: string, port = 1524): QueryResult {
    if (!ip || typeof ip !== 'string') {
      return {
        success: false,
        leaked: false,
        output: 'connect: Connection refused',
      };
    }

    const cleanIp = ip.trim();
    const node = this.getNodeByIp(cleanIp);
    if (!node) {
      return {
        success: false,
        leaked: false,
        output: `connect to ${cleanIp}: Connection refused`,
      };
    }

    const isLegacy = node.isVulnerable && (node.category === 'legacy-service' || (node.category as string) === 'legacy-rce');
    if (!isLegacy || !node.openPorts.includes(port)) {
      return {
        success: false,
        leaked: false,
        output: `Connection refused on ${cleanIp}:${port} (Service hardened or closed)`,
      };
    }

    return {
      success: true,
      leaked: true,
      flag: node.flag,
      output: node.banner || '',
    };
  }

  public markCompromised(idOrIp: string, participant: string): boolean {
    if (!idOrIp || typeof idOrIp !== 'string') return false;
    if (!participant || typeof participant !== 'string' || !participant.trim()) return false;

    const cleanTarget = idOrIp.trim();
    const node = this.getNodeById(cleanTarget) || this.getNodeByIp(cleanTarget);
    // Hardened or non-existent nodes CANNOT be compromised under any circumstances
    if (!node || !node.isVulnerable || node.category === 'hardened') {
      return false;
    }

    const cleanParticipant = participant.trim();
    if (!node.compromisedBy.includes(cleanParticipant)) {
      node.compromisedBy.push(cleanParticipant);
    }
    return true;
  }

  public isCompromised(idOrIp: string): boolean {
    if (!idOrIp || typeof idOrIp !== 'string') return false;
    const cleanTarget = idOrIp.trim();
    const node = this.getNodeById(cleanTarget) || this.getNodeByIp(cleanTarget);
    if (!node || !node.isVulnerable || node.category === 'hardened') {
      return false;
    }
    return node.compromisedBy.length > 0;
  }
}
