# Roles, routing and clients

> Loaded on demand. This carries the authority of [`AGENTS.md`](../AGENTS.md) and
> [`CLAUDE.md`](../CLAUDE.md), which name these rules in one line each and link
> here instead of restating them — every word kept in the always-loaded chain is
> re-read by every agent on every session.
>
> Read this when you are deciding **who does the work**: picking a lane, routing a
> task to a CLI, spawning a subagent, or wiring a new client.

## The 4-role pipeline

Every task card runs through four roles, in order. Each role is backed by the CLI
that plays to its strength:

| # | Role         | Backing CLI   | Owns                                                        |
| - | ------------ | ------------- | ----------------------------------------------------------- |
| 1 | **lead**     | Codex         | 계획·설계·작업 조율, spec.md → task cards, sequencing, persona alignment |
| 2 | **explorer/control** | AGY Ultra | long-context mapping, dependency analysis, independent audit/fallback |
| 3 | **builder**  | Codex Pro     | claims a card, iterates code under the health gate |
| 4 | **reviewer** | Claude Max    | verifies unit against persona, commits + pushes, gated deploys |

Each client gets the same lanes in its native format:

- **Claude Code:** `.claude/agents/{lead,explorer,builder,reviewer}.md`
- **Codex:** `.codex/agents/{lead,explorer,builder,reviewer}.toml`
- **AGY:** `.agents/agents/{lead,explorer,builder,reviewer}/agent.md`

Shared, reusable workflows live in `.agents/skills/`, which Codex and AGY both
discover natively. Claude-specific skills remain under `.claude/skills/`.

무인 공장의 기본 실행 레인은 `codex`와 `agy`다.
Codex가 기본 리드·설계·구현을 맡고 Claude는 최종 독립 리뷰에 집중한다.
AGY는 장문맥 탐색·보조 실행·독립 감사·폴백을 맡는다. 독립성은 이름이 아닌 신뢰
도메인으로 판정한다. 같은 모델 가중치를 공유하는 레인은 서로 독립 리뷰할 수 없다.

Codex 네이티브 `reviewer`는 Codex 작업의 자체 점검에 쓸 수 있지만 독립 승인으로
계산하지 않는다. 리드가 계획을 작성했으면 그 프로바이더도 작성자다. 최종 리뷰어는
계획·구현 양쪽과 독립적이어야 하며, 가용 리뷰어가 없으면 기존 게이트가 대기한다.

**Top model by default.** Every roster CLI runs its strongest model unless
explicitly overridden: `claude` pins `--model opus`, `codex` runs its flagship
with `model_reasoning_effort="high"`, `gemini`/`agy` use their own flagship
defaults. Override per run with `CLAUDE_MODEL` / `CODEX_MODEL` /
`GEMINI_MODEL` / `AGY_MODEL` — downgrade deliberately (cost, rate limits),
never as a silent default.

**Token-budget exception (owner-approved 2026-08-03).** Claude-native execution
subagents (`builder`, `explorer`, `typist`, `researcher`) deliberately pin
Sonnet; the judgment lanes (`lead`, `validator`, `adversary`, `reviewer`) remain
on Opus. 사용자 요청(2026-09-10)에 따라 기본 리드·설계·구현은 Codex로 이동한다.
Claude-native 리드는 명시적으로 선택할 때 사용하며 탐색은 AGY/Gemini를 우선한다.
모델 설정과 최종 독립 리뷰 게이트는 유지한다.

The **senior engineering playbooks** ship split by the lane that consumes them:
`repo-recon`, `tdd-loop`, `debug-protocol`, `safe-refactor` in `.agents/skills/`
(explorer/builder lanes), Codex 리드의 계획서는 `.agents/skills/plan-doc/`;
`plan-first`, `self-review`, `verify-done`,
`git-hygiene` in `.claude/skills/` (lead/reviewer lanes). Each role's agent file
says when its playbook applies; the to-be card pipeline
(`.claude/workflows/card-pipeline-tobe.mjs`) wires them into every stage.

