@AGENTS.md

# security — Claude Code adapter (Harness v0.4.63)

> Loaded by Claude Code at the start of every session. The shared contract is
> imported from `AGENTS.md`; Claude-native agents, commands, permissions, and MCP
> configuration live under `.claude/` and `.mcp.json`.
> Generated 2026-11-02 by `create-agent-harness` (v0.4.63).

## Active behavior mode

**Autonomous.** Carry out requested engineering work proactively, including
appropriate edits and verification, under the shared contract.

## Startup Update Check (세션 시작 시 필수 실행)

Claude Code 세션이 시작되면 가장 먼저 다음 명령어를 실행하여 에이전트 CLI들의 업데이트 상태를 확인하고 사용자에게 알려주세요.
```bash
node scripts/check-updates.ts
```
이 체크는 더 새 Harness 커밋도 함께 보고합니다. 실제 갱신은 Claude/Codex/AGY의 SessionStart 훅(하네스 소스의 `hooks/session-start.ts`)이 매 세션 소스를 ff-only pull한 뒤 비파괴 `--update`로 적용합니다(`CAH_AUTO_PULL=0`/`HARNESS_AUTO_UPDATE=0`으로 끔).

## Roles and routing

세 역할(**architect** 설계·판단 / **researcher** 실행·오케스트레이션 / **typist**
기계적 편집)이 이 머신에 설치된 CLI 순서대로 해석된다.
`node scripts/route.ts "<task>"`가 라우터의 선택을 보여주고
`--agent=architect|researcher|typist|builder`로 덮어쓴다. 특정 CLI 고정은 `ROUTE_<ROLE>_CLI`.

**토큰 예산 계약(요약).** Codex가 계획·설계·구현·작업 조율을 맡고 Claude/Opus는
최종 독립 리뷰에 집중한다. 기본 실행은 Codex(`node scripts/agent-session.ts "<bounded task>"`), 넓은
읽기 전용 탐색은 AGY/Gemini로 보내고 Claude는 그 diff와 증거를 리뷰한다. 독립적인
Read·검색·셸 확인은 한 턴에 묶는다. **절감은 라우팅·배칭·중복 제거에서 나오고, 필요한
게이트를 건너뛰어서 나오지 않는다.** 역할 표, 계약 전문, 협업 병목:
[`docs/harness-roles.md`](docs/harness-roles.md).

## Senior-engineer defaults (apply to all agents)

- **Read before you write.** Open the file, scan callers, then edit. Prefer `Edit` over `Write`.
- **No speculative scope.** Bug fix ≠ refactor. Don't add layers or "future-proofing" unrequested.
- **No dead validation & No silent failures.** Validate at boundaries only; never fake a fix.
- **Dependencies.** Standard problems take a maintained library; hand-roll only for domain rules.
- **Comments & Errors.** Comments for *why*; errors point at root causes (no `--no-verify`).
- **Dynamic Context Pruning.** Avoid prompt stuffing; load task-focused sub-skills on-demand.
- **Respect Institutional Memory (ADR).** Consult `docs/adr/` before refactoring core logic.
- **Anti-False Consensus (Independent Review).** Never review own work; pass to another provider.
- **Multi-Layer Deep Verification.** Tier 1 static → Tier 2 tests → Tier 3 real runtime evidence.
- **Confirm before destructive ops.** Pause before `rm -rf`, `git reset --hard`, force push, drops.
- **UI Icons Standard.** `fi fi-rr-*` (Flaticon Regular Rounded) 스타일 통일.
- **Sidebar Left-Alignment.** 사이드바 내비게이션 및 메뉴 버튼은 좌측 정렬(`justify-content: flex-start`, `text-align: left`) 필수 준수 (전역 버튼 중앙 정렬 전파 방어).
- **Web Performance & Compression.** 웹/UI 서빙 시 zstd/gzip 압축, 1일+ 브라우저 캐싱, 렌더 차단 스타일 및 주요 아이콘 preload 필수.
- **GitHub PR & Main Squash Merge.** 작업 브랜치 푸시 ➔ `gh pr create` ➔ 독립 검증 ➔ `gh pr merge --squash --delete-branch`.
- **지식베이스 자동 기록**: 세션 완료 전 작업 요약을 `node scripts/loop/knowledge.ts add`로 기록.
- **플랫폼별 빌드(특히 Wails)**: [`docs/harness-conventions.md`](docs/harness-conventions.md).

## Project facts (fill these in)

- **Stack:** _e.g. Next.js 16, React 19, TypeScript, Postgres_
- **Package manager:** _pnpm | npm | yarn_
- **Entry points:** _e.g. `app/(routes)`, `lib/server`_
- **Test runner:** _e.g. `pnpm test` (vitest)_
- **Lint / typecheck:** _e.g. `pnpm typecheck`_
- **Dev server:** _e.g. `pnpm dev` on http://localhost:3000_
- **Deploy:** _e.g. Railway via `git push`_

## Domain glossary (fill these in)

| Term  | Meaning                       |
| ----- | ----------------------------- |
| _foo_ | _what foo means in this repo_ |

## See also

- [`docs/harness-roles.md`](docs/harness-roles.md) — roles, routing, token budget, Orca
- [`docs/harness-loop.md`](docs/harness-loop.md) — coordination protocol, continuity
- [`docs/harness-gates.md`](docs/harness-gates.md) — the hard rules in full
- [`docs/PLAN_DOCS.md`](docs/PLAN_DOCS.md) — 계획서 형식과 게이트
- [`docs/behavior-specs.md`](docs/behavior-specs.md) — 반복되는 처신을 적은 행동 스펙
- [`lat.md`](./lat.md) — code-graph / file-level map of the repo
- [`DESIGN.md`](./DESIGN.md) — UI/UX system & component contract
- [`docs/HARNESS.md`](./docs/HARNESS.md) — how the multi-agent harness works
