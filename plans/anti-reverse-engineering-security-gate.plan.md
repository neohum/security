---
plan: anti-reverse-engineering-security-gate
status: approved
risk: medium
owner: security-architect
source_idea: 2026-10-16-발화자-1-0001-리버스-엔지니어링-관점에서-모든-중요한-데이터는-암호-bd67
project: create-agent-harness
created: 2026-10-22
---

# Plan: 리버스 엔지니어링 방어 3대 축(암호화·난독화·서버 무결성 검증) 보안 감사 게이트 구축

## Intent

클라이언트 번들·바이너리 및 로컬 스토리지가 공격자에게 완전히 노출되어 정적 역공학(디컴파일·문자열 추출)과 동적 메모리 변조의 표적이 되는 위협 환경에서, 에이전트가 작성한 코드가 **중요 데이터 암호화(Encryption at Rest & In Transit)**, **빌드 산출물 난독화 및 민감 상수 은닉(Obfuscation & Secret Elimination)**, **서버 측 무결성 및 권한 재검증(Server-Side Attestation & Challenge-Response Verification)**의 3대 방어 축을 모두 충족하는지 자동 검증하고 미달 시 커밋·승격을 차단(Fail-closed)하는 보안 감사 게이트(`anti-reverse-engineering-gate.ts`)를 `create-agent-harness`에 구축합니다.

## Non-goals

- 상용 하드웨어 DRM 동글 또는 커널 드라이버 수준의 안티 치트 모듈 직접 제작
- 난독화 단독으로 평문 마스터 키나 서버 전용 시크릿을 클라이언트 번들에 내장하는 행위 정당화 (클라이언트 내 서버 시크릿 내장은 전면 금지 및 즉시 차단 대상)
- 레거시 서드파티 외부 패키지의 내부 바이너리 재컴파일
- 암호학적 표준 알고리즘(AES-256-GCM, Argon2id, Ed25519, HMAC-SHA256) 대신 자체 고안한 비표준 암호 알고리즘 사용

## Steps

### Step 1: sec-gate-triad-validator
- Goal: 암호화(AEAD/KDF 규격 준수 및 평문 스토리지 차단), 난독화(심볼·문자열 보호 및 소스맵 노출 차단), 서버 무결성 검증(클라이언트 상태 신뢰 금지 및 서명/해시 체인 재검증)의 3대 방어 축을 정적 AST·패턴 기반으로 감사하는 코어 검증기 및 보안 규칙 정의서 구축
- Files: scripts/security/defense-triad-validator.ts, docs/security/anti-reverse-engineering-triad.md, tests/security/defense-triad-validator.test.ts
- Acceptance: AC-1: defense-triad-validator가 대상 코드베이스에서 평문 스토리지 기록(localStorage/ 파일 내 민감 키워드 평문 저장), 취약 알고리즘(MD5, SHA1, ECB, Math.random 기반 보안 토큰), 클라이언트 측 단독 권한·결제·점수 판정 패턴을 탐지하여 위반 항목과 가중치 점수(0~100점)를 산출함
- Acceptance: AC-2: 중요 데이터를 다루는 모듈에서 서버 측 무결성 검증(HMAC/Ed25519 서명 검증 또는 Challenge-Response Nonce 검증) 경로가 누락된 경우 critical 등급 위반을 반환함
- Acceptance: AC-3: docs/security/anti-reverse-engineering-triad.md 문서에 암호화·난독화·서버 검증 3대 원칙과 금지 패턴, 프레임워크별(Node/TS, Go/Wails, Web) 체크리스트가 한국어로 명세됨
- Tests: node --import tsx --test tests/security/defense-triad-validator.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 2: sec-gate-bundle-secret-scanner
- Goal: 프론트엔드 번들(dist, build) 및 네이티브/백엔드 산출물 설정에서 평문 API 키, 하드코딩된 대칭키·솔트, 프로덕션 inline/hidden 소스맵(.map) 노출, 디버그 심볼 잔존 여부를 스캔하는 번들 역공학 노출 검사기 구현
- Files: scripts/security/bundle-secret-scanner.ts, tests/security/bundle-secret-scanner.test.ts
- Acceptance: AC-1: bundle-secret-scanner가 지정된 소스 및 빌드 아티팩트 경로에서 고엔트로피 시크릿, 하드코딩된 암호화 키·IV, 개인키 블록, 평문 엔드포인트 자격증명을 탐지하고 파일 경로와 라인 번호를 구조화된 JSON으로 출력함
- Acceptance: AC-2: 프로덕션 빌드 설정(vite.config.ts, tsconfig.json, build 스크립트 등)에서 sourcemap 활성화 또는 심볼 미제거 설정이 감지되면 fail-closed 차단 신호를 생성함
- Acceptance: AC-3: 기존 scripts/loop/redact.ts 패턴과 호환되면서 클라이언트 번들 특화 역공학 위험 패턴(전역 window 디버그 훅, 평문 프로토콜 상수 노출)을 추가로 검출함
- Tests: node --import tsx --test tests/security/bundle-secret-scanner.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude
- Parallel: yes

