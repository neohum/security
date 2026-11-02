---
plan: anti-reverse-engineering-vault-attestation
status: approved
risk: medium
owner: security-architect
source_idea: 2026-10-16-발화자-1-0001-리버스-엔지니어링-관점에서-모든-중요한-데이터는-암호-bd67
project: keyhub
created: 2026-10-22
---

# Plan: KeyHub 볼트 역공학 방어(KDF 하한 강제·키 블라인딩·바이너리 난독화·원격 매니페스트 서명 및 에이전트 Challenge-Response 검증) 구축

## Intent

Wails v2(Go 1.25 + Vite/TypeScript) 기반 API 키 관리 데스크톱 앱인 `keyhub`가 정적 바이너리 디컴파일·문자열 추출, 메모리 덤프, 로컬 에이전트 토큰 탈취, S3/Wasabi 원격 동기화 매니페스트 위변조 및 롤백 공격에 노출되지 않도록 **1) 볼트 암호화 하드닝(Argon2id 파라미터 하한선 강제·HKDF 도메인 분리·문서 식별자 HMAC 블라인딩·메모리 키 제로화)**, **2) Go 바이너리 및 프론트엔드 번들 난독화·상수 은닉**, **3) 원격 동기화 매니페스트 Ed25519/HMAC 무결성 서명 검증 및 로컬 Agent API Challenge-Response 인증**의 3대 방어 체계를 구축합니다.

## Non-goals

- 기존 v1 볼트 파일(`vault.enc`) 사용자의 데이터를 파괴하는 비호환 마이그레이션 (v1 헤더 자동 감지 후 저장 시 하드닝된 포맷으로 무손실 업그레이드 지원)
- 클라우드 KMS 또는 외부 유료 HSM 장비 의존성 강제
- S3/Wasabi 외의 독자적인 클라우드 스토리지 엔진 신규 구축

## Steps

### Step 1: keyhub-vault-kdf-and-memory-hardening
- Goal: vault.enc 헤더 변조를 통한 Argon2id KDF 파라미터 다운그레이드 공격을 차단하고 HKDF-SHA256 기반 서브키 분리(암호화 키·문서명 블라인딩 키·매니페스트 서명 키) 및 언락 해제/종료 시 메모리 내 마스터 키·패스워드 즉시 제로화(Zeroization) 구현
- Files: internal/vault/format.go, internal/vault/vault.go, internal/vault/vault_test.go, internal/service/service.go
- Acceptance: AC-1: internal/vault/vault.go의 Open 및 KDF 검증 로직이 헤더의 Argon2id 파라미터 하한선(Time >= 3, Memory >= 65536 KiB, Threads >= 1, KeyLen == 32, Salt >= 16 bytes) 미달 시 즉시 에러로 거부하여 헤더 변조 다운그레이드 공격을 차단함
- Acceptance: AC-2: 마스터 키에서 HKDF-SHA256으로 파생한 전용 키로 문서 맵 키(secret:id 등)를 HMAC 블라인딩 처리하고 AES-GCM Additional Data(AAD)에 문서 ID와 포맷 버전을 바인딩하여 암호문 블록 교체(Ciphertext Transplanting) 공격을 차단함
- Acceptance: AC-3: Service.Lock 및 앱 종료 시 보관 중인 패스워드와 파생 키 바이트 슬라이스를 명시적으로 0x00 덮어쓰기(Zeroize)하고 단위 테스트로 검증함
- Tests: go test -v ./internal/vault/... ./internal/service/...
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 2: keyhub-agentapi-challenge-response
- Goal: 로컬 루프백 Agent API(127.0.0.1)의 정적 평문 Bearer 토큰 의존성을 제거하고 타임스탬프·논스(Nonce) 기반 HMAC-SHA256 Challenge-Response 서명 검증 및 리플레이 차단, agent.json 토큰 보호 계층 도입
- Files: internal/agentapi/token.go, internal/agentapi/server.go, internal/agentapi/server_test.go
- Acceptance: AC-1: internal/agentapi/server.go가 X-KeyHub-Timestamp, X-KeyHub-Nonce, X-KeyHub-Signature(요청 메서드+경로+타임스탬프+논스에 대한 HMAC-SHA256) 헤더를 검증하고 허용 시간창(60초) 초과 또는 재사용된 Nonce 요청을 401로 즉시 거부함
- Acceptance: AC-2: internal/agentapi/token.go가 에이전트 시크릿 저장 시 OS 사용자 컨텍스트 보호 및 최소 권한(0600) 검증을 강제하고 런타임 메모리에서 평문 노출을 최소화함
- Acceptance: AC-3: 리플레이 공격, 만료된 타임스탬프, 위조된 서명, 권한 없는 Origin 요청을 차단하는 보안 단위 테스트가 모두 통과함
- Tests: go test -v ./internal/agentapi/...
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude
- Parallel: yes

