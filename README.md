# 🎯 Metasploit Ch3 Intelligence Gathering & 200-Node CTF Arena

> **메타스플로잇 2/e 제3장 "인텔리전스 수집" 인터랙티브 실습 튜토리얼 및 200개 가상 인터넷 노드 CTF 침투 경진대회 플랫폼**
>
> 순수 Node.js(TypeScript) 기반으로 설계되어 Docker 없이도 100% 로컬 오프라인 독립 실행이 가능하며, Wi-Fi 네트워크를 통한 다자간 원격 CTF 대회 호스팅도 지원합니다.

---

## ⚡ 빠른 시작 (Quick Start)

인터넷이나 외부 클라우드 연결 없이, 로컬 컴퓨터 단독(오프라인)으로 즉시 튜토리얼과 CTF 대회를 실행할 수 있습니다.

### 1. 저장소 클론 및 패키지 설치
```bash
git clone https://github.com/neohum/security.git
cd security

# 의존성 설치 (Node.js 18+ 권장)
npm install
```

### 2. 서버 실행
```bash
npm start
```
서버가 시작되면 아래와 같은 접속 정보가 터미널에 표시됩니다:
```text
======================================================
🚀 [Metasploit Ch3 Simulation] LAN Gateway Server Ready
🌐 Host LAN IP : 172.31.1.112 (또는 localhost)
🔌 Listening   : http://0.0.0.0:3000
🔴 Attacker    : http://localhost:3000/?role=attacker
🛡️ Defender    : http://localhost:3000/?role=defender
👁️ Observer    : http://localhost:3000/?role=observer
🏁 CTF Arena   : http://localhost:3000/arena
💻 Direct SSH  : ssh -p 2222 {참가자닉네임}@localhost
======================================================
```

---

## 🎮 실행 모드 안내

### 1. 제3장 인텔리전스 수집 튜토리얼 (Interactive Tutorial)
- **접속 주소**: `http://localhost:3000`
- **역할별 뷰**:
  - **공격자 (Red Team)**: `http://localhost:3000/?role=attacker` — 인터랙티브 칼리 리눅스 셸, 실시간 자동 채점 퀘스트, 명령어 레퍼런스
  - **방어자 (Blue Team)**: `http://localhost:3000/?role=defender` — 침투 패킷 실시간 감지(IDS), 원클릭 보안 패치 및 방화벽 차단
  - **관제 (Observer 2x2)**: `http://localhost:3000/?role=observer` — 공격자와 방어자의 터미널과 토폴로지를 한눈에 관제

### 2. 200개 노드 CTF 침투 경진대회 (CTF Competition Arena)
- **접속 주소**: `http://localhost:3000/arena`
- **특징**:
  - `10.10.1.1` ~ `10.10.1.200` 대역의 200개 가상 모의 인터넷 서버 가동
  - 6대 분야(Whois, DNS-AXFR, Web/FTP, MSSQL, S3 Bucket, Legacy) 각 10개씩 총 60개 취약 서버 랜덤 배치 + 140개 보안 완벽 서버(Hardened) 혼합
  - 대기 로비(Lobby) ➔ 카운트다운 ➔ 실시간 점수 순위표(Leaderboard) ➔ First Blood 보너스 ➔ 명예의 전당
  - 터미널에서 공격 명령어가 성공하면 **플래그 수동 입력 없이 실시간 자동 채점** 연동

### 3. 네이티브 SSH 터미널 접속 (CLI 참가자용)
브라우저 대신 본인의 선호 터미널(iTerm, Windows Terminal, PuTTY 등)에서 직접 접속 가능합니다:
```bash
ssh -p 2222 player1@localhost
```

---

## 📶 네트워크 환경별 진행 시나리오

