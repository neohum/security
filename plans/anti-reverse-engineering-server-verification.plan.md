---
plan: anti-reverse-engineering-server-verification
status: approved
risk: medium
owner: security-architect
source_idea: 2026-10-16-발화자-1-0001-리버스-엔지니어링-관점에서-모든-중요한-데이터는-암호-bd67
project: sync-server-surge
created: 2026-10-22
---

# Plan: Sync-Server-Surge 역공학 방어(전송·저장 암호화 봉투, 프로토콜 스키마 은닉, 서버 측 권위 상태 검증 및 해시 체인 리플레이 차단) 구축

## Intent

클라이언트 코드와 네트워크 패킷이 역공학 및 프록시(MITM)·메모리 변조에 노출되는 환경에서 `sync-server-surge`가 클라이언트가 제출한 동기화 페이로드·권한·상태 전이를 무조건 신뢰하지 않도록, **1) 중요 동기화 페이로드의 AEAD(AES-256-GCM) 암호화 봉투(Envelope) 및 필드 단위 기밀성 보장**, **2) 클라이언트 동기화 SDK/번들 난독화 및 디버그 스키마 노출 차단**, **3) 서버 측 권위 상태 머신(Server-Authoritative State Machine), Challenge-Response Nonce, 단조 증가 시퀀스 해시 체인(Hash-Chain) 및 HMAC-SHA256 서명 재검증**의 3대 역공학 방어 체계를 구축합니다.

## Non-goals

- 클라이언트 측 로컬 검증만으로 동기화 권한이나 최종 상태를 확정하는 설계 (모든 최종 권한 및 상태 전이 결정권은 100% 서버에 귀속)
- 표준 TLS/HTTPS를 대체하는 독자적인 저수준 전송 계층 암호 알고리즘 발명 (표준 TLS 위에서 애플리케이션 계층 AEAD 봉투 및 서명 검증을 중첩 적용)
- 비인가 서드파티 디버그 프록시 허용을 위한 프로덕션 서명 검증 우회 플래그 제공

## Steps

### Step 1: surge-envelope-encryption-and-key-derivation
- Goal: 동기화 대상 중요 데이터 페이로드가 로컬 캐시·전송 구간·스토리지 스냅샷에서 평문으로 노출되지 않도록 HKDF-SHA256 세션 파생 키 기반 AES-256-GCM 암호화 봉투(Encrypted Sync Envelope) 및 AAD 컨텍스트 바인딩 계층 구현
- Files: src/security/envelope-crypto.ts, src/security/key-derivation.ts, tests/security/envelope-crypto.test.ts
- Acceptance: AC-1: src/security/envelope-crypto.ts가 AES-256-GCM(96-bit CSPRNG Nonce, 128-bit Auth Tag)과 HKDF-SHA256을 사용하여 동기화 페이로드를 암호화하고 AAD(tenantId + clientId + syncSequence + schemaVersion) 불일치 시 즉시 복호화를 거부함
- Acceptance: AC-2: 재사용된 IV/Nonce 또는 변조된 Auth Tag 입력 시 타이밍 누수 없이 상수 시간(crypto.timingSafeEqual) 검증 후 즉시 에러를 반환함
- Acceptance: AC-3: 평문 민감 필드(자격증명, 세션 시크릿, 개인 식별 데이터)가 암호화 봉투 외부 메타데이터에 포함될 경우 직렬화 단계에서 Fail-closed로 차단됨
- Tests: npm test -- tests/security/envelope-crypto.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 2: surge-server-authoritative-attestation
- Goal: 역공학된 클라이언트가 위조한 상태 변이(State Mutation)나 리플레이 패킷을 서버에서 원천 차단하기 위해 Challenge-Response Nonce 발급기, HMAC-SHA256 요청 서명 검증 미들웨어, 이전 상태 해시 체인(prevHash -> nextHash) 검증기 구현
- Files: src/server/attestation-middleware.ts, src/server/hash-chain-verifier.ts, tests/security/server-attestation.test.ts
- Acceptance: AC-1: src/server/attestation-middleware.ts가 서버가 발급한 단기 Challenge Nonce(TTL 60초, 1회용 소비)와 요청 본문·타임스탬프·시퀀스 번호에 대한 HMAC-SHA256 서명을 상수 시간 비교로 검증하고 누락·만료·재사용 시 HTTP 401/403으로 차단함
- Acceptance: AC-2: src/server/hash-chain-verifier.ts가 클라이언트가 제출한 동기화 델타의 prevStateHash가 서버 원장의 최신 커밋 해시와 일치하는지 검증하고 클라이언트가 임의로 조작한 권한·점수·타임스탬프 필드를 무시하고 서버 권위 상태 머신으로만 상태를 전이함
- Acceptance: AC-3: 시퀀스 번호 역행(Rollback), Nonce 재전송(Replay), 페이로드 중간 변조(Tampering) 공격 시나리오가 자동화 테스트에서 100% 차단됨
- Tests: npm test -- tests/security/server-attestation.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude
- Parallel: yes

