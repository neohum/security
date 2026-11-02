---
name: harness-sync
description: "현재 프로젝트에서 에이전트 실행 시 create-agent-harness 최신 템플릿·스킬·헬스 게이트를 로컬 온디맨드 비파괴(--update) 방식으로 동기화하는 스킬입니다. '하네스 업데이트', '하네스 최신화', 'harness sync', 'ca update' 요청 시 사용."
---

# harness-sync — Multi-Agent Harness 온디맨드 로컬 동기화 스킬

이 스킬은 `create-agent-harness` 코어 레포지토리의 변경 사항을 전체 하위 프로젝트에 일괄 전파(`propagate`)하거나 백그라운드에서 자동으로 GitHub PR/main 머지를 발생시키지 않고, **해당 프로젝트에서 에이전트를 실행할 때(`hooks/session-start.ts` 또는 `ca update`) 현재 프로젝트에 한해 비파괴(`--update`) 방식으로 동기화**하는 표준 프로토콜입니다.

---

## 🎯 핵심 원칙 (계속적인 GitHub Main 머지 활동 방지)

1. **전체 프로젝트 일괄 전파(`propagate --pr`) 금지**:
   - `create-agent-harness` 코어를 수정하더라도 하위 프로젝트 전체를 순회하며 자동 브랜치·PR·Squash Merge를 수행하지 않습니다.
2. **해당 프로젝트 에이전트 실행 시 온디맨드 적용**:
   - 각 프로젝트에서 에이전트(Claude, Codex, AGY)가 시작될 때 `hooks/session-start.ts`가 로컬에서 비파괴 `--update`만 수행합니다(백그라운드 자동 Git PR 생성 없음).
3. **수동 갱신 (`ca update`)**:
   - 현재 작업 중인 프로젝트에서 즉시 하네스를 최신화할 때는 로컬에서 `ca update` 또는 `node scripts/loop/harness-sync.ts update`를 실행합니다.

---

## 🛠️ 실행 명령

```bash
# 현재 프로젝트 로컬 비파괴 업데이트 (권장)
ca update

# 또는 스크립트 직접 실행
node scripts/loop/harness-sync.ts update

# 하네스 소스 및 버전 상태 확인
node scripts/loop/harness-sync.ts check
```

---

## 🔒 안전 불변식 (Hard Rules)

1. **비파괴 업데이트 (`--update`)**:
   - 기존 프로젝트에서 자체 수정한 파일과 사용자 `docs/` 문서는 보존하고, 하네스 관리 파일만 안전하게 병합합니다.
2. **백그라운드 자동 PR/Main 머지 금지**:
   - 세션 시작 훅이나 하네스 동기화 시 무인 백그라운드 PR 생성 및 main 브랜치 자동 병합을 수행하지 않습니다.

