# Hard rules

> Loaded on demand — and **non-negotiable**. This carries the authority of
> [`AGENTS.md`](../AGENTS.md), whose *Hard rules* section names each of these in
> one line and links here for the detail. A rule stated in one place and enforced
> in another is still binding; nothing here is advisory.
>
> The loop is designed to fail safe, not fast.

## Hard rules

These are non-negotiable. The loop is designed to fail safe, not fast.

- **Max iteration cap.** Each card gets a fixed iteration budget. On reaching it the
  **builder** stops and escalates to the **lead** — it never loops forever.
- **Command timeout filter.** Every shell command runs under a timeout; a hung
  command is killed and surfaced, not silently waited on.
- **Never use account-wide cloud tokens.** Each release environment uses its own
  project/environment-scoped token (`RAILWAY_STAGING_TOKEN`,
  `RAILWAY_CANARY_TOKEN`, `RAILWAY_TOKEN`) — never an account API key.
- **Commercial releases promote, never jump.** Staging deploy+health and canary
  deploy+health must pass before production. A failed stage stops promotion; a
  production health failure retains rollback authority.
- **Never bypass the data-contract guard.** Every DB-row shape and every storage path
  must pass `scripts/loop/data-contract.ts`. A violation means fix the shape or the
  contract — never disable the guard.
- **Dynamic Context Pruning.** Do not dump static rules all at once. Agents must slice context dynamically and load task-focused sub-skills on demand to avoid context degradation ("Lost in the Middle").
- **Institutional Memory & ADR Respect.** Always consult `docs/adr/` (Architecture Decision Records) before refactoring core architecture. Respect historical trade-offs, operational constraints, and domain reasons ("why decisions were made").
- **Anti-False Consensus (Independent Cross-Verification).** Reviewers and auditors must run from an independent provider/model than the builder with adversarial challenge (`FRAMEIN_CHALLENGE=1`). A builder model cannot self-approve or review its own work to prevent false consensus.

- **Multi-Layer Deep Verification Gate.** Verification cannot rely on typecheck/lint alone. Tasks must pass 3 tiers of gates: Tier 1 (Static/Lint/Typecheck), Tier 2 (Functional Unit/Integration/Property-based/Differential tests), and Tier 3 (Visual regression/Playwright screenshots & Runtime NFR checks).
- **Agentic Invariant & Property Gate.** Beyond example-based tests, agents must prove system constraints with property-based testing (4 key invariants: round-trip serialization, system constraints like zero-PII/non-negative balance, idempotency, and optimization equivalence) and differential testing (using the prior system as the ground-truth oracle during migrations). Stateful or distributed components must pass deterministic simulation testing (DST) with fault injection (virtual clocks, synthetic drops) to guarantee 100% reproducible error recovery. Core verification loops must execute deterministically with sub-second feedback; flaky tests must be quarantined immediately to prevent loop incentive degradation.
- **Multi-Device & Responsive Verification Gate.** All user-facing UI deliverables must be verified across standard device viewports (Mobile 375/390px, Tablet 768/1024px, Desktop 1280/1920px). Horizontal overflow, touch targets below 44px on mobile, unwrapped tables, and fixed-width layout breakage are blocking defects.
- **Executable acceptance evidence.** A plan card needs `AC-*` acceptance IDs and
  at least one `Tests` command. The reviewer must return every ID exactly once
  with `pass` and concrete observed evidence; missing, duplicated, failed, or
  unverified criteria block shipping.
- **Fail-closed project quality profile.** `.harness-quality.json` declares
  always-required and changed-path-conditional checks. A required check cannot
  be absent or bypassed with `HEALTH_*=true`.
- **Brand assets are completion evidence.** Any app/web surface change must add a
  changed `evidence/<YYYYMMDD>-<card>/brand-assets.json`. It declares one vector
  source, `created|reused` intent, a referenced logo, a referenced favicon
  verified at 16px and 32px, a referenced app-icon of at least 128px, the
  plan/review contract, and a real screenshot under `evidence/`. Empty,
  unreferenced, escaping, or symlinked assets fail closed in both health shells;
  there is no `HEALTH_BRAND` bypass.