## Client-native behavior

- In a **Claude Code** session, use Claude's native subagents, commands,
  permissions, and `.mcp.json` configuration.
- In a **Codex** session, use Codex subagents from `.codex/agents/` and project
  settings from `.codex/config.toml`.
- In an **AGY** session, use AGY subagents from `.agents/agents/`, workspace
  skills from `.agents/skills/`, and MCP servers from `.agents/mcp_config.json`.
- Do not interpret another client's private configuration as active instructions.
  `scripts/route.ts` is the explicit cross-CLI router and runs only when invoked.

## Orca 사용 안내

이 프로젝트는 Orca(워크트리·터미널·자동화·내장 브라우저를 관리하는 에이전트
오케스트레이션 앱/CLI) 환경에서 작업될 수 있다. Orca가 설치되지 않은
머신에서는 이 섹션을 무시한다.

- **언제 Orca CLI를 쓰나.** Orca가 관리하는 상태 — 워크트리(child worktree),
  폴더 컨텍스트, 터미널, 저장소, 자동화(automations), 워크트리 코멘트, Orca 앱
  내장 브라우저 — 를 만질 때, 그리고 "다른 에이전트/워크트리에 핸드오프",
  "워크트리에 codex/claude 띄워줘" 같은 요청일 때. 이때는 raw `git worktree`,
  임의 PTY, Playwright 대신 Orca CLI가 우선이다. Orca 상태와 무관한 작업은
  일반 셸 도구를 쓴다.
- **실행 파일 결정 (세션당 1회).** ① `ORCA_CLI_COMMAND` 환경변수가 있으면 그
  값 → ② dev 체크아웃(`ORCA_DEV_REPO_ROOT` 노출)이면 `orca-dev` → ③ Linux에서
  Orca 관리 터미널 밖이면 `orca-ide` (bare `orca`는 GNOME 스크린리더로 풀릴 수
  있으니 금지) → ④ 그 외에는 `orca`. 선택한 실행 파일이 실패하면 다른 것으로
  넘어가지 말고 에러를 그대로 보고한다.
- **가이드는 바이너리가 제공한다.** Orca 명령을 실행하기 전에
  `orca skills list` / `orca skills get <name>`으로 **버전 일치 가이드**를
  로드하고, 기계가독 명령 스키마는 `orca agent-context`로 얻는다. Orca 사용법을
  이 문서나 다른 파일에 하드코딩하지 말 것 — 실제 실행될 바이너리와 문서가
  어긋나는 드리프트를 막기 위한 Orca의 설계다.

## Role boundaries & Multi-Agent Collaboration (역할 분담 및 협업 구조)

Codex가 전체 작업을 주도하고 작업 성격에 따라 보조 레인과 독립 리뷰를 연결한다.

### 1. 에이전트별 최적의 역할 분담 (Role Matrix)

| 에이전트 | CLI | 주 역할 (Role) | 강점 및 활용 방식 |
| :--- | :--- | :--- | :--- |
| **architect** | `codex`→`agy`→`gemini`→`claude` | 설계 | 시스템 구조·API·경계·트레이드오프 결정 |
| **researcher** | `agy`→`gemini`→`codex`→`claude` | 장문맥 조사 | 많은 파일·문서 분석과 의존성 지도 |
| **typist** | `codex`→`agy`→`gemini`→`claude` | 반복 편집 | 이름 변경·패턴 적용·보일러플레이트 |
| **builder** | `codex`→`agy`→`gemini`→`claude` | 구현·검증 | 기능 구현·버그 수정·헬스 게이트 실행 |

Run `node scripts/route.ts "<task>"` to see which agent the router picks.
Override with `--agent=architect|researcher|typist|builder`. Each role resolves to the
first CLI **installed on this machine**, in the order shown. Pin one with
`ROUTE_<ROLE>_CLI`.

### Token budget contract

