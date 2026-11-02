# Working language, encoding, and platform build notes

> Loaded on demand. This carries the authority of [`AGENTS.md`](../AGENTS.md) and
> [`CLAUDE.md`](../CLAUDE.md), which state each rule in one line and link here for
> the reasoning. The reasoning is the part worth keeping — every one of these was
> written after the failure it prevents.

## Working language & encoding

- **Korean first.** User-facing text — UI copy, docs, card summaries, commit
  message bodies, Telegram notifications — defaults to Korean unless the spec
  says otherwise. Code identifiers and log/error keys stay in English.
- **UTF-8 everywhere, no BOM — except `.ps1`, which requires one.** Every file
  is written UTF-8 without BOM (`.editorconfig` enforces it). Web pages declare
  `<meta charset="utf-8">` and default to `<html lang="ko">`. The exception is
  narrow and mandatory: see *No mojibake on Windows* below.
- **No mojibake on Windows.** PowerShell scripts set the console to UTF-8
  before printing (see `scripts/loop/health.ps1`); never read agent/tool output
  through a legacy codepage (CP949). If Korean text renders as `?` or `占쏙옙`,
  fix the encoding at the source — do not strip the Korean.
  That console setting fixes *output*; it cannot fix how the file itself was
  read. Windows PowerShell 5.1 — what `powershell` resolves to, and what the
  loop invokes — decodes a BOM-less `.ps1` as the ANSI codepage, so any
  non-ASCII byte is misread before the first line runs. It is worse than
  mojibake: `✓` and `—` end in bytes `0x93`/`0x94`, which CP1252 maps to the
  curly quotes `“`/`”`, and PowerShell's tokenizer accepts those as string
  delimiters — the script fails to *parse*. So **every `.ps1` ships with a
  UTF-8 BOM**, and that is the only place a BOM is allowed.
- **Local time in anything human-facing.** Timestamps shown to people — docs,
  card summaries, Telegram notifications, dashboards — use the host's local
  timezone: **Asia/Seoul by default**, and the deployment region's timezone if
  the host moves. Machine-facing records (logs, SQLite rows, traces) stay
  ISO 8601 **with an explicit offset** — never bare UTC presented as local
  time, never a naive timestamp.

> 짧은 형태의 senior-engineer 기본기(읽고 나서 쓰기, 투기적 스코프 금지, 조용한
> 실패 금지 …)는 `CLAUDE.md`에 한 줄씩 남아 있다. 여기에는 그 목록이 담을 수 없는
> **긴 것들**만 둔다 — 반복해서 틀리는 플랫폼별 빌드 절차와, 세션 기록 명령.

## Cross-Platform Wails 빌드 핵심 지침 (반복 실수 방지 — Windows, macOS, Linux)

1. **[공통] 빌드 에러 무조건 검증**: Wails CLI는 빌드 단계에서 실패해도 성공(SUCCESS)으로 로깅하고 에러 코드를 삼키는 버그가 있으므로, 빌드 실패 시 반드시 개별 셸 스크립트 실행 결과를 직접 확인하여 빌드 성공 유무 및 에러 상태 코드를 직접 검증하십시오.
2. **[Windows] WebView2 COM VTable Panic 회피**: go 1.26 윈도우 환경에서 COM DLL 바인딩 충돌로 인한 실행 패닉(`A dynamic link library (DLL) initialization routine failed`)을 영구 방어하기 위해, **반드시 `wails build -tags native_webview2loader` 빌드 플래그를 필수로 지정**하여 네이티브 로더를 사용하도록 컴파일하십시오.
3. **[공통] 실행 파일 쓰기 락 (Text File Busy) 우회**: 프로그램이 켜져 있는 상태에서 빌드하면 파일 쓰기 잠금 에러가 발생하므로, `-o mt_temp`로 임시 이름을 지정해 빌드한 뒤 최종 압축/패키징을 진행하고 임시 파일은 자가 소각(`rm` / `del`)하는 방식을 권장합니다.
4. **[공통] 엄격한 Go 컴파일 규칙**: Go 컴파일러는 미사용 패키지 임포트 및 괄호 밸런스 붕괴 시 즉시 컴파일 실패를 냅니다. 수정 후 반드시 로컬 헬스 체킹을 기동해 사전에 문법을 체크하십시오.
5. **[Windows] SmartScreen 대응 및 자연 평판 누적/오탐 등록**: 윈도우 Defender SmartScreen(인식할 수 없는 앱의 시작 차단)은 코드 서명 인증서 부재 및 초기 다운로드 평판 부족으로 발생합니다. 유료 인증서 없이 0원으로 대응할 때는 (1) 다운로드 웹페이지에 2단계 안내 가이드([추가 정보] ➔ [실행])를 제공하여 사용자가 정상 실행하도록 유도하고, (2) 릴리스 파이프라인에서 `scripts/release/submit-wdsi-helper.ps1`을 통해 Microsoft WDSI에 무료 분석을 신청하여 자연 평판(Reputation)을 누적합니다. 오탐 격리 방어를 위해 ZIP 병렬 출력도 유지합니다.
6. **[macOS] Gatekeeper 격리 방어 및 권한 우회**: 맥 환경에서 서명되지 않은 `.app` 실행 파일은 게이트키퍼(Gatekeeper)에 의해 실행이 원천 차단됩니다. 이를 로컬 우회하기 위해 빌드 직후 `xattr -cr <path_to_app>` 명령을 실행하여 속성을 정화해 주거나, 안전하게 `.dmg` / `.zip` 포맷으로 묶어서 배포하여야 합니다.
7. **[Linux] 실행 권한(`chmod +x`) 주입 및 상대 경로 보증**: 리눅스 컴파일 본은 빌드 완료 후 실행 권한이 누락될 수 있으므로, 빌드 자동화 단계에 반드시 `chmod +x` 스크립트를 동봉하여 락을 막으십시오.

