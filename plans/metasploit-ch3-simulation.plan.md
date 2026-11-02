---
plan: metasploit-ch3-simulation
status: approved
risk: medium
owner: neohum
project: security
created: 2026-11-02
---

# Plan: 메타스플로잇 2/e 3장 인텔리전스 수집 인터랙티브 시뮬레이션 게임 구축

## Intent

『메타스플로잇 Metasploit, 2/e - 침투 테스트 실전 가이드』 3장 "인텔리전스 수집"의 전 과정(수동 정보 수집: 후이즈·넷크래프트·DNS 분석, 능동 정보 수집: Nmap·MSF 포트 스캔, 타깃 스캔: SMB·MSSQL·S3·SSH·FTP·SNMP, 커스텀 MSF 스캐너 제작)을 실제 외부 인터넷 질의 없이 안전한 로컬 샌드박스(페이크 인프라)에서 체험할 수 있는 1시간 코스 인터랙티브 시뮬레이션 게임을 구축합니다.  
화면은 `colorfigures` 스타일의 다크 미니멀 2×2 그리드로 구성하여, 좌측에는 공격자의 관점(토폴로지 맵 & 공격 터미널)을, 우측에는 방어자의 관점(실시간 IDS 로그 & 방어 튜토리얼 터미널)을 제공함으로써 공격과 방어의 상호작용을 한눈에 체득할 수 있도록 합니다. 기존 `lab/lab` 도커 설정을 그대로 승계하고 오버레이하여 리눅스·맥·윈도우에서 단일 명령어로 원클릭 실행되도록 패키징합니다.

## Non-goals

- 실제 공용 인터넷(외부 Whois 레지스트리, 실제 Netcraft 도메인, 외부 AWS S3 등)으로의 실제 패킷 전송 (100% 로컬 샌드박스 격리)
- 도서 3장 범위 외의 침투 익스플로잇(4장 이후의 취약점 공격 및 페이로드 셸 획득)으로의 과도한 범위 확장
- 상용 SIEM/유료 침입탐지 소프트웨어 의존성 추가 (오픈소스 경량 도구로 자립 완결)
- 특정 단일 OS에만 종속되는 GUI 래퍼 개발 (브라우저 기반 xterm.js 표준 웹 앱 채택)

## Sketch of the file layout

- `docker-compose.sim.yaml`: 기존 `lab/lab/compose.yaml`을 상속/확장하는 오버레이 컴포즈 파일
- `docker/fake-recon/`: 페이크 Whois(포트 43), 페이크 Netcraft 웹(포트 8080), 페이크 DNS(포트 53 AXFR) 컨테이너 정의
- `docker/fake-s3/`: MinIO 기반의 모의 AWS 공개 S3 버킷 환경 설정
- `server/`: Node.js Express + WebSocket 서버 (xterm.js PTY 브릿지, 시나리오 진행도 엔진, 실시간 IDS 트래픽 중계)
- `client/`: Vite 기반의 2×2 그리드 SPA 웹 UI (`DESIGN.md` 준수, colorfigures 스타일)
- `client/src/components/`: AttackerView, DefenderView, TwinTerminal, TopologyRadar
- `scenarios/ch3-missions.json`: 3장 목차별 공격/방어 퀘스트, 명령어 가이드, 플래그 검증 로직
- `run.ps1` / `run.sh`: 윈도우/맥/리눅스 원클릭 자동 빌드 및 브라우저 기동 스크립트

## Steps