### Step 3: keyhub-sync-manifest-signature-attestation
- Goal: S3/Wasabi 원격 동기화 시 평문 vault/manifest.json 위변조 및 구버전 롤백(Rollback) 공격을 방어하기 위해 볼트 파생 서명 키 기반 HMAC-SHA256/Ed25519 매니페스트 무결성 서명 및 단조 증가(Monotonic) Revision 검증 구현
- Files: internal/sync/client.go, internal/sync/s3.go, internal/sync/client_test.go, internal/service/sync.go
- Depends on: keyhub-vault-kdf-and-memory-hardening, keyhub-agentapi-challenge-response
- Acceptance: AC-1: internal/sync/client.go의 Manifest 구조체에 버전, 타임스탬프, 볼트 암호문 SHA-256, Revision, DeviceID 전체를 커버하는 암호학적 인증 태그(Signature/MAC)가 추가되고 Push 시 서명 생성, Pull/Check 시 서명 검증이 강제됨
- Acceptance: AC-2: 원격지의 Manifest 서명이 유효하지 않거나 로컬에 기록된 마지막 확인 Revision보다 낮은 Revision(롤백 공격)이 감지되면 Pull 덮어쓰기를 즉시 중단하고 무결성 위반 에러를 반환함
- Acceptance: AC-3: 원격 암호문(vault.enc)의 실제 SHA-256 해시와 서명된 Manifest.SHA256이 불일치할 경우 복호화 및 로컬 반영 전에 차단됨이 테스트로 증명됨
- Tests: go test -v ./internal/sync/... ./internal/service/...
- Risk: medium
- Complexity: medium
- Agent: codex
- Reviewer: claude

### Step 4: keyhub-binary-and-frontend-obfuscation
- Goal: 배포용 Go 네이티브 바이너리와 Wails 프론트엔드 번들에서 심볼 테이블·경로 정보·소스맵을 제거하고 민감 IPC 브릿지 상수 및 내부 문자열의 정적 역공학 추출 난이도를 극대화하는 하드닝 빌드 파이프라인 구축
- Files: scripts/build-all.ps1, frontend/vite.config.ts, frontend/src/api.ts
- Depends on: keyhub-sync-manifest-signature-attestation
- Acceptance: AC-1: frontend/vite.config.ts 프로덕션 빌드에서 sourcemap: false, 디버그 콘솔·주석 제거, 식별자 난독화 옵션이 강제되고 빌드 산출물(frontend/dist) 내에 .map 파일이나 평문 시크릿 상수가 존재하지 않음
- Acceptance: AC-2: scripts/build-all.ps1가 -trimpath 및 -ldflags="-s -w"와 선택적 garble 난독화 파이프라인을 지원하고 빌드 완료 후 바이너리·번들 내 평문 시크릿/심볼 잔존 여부를 자동 검사함
- Acceptance: AC-3: 프론트엔드 IPC 래퍼(frontend/src/api.ts)가 민감 데이터를 브라우저 localStorage/sessionStorage에 캐싱하지 않고 메모리 참조를 즉시 해제함
- Tests: npm --prefix frontend run build && go test ./...
- Risk: low
- Complexity: low
- Agent: codex
- Reviewer: claude

## Verification
- Tier 1: go vet ./... && npm --prefix frontend run build
- Tier 2: go test -race -v ./internal/vault/... ./internal/agentapi/... ./internal/sync/... ./internal/service/...
- Tier 3: 변조된 Argon2id 헤더, 재전송된 Agent API Nonce, 서명이 훼손된 원격 Manifest 시나리오에 대한 Fail-closed 차단 통합 검증 및 빌드 산출물 문자열/소스맵 무결성 검사

## Reviewer topology
builder=codex, reviewer=claude, challenge=on
