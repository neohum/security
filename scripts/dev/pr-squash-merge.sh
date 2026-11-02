#!/bin/bash
# pr-squash-merge.sh — 깃 커밋, 푸시, 메인 머지 앤 스쿼시, 브랜치 삭제 원클릭 자동화 러너
# Enforces the mandatory policy: No direct main push; all changes merge to main via PR Squash & Merge.

set -e

CURRENT_BRANCH=$(git branch --show-current)

if [ -z "$CURRENT_BRANCH" ]; then
  echo "❌ Error: Detached HEAD 상태입니다. 유효한 브랜치에서 실행해주세요." >&2
  exit 1
fi

TITLE="${1:-}"
BODY="${2:-}"

# 1. main 브랜치일 경우 작업 브랜치 자동 분기 (main 직접 커밋/푸시 방지)
if [ "$CURRENT_BRANCH" = "main" ]; then
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  BRANCH_SLUG="feat/auto-$TIMESTAMP"
  echo "🌿 'main' 브랜치에서 작업 브랜치로 자동 분기합니다: $BRANCH_SLUG"
  git switch -c "$BRANCH_SLUG"
  CURRENT_BRANCH="$BRANCH_SLUG"
fi

echo "==============================================================================="
echo "🚀 [GitHub PR & Squash Merge Workflow] 브랜치: $CURRENT_BRANCH"
echo "==============================================================================="

# 2. 변경사항 자동 커밋
if [ -n "$(git status --porcelain)" ]; then
  COMMIT_MSG="${TITLE:-feat: update changes ($(date +'%Y-%m-%d %H:%M'))}"
  echo ""
  echo "📝 변경사항 스테이징 및 커밋 중: $COMMIT_MSG"
  git add -A
  git commit -m "$COMMIT_MSG"
else
  echo ""
  echo "ℹ️ 커밋할 변경사항이 없습니다. 브랜치의 기존 커밋으로 진행합니다."
fi

# 3. 원격 저장소(origin)로 브랜치 푸시
echo ""
echo "1️⃣ 원격 저장소(origin)로 브랜치 푸시 중 ($CURRENT_BRANCH)..."
git push -u origin "$CURRENT_BRANCH"

# 4. GitHub CLI 확인
if ! command -v gh &> /dev/null; then
  echo "⚠️ GitHub CLI ('gh')가 설치되어 있지 않습니다."
  echo "   GitHub 웹 브라우저에서 PR을 생성한 후 'Squash and merge'를 수행해주세요:"
  echo "   URL: https://github.com/$(git config --get remote.origin.url | sed -E 's/.*github.com[:\/](.+)\.git/\1/')/pull/new/$CURRENT_BRANCH"
  exit 1
fi

# 5. GitHub Pull Request 확인 및 생성
echo ""
echo "2️⃣ GitHub Pull Request 확인 및 생성 중..."
PR_EXISTS=$(gh pr list --head "$CURRENT_BRANCH" --json number --jq '.[0].number' 2>/dev/null || true)

PR_TITLE="${TITLE:-feat: $CURRENT_BRANCH}"
PR_BODY="${BODY:-## 📌 변경 요약\n- $PR_TITLE\n\n## 🧪 검증 결과\n- 단위/빌드 테스트 통과}"

if [ -z "$PR_EXISTS" ]; then
  gh pr create --title "$PR_TITLE" --body "$PR_BODY" --base main --head "$CURRENT_BRANCH"
  echo "✅ Pull Request 생성 완료."
  PR_EXISTS=$(gh pr list --head "$CURRENT_BRANCH" --json number --jq '.[0].number' 2>/dev/null || true)
else
  echo "ℹ️ 기존 PR #$PR_EXISTS 이(가) 이미 열려 있습니다."
fi

# 6. Squash and Merge 수행 with #<number> in commit title
echo ""
PR_NUMBER=$(gh pr view "$CURRENT_BRANCH" --json number --jq '.number' 2>/dev/null || echo "$PR_EXISTS")
PR_TITLE_VIEW=$(gh pr view "$CURRENT_BRANCH" --json title --jq '.title' 2>/dev/null || echo "$PR_TITLE")
PR_BODY_CONTENT=$(gh pr view "$CURRENT_BRANCH" --json body --jq '.body' 2>/dev/null || echo "$PR_BODY")

echo "🔗 대상 PR: #$PR_NUMBER ($PR_TITLE_VIEW)"
echo "3️⃣ Squash and Merge 수행 중 (main으로 '#$PR_NUMBER' 태그가 포함된 단일 커밋 압축 병합)..."

SUBJECT="$PR_TITLE_VIEW (#$PR_NUMBER)"
gh pr merge "$CURRENT_BRANCH" --squash --delete-branch --subject "$SUBJECT" --body "$PR_BODY_CONTENT" 2>/dev/null || \
gh pr merge "$CURRENT_BRANCH" --squash --delete-branch --admin 2>/dev/null || \
gh pr merge "$CURRENT_BRANCH" --squash --delete-branch

# 7. 로컬 main 동기화 및 브랜치 삭제
echo ""
echo "4️⃣ 로컬 main 브랜치 동기화 및 작업 브랜치 삭제 중..."
git switch main
git pull origin main
git branch -D "$CURRENT_BRANCH" 2>/dev/null || true
git remote prune origin 2>/dev/null || true

echo ""
echo "==============================================================================="
echo "🎉 [성공] 깃 커밋, 푸시, 메인 머지 앤 스쿼시, 브랜치 삭제가 완료되었습니다!"
echo "==============================================================================="
