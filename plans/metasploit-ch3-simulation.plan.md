---
plan: metasploit-ch3-simulation
status: approved
risk: medium
owner: neohum
project: security
created: 2026-11-02
---

# Plan: 메타스플로잇 2/e 3장 인텔리전스 수집 인터랙티브 시뮬레이션 게임 구축 (Windows 호스트 & LAN 다중 접속 협업 랩)

## Intent

『메타스플로잇 Metasploit, 2/e - 침투 테스트 실전 가이드』 3장 "인텔리전스 수집"의 전 과정(수동 정보 수집: 후이즈·넷크래프트·DNS 분석, 능동 정보 수집: Nmap·MSF 포트 스캔, 타깃 스캔: SMB·MSSQL·S3·SSH·FTP·SNMP, 커스텀 MSF 스캐너 제작)을 외부 인터넷 질의 없이 안전한 로컬 샌드박스에서 체험할 수 있는 인터랙티브 시뮬레이션 게임을 구축합니다.

특히 **호스트 PC로 Windows 10/11(Docker Desktop WSL2)** 1대를 중앙 서버로 지정하고, 동일 Wi-Fi 네트워크에 연결된 여러 대의 컴퓨터(Mac, Linux, Windows 노트북)가 별도 설치 없이 웹 브라우저(`http://{호스트IP}:3000`) 또는 SSH로 접속하여 **공격자(Attacker)**, **방어자(Defender)**, **관제/참관(Observer)** 역할을 실시간으로 분담 수행하는 LAN 협업 훈련 환경을 완성합니다. 윈도우 방화벽 인바운드 자동 등록, Wi-Fi IP 자동 감지, 역할별 전용 뷰 분기 및 실시간 패킷 동기화를 단일 원클릭 런처(`run-host.ps1`)로 제공합니다.

## Non-goals

- 실제 공용 인터넷(외부 Whois 레지스트리, 실제 Netcraft 도메인, 외부 AWS S3 등)으로의 실제 패킷 전송 (100% 로컬 샌드박스 격리)
- 도서 3장 범위 외의 침투 익스플로잇(4장 이후의 취약점 공격 및 페이로드 셸 획득)으로의 과도한 범위 확장
- 상용 SIEM/유료 침입탐지 소프트웨어 의존성 추가 (오픈소스 경량 도구로 자립 완결)
- 참가자 컴퓨터(클라이언트)마다 Docker Desktop을 강제 설치시키는 분산 배포 방식 배제 (호스트 1대 집중형 Zero-Setup 채택)

## Sketch of the file layout

- `docker-compose.sim.yaml`: 기존 `lab/lab/compose.yaml`을 상속/확장하여 윈도우 호스트의 `0.0.0.0:3000`(웹) 및 `0.0.0.0:2222`(SSH) 포트로 외부 바인딩하는 오버레이 컴포즈 파일
- `docker/fake-recon/`: 페이크 Whois(포트 43), 페이크 Netcraft 웹(포트 8080), 페이크 DNS(포트 53 AXFR) 컨테이너 정의
- `docker/fake-s3/`: MinIO 기반의 모의 AWS 공개 S3 버킷 환경 설정
- `server/index.ts`: Express + WebSocket 서버 (LAN 호스트 바인딩, 역할 기반 세션 분기, xterm.js PTY 브릿지)
- `server/lan-manager.ts`: 윈도우 로컬 IP 감지, 다중 클라이언트 역할(`attacker`, `defender`, `observer`) 세션 라우팅
- `server/traffic-monitor.ts`: 가상 브릿지(172.28.0.0/16) SYN 패킷 및 포트 접근 이벤트 실시간 캡처 및 브로드캐스팅
- `client/src/App.tsx`: 2×2 그리드 전체 뷰 및 단일 역할 전용 뷰(`?role=attacker|defender|observer`) 라우팅
- `client/src/components/AttackerDashboard.tsx`: 공격자 관점 (Kali xterm.js 터미널, 정찰 토폴로지 레이더, 퀘스트 목록)
- `client/src/components/DefenderDashboard.tsx`: 방어자 관점 (실시간 IDS 패킷 알림 로그, 방어자 터미널, 실습 튜토리얼)
- `client/src/components/TwinTerminal.tsx`: 트윈 xterm.js 터미널 분할 렌더러
- `scenarios/ch3-missions.json`: 3장 목차별 공격/방어 퀘스트, 명령어 가이드, 플래그 검증 로직
- `run-host.ps1`: Windows 호스트 전용 원클릭 런처 (방화벽 포트 등록, Wi-Fi IP 감지, 도커 기동, 역할별 URL 콘솔 안내)
- `docs/lan-client-guide.md`: 맥/리눅스/윈도우 클라이언트 참가자 접속 매뉴얼 (브라우저 접속 및 선택적 SSH 접속 안내)

