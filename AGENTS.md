# AGENTS.md — master contract for security (Harness v0.4.63)

> Generated 2026-11-02 by `create-agent-harness` (v0.4.63).
> This is the single source of truth for how the autonomous loop behaves on this
> repo. The 4 roles read it; `scripts/loop/data-contract.ts` parses the
> `## Data Contract` block below. Edit it deliberately — agents obey it.

## Harness mode: Autonomous (자율 실행형)

이 프로젝트는 기존 실행 중심 하네스를 사용한다. 사용자가 맡긴 개발 작업은
필요한 파일 변경과 검증까지 주도적으로 완료하고, 아래의 역할 파이프라인과
자율 루프를 사용할 수 있다.

## The 4-role pipeline

카드 하나는 **lead**(Codex, 계획·설계·작업 조율) → **explorer/control**(AGY,
장문맥 매핑·독립 감사) → **builder**(Codex, 헬스 게이트 아래 반복) →
**reviewer**(Claude, 페르소나 대조·커밋·게이트된 배포) 순으로 흐른다. 리뷰어는
**빌더와 다른 신뢰 도메인**이어야 하며, 두 레인이 같은 모델 가중치를 공유하면 하나의
의견으로 센다. Codex가 기본 실행을 주도하고 Claude는 최종 독립 리뷰에 집중한다.
리뷰어는 인수 증거와 페르소나 권고를 하나의 구조화 응답으로 돌려주고,
그 뒤에도 결정론적 페르소나 바닥값이 적용된다. 레인별 CLI·모델 정책(기본은 각 CLI의
최상위 모델)·플레이북 배치는 [`docs/harness-roles.md`](docs/harness-roles.md).

## Client-native behavior

각 클라이언트는 자기 네이티브 설정만 따른다 — Claude는 `.claude/` + `.mcp.json`,
Codex는 `.codex/`, AGY는 `.agents/`. **다른 클라이언트의 비공개 설정을 실행 지시로
해석하지 않는다.** 교차 CLI 라우터는 `scripts/route.ts`뿐이고 명시적으로 호출될 때만
돈다. Orca 환경에서 일할 때의 규칙(언제 Orca CLI를 쓰고, 어떤 실행 파일을 고르는지)도
같은 문서에 있다: [`docs/harness-roles.md`](docs/harness-roles.md).

## Working language & encoding

- **한국어 우선.** 사람이 읽는 텍스트(UI 카피, 문서, 카드 요약, 커밋 본문, 알림)는
  한국어가 기본. 코드 식별자와 로그/에러 키는 영어.
- **UTF-8, BOM 없음 — 단 `.ps1`은 BOM 필수.** 웹 페이지는 `<meta charset="utf-8">`와
  `<html lang="ko">`가 기본. BOM 없는 `.ps1`은 Windows PowerShell 5.1에서 파싱 자체가
  깨지므로 이 예외는 선택이 아니다.
- **사람에게 보이는 시각은 로컬 시간**(기본 Asia/Seoul), 기계 기록(로그·SQLite·트레이스)은
  오프셋이 붙은 ISO 8601. 맨 UTC를 로컬처럼 보여주지 않는다.
- 근거와 전문(모지바케가 왜 파싱 실패가 되는지 포함):
  [`docs/harness-conventions.md`](docs/harness-conventions.md).

## Plan documents (계획서 우선)

기능 단위 작업의 기본 단위는 카드가 아니라 **계획서**다:
`plans/<slug>.plan.md`. 사람이 한 번 승인하면(`status: approved`) 그 문서의
`### Step N: <card-slug>`들이 **의존성 순서를 갖춘 백로그 카드 전체**로 한 번에
컴파일되고, 서로 무관한 단계는 같은 wave에서 병렬로 실행된다. 전체 형식·명령·
설정은 [`docs/PLAN_DOCS.md`](docs/PLAN_DOCS.md).

- 작성: `node scripts/loop/plan-doc.ts init <slug>` → 채우고 →
  `node scripts/loop/plan-doc.ts check <slug>` → `status: approved`
- 컴파일: 루프가 매 틱 자동으로 한다 (`plan-doc.ts compile`은 수동 확인용)
- 단계마다 `Files`(선언된 폭발 반경 = path allowlist), `Acceptance`(`AC-1: …`),
  `Tests`(실제 명령)가 필수다
- 앱·웹 단계는 로고, app-icon, favicon의 생성 또는 재사용과 실제 참조, screenshot
  증거를 Acceptance에 포함한다
