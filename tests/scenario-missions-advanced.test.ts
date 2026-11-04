// tests/scenario-missions-advanced.test.ts
// Comprehensive Test Suite for Tutorial Chapter 3 Second Half (Quests 4~6)
// Targets:
//   - Quest 4: MSSQL Brute-Force (auxiliary/scanner/mssql/mssql_login, sa:Password123!)
//   - Quest 5: S3 Bucket Exposure (curl S3 bucket, config.env extraction)
//   - Quest 6: Custom Ruby Scanner (banner.rb / custom_tcp_banner.rb creation & execution)
// Covers manual flag submission, CLI & terminal command matching, stdout pattern recognition,
// edge cases (whitespace, mixed case, flags, shorthand paths), ScenarioState auto-scoring, and REST API.

import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  TUTORIAL_QUESTS,
  isMssqlBruteforce,
  isS3BucketEnumeration,
  isCustomRubyScanner,
  evaluateMssqlLogin,
  evaluateS3Bucket,
  evaluateCustomRubyScanner,
  evaluateTutorialQuest,
  evaluateAdvancedCommand,
  loadMissions,
  getAllMissions,
  getMissionById,
  evaluateFlag,
  evaluateCommand,
  evaluateSubmission,
} from "../server/scenario-missions.ts";

import { ScenarioState, INITIAL_QUESTS } from "../server/scenario-state.ts";
import { GatewayApp } from "../server/index.ts";

describe("Chapter 3 Quests 4~6: Scenario & Mission Definitions", () => {
  it("TUTORIAL_QUESTS contains 6 structured quests in order", () => {
    assert.equal(TUTORIAL_QUESTS.length, 6);
    assert.equal(TUTORIAL_QUESTS[3].order, 4);
    assert.equal(TUTORIAL_QUESTS[3].id, "m4-mssql-login");
    assert.equal(TUTORIAL_QUESTS[4].order, 5);
    assert.equal(TUTORIAL_QUESTS[4].id, "m5-s3-leak");
    assert.equal(TUTORIAL_QUESTS[5].order, 6);
    assert.equal(TUTORIAL_QUESTS[5].id, "m6-custom-scanner");
  });

  it("INITIAL_QUESTS in scenario-state matches Chapter 3 progression", () => {
    assert.equal(INITIAL_QUESTS.length, 6);
    assert.equal(INITIAL_QUESTS[0].order, 1);
    assert.equal(INITIAL_QUESTS[1].order, 2);
    assert.equal(INITIAL_QUESTS[2].order, 3);
    assert.equal(INITIAL_QUESTS[3].order, 4);
    assert.equal(INITIAL_QUESTS[4].order, 5);
    assert.equal(INITIAL_QUESTS[5].order, 6);

    assert.equal(INITIAL_QUESTS[3].id, "quest-mssql-login");
    assert.equal(INITIAL_QUESTS[4].id, "quest-s3");
    assert.equal(INITIAL_QUESTS[5].id, "quest-custom-scanner");
  });

  it("scenarios/ch3-missions.json has enriched aliases and regex patterns for missions 7, 8, 12", () => {
    const missions = loadMissions();
    const mssql = missions.find((m) => m.id === "service-mssql-ping-07");
    const s3 = missions.find((m) => m.id === "service-s3-bucket-08");
    const ruby = missions.find((m) => m.id === "custom-scanner-ruby-12");

    assert.ok(mssql);
    assert.ok(s3);
    assert.ok(ruby);

    assert.ok(mssql.aliases?.includes("FLAG{MSSQL_SA_PWNED}"));
    assert.ok(s3.aliases?.includes("FLAG{S3_CONFIDENTIAL_LEAK}"));
    assert.ok(ruby.aliases?.includes("FLAG{CUSTOM_RUBY_BANNER_GRABBED}"));
  });
});

