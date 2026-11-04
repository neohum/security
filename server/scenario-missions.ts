import {
  Mission,
  MissionsData,
  DefenderAlert,
  EvaluationResult,
  loadMissions,
  getAllMissions,
  getMissionById,
  getMissionsByCategory,
  getSeverityForCategory,
  generateDefenderAlert,
  evaluateFlag,
  evaluateCommand,
  evaluateSubmission,
} from "./mission-evaluator.ts";

export {
  type Mission,
  type MissionsData,
  type DefenderAlert,
  type EvaluationResult,
  loadMissions,
  getAllMissions,
  getMissionById,
  getMissionsByCategory,
  getSeverityForCategory,
  generateDefenderAlert,
  evaluateFlag,
  evaluateCommand,
  evaluateSubmission,
};

export interface TutorialQuest {
  id: string;
  order: number;
  title: string;
  category: "passive" | "active" | "target" | "custom";
  description: string;
  targetIp: string;
  hintCommand: string;
  flagKey: string;
  aliases: string[];
  points: number;
  missionIdRef: string;
  validationPattern: string;
}

export const TUTORIAL_QUESTS: TutorialQuest[] = [
  {
    id: "m1-whois",
    order: 1,
    title: "1단계: 수동 정보 수집 — Whois 분석",
    category: "passive",
    description: "페이크 Whois 서버(172.28.0.15:43)에 도메인 등록 정보를 질의하여 담당자 이메일과 서브넷 정보를 식별하세요.",
    targetIp: "172.28.0.15",
    hintCommand: "whois -h 172.28.0.15 megacorp.internal",
    flagKey: "FLAG{WHOIS_RECON_SUCCESS}",
    aliases: [
      "FLAG{whois_recon_success}",
      "FLAG{whois_megacorp_admin_discovered}",
    ],
    points: 100,
    missionIdRef: "recon-whois-01",
    validationPattern: "(whois.*megacorp\\.internal|admin@megacorp\\.internal|OrgName:\\s*MegaCorp|whois_recon_success)",
  },
  {
    id: "m2-dns-axfr",
    order: 2,
    title: "2단계: DNS Zone Transfer(AXFR) 영역 전송",
    category: "passive",
    description: "모의 DNS 서버의 BIND AXFR 취약점을 이용해 megacorp.internal의 모든 내부 서브도메인을 탈취하세요.",
    targetIp: "172.28.0.15",
    hintCommand: "dig axfr @172.28.0.15 megacorp.internal",
    flagKey: "FLAG{ZONE_TRANSFER_EXPOSED}",
    aliases: [
      "FLAG{axfr_zone_transferred}",
      "FLAG{axfr_zone_transfer_subdomains_leaked}",
    ],
    points: 100,
    missionIdRef: "recon-dns-axfr-03",
    validationPattern: "(dig\\s+axfr\\s+@172\\.28\\.0\\.15|host\\s+-l\\s+megacorp\\.internal|zone_transfer_exposed|axfr_zone_transferred)",
  },
  {
    id: "m3-db-nmap",
    order: 3,
    title: "3단계: 능동 정보 수집 — db_nmap 포트 스캔",
    category: "active",
    description: "MSF 콘솔 내부에서 db_nmap을 실행하여 가상 서브넷(172.28.0.0/24)의 열린 포트를 PostgreSQL DB에 기록하세요.",
    targetIp: "172.28.0.20",
    hintCommand: "msfconsole -q -x 'db_nmap -sS -sV 172.28.0.20 172.28.0.30; hosts; services'",
    flagKey: "FLAG{MSF_DB_NMAP_RECORDED}",
    aliases: [
      "FLAG{syn_scan_detected}",
      "FLAG{nmap_syn_stealth_scan_completed}",
      "FLAG{msf_auxiliary_portscan_tcp_success}",
    ],
    points: 100,
    missionIdRef: "scan-nmap-syn-04",
    validationPattern: "(nmap.*-sS.*172\\.28\\.0\\.20|db_nmap.*|21/tcp\\s+open|22/tcp\\s+open|syn_scan_detected|msf_db_nmap_recorded)",
  },
  {
    id: "m4-mssql-login",
    order: 4,
    title: "4단계: 타깃 스캔 — MSSQL sa 브루트포스",
    category: "target",
    description: "auxiliary/scanner/mssql/mssql_login 모듈을 활용해 취약한 MSSQL 인스턴스(172.28.0.30)의 관리자 비밀번호를 획득하세요.",
    targetIp: "172.28.0.30",
    hintCommand: "use auxiliary/scanner/mssql/mssql_login\nset RHOSTS 172.28.0.30\nrun",
    flagKey: "FLAG{MSSQL_SA_PWNED}",
    aliases: [
      "FLAG{mssql_instance_ping_confirmed}",
      "FLAG{service_version_discovered}",
      "FLAG{mssql_login_sa_success}",
      "FLAG{mssql_sa_pwned}",
    ],
    points: 100,
    missionIdRef: "service-mssql-ping-07",
    validationPattern: "(auxiliary/scanner/mssql/mssql_(?:ping|login)|172\\.28\\.0\\.30(?::1433)?|SQL\\s*Server|InstanceName|Login\\s+Successful|sa:Password123!|MSSQL_SA_PWNED)",
  },
  {
    id: "m5-s3-leak",
    order: 5,
    title: "5단계: 클라우드 스토리지 — Fake S3 버킷 정찰",
    category: "target",
    description: "모의 AWS S3(172.28.0.25:9000)의 퍼블릭 버킷에서 노출된 config.env 파일을 추출하여 데이터베이스 접속 정보를 확보하세요.",
    targetIp: "172.28.0.25",
    hintCommand: "aws --endpoint-url http://172.28.0.25:9000 s3 cp s3://megacorp-backup/config.env -",
    flagKey: "FLAG{S3_CONFIDENTIAL_LEAK}",
    aliases: [
      "FLAG{s3_open_bucket_config_env_leaked}",
      "FLAG{s3_bucket_leaked_creds}",
      "FLAG{s3_confidential_leak}",
    ],
    points: 100,
    missionIdRef: "service-s3-bucket-08",
    validationPattern: "(curl.*(?:172\\.28\\.0\\.(?:15|20|25):9000|backup-s3).*|s3://megacorp-backup|config\\.env|db_passwords\\.txt|S3_CONFIDENTIAL_LEAK|s3_bucket_leaked|AWS_ACCESS_KEY_ID)",
  },
  {
    id: "m6-custom-scanner",
    order: 6,
    title: "6단계: 커스텀 MSF 스캐너 루비 모듈 작성",
    category: "custom",
    description: "교재 3장의 Msf::Exploit::Remote::Tcp 믹스인을 사용한 custom_tcp_banner.rb 스캐너를 로드하고 미지의 포트 배너를 획득하세요.",
    targetIp: "172.28.0.20",
    hintCommand: "msfconsole -m scenarios/modules -x 'use auxiliary/scanner/custom_tcp_banner; run'",
    flagKey: "FLAG{CUSTOM_RUBY_BANNER_GRABBED}",
    aliases: [
      "FLAG{custom_ruby_tcp_scanner_executed_successfully}",
      "FLAG{custom_scanner_ruby_win}",
      "FLAG{custom_ruby_banner_grabbed}",
    ],
    points: 100,
    missionIdRef: "custom-scanner-ruby-12",
    validationPattern: "(custom_tcp_banner|banner\\.rb|Msf::Auxiliary::Scanner|BANNER:.*172\\.28\\.0\\.20|Received\\s+banner|220\\s*\\(vsFTPd|CUSTOM_RUBY_BANNER_GRABBED|custom_ruby_tcp_scanner|custom_scanner_ruby)",
  },
];