### 시나리오 A: 강사/호스트 PC 1대로 진행 (공유기/Wi-Fi 연결 시)
1. 호스트 PC에서 `npm start` 실행 후 표시되는 **Host LAN IP** 확인 (예: `172.31.1.112`)
2. 같은 Wi-Fi에 접속한 참가자들은 브라우저에서 `http://172.31.1.112:3000/arena`로 접속하여 닉네임 입력 후 참가
3. 호스트가 **대회 시작** 버튼을 누르면 모든 참가자 화면에서 실시간 경진대회 시작

### 시나리오 B: 현장 네트워크 불안정 또는 AP 격리로 상호 접속이 안 될 때 (독립 실행 모드)
> 💡 **컴퓨터 간 네트워크가 연결되지 않아도 걱정 없습니다!**

1. 각 참가자가 본인 노트북에서 저장소를 클론:
   ```bash
   git clone https://github.com/neohum/security.git
   cd security && npm install && npm start
   ```
2. 각자 본인 노트북의 `http://localhost:3000` (튜토리얼) 및 `http://localhost:3000/arena` (CTF 대회)에 접속하여 100% 완벽한 단독 실습 및 침투 테스트 진행 가능

---

## 📜 셸 스크립트(.sh) 및 자동화 툴킷 활용

200개 대역을 일일이 수동 검색하지 않고, 셸 스크립트나 파이썬으로 고속 스캔 및 전수 점령이 가능합니다.

### 1. 터미널에서 직접 셸 스크립트 작성 및 실행
```bash
# 200개 대역 Whois 일괄 검색 스크립트 생성
echo 'for i in $(seq 1 200); do whois -h 10.10.1.$i megacorp.internal; done' > whois_sweep.sh
chmod +x whois_sweep.sh

# 실행 (취약점 발견 즉시 자동 채점)
./whois_sweep.sh
```

### 2. 기본 내장 툴킷 바로 실행 (`/root/tools/`)
터미널 또는 SSH 세션에서 기본 제공되는 실전 스크립트를 즉시 실행할 수 있습니다:
- `bash /root/tools/whois_scan.sh`: 200개 노드 Whois 등록정보 일괄 고속 정찰
- `bash /root/tools/axfr_scan.sh`: DNS Zone Transfer BIND 취약 네임서버 탈취
- `bash /root/tools/nmap_scan.sh`: 웹/FTP/MSSQL/S3 포트 고속 스캐너
- `bash /root/tools/s3_leak_scan.sh`: MinIO/S3 9000번 포트 퍼블릭 버킷 노출 점검
- `bash /root/tools/auto_pwn.sh`: 6대 분야 60개 취약 서버 전수 일괄 점령 종합 스크립트

---

## 🐳 Docker Full-Stack 샌드박스 연동 (선택사항)

실제 BIND DNS, MinIO S3 및 가상 네트워크 컨테이너를 함께 기동하려는 경우:

### Windows (PowerShell)
```powershell
# 호스트 모의 환경 및 도커 컨테이너 원클릭 실행
npm run sim:host       # 또는 .\run-host.ps1

# 실습 종료 후 자원 정리
npm run sim:clean      # 또는 .\cleanup-host.ps1
```

### macOS & Linux (Bash/Zsh)
```bash
# 호스트 모의 환경 및 도커 컨테이너 원클릭 실행
npm run sim:host:sh    # 또는 ./run-host.sh

# 실습 종료 후 자원 정리
npm run sim:clean:sh   # 또는 ./cleanup-host.sh
```

> 💡 **참고**: Docker가 설치되어 있지 않아도 `npm start`만 실행하면 **순수 Node.js 내장 모의 인터넷 엔진(`MockInternetMesh`)**으로 윈도우, 맥, 리눅스 어디서나 100% 동일하게 모든 기능이 작동합니다.

---

## 🧪 테스트 검증

```bash
npm test
```
- 총 143개 단위, 통합, E2E 및 보안 검증 테스트 100% 통과.

---

## 📄 라이선스
MIT License. 교육 및 모의 침투 훈련 목적으로 자유롭게 사용하실 수 있습니다.