크로스 빌드 자동화는 `scripts/loop/cross-build-wails.sh`에 있습니다.

## 지식베이스 프롬프트 자동 저장

에이전트는 사용자와의 세션을 완료하기 전(최종 답변 전), 사용자의 요청 프롬프트와
작업 이력을 `node scripts/loop/knowledge.ts add` 도구로 지식베이스에 기록합니다.

```bash
node scripts/loop/knowledge.ts add --title "[Agent Human Input] 요약" --tags "human,prompt" -- "프롬프트 원문"
```

중요 API 키나 시크릿 등 민감정보는 반드시 마스킹 후 저장합니다
(`scripts/loop/redact.ts`).

## UI/UX 사이드바 내비게이션 정렬 표준 (Sidebar Left-Alignment)

사이드바(Sidebar) 내비게이션 메뉴 및 목록 버튼은 반드시 **좌측 정렬(`justify-content: flex-start`, `text-align: left`)**을 적용해야 합니다.
- **원인 및 방어책**: CSS에서 범용 버튼(`button, .btn`)에 `display: inline-flex; justify-content: center;`를 부여하는 경우가 많아, `<button class="nav-btn">` 형태의 사이드바 메뉴가 의도치 않게 중앙 정렬되는 시각적 결함이 발생합니다.
- 사이드바 내비게이션 항목에는 반드시 명시적으로 `justify-content: flex-start; text-align: left;`를 선언하여 아이콘과 라벨 텍스트가 좌측에 정렬되도록 보장합니다.

## 프롬프트 캐싱 불변식 & 시스템 프롬프트 다이어트 (claude.dev Best Practice)

Anthropic 공식 `claude.dev` 엔지니어링 모범 사례에 기반하여, 에이전트의 응답 품질 극대화와 캐시 히트율(90%+)을 보장하기 위한 불변식을 강제합니다.

1. **정적 접두사 고정 (Static Prefix Invariant)**: 시스템 프롬프트, 도구 스키마, 프로젝트 핵심 규칙(`AGENTS.md`)은 세션 전체에서 불변의 접두사로 유지되어야 합니다.
2. **미드 세션 도구/모델 스왑 금지**: 세션 실행 도중에 도구 세트를 임의로 변경하거나 모델을 교체하면 접두사 캐시가 완전히 무효화되므로 엄격히 금지합니다.
3. **가변 데이터 후방 배치**: 동적 타임스탬프, 현재 시간, 실시간 diff 등 매 턴 변하는 데이터는 시스템 프롬프트 상단이 아닌 메시지 최하단 가변 영역에 배치합니다.
4. **시스템 프롬프트 다이어트 (The 80% Rule)**: 상시 로드 컨텍스트(`CLAUDE.md`, `AGENTS.md`)는 핵심 안전 불변식만 남기고 3,600단어 예산 내로 유지하며(`tests/context-budget.test.ts`), 세부 절차는 온디맨드 문서와 스킬로 점진적 노출(Progressive Disclosure)합니다.

## 파괴적 명령 사전 비행 점검 (Blast Radius Guard)

`rm -rf`, `rmdir`, `del`, `git clean` 등 대규모 삭제나 파괴적 명령을 실행하기 전, 반드시 사전 영향도를 계산합니다:
```bash
node scripts/loop/blast-radius.ts "<command>"
```
- 영향받는 파일 수와 바이트 수를 사전에 파악하여 의도치 않은 대규모 소스 손실이나 시스템 경로 침범을 방어합니다.
- 고위험(`high` 또는 `critical` 심각도) 명령은 사람 확인이나 격리 검토 없이 자율 실행되지 않습니다.

## 대화형 독립 실행 HTML 검증 산출물

품질 감사(`ux-audit`), 테스트 리포트, 벤치마크 등 다차원 검증 산출물은 마크다운 요약과 함께 외부 의존성이 없는 단독 실행형 대화형 HTML 문서(`docs/test-results.html`, `evidence/.../report.html`)로 작성을 권장합니다. 인터랙티브 필터링과 인라인 증거 탐색을 제공합니다.

## 고품격 이미지 생성 프롬프트 레시피 카탈로그

UI/UX 애셋 및 일러스트레이션 생성 시 일관된 고품격 미학(High-Taste Aesthetics)을 유지하기 위해 큐레이션된 프롬프트 카탈로그(`docs/image-prompts.json`)를 관리합니다:
```bash
# 레시피 목록 및 검색
node scripts/loop/image-prompts.ts list
node scripts/loop/image-prompts.ts search "paper"

# 원하는 주제로 프롬프트 즉시 렌더링 (Antigravity generate_image 연동)
node scripts/loop/image-prompts.ts render layered-paper-cut --subject "원하는 주제"
```
자세한 레시피 및 추가 가이드는 [`docs/image-prompts.md`](image-prompts.md)를 참조하십시오.



