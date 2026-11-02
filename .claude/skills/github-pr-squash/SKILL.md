---
name: github-pr-squash
description: "현재 작업의 깃 커밋, 원격 푸시, GitHub PR 생성, 메인 머지 앤 스쿼시(Squash and Merge), 로컬/원격 브랜치 삭제 및 main 최신화를 원클릭으로 일괄 자동 처리하는 표준 워크플로우 스킬입니다. '깃 커밋', '깃 푸시', 'PR 생성', '메인 머지', '스쿼시 머지', '브랜치 삭제', 'github push', 'pr merge', 'pr squash' 요청 시 사용."
---

# github-pr-squash — 깃 커밋, 푸시, 메인 머지 앤 스쿼시, 브랜치 삭제 일괄 처리

이 스킬은 하네스의 핵심 원칙인 **"main 직접 푸시 금지 & 모든 변경은 PR Squash Merge로만 main 진입"**을 완벽하게 준수하면서,
개발자가 한 번의 요청으로 **커밋 ➔ 푸시 ➔ PR 생성 ➔ 스쿼시 머지 ➔ 로컬/원격 브랜치 삭제**까지 원스톱으로 안전하게 처리하도록 돕는 표준 자동화 스킬입니다.

---

## ⚡ 원클릭 자동 실행 스크립트

수동으로 명령을 하나씩 칠 필요 없이, 프로젝트에 내장된 러너를 통해 전체 파이프라인을 1회 실행으로 완결합니다:

### 1. Windows PowerShell (BOM 준수)
```powershell
pwsh scripts/dev/pr-squash-merge.ps1 -Message "feat(ui): 작업 제목 요약"
```

### 2. Cross-Platform (Node / TypeScript)
```bash
npx tsx scripts/dev/pr-squash-merge.ts "feat(ui): 작업 제목 요약"
```

### 3. Bash (macOS / Linux / WSL)
```bash
./scripts/dev/pr-squash-merge.sh "feat(ui): 작업 제목 요약"
```

---

## 🎯 자동화 파이프라인 7단계

스크립트 및 에이전트는 다음 단계를 순서대로 자율 실행합니다:

1. **작업 브랜치 확인 및 자동 분기**:
   - 현재 브랜치가 `main`인 경우, `feat/auto-<YYYYMMDD-HHmmss>` 또는 지정된 이름으로 작업 브랜치를 자동 생성 및 전환하여 main 직접 푸시 차단 규칙을 우회하지 않고 정상 보호합니다.
2. **변경사항 스테이징 및 커밋 (`git commit`)**:
   - `git add -A` 및 전달받은 요약 메시지로 원자적 커밋 생성.
3. **원격 저장소 푸시 (`git push`)**:
   - `git push -u origin <작업-브랜치>`로 GitHub origin에 푸시.
4. **GitHub Pull Request 생성 (`gh pr create`)**:
   - 대상 브랜치에 열린 PR이 없으면 `gh pr create --title ... --body ... --base main`으로 자동 생성.
5. **Squash and Merge 수행 (`gh pr merge`)**:
   - `gh pr merge <작업-브랜치> --squash --delete-branch --subject "<제목> (#<PR_NUM>)"`
   - PR 내 여러 커밋을 main에 깔끔한 1개의 단일 커밋으로 압축 머지하고 원격 브랜치 자동 삭제.
6. **로컬 `main` 브랜치 동기화**:
   - `git switch main && git pull origin main`으로 로컬 main을 최신 머지 상태로 업데이트.
7. **로컬 작업 브랜치 삭제 (`git branch -D`)**:
   - 머지가 끝난 로컬 브랜치를 `git branch -D <작업-브랜치>`로 정리하고 `git remote prune origin` 수행.

---

## 🚨 주의사항 및 문제 해결

- **GitHub CLI 인증**: `gh auth status`가 정상이어야 합니다. 미인증 시 `gh auth login` 수행.
- **머지 충돌 발생 시**: `git switch <작업-브랜치> && git merge main`을 통해 충돌을 해결하고 테스트 통과 후 다시 실행합니다.
- **GitHub Actions 빌드 기본 비활성**: GitHub Actions 워크플로우는 기본적으로 자동 실행하지 않으며, 검증은 로컬 하네스 게이트에서 완결합니다. 액션 빌드는 사용자가 명시적으로 요청한 경우에만 수동 실행합니다.