### Step 3: sec-gate-quality-profile-wiring
- Goal: 3대 방어 축 검증기와 번들 스캐너를 통합한 CLI 게이트(anti-reverse-engineering-gate.ts)를 구현하고 .harness-quality.json 및 scripts/loop/health.sh에 연동하여 보안 기준 미달 시 자율 루프 커밋·승격을 자동 차단
- Files: scripts/security/anti-reverse-engineering-gate.ts, .harness-quality.json, scripts/loop/health.sh, tests/security/anti-reverse-engineering-gate.test.ts
- Depends on: sec-gate-triad-validator, sec-gate-bundle-secret-scanner
- Acceptance: AC-1: npx tsx scripts/security/anti-reverse-engineering-gate.ts 실행 시 3대 방어 축 점검 결과와 번들 노출 스캔 결과를 합산하여 치명적 위반 존재 시 exit code 1로 종료하고 구체적인 교정 가이드를 출력함
- Acceptance: AC-2: --json 및 --report 플래그 지원으로 카드 완료 증거 디렉토리(evidence/YYYYMMDD-card/security-triad-report.md)에 감사 증적을 자동 기록함
- Acceptance: AC-3: .harness-quality.json 및 health.sh에서 보안 감사 게이트를 호출할 수 있도록 연결되고 모든 기존 품질 게이트 테스트와 충돌 없이 통과함
- Tests: node --import tsx --test tests/security/anti-reverse-engineering-gate.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 4: sec-gate-template-and-tests
- Goal: 신규 스캐폴딩 및 다운스트림 프로젝트(keyhub, sync-server-surge 등)에 동일한 역공학 방어 보안 게이트가 배포되도록 template/ 디렉토리에 스크립트를 미러링하고 종단간 회귀 테스트를 완성
- Files: template/scripts/security/anti-reverse-engineering-gate.ts, template/scripts/security/defense-triad-validator.ts, template/scripts/security/bundle-secret-scanner.ts, tests/security/template-parity.test.ts
- Depends on: sec-gate-quality-profile-wiring
- Acceptance: AC-1: scripts/security/ 하위 3개 모듈과 template/scripts/security/ 하위 모듈 간의 기능 및 인터페이스 동등성(Parity)이 자동화 테스트로 검증됨
- Acceptance: AC-2: 모의 역공학 취약 샘플(평문 키 내장, 소스맵 노출, 클라이언트 단독 권한 판정)과 정상 방어 샘플(AES-256-GCM + 난독화 설정 + 서버 HMAC 검증)을 대상으로 게이트의 차단 및 통과 동작이 100% 검증됨
- Tests: node --import tsx --test tests/security/*.test.ts
- Risk: low
- Complexity: low
- Agent: codex
- Reviewer: claude

## Verification
- Tier 1: npx tsc --noEmit && npx tsx scripts/loop/plan-doc.ts check anti-reverse-engineering-security-gate
- Tier 2: node --import tsx --test tests/security/*.test.ts
- Tier 3: npx tsx scripts/security/anti-reverse-engineering-gate.ts --json 실행을 통한 실제 저장소 보안 게이트 Fail-closed 동작 및 리포트 산출 검증

## Reviewer topology
builder=codex, reviewer=claude, challenge=on