- **Built and visibly observed, or not done.** App/web changes must add a changed
  `evidence/<YYYYMMDD>-<card>/deliverable-preview.json` containing the exact
  production build command, `exitCode: 0`, a real artifact and build log, plus
  an observed localhost runtime or desktop window and screenshot. A web preview
  may bind only to loopback (`127.0.0.1`, `localhost`, or `::1`) and the recorded
  process must be cleaned up after observation. Headless environments remain
  `waiting-for-visual-review` with a concrete manual command; they never pass as
  observed. Build evidence containing deploy/publish/upload/push is rejected,
  and there is no `HEALTH_PREVIEW` bypass.
- **Jev는 게이트를 조이기만 한다 — 단조 합성.** 선택적으로 켜는 내용 기반
  리스크 채점(`FRAMEIN_JEV=1`)은 `최종 = max(정규식, Jev)`로 합성되므로 정규식
  판정을 **낮출 수 없다**. 키 없음·타임아웃·오류는 전부 정규식 결과로 되돌아가
  Jev 도입 이전 동작이 된다. 기본은 꺼져 있다 — diff가 제3자 API로 나가기
  때문이다. 전문: [`docs/jev-decision-layer.md`](jev-decision-layer.md),
  [ADR-0028](adr/0028-jev-content-risk-scoring.md).
- **No approved plan, no risky build.** `scripts/loop/plan-gate.ts` blocks a
  `Risk: medium|high` card that no approved `plans/*.plan.md` declares — before the
  worktree, before the first token. Fix it by writing the plan, never by turning
  the gate off: `HARNESS_PLAN_GATE=off` is interactive-only and a declared
  unattended run refuses it (`autonomy.ts`).
- **No evidence file, no ship.** A card in scope for evidence
  (`evidence.requireAtRisk`, and always when it came from a plan document) must
  leave `evidence/<YYYYMMDD>-<card>/` with all four sections filled — WHAT WAS
  TESTED / OBSERVED / WHY IT IS ENOUGH / WHAT WAS OMITTED — plus at least one
  captured artifact. A model's report of what it observed is not the observation.
- **Dependency order is enforced, not hoped for.** A card is claimable only when
  every card in its `Dependencies:` is `done` (`scripts/loop/deps.ts`). Declaring
  a dependency and then racing it is the failure this removes.