- 앱·웹 결과는 production build 뒤 localhost preview 또는 desktop 앱을 실제 실행하고
  readiness와 screenshot을 확인한다. headless는 waiting-for-visual-review로 남긴다
- 모든 계획서와 보고서는 브라우저 즉시 열람용 HTML(`.html`)을 함께 생성한다
- `plan.md`는 설계가 필요 없는 한 줄짜리 잡무용으로 계속 살아 있다

## Speed-maximized agentic workflow
- **Scoping & Waves**: `Files:` 직행, Types ➔ Core ➔ UI ➔ Tests 순차 웨이브 분할.
- **Subagent Parallel Swarm**: 무의존성 태스크는 가용 서브에이전트 병렬 스웜(invoke_subagent)으로 즉시 분산 처리.
- **Tiering & Templates**: 모델 티어링 및 `[Target]+[Feature]+[Test]` 구조화 프롬프트 준수.

## Coordination protocol

무인 루프는 bare git repo + 카드별 락 파일 + SQLite 백로그로 조율된다:
**plan(승인된 계획서 → 카드 사슬) → pull → claim → iterate → reviewer sign-off →
commit·push·promote(staging→canary→production) → 모바일 알림·안전 밸브 →
유휴 시 자가평가.** claim 대상은 `open`이 아니라 의존성이 모두 `done`인 **ready**
카드이며, 각 단계는 텔레메트리 이벤트를 남긴다(`scripts/loop/telemetry.ts` → SQLite +
`current.md`). 단계별 전문은 [`docs/harness-loop.md`](docs/harness-loop.md),
스크립트 단위 설명은 [`docs/AUTONOMOUS_LOOP.md`](docs/AUTONOMOUS_LOOP.md).

## Autonomy tiers

무엇을 스스로 결정하고, 무엇을 다른 프로바이더에게 물어보고, 무엇을 사람에게
넘기는지는 [`docs/AUTONOMY.md`](docs/AUTONOMY.md)에 정의되어 있다. 요약:

| Tier | 무엇 | 누가 승인 |
| ---- | ---- | -------- |
| 1 | 워크트리 안의 되돌릴 수 있는 작업 | 아무도 (게이트만) |
| 2 | 커밋·머지되는 모든 것 | 빌더와 **독립된 프로바이더**의 리뷰어 |
| 3 | auth·시크릿·마이그레이션·결제·프로덕션 | **사람** |

그리고 계층을 가로지르는 불변식 하나: **안전 우회는 대화형 전용이다.**
`ralph-loop`/`factory`는 진입점에서 스스로를 무인 실행으로 선언하고, 선언된
실행은 `HARNESS_SANDBOX_MODE=host`(거부), `FRAMEIN_RISK=off`(무시),
`HARNESS_PLAN_GATE=off`(무시)를 쓸 수 없다.

## Behavior specs (반복되는 처신)