### Step 3: surge-sync-protocol-anti-tamper-ledger
- Goal: 암호화 봉투 계층과 서버 무결성 검증 미들웨어를 동기화 라우터 및 영속 원장(Audit Ledger)에 통합하고 위변조 탐지 시 세션 토큰 즉시 폐기 및 보안 감사 이벤트 기록
- Files: src/server/sync-router.ts, src/server/security-audit-ledger.ts, tests/security/sync-anti-tamper.test.ts
- Depends on: surge-envelope-encryption-and-key-derivation, surge-server-authoritative-attestation
- Acceptance: AC-1: src/server/sync-router.ts의 모든 상태 변경 엔드포인트가 서버 무결성 검증 미들웨어와 암호화 봉투 검증을 필수 통과해야만 원장 반영을 허용함
- Acceptance: AC-2: 서명 불일치 또는 해시 체인 깨짐이 임계 횟수 이상 발생한 디바이스/세션에 대해 즉시 토큰 폐기(Revocation) 및 쿨다운 차단을 수행하고 security-audit-ledger에 구조화된 보안 이벤트를 기록함
- Acceptance: AC-3: 정상 동기화 클라이언트와 변조 공격 클라이언트가 혼재된 동시성 테스트에서 정상 세션은 무중단 처리되고 변조 세션만 격리됨이 검증됨
- Tests: npm test -- tests/security/sync-anti-tamper.test.ts
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 4: surge-client-bundle-obfuscation-and-hardening
- Goal: 클라이언트 측 동기화 어댑터 및 배포 번들에서 내부 프로토콜 상수·시크릿·소스맵 노출을 제거하고 빌드 시 역공학 방어 준수 여부를 자동 검증하는 하드닝 스크립트 구축
- Files: scripts/harden-build.ts, vite.config.ts, tests/security/bundle-hardening.test.ts
- Depends on: surge-sync-protocol-anti-tamper-ledger
- Acceptance: AC-1: 프로덕션 빌드 설정에서 sourcemap 비활성화, 디버그 심볼 스트리핑, 프로토콜 내부 식별자 난독화가 적용되고 빌드 산출물에 .map 파일 및 평문 서버 시크릿이 0건임이 확인됨
- Acceptance: AC-2: scripts/harden-build.ts가 빌드 산출물을 스캔하여 평문 키·시크릿 패턴이나 디버그 훅이 발견되면 exit code 1로 빌드를 즉시 중단함
- Acceptance: AC-3: 암호화·난독화·서버 무결성 검증 3대 축의 통합 회귀 테스트 스위트가 모두 통과함
- Tests: npm test -- tests/security/bundle-hardening.test.ts
- Risk: low
- Complexity: low
- Agent: codex
- Reviewer: claude

## Verification
- Tier 1: npx tsc --noEmit
- Tier 2: npm test -- tests/security/*.test.ts
- Tier 3: 패킷 변조·Nonce 리플레이·해시 체인 롤백 공격 시뮬레이션에 대한 서버 측 100% 차단 검증 및 프로덕션 빌드 산출물 역공학 노출 스캔

## Reviewer topology
builder=codex, reviewer=claude, challenge=on
