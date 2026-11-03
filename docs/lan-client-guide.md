# LAN 다중 클라이언트 접속 및 협업 훈련 가이드 (Mac · Linux · Windows)

> 본 문서는 **Windows 호스트 PC**에서 구동되는 『메타스플로잇 2/e 3장 인텔리전스 수집』인터랙티브 시뮬레이션 환경에 동일 Wi-Fi(또는 사내 LAN) 네트워크로 연결된 다른 장비들이 원클릭으로 접속하여 협업하는 방법을 안내합니다.
> 클라이언트 장비에는 **Docker나 별도의 침투 도구를 설치할 필요가 없습니다.** 브라우저만 있으면 즉시 공격자, 방어자, 관제자 역할을 수행할 수 있습니다.

---

## 1. 사전 준비 (Prerequisites)

1. **동일 Wi-Fi / LAN 네트워크 접속**:
   - 호스트 PC(Windows)와 참가자 노트북(MacBook, Ubuntu, 다른 Windows 노트북 등)이 **동일한 Wi-Fi 공유기(AP)** 에 연결되어 있어야 합니다.
2. **호스트 IPv4 주소 확인**:
   - 호스트 PC의 터미널에서 `.\run-host.ps1`을 실행하면 다음과 같은 화면 배너와 함께 호스트 IP(예: `192.168.0.50`)가 자동 출력됩니다.

```text
+----------------------------------------------------------------------+
|   Metasploit 2/e Ch.3 Intelligence Gathering Simulation Lab Ready   |
+----------------------------------------------------------------------+
|  동일 Wi-Fi / 네트워크에 연결된 모든 장비(Mac, Linux, Win)에서 접속  |
+----------------------------------------------------------------------+

  [1] 공격자 대시보드 (Attacker Console):
      http://192.168.0.50:3000/?role=attacker
  [2] 방어자 대시보드 (Defender Console):
      http://192.168.0.50:3000/?role=defender
  [3] 통합 참관 대시보드 (Observer 2x2 Grid):
      http://192.168.0.50:3000/?role=observer
  [4] 외부 SSH 직접 터미널 접속:
      ssh -p 2222 attacker@192.168.0.50
```

---

## 2. 웹 브라우저 접속 (Zero-Setup 협업)

참가자 노트북의 웹 브라우저(Chrome, Safari, Edge 등)를 열고 배정된 역할에 따라 URL을 입력합니다.

### A. 공격자 (Attacker)
- **접속 URL**: `http://{호스트IP}:3000/?role=attacker`
- **화면 구성**:
  - **Kali Linux Web PTY 터미널**: 브라우저 내에서 바로 `msfconsole`, `nmap`, `whois`, `dig` 등의 명령어를 실행할 수 있는 고성능 xterm.js 터미널.
  - **정찰 토폴로지 레이더**: 수집된 서비스(Whois, DNS, SMB, MSSQL, S3 등)가 실시간 노드로 시각화되는 반응형 그래프.
  - **3장 퀘스트 보드**: 12단계 실습 퀘스트, 명령어 힌트, 플래그 제출 인터페이스.

### B. 방어자 (Defender)
- **접속 URL**: `http://{호스트IP}:3000/?role=defender`
- **화면 구성**:
  - **실시간 IDS 트래픽 감시창**: 공격자가 전송하는 SYN 스캔, DNS 질의, SMB 프로토콜 협상 패킷이 초단위로 캡처되어 경보 출력.
  - **공격 원리 & 보안 패치 가이드**: 각 공격에 대응하는 BIND DNS 잠금, Apache 헤더 은닉, iptables 포트스캔 차단, S3 퍼블릭 차단 가이드 제공.
  - **방어자 터미널**: 방어 서버의 설정 파일을 수정하고 서비스를 재시작할 수 있는 관리자 셸.

### C. 참관 및 관제 (Observer)
- **접속 URL**: `http://{호스트IP}:3000/?role=observer` 또는 `http://{호스트IP}:3000/`
- **화면 구성**:
  - **2×2 그리드 화면**: 공격자 화면과 방어자 화면을 한눈에 나란히 배치하여 훈련 진행 상황을 실시간 모니터링.

---

## 3. 네이티브 터미널 선호자를 위한 SSH 접속 가이드

브라우저 PTY 대신 자신의 로컬 터미널(macOS Terminal, iTerm2, Linux Bash, Windows Terminal)을 선호하는 공격자 참가자는 호스트의 2222번 포트로 직접 SSH 접속할 수 있습니다.