게이트는 결과를 재고, **행동 스펙은 그 사이의 처신을 적는다** — 초록을 믿을지,
리뷰를 누가 할지, 못 한 것을 말할지. `.agents/behaviors/<name>/BEHAVIOR.md`
([Agent Behavior](https://agentbehavior.dev) 형식), 검사는 `health.sh` 안에서
돈다. 무엇이 기존 규칙이고 무엇이 새 제안인지는 각 스펙에 적혀 있다:
[`docs/behavior-specs.md`](docs/behavior-specs.md).

## Hard rules

비협상 사항. 루프는 빠르게가 아니라 **안전하게 실패하도록** 설계돼 있다. 각 줄은
규칙의 이름이고, 근거와 세부는 [`docs/harness-gates.md`](docs/harness-gates.md)에 있다.
거기 적힌 것은 참고가 아니라 구속력 있는 규칙이다.

- **Max iteration cap** — 카드마다 고정된 반복 예산, 소진 시 lead로 에스컬레이션
- **Command timeout filter** — 모든 셸 명령은 타임아웃 아래에서 돈다
- **계정 전역 클라우드 토큰 금지** — 환경별 스코프 토큰만 사용
- **승격 없는 배포 금지** — staging → canary → production, 실패하면 승격 중단
- **데이터 가드 우회 금지** — 모든 DB 행/스토리지 경로는 `data-contract.ts`를 통과
- **Multi-Layer Deep Verification** — Tier 1 정적 → Tier 2 테스트 → Tier 3 실행/시각
- **Executable acceptance evidence** — 모든 `AC-*`가 정확히 한 번 `pass` + 관찰 증거
- **No evidence file, no ship** — `evidence/<YYYYMMDD>-<card>/` 네 절 + 캡처 산출물
- **No approved plan, no risky build** — `Risk: medium|high`는 승인된 계획서 필요
- **Dependency order is enforced** — 선행 카드가 `done`이어야 claim된다
- **Anti-False Consensus** — 빌더와 독립된 프로바이더만 리뷰·감사할 수 있다
- **Subagent Parallel Swarm** — 격리 다중 태스크는 가용 서브에이전트 병렬 스웜으로 즉시 분산 — [`docs/harness-roles.md`](docs/harness-roles.md)
- **GitHub PR & Actions 정책** — 브랜치 PR 독립 리뷰 후 squash merge로만 반영, main 직접 푸시 차단, Actions 빌드는 기본 비활성이며 사용자 명시 요청 시에만 실행
- **HTML Companion Gate** — 모든 계획서(`plans/*.plan.md`)와 주요 보고서는 브라우저 즉시 열람용 HTML(`.html`)을 동반 생성
- **UI Icons Standard (fi fi-rr)** — 모든 UI 아이콘은 Flaticon UIcons Regular Rounded (`fi fi-rr-*`) 스타일을 단일 표준으로 사용하며, 인라인 SVG·Lucide·Heroicons·이모지 혼용 금지
- **Fail-closed quality profile** — `.harness-quality.json`의 필수 검사는 우회 불가
- **Brand assets completion** — 앱·웹 변경은 로고·app-icon·favicon·화면 캡처 필수
- **Visual deliverable preview** — production 빌드·실행·화면 확인 없이는 완료 금지
- **Dynamic Context Pruning / ADR 존중** — 규칙을 한꺼번에 쏟지 않고, 리팩터 전에
  `docs/adr/`를 먼저 읽는다
- **Windows Setup R2 & SmartScreen** — 셋업 배포 시 R2 업로드 및 WDSI 평판 등록(submit-wdsi-helper.ps1) 필수
- **Public Repository Harness Isolation** — 퍼블릭 저장소에는 하네스 파일(계약·루프·스크립트)을 .gitignore로 완전 격리
- **Web Performance & Compression** — Caddy 전송 압축(zstd/gzip), 정적 자산 브라우저 캐시(max-age=86400+), 렌더 차단 스타일시트 및 UI 핵심 아이콘 preload 필수
- **UI/UX Standards & Audit (ux-audit)** — 4/8pt 그리드(`spacing-lint.ts`), 터치 타겟 44px+, Flaticon 단일화, ux-audit 검증 준수
- **사이드바 좌측 정렬** — 사이드바 메뉴·목록 버튼은 반드시 좌측 정렬(`text-left justify-start`) 적용, 가운데 정렬 상속 금지
- **Anti-Fingernail Design** — 비대칭 굵은 테두리(`border-l-4 rounded-*`) 금지, 대칭 테두리(`border`) 사용
- **Button & Badge Centering** — 버튼·배지 텍스트와 아이콘은 `inline-flex items-center justify-center leading-none` 필수
- **한국어 줄바꿈 표준** — 어절 줄바꿈(`break-keep`), 제목 균형(`text-balance`), 본문 외톨이 방지(`text-pretty`), 단일 행(`whitespace-nowrap`), `break-all` 금지


## Continuity layer (Framein verbs)

모델이 바뀌어도 작업이 이어지도록 `scripts/loop/framein.ts`가 네 동사를 제공한다:
**start**(claim 시점에 intent+baseline 계약 동결), **risk**(변경 경로로 위험 채점 →
high는 사람 탭까지 대기), **capsule**(계약+diff+헬스+원장을 묶어 다음 모델에 인계),
**show**. 고위험 diff에서는 다른 프로바이더의 챌린지가 **항상** 돌고, **BLOCK 판정은
커밋·푸시 전에 카드를 멈춘다**. 전문: [`docs/harness-loop.md`](docs/harness-loop.md).

## Data Contract

Agents MUST keep this block in sync with the real database schema and storage
layout. `scripts/loop/data-contract.ts` parses this exact fenced `yaml` block and
**blocks any write** (DB row or storage object) that violates it; the violation is
logged as a `guard` telemetry event for escalation. Fields ending in `?` are
optional. Update this block in the same commit that changes the schema.

```yaml
schemas:
  users:
    id: integer
    email: string
    display_name?: string
    is_active: boolean
    created_at: timestamp
    settings?: json
  events:
    id: integer
    user_id: integer
    kind: string
    payload?: json
    occurred_at: timestamp
storage:
  allowedPrefixes:
    - uploads/
    - exports/
    - screenshots/
  allowedExtensions:
    - .pdf
    - .png
    - .jpg
    - .json
```