describe("Quest 4: MSSQL Brute-Force (mssql_login) Edge Cases", () => {
  it("evaluates manual flag submissions with primary flag and aliases (case-insensitive)", () => {
    // Primary flag
    assert.equal(evaluateTutorialQuest(4, "FLAG{MSSQL_SA_PWNED}").matched, true);
    // Lowercase
    assert.equal(evaluateTutorialQuest(4, "flag{mssql_sa_pwned}").matched, true);
    // Ping flag alias
    assert.equal(evaluateTutorialQuest(4, "FLAG{mssql_instance_ping_confirmed}").matched, true);
    // Service version alias
    assert.equal(evaluateTutorialQuest(4, "FLAG{service_version_discovered}").matched, true);
    // Login alias
    assert.equal(evaluateTutorialQuest("m4-mssql-login", "FLAG{mssql_login_sa_success}").matched, true);
    // Whitespace tolerance
    assert.equal(evaluateTutorialQuest(4, "   FLAG{MSSQL_SA_PWNED}   \n").matched, true);
    // Invalid flag rejection
    assert.equal(evaluateTutorialQuest(4, "FLAG{wrong_mssql_flag}").matched, false);
  });

  it("evaluates Metasploit auxiliary/scanner/mssql/mssql_login commands", () => {
    // Standard module use
    assert.equal(isMssqlBruteforce("use auxiliary/scanner/mssql/mssql_login\nset RHOSTS 172.28.0.30\nrun"), true);
    // Shorthand path
    assert.equal(isMssqlBruteforce("use scanner/mssql/mssql_login\nset rhosts 172.28.0.30\nexploit"), true);
    // Shorthand use mssql_login
    assert.equal(isMssqlBruteforce("use mssql_login\nset RHOSTS 172.28.0.30\nrun"), true);
    // Mixed case and extra spaces
    assert.equal(isMssqlBruteforce("USE   AUXILIARY/scanner/MSSQL/mssql_login\nSET   RHOSTS   172.28.0.30\nRUN"), true);
    // msfconsole one-liner execution
    assert.equal(isMssqlBruteforce("msfconsole -q -x 'use auxiliary/scanner/mssql/mssql_login; set RHOSTS 172.28.0.30; run'"), true);
  });

  it("evaluates CLI and script brute-force attempts: sqsh, sqlcmd, mssqlclient, hydra, nmap", () => {
    // sqsh
    assert.equal(isMssqlBruteforce("sqsh -S 172.28.0.30 -U sa -P Password123!"), true);
    // sqlcmd
    assert.equal(isMssqlBruteforce("sqlcmd -S 172.28.0.30:1433 -U sa -P Password123!"), true);
    // mssqlclient.py
    assert.equal(isMssqlBruteforce("python3 mssqlclient.py sa:Password123!@172.28.0.30"), true);
    // hydra
    assert.equal(isMssqlBruteforce("hydra -l sa -P /usr/share/wordlists/passwords.txt 172.28.0.30 mssql"), true);
    // nmap ms-sql-brute script
    assert.equal(isMssqlBruteforce("nmap -p 1433 --script ms-sql-brute --script-args userdb=users.txt,passdb=passwords.txt 172.28.0.30"), true);
  });

  it("evaluates terminal stdout success patterns", () => {
    const stdout1 = "[+] 172.28.0.30:1433 - MSSQL - Login Successful: sa:Password123!";
    assert.equal(isMssqlBruteforce("", stdout1), true);

    const stdout2 = "[+] 172.28.0.30:1433 - MSSQL - SUCCESSFUL LOGIN 'sa':'Password123!'";
    assert.equal(isMssqlBruteforce("", stdout2), true);

    const stdout3 = "[+] 172.28.0.30:1433 - Found: sa / Password123!";
    assert.equal(isMssqlBruteforce("", stdout3), true);

    const stdout4 = "Microsoft SQL Server 2019 (RTM-CU18) - 15.0.4261.1\n172.28.0.30:1433";
    assert.equal(isMssqlBruteforce("", stdout4), true);
  });

  it("rejects non-matching or unrelated commands for Quest 4", () => {
    assert.equal(isMssqlBruteforce("use auxiliary/scanner/portscan/tcp"), false);
    assert.equal(isMssqlBruteforce("nmap -sS 172.28.0.10"), false);
    assert.equal(isMssqlBruteforce("curl http://172.28.0.15:8080"), false);
    assert.equal(isMssqlBruteforce("sqsh -S 10.0.0.99 -U admin -P secret"), false);
  });

  it("evaluateMssqlLogin returns formatted EvaluationResult with defender alert", () => {
    const res = evaluateMssqlLogin("use auxiliary/scanner/mssql/mssql_login", "[+] 172.28.0.30:1433 - Login Successful: sa:Password123!");
    assert.equal(res.matched, true);
    assert.equal(res.flagUnlocked, "FLAG{MSSQL_SA_PWNED}");
    assert.ok(res.defenderAlert);
    assert.equal(res.defenderAlert?.severity, "high");
    assert.match(res.message, /MSSQL sa 브루트포스 로그인 성공/);
  });
});