- Codex가 계획·설계·구현·조율을 담당한다. 기본 세션은
  `node scripts/agent-session.ts "<task>"`로 실행하고, 넓은 읽기 전용 탐색은
  AGY/Gemini를 우선한다. Claude/Opus는 최종 diff와 증거의 독립 리뷰에 집중한다.
- `HARNESS_BULK_LANE` 기본값은 `codex`다. 자체 점검·카드 분류·페르소나 학습도
  Codex가 맡고 시장·고충·레이더 조사는 AGY가 맡는다. `HARNESS_RECURRING_LANE`과
  `HARNESS_LANE_<JOB>`으로 조정할 수 있다. Claude는 일반 실행의 마지막 폴백이며
  명시적인 `--agent`·`ROUTE_<ROLE>_CLI` 선택은 존중한다.
- Batch independent `Read`, search, and shell checks into one assistant turn.
  When target paths are already known, do not issue one tool call per file.
- Use `TaskCreate`/`TaskUpdate` only for three or more independently trackable
  work units. A short checklist in the working response is enough for smaller
  tasks.
- Do not reread unchanged static instructions. `CLAUDE.md`/`AGENTS.md` are
  session context; consult `lat.md`, `DESIGN.md`, ADRs, and skills only when the
  current task actually touches them. Use `context-pruner.ts` for a large rule
  surface.
- Preserve every existing health, acceptance-evidence, independent-review, and
  high-risk gate. Token savings come from routing, batching, and deduplication,
  never from skipping required evidence.

### 2. 단계별 실행

1. Codex가 요구사항·계획서·인수 조건을 정리한다. 큰 탐색은 AGY/Gemini로 배정한다.
2. Codex가 구현·테스트·실패 수정을 주도한다. AGY는 격리된 보조 작업을 맡는다.
3. 작성에 참여하지 않은 Claude 등 독립 프로바이더가 최종 diff·검증 증거를 리뷰한다.
4. 기존 증거·위험·사람 승인 게이트를 통과한 결과만 커밋·승격한다.

### 3. 멀티 에이전트 협업 시의 주의점 (Bottlenecks)

1.  **컨텍스트 동기화 및 병합 충돌 (Merge Conflicts)**: 동시에 여러 에이전트가 동일 파일을 수정하면 충돌이 납니다. 모듈별/기능별 독립된 브랜치나 분리된 디렉터리를 지정하여 에이전트를 구동하세요.
2.  **휴먼 인 더 루프 (Human-in-the-Loop) 오버헤드**: 에이전트가 잘못된 컨텍스트로 환각을 일으킬 수 있으므로 **단계별 검토 프로세스(Gatekeeping)**가 핵심입니다.

### 4. 서브에이전트 병렬 스웜 프로토콜 (Subagent Parallel Swarm Protocol)

상호 의존성이 없는 다중 태스크는 단일 에이전트가 순차적으로 처리하지 않고, 서브에이전트 스웜을 통해 즉시 병렬 분산 실행한다.

- **작업 분할 기준 (Decomposition)**:
  - 독립된 저장소/디렉터리 동기화 (예: 멀티 리포 git pull, 상태 검사, 의존성 업데이트)
  - 상호 영향 없는 파일/모듈 단위 검증 및 단위 테스트 실행
  - 레이어별(Types/Schema ➔ Core ➔ UI/API ➔ Tests) 독립 분할 작업
- **단일 턴 다중 호출 (Single-Turn Batch Invocation)**:
  - 메인 에이전트는 한 턴에 여러 서브에이전트 호출(`invoke_subagent` / `dispatch`)을 동시에 실행하여 대기 시간을 직렬(N)에서 병렬(1)로 단축한다.
  - 서브에이전트로부터 비동기 응답(Reactive Wakeup)이 완료될 때까지 불필요한 폴링 루프를 돌지 않는다.
- **모델 티어링 (Model Tiering)**:
  - 단순 탐색, 린트, 단위 테스트, 보일러플레이트: 경량·고속 모델 배정
  - 아키텍처 설계, 심층 추론, 복합 충돌 해결: 플래그십/프로 모델 배정