### macOS & Linux
```bash
# 호스트 IP가 192.168.0.50인 경우
ssh -p 2222 attacker@192.168.0.50

# 기본 비밀번호: security123! (또는 kali)
```

### Windows (PowerShell / Windows Terminal)
```powershell
ssh -p 2222 attacker@192.168.0.50
```

접속 후 즉시 Kali Linux 컨테이너 환경(`172.28.0.10`)의 셸로 진입하며, `msfconsole`을 입력하여 교재 3장 실습을 바로 진행할 수 있습니다.

---

## 4. 메타스플로잇 2/e 3장 실습 퀘스트 요약

| 순번 | 단계 | 모듈 및 명령어 예시 | 타깃 호스트 |
| :--- | :--- | :--- | :--- |
| **01** | Whois 질의 | `whois -h 172.28.0.15 megacorp.internal` | Fake Whois (172.28.0.15) |
| **02** | HTTP 헤더 조사 | `curl -I http://172.28.0.15:8080` | Web Server (172.28.0.15:8080) |
| **03** | DNS Zone Transfer | `dig axfr @172.28.0.15 megacorp.internal` | DNS Server (172.28.0.15:53) |
| **04** | Nmap SYN 스캔 | `nmap -sS -Pn 172.28.0.20` | Target Linux (172.28.0.20) |
| **05** | MSF 포트스캔 | `auxiliary/scanner/portscan/tcp` | Target Linux (172.28.0.20) |
| **06** | SMB 버전 탐색 | `auxiliary/scanner/smb/smb_version` | Target Linux (172.28.0.20:445) |
| **07** | MSSQL 핑 조사 | `auxiliary/scanner/mssql/mssql_ping` | Target SQL (172.28.0.30:1433) |
| **08** | S3 오픈버킷 탐색 | `curl http://172.28.0.15:9000/megacorp-backup` | Fake S3 (172.28.0.15:9000) |
| **09** | SSH 버전 탐색 | `auxiliary/scanner/ssh/ssh_version` | Target Linux (172.28.0.20:22) |
| **10** | FTP 버전 탐색 | `auxiliary/scanner/ftp/ftp_version` | Target Linux (172.28.0.20:21) |
| **11** | SNMP 정보 열거 | `auxiliary/scanner/snmp/snmp_enum` | Target Linux (172.28.0.20:161) |
| **12** | 커스텀 루비 스캐너 | `auxiliary/scanner/custom/custom_tcp_banner` | All Targets |

---

## 5. 문제 해결 (Troubleshooting)

### Q1. 브라우저에서 `http://{호스트IP}:3000` 접속이 되지 않거나 연결 시간이 초과됩니다.
1. **Windows 방화벽 차단 확인**:
   - 호스트 PC 관리자 권한 PowerShell에서 아래 명령어를 실행하여 3000, 2222 포트가 허용되어 있는지 확인하십시오:
     ```powershell
     Get-NetFirewallRule -DisplayName "Metasploit-Sim-*"
     ```
   - 등록되어 있지 않다면 `run-host.ps1`을 관리자 권한으로 재실행하십시오.
2. **Wi-Fi 공유기 AP 격리(AP Isolation / Client Isolation) 활성화 여부**:
   - 일부 공용 카페나 기업용 Wi-Fi에서는 무선 클라이언트 간 직접 통신을 차단하는 **AP Isolation** 기능이 켜져 있을 수 있습니다.
   - 클라이언트에서 호스트로 ping 테스트를 실행하십시오:
     ```bash
     ping {호스트IP}
     ```
   - 응답이 없다면 스마트폰 모바일 핫스팟 또는 독립된 무선 공유기에 호스트와 클라이언트를 함께 연결하십시오.

### Q2. SSH 포트 2222 접속 시 `Connection Refused`가 발생합니다.
- 호스트의 Docker 컨테이너에서 SSH 데몬이 시작되었는지 확인하십시오:
  ```powershell
  docker compose -f docker-compose.sim.yaml ps
  ```
- `kalibox` 컨테이너 포트 매핑에 `0.0.0.0:2222->22`가 설정되어 있는지 점검하십시오.

### Q3. 실습을 마치고 호스트 환경을 완전히 종료하고 싶습니다.
- 호스트 PC PowerShell에서 다음 명령어를 실행하십시오:
  ```powershell
  .\cleanup-host.ps1 -RemoveFirewallRules
  ```