/**
 * Normalizes input text by removing ANSI escape sequences and extra whitespace.
 */
export function normalizeTerminalText(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

/**
 * Checks if input represents an MSSQL brute-force / login attempt against 172.28.0.30
 * Handles Metasploit auxiliary/scanner/mssql/mssql_login, sqsh, sqlcmd, mssqlclient, hydra, and terminal outputs.
 */
export function isMssqlBruteforce(command: string, stdout = ""): boolean {
  const combined = normalizeTerminalText(`${command}\n${stdout}`);

  // 1. Direct flag check
  if (/FLAG\{(?:MSSQL_SA_PWNED|mssql_instance_ping_confirmed|service_version_discovered|mssql_login_sa_success)\}/i.test(combined)) {
    return true;
  }

  // 2. Metasploit module path matching: auxiliary/scanner/mssql/mssql_login
  // Handles variable whitespace, uppercase, shorthand module names
  const msfModulePattern = /(?:use\s+)?(?:auxiliary\/)?scanner\/mssql\/mssql_(?:login|ping)/i;
  const msfShorthandPattern = /use\s+mssql_login/i;
  const targetIpPattern = /172\.28\.0\.30/;
  const mssqlPortPattern = /(?:1433|ms-sql-s)/i;

  if (msfModulePattern.test(combined) || msfShorthandPattern.test(combined)) {
    // If module loaded, check if run or target specified or terminal output
    if (
      targetIpPattern.test(combined) ||
      /\b(?:run|exploit|set\s+rhosts)\b/i.test(combined) ||
      /mssql/i.test(command)
    ) {
      return true;
    }
  }

  // 3. One-liner msfconsole execution
  if (/msfconsole.*mssql_login/i.test(combined)) {
    return true;
  }

  // 4. CLI client tools: sqsh, sqlcmd, mssqlclient.py, hydra, medusa, nmap
  const sqshMatch = /(?:sqsh|sqlcmd)\b.*(?:-S|-s)\s*172\.28\.0\.30/i.test(combined) && /(?:-U|-u)\s*sa/i.test(combined);
  const mssqlClientMatch = /mssqlclient(?:\.py)?\s+sa(?::[^@]+)?@172\.28\.0\.30/i.test(combined);
  const hydraMatch = /hydra\b.*172\.28\.0\.30.*mssql/i.test(combined);
  const nmapBruteMatch = /nmap\b.*--script\s+ms-sql-brute.*172\.28\.0\.30/i.test(combined);

  if (sqshMatch || mssqlClientMatch || hydraMatch || nmapBruteMatch) {
    return true;
  }

  // 5. Successful login stdout indicators
  const successfulLoginOutput =
    /Login\s+Successful(?::\s*sa:Password123!)?/i.test(combined) ||
    /SUCCESSFUL\s+LOGIN\s+['"]?sa['"]?/i.test(combined) ||
    /Found:\s*sa\s*\/\s*Password123!/i.test(combined) ||
    (/172\.28\.0\.30:1433/i.test(combined) && /Microsoft\s+SQL\s+Server/i.test(combined));

  if (successfulLoginOutput) {
    return true;
  }

  return false;
}

/**
 * Checks if input represents S3 bucket enumeration or data exfiltration.
 * Handles curl with various flags, aws s3, mc, s3cmd, and terminal outputs.
 */
export function isS3BucketEnumeration(command: string, stdout = ""): boolean {
  const combined = normalizeTerminalText(`${command}\n${stdout}`);

  // 1. Direct flag check
  if (/FLAG\{(?:S3_CONFIDENTIAL_LEAK|s3_open_bucket_config_env_leaked|s3_bucket_leaked_creds)\}/i.test(combined)) {
    return true;
  }

  // 2. Target endpoints: 172.28.0.15:9000, 172.28.0.20:9000, 172.28.0.25:9000, backup-s3.megacorp.internal:9000
  const isTargetS3Host = /(?:172\.28\.0\.(?:15|20|25):9000|backup-s3(?:\.megacorp\.internal)?:9000)/i.test(combined);
  const isBucketName = /megacorp-backup/i.test(combined);

  // 3. curl variations: flags (-s, -v, -I, -sSL, -X GET, etc.)
  const isCurlCommand = /\bcurl\b/i.test(command) || /\bcurl\b/i.test(combined);
  if (isCurlCommand && (isTargetS3Host || isBucketName)) {
    return true;
  }

  // 4. aws s3 cli commands
  const isAwsS3 = /\baws\b.*s3\s+(?:ls|cp|sync)/i.test(combined) && (isTargetS3Host || isBucketName || /config\.env/i.test(combined));
  if (isAwsS3) {
    return true;
  }

  // 5. MinIO Client (mc) or s3cmd
  const isOtherS3Cli = /\b(?:mc|s3cmd)\b.*megacorp-backup/i.test(combined);
  if (isOtherS3Cli) {
    return true;
  }

  // 6. Terminal stdout indicators: S3 XML listing, config.env contents
  const hasS3XmlListing = /<ListBucketResult>/i.test(combined) && /<Name>megacorp-backup<\/Name>/i.test(combined);
  const hasEnvContents = /AWS_ACCESS_KEY_ID\s*=/i.test(combined) && /DB_PASS(?:WORD)?\s*=\s*Password123!/i.test(combined);
  const hasDownloadTrace = /download:\s*s3:\/\/megacorp-backup\/config\.env/i.test(combined);

  if (hasS3XmlListing || hasEnvContents || hasDownloadTrace) {
    return true;
  }

  return false;
}

/**
 * Checks if input represents writing, loading, or executing the custom Ruby TCP banner scanner module.
 * Handles banner.rb and custom_tcp_banner.rb file creation, Msf mixins, and command execution.
 */
export function isCustomRubyScanner(command: string, stdout = "", fileContent = ""): boolean {
  const combined = normalizeTerminalText(`${command}\n${stdout}\n${fileContent}`);

  // 1. Direct flag check
  if (/FLAG\{(?:CUSTOM_RUBY_BANNER_GRABBED|custom_ruby_tcp_scanner_executed_successfully|custom_scanner_ruby_win)\}/i.test(combined)) {
    return true;
  }

  // 2. File creation or modification: banner.rb or custom_tcp_banner.rb
  const fileTarget = /(?:custom_tcp_banner|banner)\.rb/i;
  const isCreatingFile =
    /(?:cat\s*<<\s*['"]?EOF['"]?\s*>\s*.*|echo\s+.*>\s*.*|cp\s+.*|nano\s+|vim?\s+|touch\s+)(?:[^\n]*\/)?(?:custom_tcp_banner|banner)\.rb/i.test(command) ||
    fileTarget.test(command);

  // 3. Ruby code contents matching Msf::Auxiliary::Scanner or Tcp mixins
  const hasMsfRubyCode =
    /require\s+['"]msf\/core['"]/i.test(combined) ||
    /Msf::Auxiliary::Scanner/i.test(combined) ||
    /Msf::Exploit::Remote::Tcp/i.test(combined) ||
    (/def\s+run_host/i.test(combined) && /sock\.get_once/i.test(combined));

  if (isCreatingFile && hasMsfRubyCode) {
    return true;
  }

  // 4. Execution via ruby CLI
  const isRubyCliExec = /\bruby\s+(?:[^\s]*\/)?(?:custom_tcp_banner|banner)\.rb/i.test(command);
  if (isRubyCliExec) {
    return true;
  }

  // 5. Execution via msfconsole module load
  const isMsfExec =
    /use\s+(?:auxiliary\/scanner\/)?(?:custom\/)?(?:custom_tcp_banner|banner)/i.test(combined) ||
    /msfconsole.*(?:custom_tcp_banner|banner\.rb)/i.test(combined);
  if (isMsfExec) {
    return true;
  }

  // 6. Terminal stdout indicators: banner capture output
  const hasBannerOutput =
    /\[\+\]\s*\[?172\.28\.0\.20(?::21)?\]?\s*-\s*Banner:\s*220\s*\(vsFTPd\s+2\.3\.4\)/i.test(combined) ||
    /BANNER:\s*172\.28\.0\.20:21\s*->\s*220\s*\(vsFTPd/i.test(combined) ||
    /Received\s+banner:\s*220\s*\(vsFTPd/i.test(combined) ||
    (/Executing\s+custom_tcp_banner/i.test(combined) && /220\s*\(vsFTPd/i.test(combined));

  if (hasBannerOutput) {
    return true;
  }

  return false;
}

/**
 * Specialized evaluator for Quest 4: MSSQL sa Brute-Force.
 */
export function evaluateMssqlLogin(command: string, stdout = ""): EvaluationResult {
  const quest = TUTORIAL_QUESTS.find((q) => q.id === "m4-mssql-login")!;
  const mission = getMissionById(quest.missionIdRef);

  if (isMssqlBruteforce(command, stdout)) {
    return {
      matched: true,
      mission,
      flagUnlocked: quest.flagKey,
      matchedBy: stdout ? "output" : "command",
      defenderAlert: mission ? generateDefenderAlert(mission) : undefined,
      message: `[퀘스트 4 완료] MSSQL sa 브루트포스 로그인 성공! (${quest.title})`,
    };
  }

  return {
    matched: false,
    mission,
    matchedBy: "none",
    message: "MSSQL 브루트포스 조건이 일치하지 않습니다. auxiliary/scanner/mssql/mssql_login 및 sa 인증을 확인하세요.",
  };
}

/**
 * Specialized evaluator for Quest 5: S3 Bucket Enumeration.
 */
export function evaluateS3Bucket(command: string, stdout = ""): EvaluationResult {
  const quest = TUTORIAL_QUESTS.find((q) => q.id === "m5-s3-leak")!;
  const mission = getMissionById(quest.missionIdRef);

  if (isS3BucketEnumeration(command, stdout)) {
    return {
      matched: true,
      mission,
      flagUnlocked: quest.flagKey,
      matchedBy: stdout ? "output" : "command",
      defenderAlert: mission ? generateDefenderAlert(mission) : undefined,
      message: `[퀘스트 5 완료] S3 퍼블릭 버킷 노출 및 config.env 획득 성공! (${quest.title})`,
    };
  }

  return {
    matched: false,
    mission,
    matchedBy: "none",
    message: "S3 버킷 탐색 조건이 일치하지 않습니다. curl http://172.28.0.25:9000/megacorp-backup 명령을 점검하세요.",
  };
}

/**
 * Specialized evaluator for Quest 6: Custom Ruby Scanner module.
 */
export function evaluateCustomRubyScanner(command: string, stdout = "", fileContent = ""): EvaluationResult {
  const quest = TUTORIAL_QUESTS.find((q) => q.id === "m6-custom-scanner")!;
  const mission = getMissionById(quest.missionIdRef);

  if (isCustomRubyScanner(command, stdout, fileContent)) {
    return {
      matched: true,
      mission,
      flagUnlocked: quest.flagKey,
      matchedBy: stdout ? "output" : "command",
      defenderAlert: mission ? generateDefenderAlert(mission) : undefined,
      message: `[퀘스트 6 완료] 커스텀 루비 배너 스캐너 (banner.rb) 구동 성공! (${quest.title})`,
    };
  }

  return {
    matched: false,
    mission,
    matchedBy: "none",
    message: "커스텀 스캐너 조건이 일치하지 않습니다. custom_tcp_banner.rb 파일 작성 및 실행을 확인하세요.",
  };
}

/**
 * Evaluates user submission for any tutorial quest by order (1~6) or id string.
 */
export function evaluateTutorialQuest(
  questIdOrOrder: string | number,
  input: string,
  stdout = ""
): EvaluationResult {
  const key = String(questIdOrOrder).toLowerCase().trim();
  const quest = TUTORIAL_QUESTS.find(
    (q) =>
      String(q.order) === key ||
      q.id.toLowerCase() === key ||
      q.missionIdRef.toLowerCase() === key ||
      q.aliases.some((a) => a.toLowerCase() === key)
  );

  if (!quest) {
    return {
      matched: false,
      matchedBy: "none",
      message: `튜토리얼 퀘스트 '${questIdOrOrder}'를 찾을 수 없습니다.`,
    };
  }

  const mission = getMissionById(quest.missionIdRef);
  const trimmed = input.trim();

  // 1. Direct flag check
  const isDirectFlag =
    trimmed.toUpperCase() === quest.flagKey.toUpperCase() ||
    quest.aliases.some((a) => a.toUpperCase() === trimmed.toUpperCase()) ||
    (mission && (trimmed.toUpperCase() === mission.flag.toUpperCase() || mission.aliases?.some((a) => a.toUpperCase() === trimmed.toUpperCase())));

  if (isDirectFlag) {
    return {
      matched: true,
      mission,
      flagUnlocked: quest.flagKey,
      matchedBy: "flag",
      defenderAlert: mission ? generateDefenderAlert(mission) : undefined,
      message: `정답 플래그 확인: [${quest.title}] 클리어!`,
    };
  }

  // 2. Specific evaluators for Quests 4, 5, 6
  if (quest.order === 4 || quest.id === "m4-mssql-login") {
    return evaluateMssqlLogin(input, stdout);
  }
  if (quest.order === 5 || quest.id === "m5-s3-leak") {
    return evaluateS3Bucket(input, stdout);
  }
  if (quest.order === 6 || quest.id === "m6-custom-scanner") {
    return evaluateCustomRubyScanner(input, stdout);
  }

  // 3. Fallback regex validation pattern
  try {
    const combined = `${input}\n${stdout}`;
    const regex = new RegExp(quest.validationPattern, "i");
    if (regex.test(combined)) {
      return {
        matched: true,
        mission,
        flagUnlocked: quest.flagKey,
        matchedBy: stdout && !regex.test(input) ? "output" : "command",
        defenderAlert: mission ? generateDefenderAlert(mission) : undefined,
        message: `유효 실행 확인: [${quest.title}] 클리어!`,
      };
    }
  } catch {
    // regex error fallback
  }

  return {
    matched: false,
    mission,
    matchedBy: "none",
    message: `제출 내용이 퀘스트 [${quest.title}]의 조건과 일치하지 않습니다.`,
  };
}

/**
 * Scans a command and optional stdout against all tutorial quests,
 * returning all matched evaluation results.
 */
export function evaluateAdvancedCommand(command: string, stdout = ""): EvaluationResult[] {
  const results: EvaluationResult[] = [];

  for (const quest of TUTORIAL_QUESTS) {
    const res = evaluateTutorialQuest(quest.id, command, stdout);
    if (res.matched) {
      results.push(res);
    }
  }

  return results;
}