describe("Quest 5: S3 Bucket Exposure Edge Cases", () => {
  it("evaluates manual flag submissions with primary flag and aliases (case-insensitive)", () => {
    // Primary flag
    assert.equal(evaluateTutorialQuest(5, "FLAG{S3_CONFIDENTIAL_LEAK}").matched, true);
    // Lowercase
    assert.equal(evaluateTutorialQuest(5, "flag{s3_confidential_leak}").matched, true);
    // Open bucket config.env alias
    assert.equal(evaluateTutorialQuest(5, "FLAG{s3_open_bucket_config_env_leaked}").matched, true);
    // Leaked creds alias
    assert.equal(evaluateTutorialQuest(5, "FLAG{s3_bucket_leaked_creds}").matched, true);
    // Lookup by string ID
    assert.equal(evaluateTutorialQuest("m5-s3-leak", "FLAG{S3_CONFIDENTIAL_LEAK}").matched, true);
    assert.equal(evaluateTutorialQuest("service-s3-bucket-08", "FLAG{S3_CONFIDENTIAL_LEAK}").matched, true);
    // Whitespace tolerance
    assert.equal(evaluateTutorialQuest(5, " \t FLAG{S3_CONFIDENTIAL_LEAK} \n").matched, true);
    // Invalid flag rejection
    assert.equal(evaluateTutorialQuest(5, "FLAG{wrong_s3_flag}").matched, false);
  });

  it("evaluates curl commands across various target IPs and flag combinations", () => {
    // Port 9000 on 172.28.0.25 (AttackerDashboard spec)
    assert.equal(isS3BucketEnumeration("curl http://172.28.0.25:9000/megacorp-backup"), true);
    // Port 9000 on 172.28.0.15 (ch3-missions.json spec)
    assert.equal(isS3BucketEnumeration("curl http://172.28.0.15:9000/megacorp-backup"), true);
    // Port 9000 on 172.28.0.20 (scenario-state spec)
    assert.equal(isS3BucketEnumeration("curl http://172.28.0.20:9000/megacorp-backup"), true);
    // Domain endpoint
    assert.equal(isS3BucketEnumeration("curl http://backup-s3.megacorp.internal:9000/megacorp-backup"), true);
    // Direct config.env file download
    assert.equal(isS3BucketEnumeration("curl -s http://172.28.0.25:9000/megacorp-backup/config.env"), true);
    // curl flags: -v, -I, -sSL, -X GET
    assert.equal(isS3BucketEnumeration("curl -v http://172.28.0.15:9000/megacorp-backup"), true);
    assert.equal(isS3BucketEnumeration("curl -I http://172.28.0.25:9000/megacorp-backup"), true);
    assert.equal(isS3BucketEnumeration("curl -sSL http://172.28.0.20:9000/megacorp-backup/config.env"), true);
    assert.equal(isS3BucketEnumeration("curl -X GET http://172.28.0.25:9000/megacorp-backup"), true);
    // Missing http protocol prefix
    assert.equal(isS3BucketEnumeration("curl 172.28.0.25:9000/megacorp-backup"), true);
  });

  it("evaluates aws s3, minio mc, and s3cmd CLI commands", () => {
    // aws cli ls
    assert.equal(isS3BucketEnumeration("aws --endpoint-url=http://172.28.0.25:9000 s3 ls s3://megacorp-backup"), true);
    // aws cli cp to stdout
    assert.equal(isS3BucketEnumeration("aws --endpoint-url http://172.28.0.25:9000 s3 cp s3://megacorp-backup/config.env -"), true);
    // aws cli sync
    assert.equal(isS3BucketEnumeration("aws --endpoint-url=http://172.28.0.15:9000 s3 sync s3://megacorp-backup ./loot"), true);
    // mc (MinIO client)
    assert.equal(isS3BucketEnumeration("mc ls local/megacorp-backup"), true);
    // s3cmd
    assert.equal(isS3BucketEnumeration("s3cmd --host=172.28.0.25:9000 ls s3://megacorp-backup"), true);
  });

  it("evaluates S3 XML directory listing and config.env terminal output", () => {
    const s3XmlOutput = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>megacorp-backup</Name>
  <Prefix></Prefix>
  <Contents>
    <Key>config.env</Key>
    <Size>342</Size>
  </Contents>
  <Contents>
    <Key>db_passwords.txt</Key>
    <Size>128</Size>
  </Contents>
</ListBucketResult>`;
    assert.equal(isS3BucketEnumeration("", s3XmlOutput), true);

    const envContents = `DB_HOST=172.28.0.30
DB_USER=sa
DB_PASSWORD=Password123!
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin`;
    assert.equal(isS3BucketEnumeration("", envContents), true);

    const awsTrace = "download: s3://megacorp-backup/config.env to -";
    assert.equal(isS3BucketEnumeration("", awsTrace), true);
  });

  it("rejects non-matching or unrelated commands for Quest 5", () => {
    assert.equal(isS3BucketEnumeration("curl http://172.28.0.15:8080/index.php"), false);
    assert.equal(isS3BucketEnumeration("whois megacorp.internal"), false);
    assert.equal(isS3BucketEnumeration("aws s3 ls s3://unrelated-corp-public"), false);
    assert.equal(isS3BucketEnumeration("ls -la /tmp"), false);
  });

  it("evaluateS3Bucket returns formatted EvaluationResult with defender alert", () => {
    const res = evaluateS3Bucket("curl http://172.28.0.25:9000/megacorp-backup", "config.env\ndb_passwords.txt");
    assert.equal(res.matched, true);
    assert.equal(res.flagUnlocked, "FLAG{S3_CONFIDENTIAL_LEAK}");
    assert.ok(res.defenderAlert);
    assert.equal(res.defenderAlert?.severity, "high");
    assert.match(res.message, /S3 퍼블릭 버킷 노출 및 config\.env 획득 성공/);
  });
});

describe("Quest 6: Custom Ruby Scanner (banner.rb / custom_tcp_banner.rb) Edge Cases", () => {
  it("evaluates manual flag submissions with primary flag and aliases (case-insensitive)", () => {
    // Primary flag
    assert.equal(evaluateTutorialQuest(6, "FLAG{CUSTOM_RUBY_BANNER_GRABBED}").matched, true);
    // Lowercase
    assert.equal(evaluateTutorialQuest(6, "flag{custom_ruby_banner_grabbed}").matched, true);
    // ch3-missions.json flag alias
    assert.equal(evaluateTutorialQuest(6, "FLAG{custom_ruby_tcp_scanner_executed_successfully}").matched, true);
    // scenario-state flag alias
    assert.equal(evaluateTutorialQuest(6, "FLAG{custom_scanner_ruby_win}").matched, true);
    // Lookup by string ID
    assert.equal(evaluateTutorialQuest("m6-custom-scanner", "FLAG{CUSTOM_RUBY_BANNER_GRABBED}").matched, true);
    assert.equal(evaluateTutorialQuest("custom-scanner-ruby-12", "FLAG{CUSTOM_RUBY_BANNER_GRABBED}").matched, true);
    // Whitespace tolerance
    assert.equal(evaluateTutorialQuest(6, "  FLAG{CUSTOM_RUBY_BANNER_GRABBED}  \r\n").matched, true);
    // Invalid flag rejection
    assert.equal(evaluateTutorialQuest(6, "FLAG{wrong_ruby_flag}").matched, false);
  });

  it("evaluates file creation and writing of custom_tcp_banner.rb and banner.rb", () => {
    // cat heredoc writing banner.rb
    const catCmd1 = `cat << 'EOF' > banner.rb
require 'msf/core'
class MetasploitModule < Msf::Auxiliary
  include Msf::Auxiliary::Scanner
  include Msf::Exploit::Remote::Tcp
  def run_host(ip)
    connect
    banner = sock.get_once(-1, 5)
    print_good("[#{ip}:#{rport}] - Banner: #{banner}")
  end
end
EOF`;
    assert.equal(isCustomRubyScanner(catCmd1), true);

    // cat heredoc writing to custom_tcp_banner.rb in msf modules dir
    const catCmd2 = `cat << EOF > ~/.msf4/modules/auxiliary/scanner/custom/custom_tcp_banner.rb
require 'msf/core'
class MetasploitModule < Msf::Auxiliary
  include Msf::Auxiliary::Scanner
  include Msf::Exploit::Remote::Tcp
EOF`;
    assert.equal(isCustomRubyScanner(catCmd2), true);

    // echo to file
    assert.equal(isCustomRubyScanner("echo 'require \"msf/core\"' > custom_tcp_banner.rb"), true);

    // cp template to banner.rb
    assert.equal(isCustomRubyScanner("cp scenarios/custom-scanner-template.rb banner.rb"), true);

    // editor commands
    assert.equal(isCustomRubyScanner("nano banner.rb", "", "require 'msf/core'\nMsf::Auxiliary::Scanner"), true);
    assert.equal(isCustomRubyScanner("vim custom_tcp_banner.rb", "", "Msf::Exploit::Remote::Tcp\nsock.get_once"), true);
  });

  it("evaluates CLI execution of banner.rb and custom_tcp_banner.rb", () => {
    // ruby CLI with args
    assert.equal(isCustomRubyScanner("ruby banner.rb 172.28.0.20 21"), true);
    // ruby CLI without args
    assert.equal(isCustomRubyScanner("ruby custom_tcp_banner.rb"), true);
    // ruby CLI with relative path
    assert.equal(isCustomRubyScanner("ruby ./scenarios/banner.rb 172.28.0.20"), true);
    // msfconsole module load and run
    assert.equal(isCustomRubyScanner("msfconsole -m scenarios/modules -x 'use auxiliary/scanner/custom_tcp_banner; run'"), true);
    // msfconsole reload_all and run
    assert.equal(isCustomRubyScanner("reload_all; use auxiliary/scanner/custom/custom_tcp_banner; set RHOSTS 172.28.0.20; run"), true);
    // Shorthand use auxiliary/scanner/banner
    assert.equal(isCustomRubyScanner("use auxiliary/scanner/banner\nrun"), true);
  });

  it("evaluates terminal banner grab stdout outputs", () => {
    // Metasploitable2 vsftpd 2.3.4 FTP banner
    const out1 = "[+] [172.28.0.20:21] - Banner: 220 (vsFTPd 2.3.4)";
    assert.equal(isCustomRubyScanner("", out1), true);

    const out2 = "[+] 172.28.0.20:21 - Received banner: 220 (vsFTPd 2.3.4)";
    assert.equal(isCustomRubyScanner("", out2), true);

    const out3 = "BANNER: 172.28.0.20:21 -> 220 (vsFTPd 2.3.4)";
    assert.equal(isCustomRubyScanner("", out3), true);

    const out4 = "[*] Executing custom_tcp_banner against 172.28.0.20...\n[+] 220 (vsFTPd 2.3.4)";
    assert.equal(isCustomRubyScanner("", out4), true);
  });

  it("rejects non-matching or unrelated commands for Quest 6", () => {
    assert.equal(isCustomRubyScanner("cat banner.txt"), false);
    assert.equal(isCustomRubyScanner("ruby test_hello.rb"), false);
    assert.equal(isCustomRubyScanner("nmap -sV 172.28.0.20"), false);
    assert.equal(isCustomRubyScanner("echo 'hello world' > script.sh"), false);
  });

  it("evaluateCustomRubyScanner returns formatted EvaluationResult with defender alert", () => {
    const res = evaluateCustomRubyScanner("ruby banner.rb 172.28.0.20 21", "[+] [172.28.0.20:21] - Banner: 220 (vsFTPd 2.3.4)");
    assert.equal(res.matched, true);
    assert.equal(res.flagUnlocked, "FLAG{CUSTOM_RUBY_BANNER_GRABBED}");
    assert.ok(res.defenderAlert);
    assert.equal(res.defenderAlert?.severity, "critical");
    assert.match(res.message, /커스텀 루비 배너 스캐너/);
  });
});

describe("ScenarioState: Sequential & Automated Progression for Quests 4~6", () => {
  it("progresses sequentially from Quest 1 to Quest 6", () => {
    const state = new ScenarioState();
    let snapshot = state.getState();

    // Initial state: Quest 1 active, Quests 2-6 locked
    assert.equal(snapshot.quests[0].status, "active");
    assert.equal(snapshot.quests[1].status, "locked");
    assert.equal(snapshot.quests[3].status, "locked");

    // Complete Quest 1 (Whois)
    const r1 = state.submitFlag("FLAG{whois_recon_success}");
    assert.equal(r1.success, true);
    snapshot = state.getState();
    assert.equal(snapshot.quests[0].status, "completed");
    assert.equal(snapshot.quests[1].status, "active");

    // Complete Quest 2 (AXFR)
    const r2 = state.submitFlag("FLAG{axfr_zone_transferred}");
    assert.equal(r2.success, true);
    snapshot = state.getState();
    assert.equal(snapshot.quests[1].status, "completed");
    assert.equal(snapshot.quests[2].status, "active");

    // Complete Quest 3 (Nmap)
    const r3 = state.submitFlag("FLAG{syn_scan_detected}");
    assert.equal(r3.success, true);
    snapshot = state.getState();
    assert.equal(snapshot.quests[2].status, "completed");
    assert.equal(snapshot.quests[3].status, "active"); // Quest 4 MSSQL is now active!

    // Complete Quest 4 (MSSQL) with alias
    const r4 = state.submitFlag("FLAG{MSSQL_SA_PWNED}");
    assert.equal(r4.success, true);
    assert.equal(r4.pointsAwarded, 200);
    snapshot = state.getState();
    assert.equal(snapshot.quests[3].status, "completed");
    assert.equal(snapshot.quests[4].status, "active"); // Quest 5 S3 is now active!

    // Complete Quest 5 (S3) with alias
    const r5 = state.submitFlag("FLAG{S3_CONFIDENTIAL_LEAK}");
    assert.equal(r5.success, true);
    assert.equal(r5.pointsAwarded, 200);
    snapshot = state.getState();
    assert.equal(snapshot.quests[4].status, "completed");
    assert.equal(snapshot.quests[5].status, "active"); // Quest 6 Custom Scanner is active!

    // Complete Quest 6 (Custom Scanner)
    const r6 = state.submitFlag("FLAG{CUSTOM_RUBY_BANNER_GRABBED}");
    assert.equal(r6.success, true);
    assert.equal(r6.pointsAwarded, 250);
    snapshot = state.getState();
    assert.equal(snapshot.completedQuests, 6);
    assert.equal(snapshot.scores.attacker, 100 + 150 + 150 + 200 + 200 + 250);
  });

  it("automatically scores Quests 4~6 via evaluateCommand without manual flag entry", () => {
    const state = new ScenarioState();
    // Fast-forward quests 1-3
    state.submitFlag("FLAG{whois_recon_success}");
    state.submitFlag("FLAG{axfr_zone_transferred}");
    state.submitFlag("FLAG{syn_scan_detected}");

    // Auto-evaluate Quest 4 via terminal output
    const evalMssql = state.evaluateCommand(
      "use auxiliary/scanner/mssql/mssql_login\nset RHOSTS 172.28.0.30\nrun",
      "[*] 172.28.0.30:1433 - Starting MSSQL login brute-force...\n[+] 172.28.0.30:1433 - MSSQL - Login Successful: sa:Password123!"
    );
    assert.equal(evalMssql.matched, true);
    assert.equal(evalMssql.quest?.id, "quest-mssql-login");
    assert.equal(evalMssql.pointsAwarded, 200);

    // Auto-evaluate Quest 5 via curl command
    const evalS3 = state.evaluateCommand(
      "curl http://172.28.0.25:9000/megacorp-backup",
      "DB_HOST=172.28.0.30\nDB_PASS=Password123!\nAWS_ACCESS_KEY_ID=minioadmin"
    );
    assert.equal(evalS3.matched, true);
    assert.equal(evalS3.quest?.id, "quest-s3");
    assert.equal(evalS3.pointsAwarded, 200);

    // Auto-evaluate Quest 6 via ruby banner script output
    const evalRuby = state.evaluateCommand(
      "ruby banner.rb 172.28.0.20 21",
      "[+] [172.28.0.20:21] - Banner: 220 (vsFTPd 2.3.4)"
    );
    assert.equal(evalRuby.matched, true);
    assert.equal(evalRuby.quest?.id, "quest-custom-scanner");
    assert.equal(evalRuby.pointsAwarded, 250);

    const finalState = state.getState();
    assert.equal(finalState.completedQuests, 6);
  });

  it("rejects duplicate submissions with appropriate alreadyCompleted flag", () => {
    const state = new ScenarioState();
    state.submitFlag("FLAG{whois_recon_success}");

    // First attempt succeeds
    const first = state.submitFlag("FLAG{whois_recon_success}");
    assert.equal(first.success, false);
    assert.match(first.message, /이미 완료된/);

    // evaluateCommand on already completed quest
    const evalDupe = state.evaluateCommand("whois -h 172.28.0.15 megacorp.internal", "FLAG{whois_recon_success}");
    assert.equal(evalDupe.alreadyCompleted, true);
  });

  it("getQuest resolves by order number, primary ID, and alias IDs", () => {
    const state = new ScenarioState();

    // By order number
    assert.equal(state.getQuest(4)?.id, "quest-mssql-login");
    assert.equal(state.getQuest(5)?.id, "quest-s3");
    assert.equal(state.getQuest(6)?.id, "quest-custom-scanner");

    // By legacy / alias ID
    assert.equal(state.getQuest("quest-msf-services")?.id, "quest-mssql-login");
    assert.equal(state.getQuest("m4-mssql-login")?.id, "quest-mssql-login");
    assert.equal(state.getQuest("service-mssql-ping-07")?.id, "quest-mssql-login");
    assert.equal(state.getQuest("m5-s3-leak")?.id, "quest-s3");
    assert.equal(state.getQuest("m6-custom-scanner")?.id, "quest-custom-scanner");
  });
});

describe("REST API Integration: /api/missions/evaluate & /api/scenario/evaluate", async () => {
  let app: GatewayApp;
  let port: number;
  let baseUrl: string;

  test("Server Startup for REST API Tests", async () => {
    app = new GatewayApp({ port: 0, hostIp: "127.0.0.1", sshPort: 0 });
    port = await app.listen(0, "127.0.0.1", 0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  test("POST /api/missions/evaluate: Quest 4 MSSQL command evaluation", async () => {
    const res = await fetch(`${baseUrl}/api/missions/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        missionId: "m4-mssql-login",
        command: "use auxiliary/scanner/mssql/mssql_login\nset RHOSTS 172.28.0.30\nrun",
        stdout: "[+] 172.28.0.30:1433 - Login Successful: sa:Password123!",
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.matched, true);
    assert.equal(data.flagUnlocked, "FLAG{MSSQL_SA_PWNED}");
  });

  test("POST /api/missions/evaluate: Quest 5 S3 curl evaluation", async () => {
    const res = await fetch(`${baseUrl}/api/missions/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        missionId: "m5-s3-leak",
        command: "curl -s http://172.28.0.25:9000/megacorp-backup/config.env",
        stdout: "AWS_ACCESS_KEY_ID=minioadmin\nDB_PASS=Password123!",
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.matched, true);
    assert.equal(data.flagUnlocked, "FLAG{S3_CONFIDENTIAL_LEAK}");
  });

  test("POST /api/missions/evaluate: Quest 6 Custom Ruby scanner evaluation", async () => {
    const res = await fetch(`${baseUrl}/api/missions/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        missionId: "m6-custom-scanner",
        command: "ruby banner.rb 172.28.0.20 21",
        stdout: "[+] [172.28.0.20:21] - Banner: 220 (vsFTPd 2.3.4)",
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.matched, true);
    assert.equal(data.flagUnlocked, "FLAG{CUSTOM_RUBY_BANNER_GRABBED}");
  });

  test("POST /api/scenario/evaluate: Automatic evaluation and scenario state update", async () => {
    // Fast forward to quest 4
    await fetch(`${baseUrl}/api/scenario/flag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag: "FLAG{whois_recon_success}" }),
    });
    await fetch(`${baseUrl}/api/scenario/flag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag: "FLAG{axfr_zone_transferred}" }),
    });
    await fetch(`${baseUrl}/api/scenario/flag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag: "FLAG{syn_scan_detected}" }),
    });

    // Auto evaluate Quest 4
    const res = await fetch(`${baseUrl}/api/scenario/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "sqsh -S 172.28.0.30 -U sa -P Password123!",
        stdout: "Microsoft SQL Server 2019",
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.matched, true);
    assert.equal(data.quest?.id, "quest-mssql-login");

    // Verify scenario snapshot
    const stateRes = await fetch(`${baseUrl}/api/scenario`);
    const state = await stateRes.json();
    assert.equal(state.completedQuests, 4);
    assert.equal(state.quests[3].status, "completed");
    assert.equal(state.quests[4].status, "active"); // Next quest unlocked!
  });

  test("Server Teardown", async () => {
    await app.close();
  });
});