### Step 1: sim-mock-infrastructure
- Goal: 기존 `lab/lab` 컨테이너(kalibox, metasploitable2, vuln-mssql)와 완벽히 연동되는 페이크 인텔리전스 인프라(Fake Whois, Fake Netcraft, Fake DNS with AXFR, Fake AWS S3 MinIO)를 오버레이 도커 구성으로 완비
- Files: docker-compose.sim.yaml, docker/fake-recon/Dockerfile, docker/fake-recon/server.js, docker/fake-recon/named.conf, docker/fake-s3/init-buckets.sh, tests/sim-infra.test.ts
- Acceptance: AC-1: `docker-compose.sim.yaml`이 `lab/lab/compose.yaml`의 기존 설정을 파괴하지 않고 오버레이하여 모든 컨테이너가 172.28.0.0/16 서브넷에서 정상 기동됨
- Acceptance: AC-2: kalibox 컨테이너에서 `whois -h 172.28.0.15 megacorp.internal` 질의 시 가상 기업 등록 데이터가 정상 반환됨
- Acceptance: AC-3: `dig axfr @172.28.0.15 megacorp.internal` 질의 시 모의 서브도메인 목록(db-mssql, backup-s3 등)이 모두 노출되는 Zone Transfer 취약점이 재현됨
- Acceptance: AC-4: Fake S3에 `megacorp-backup` 공개 버킷 및 기밀 데이터(`config.env`, `db_passwords.txt`)가 초기 적재됨
- Tests: node --import tsx --test tests/sim-infra.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 2: sim-backend-gateway
- Goal: 공격자(kalibox)와 방어자(metasploitable2/ids) 컨테이너에 각각 연결되는 Web PTY 웹소켓 서버를 구축하고, 네트워크 패킷 캡처 스트림을 브라우저에 실시간 브로드캐스팅하는 백엔드 엔진 구현
- Files: server/index.ts, server/pty-manager.ts, server/traffic-monitor.ts, server/scenario-state.ts, tests/server-gateway.test.ts
- Depends on: sim-mock-infrastructure
- Acceptance: AC-1: WebSocket 엔드포인트 `/ws/terminal/attacker` 및 `/ws/terminal/defender`를 통해 각 도커 컨테이너의 TTY 세션이 지연 없이 xterm.js 클라이언트와 양방향 통신함
- Acceptance: AC-2: 가상 네트워크 브릿지에서 발생하는 SYN 패킷 및 포트 접근 이벤트가 감지되어 `/ws/events` 채널로 실시간 JSON 스트리밍됨
- Acceptance: AC-3: 세션별 시나리오 퀘스트 진행 상태 및 플래그 획득 여부를 메모리/SQLite에 안전하게 저장 및 동기화함
- Tests: node --import tsx --test tests/server-gateway.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 3: sim-frontend-grid
- Goal: `https://april-zhu.com/colorfigures` 스타일의 미니멀 다크 모드 2×2 그리드 SPA 웹 UI를 구축하고, 상단 2칸(공격자/방어자 대시보드)과 하단 2칸(트윈 xterm.js 터미널) 연동
- Files: client/index.html, client/src/App.tsx, client/src/components/AttackerDashboard.tsx, client/src/components/DefenderDashboard.tsx, client/src/components/TwinTerminal.tsx, client/src/components/TopologyRadar.tsx, tests/frontend-components.test.ts
- Depends on: sim-backend-gateway
- Acceptance: AC-1: 화면이 가로 2열, 세로 2행의 반응형 2×2 그리드로 분할되며, 상하/좌우 분할 비율을 조정할 수 있는 스플릿 리사이저가 정상 작동함
- Acceptance: AC-2: 좌상단 공격자 뷰에 발견된 자산 토폴로지 레이더와 퀘스트 체크리스트가 표시되고, 우상단 방어자 뷰에 튜토리얼 가이드와 실시간 IDS 패킷 레이더가 렌더링됨
- Acceptance: AC-3: 하단 좌/우 터미널이 xterm.js 기반으로 구동되어 컬러 출력, 단축키, 복사/붙여넣기 및 리사이즈가 완벽 지원됨
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
- Acceptance: AC-4: 방어자 뷰에서 각 공격 기법에 대한 로그 분석 가이드와 1-클릭 방어 패치(또는 방어 명령어 예시)가 함께 표시됨
- Tests: node --import tsx --test tests/scenario-missions.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 5: sim-cross-platform-bootstrap
- Goal: Windows(PowerShell), macOS/Linux(Bash)에서 단 하나의 명령어 실행으로 모든 도커 컨테이너 기동, 웹 서버 구동, 브라우저 오픈까지 완결되는 크로스 플랫폼 원클릭 런처 및 검증 스크립트 작성
- Files: run.ps1, run.sh, cleanup.ps1, cleanup.sh, README.md, docs/simulation-guide.md, tests/launcher-syntax.test.ts
- Depends on: sim-scenario-engine
- Acceptance: AC-1: `.\run.ps1` 및 `./run.sh` 실행 시 필수 선행 조건(Docker, Compose, Node 가용성)을 검증하고 누락 시 친절한 안내를 출력함
- Acceptance: AC-2: 도커 빌드 완료 후 브라우저가 `http://localhost:3000`으로 자동 실행됨
- Acceptance: AC-3: `.\cleanup.ps1` 및 `./cleanup.sh` 실행 시 생성된 컨테이너, 임시 네트워크 및 볼륨이 깔끔하게 정리됨
- Acceptance: AC-4: README.md 및 가이드 문서에 윈도우/맥/리눅스 환경별 실행 방법과 1시간 완주 커리큘럼이 한국어로 상세 수록됨
- Tests: node --import tsx --test tests/launcher-syntax.test.ts
- Risk: low
- Complexity: low
- Agent: codex
- Reviewer: claude

## Verification
- Tier 1: `npx tsx scripts/loop/plan-doc.ts check metasploit-ch3-simulation` 계획서 유효성 100% 통과
- Tier 2: `node --import tsx --test tests/*.test.ts` (인프라 설정, 백엔드 게이트웨이, 시나리오 평가 엔진 단위 테스트 통과)
- Tier 3: 도커 컨테이너 빌드 후 브라우저(localhost:3000)에서 2×2 그리드 UI 및 양방향 웹 터미널 실시간 스트리밍 시각 검증

## Reviewer topology
builder=codex, reviewer=claude, challenge=on