- **Windows setup release, Cloudflare R2 upload & SmartScreen zero-cost reputation.** 데스크톱/런처 앱 버전업 시 반드시 셋업 파일(`.exe`)과 `latest-win.json`/`latest.json`(SHA-256 해시 포함)을 생성하여 **Cloudflare R2**(`scripts/release/release-r2.ts` / `scripts/loop/upload-r2.ts`)에 업로드해야 한다. 서명 없는 Windows 셋업(`.exe`) 배포 시 다운로드 표면에 2단계 안내 UI([추가 정보] ➔ [실행])를 제공하여 이탈을 방지하고, 릴리스 파이프라인에 `submit-wdsi-helper.ps1`을 포함하여 Microsoft WDSI 무료 오탐 분석 및 자연 평판(Reputation) 등록을 유도해야 한다.
- **Anti-Fingernail / Cuticle Design Standard.** 비대칭 굵은 테두리(`border-l-4`, `border-l-2`)와 둥근 모서리(`rounded-*`, `rounded-r-*`)를 결합하여 손톱(fingernail/cuticle) 모양이나 뜯겨 나간 듯한 비대칭 왜곡을 유발하는 디자인을 전면 금지한다. 카드, 콜아웃, 버튼은 균형 잡힌 전면 테두리(`border`), 은은한 그림자(`shadow-2xs`), 또는 배경색 채움을 사용한다.
- **Button, Chip & Badge Perfect Centering.** 버튼(`button`), 액션 링크(`a`), 칩(`chip`), 배지(`badge`) 내부의 모든 텍스트와 아이콘은 상하좌우 완벽 중앙 정렬(`inline-flex items-center justify-center leading-none`)되어야 하며, 아이콘은 `i.flex.items-center.justify-center.leading-none`을 의무 적용하여 기준선 불일치 및 수직 쏠림을 방지한다.
- **Adjacent Controls Horizontal & Center Alignment (인접 컨트롤·푸터 액션 수평 정렬 및 마진 박스 편향 차단).** 나란히 배치되는 버튼, 액션 링크, 배너, 스크롤탑 버튼 등 인라인 인터랙티브 요소는 Flex 컨테이너(`align-items: center`) 안에서 동일한 높이 규격(최소 터치 타깃 `min-height: 44px` 권장)을 공유해야 한다. 특정 요소에 잔존하는 비대칭 외부 여백(`margin-bottom`, `margin-top`)으로 인해 Flexbox 마진 박스(Margin Box) 기준 중심축(Center-Y)이 편향되어 위아래로 붕 뜨거나 수평선이 어긋나는 결함을 금지한다. 인접 액션 그룹 내부에서는 모든 자식의 상하 마진을 `margin: 0` 또는 `margin-block: 0`으로 정규화하고 높이 및 베이스라인을 일치시켜야 한다.
- **Korean Typography & Line-Break Standard (한국어 줄바꿈·타이포그래피 표준).** 한국어 UI에서 어절 단위 줄바꿈(`word-break: keep-all;`), 제목 줄바꿈 균형(`text-wrap: balance;`), 본문 외톨이 단어 방지(`text-wrap: pretty;`), 긴 용어/URL 넘침 방지(`overflow-wrap: break-word;`), 버튼/배지 단일 행 유지(`white-space: nowrap;`)를 의무화한다. 한국어 제목이나 본문에 음절 단위로 단어가 끊어지는 슬롭 현상을 유발하는 `word-break: break-all` 적용은 전면 금지한다.
- **Public Repository Harness Isolation (퍼블릭 저장소 하네스 격리).** GitHub 퍼블릭(Public) 저장소로 생성하거나 푸시할 때, 하네스와 관련된 모든 파일(에이전트 계약, 자율 루프 스크립트, 내부 계획서, 증거 파일, 런타임 상태 등)은 `.gitignore`에 자동 등록되어 Git 인덱스에서 완전히 제외되어야 한다. `ship.ts` 프리체크 및 `public-repo-guard.ts`가 퍼블릭 저장소의 하네스 파일 노출을 상시 감지하고 차단한다.
- **HTML Companion & Visual Viewer Gate (계획서 및 보고서 브라우저 열람용 HTML 동반 필수).** 모든 계획서(`plans/*.plan.md`)와 주요 보고서(품질 감사, 성능 벤치마크, 릴리스 증거)는 마크다운 원본과 함께 브라우저에서 즉시 열람 가능한 단일 HTML(`.html`) 뷰어를 동반 생성해야 한다. 계획서가 작성·수정·승인되거나(`plans/<slug>.plan.html`) 검증 증거가 캡처될 때(`evidence/.../report.html`) 최신 상태의 HTML 동반 파일이 생성·유지되지 않은 산출물은 불완전한 작업으로 간주하여 게이트를 통과할 수 없다.
- **GitHub Actions Build On-Demand Gate (GitHub Actions 빌드 기본 비활성 및 사용자 명시 요청 시에만 실행).** GitHub Actions 워크플로우(CI/CD, 릴리스 빌드, 테스트 파이프라인 등)는 기본적으로 자동 실행하지 않으며 비활성화 상태를 유지한다. 모든 빌드·테스트·린트 검증은 로컬 하네스 게이트(`health.sh`, `npm test` 등)를 통해 1차 완결하며, GitHub Actions 빌드는 사용자가 대화창에서 명시적으로 실행을 요청하거나 승인한 경우에만 진행(`workflow_dispatch` 또는 수동 트리거)한다. 에이전트가 임의로 원격 액션 빌드를 트리거하거나 자동 실행에 의존하는 행위를 금지한다.
- **No Unprompted System Shutdown (임의 전원 제어 및 컴퓨터 자동 종료 엄격 금지).** `/parallel-git-sync` 등 장기 실행 또는 배치 스킬 완료 후, 사용자가 해당 턴에서 직접적이고 명시적으로 시스템 종료를 지시하지 않은 경우 절대로 컴퓨터를 종료(`shutdown`)하거나 전원을 제어해서는 안 된다. 이전 턴의 종료 요청은 해당 1회성 작업 종료로 소멸하며, 후속 세션이나 재호출 시 자동 승계되지 않는다.