## Steps

### Step 1: sim-mock-infrastructure
- Goal: 기존 `lab/lab` 컨테이너(kalibox, metasploitable2, vuln-mssql)와 연동되는 페이크 인텔리전스 인프라(Fake Whois, Fake Netcraft, Fake DNS with AXFR, Fake AWS S3 MinIO)를 구축하고 윈도우 호스트 바인딩 준비
- Files: docker-compose.sim.yaml, docker/fake-recon/Dockerfile, docker/fake-recon/server.js, docker/fake-recon/named.conf, docker/fake-s3/init-buckets.sh, tests/sim-infra.test.ts
- Acceptance: AC-1: `docker-compose.sim.yaml`이 `lab/lab/compose.yaml`을 오버레이하여 모든 컨테이너가 172.28.0.0/16 서브넷에서 정상 기동됨
- Acceptance: AC-2: kalibox 컨테이너에서 `whois -h 172.28.0.15 megacorp.internal` 질의 시 가상 기업 등록 데이터가 정상 반환됨
- Acceptance: AC-3: `dig axfr @172.28.0.15 megacorp.internal` 질의 시 모의 서브도메인 목록(db-mssql, backup-s3 등)이 모두 노출되는 Zone Transfer 취약점이 재현됨
- Acceptance: AC-4: Fake S3에 `megacorp-backup` 공개 버킷 및 기밀 데이터(`config.env`, `db_passwords.txt`)가 초기 적재됨
- Tests: node --import tsx --test tests/sim-infra.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 2: sim-backend-gateway
- Goal: 공격자(kalibox)와 방어자(metasploitable2/ids) 컨테이너에 각각 연결되는 Web PTY 웹소켓 서버를 구축하고, 같은 Wi-Fi 대역 다중 클라이언트 접속을 지원하는 LAN 세션 게이트웨이 구현
- Files: server/index.ts, server/lan-manager.ts, server/pty-manager.ts, server/traffic-monitor.ts, server/scenario-state.ts, tests/server-gateway.test.ts
- Depends on: sim-mock-infrastructure
- Acceptance: AC-1: WebSocket 엔드포인트 `/ws/terminal/attacker` 및 `/ws/terminal/defender`를 통해 각 도커 컨테이너의 TTY 세션이 지연 없이 외부 Wi-Fi 클라이언트와 양방향 통신함
- Acceptance: AC-2: 가상 네트워크 브릿지에서 발생하는 SYN 패킷 및 포트 접근 이벤트가 감지되어 `/ws/events` 채널로 실시간 JSON 스트리밍됨
- Acceptance: AC-3: 세션별 시나리오 퀘스트 진행 상태 및 플래그 획득 여부를 메모리/SQLite에 안전하게 저장 및 동기화함
- Acceptance: AC-4: 외부 클라이언트(맥, 리눅스, 다른 윈도우 PC)가 자신의 터미널을 선호할 경우를 위한 컨테이너 SSH 포트(`0.0.0.0:2222`) 바인딩 인터페이스를 지원함
- Tests: node --import tsx --test tests/server-gateway.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 3: sim-frontend-grid
- Goal: `https://april-zhu.com/colorfigures` 스타일의 미니멀 다크 모드 2×2 그리드 SPA 웹 UI를 구축하고, URL 역할 파라미터(`role=attacker|defender|observer`)에 따라 맞춤형 뷰를 렌더링하는 다중 클라이언트 인터페이스 구현
- Files: client/index.html, client/src/App.tsx, client/src/components/AttackerDashboard.tsx, client/src/components/DefenderDashboard.tsx, client/src/components/TwinTerminal.tsx, client/src/components/TopologyRadar.tsx, tests/frontend-components.test.ts
- Depends on: sim-backend-gateway
- Acceptance: AC-1: 기본 화면은 2×2 그리드(공격 대시보드+터미널, 방어 대시보드+터미널)로 렌더링되며 스플릿 리사이저가 정상 작동함
- Acceptance: AC-2: `?role=attacker` 접속 시 공격자 전용 풀스크린 뷰(Kali 터미널 + 토폴로지 레이더 + 공격 퀘스트)로 최적화 렌더링됨
- Acceptance: AC-3: `?role=defender` 접속 시 방어자 전용 풀스크린 뷰(실시간 IDS 패킷 감시창 + 방어 터미널 + 튜토리얼 가이드)로 최적화 렌더링됨
- Acceptance: AC-4: `DESIGN.md` 규격 준수 (한국어 줄바꿈 `break-keep`, `text-balance`, 버튼 및 배지 완벽 중앙 정렬, 비대칭 테두리 배제)
- Tests: node --import tsx --test tests/frontend-components.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 4: sim-scenario-engine
- Goal: 도서 3장 목차(수동 수집, 능동 Nmap/MSF 포트 스캔, 타깃 스캔 6종, 커스텀 루비 스캐너, 결과 리포트)를 60분 코스 상호작용 퀘스트로 데이터베이스화하고 자동 채점 및 방어자 가이드 제공
- Files: scenarios/ch3-missions.json, scenarios/custom-scanner-template.rb, server/mission-evaluator.ts, tests/scenario-missions.test.ts
- Depends on: sim-frontend-grid
- Acceptance: AC-1: 수동 정보 수집 단계에서 Whois, Netcraft, DNS Zone Transfer 실습이 순차 언락되며 올바른 산출물 획득 시 다음 퀘스트가 활성화됨
- Acceptance: AC-2: 능동 및 타깃 스캔(SMB, MSSQL, S3, SSH, FTP, SNMP)에서 MSF 모듈 실행 및 결과 취약점 발견 시 토폴로지 맵에 실시간으로 서비스 아이콘과 플래그가 언락됨
- Acceptance: AC-3: 교재의 커스텀 루비 스캐너 모듈 템플릿(`custom_tcp_banner.rb`)이 제공되며 모듈 구동 성공 시 커스텀 배너 정보가 등록됨
- Acceptance: AC-4: 공격자가 스캔 명령을 실행할 때 방어자 화면에 즉시 탐지 알림과 함께 해당 공격에 대한 원리 및 방어 패치 명령어가 연동 표시됨
- Tests: node --import tsx --test tests/scenario-missions.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 5: sim-host-bootstrap
- Goal: Windows 호스트 PC 환경에서 실행할 원클릭 기동 스크립트(`run-host.ps1`)를 구축하여 방화벽 포트 자동 확인/등록, Wi-Fi IP 감지, 도커 기동 및 참여자 접속 URL 콘솔 안내를 완결함
- Files: run-host.ps1, cleanup-host.ps1, docs/lan-client-guide.md, README.md, tests/launcher-syntax.test.ts
- Depends on: sim-scenario-engine
- Acceptance: AC-1: `run-host.ps1` 실행 시 Wi-Fi 네트워크 어댑터의 IPv4 주소를 자동으로 추출하고 포트 3000 및 2222의 Windows Defender 방화벽 인바운드 허용 상태를 점검함 (미등록 시 관리자 권한으로 자동 등록 유도)
- Acceptance: AC-2: Docker Desktop 가용성을 확인하고 `docker-compose -f docker-compose.sim.yaml up -d`를 일괄 실행하여 모든 서비스가 준비 상태가 되도록 제어함
- Acceptance: AC-3: 콘솔 화면에 공격자(`http://{IP}:3000/?role=attacker`), 방어자(`http://{IP}:3000/?role=defender`), 관제자(`http://{IP}:3000/?role=observer`) 접속 URL을 명확하게 박스 형태로 출력함
- Acceptance: AC-4: `docs/lan-client-guide.md`에 맥북, 리눅스, 윈도우 참가자가 와이파이에 연결하여 브라우저로 참여하는 상세 가이드가 한국어로 수록됨
- Tests: node --import tsx --test tests/launcher-syntax.test.ts
- Risk: low
- Complexity: low
- Agent: codex
- Reviewer: claude

## Verification
- Tier 1: `npx tsx scripts/loop/plan-doc.ts check metasploit-ch3-simulation` 유효성 검사 100% 통과
- Tier 2: `node --import tsx --test tests/*.test.ts` (인프라 구성, 게이트웨이 WebSocket, 역할별 라우터 단위 테스트 통과)
- Tier 3: 윈도우 호스트에서 `.\run-host.ps1` 모의 실행 및 로컬 IP 바인딩, 브라우저 다중 탭(attacker, defender) 동시 접속 상호작용 검증

## Reviewer topology
builder=codex, reviewer=claude, challenge=on
