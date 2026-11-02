---
name: prelaunch-persona-audit
description: "출시 전 5대 페르소나 병렬 브라우저 감사 게이트."
---

# prelaunch-persona-audit — 출시 전 5대 가상 사용자 페르소나 브라우저 감사 스웜

서비스 출시 직전, 5명의 서로 다른 성향과 디바이스·네트워크 조건을 가진 가상 사용자 하위 에이전트를 병렬 스웜(Swarm)으로 호출하여 **첫 화면 진입 → 회원가입/온보딩 → 핵심 기능 첫 성공**까지의 전체 사용자 여정을 실제 브라우저에서 검증합니다.

모든 페르소나 정의, 브라우저 에뮬레이션 직렬화, 결함 빈도·심각도 집계, 마크다운(`.md`)·자립형 HTML(`.html`) 리포트 렌더링 및 1차/2차 재검증(Re-audit) 판정은 [`scripts/qa/persona-browser-audit.ts`](../../../scripts/qa/persona-browser-audit.ts) 엔진으로 수행합니다.

---

## 1. 5대 가상 사용자 페르소나 스펙 (`PRELAUNCH_PERSONAS`)

| 페르소나 ID | 역할명 | 뷰포트 / 디바이스 | 네트워크 쓰로틀링 | 핵심 행동 규칙 (Heuristics) | 즉시 중단 조건 (Abort Conditions) |
| --- | --- | --- | --- | --- | --- |
| `impatient-first-click` | 급한 사용자 | `1280x800` (`Desktop Chrome`) | `none` (`20ms`, `10000kbps`) | 안내문을 읽지 않고 3초 내 첫 주 행동(Primary CTA) 버튼 클릭, 최소 입력만 수행 | 3초 내 핵심 CTA 식별 불가, 첫 클릭 후 3초 초과 무응답/첫 에러 발생, 필수 입력 5개 이상 |
| `skeptical-legal-reader` | 의심 많은 사용자 | `1440x900` (`Desktop Chrome HiDPI`) | `none` (`20ms`, `10000kbps`) | 가입·결제 전 요금제(Pricing), 이용약관(Terms), 개인정보 처리방침(Privacy), 환불/보안 링크 전수 클릭 | 약관/개인정보 링크 누락·404·빈 모달, 무료 체험/자동 결제 조건 미명시 |
| `mobile-375-slow3g` | 모바일 저속망 사용자 | `375x667` (`iPhone SE`, `isMobile: true`, `hasTouch: true`) | `slow-3g` (`400ms`, `400kbps`, CPU 4x 감속) | 모바일 화면에서 가로 스크롤(`scrollWidth > innerWidth`) 및 `44x44px` 미만 터치 타겟, 로딩 인디케이터 점검 | 가로 스크롤로 주요 버튼/입력창 잘림, 44px 미만 터치 타겟 오작동, Slow 3G 10초 초과 먹통 |
| `literal-copy-follower` | 화면 문구만 믿는 사용자 | `1280x800` (`Desktop Chrome`) | `none` (`20ms`, `10000kbps`) | 배경지식 없이 화면 안내 문구·플레이스홀더(`예: ...`)·버튼 텍스트 그대로만 입력·클릭 | 플레이스홀더 예시 그대로 입력 시 검증 실패, 해결책 없는 모호한 에러 메시지, 완료 후 다음 안내 부재 |
| `chaos-doubleclick-fuzzer` | 망가뜨리는 사용자 | `1280x800` (`Desktop Chrome`) | `fast-3g` (`150ms`, `1600kbps`, CPU 2x 감속) | 빈 값·초장문(1,000자+)·특수문자/이모지·음수 입력, 뒤로/앞으로 가기, 모든 제출 버튼 더블클릭·5회 연타 | 더블클릭 시 중복 요청(409/500) 발생, 뒤로 가기/특수문자 입력 시 미처리 예외·빈 화면 발생 |

---

## 2. 브라우저 MCP 에뮬레이션 설정

각 하위 에이전트는 `scripts/qa/persona-browser-audit.ts --emulate <personaId> --url <targetUrl>`이 출력하는 설정으로 Playwright MCP 및 Chrome DevTools MCP를 초기화합니다.

- **Playwright MCP 실행 인자 (`playwrightArgs`)**:
  - `--device <playwrightDevice> --viewport-size <width>,<height>`
  - 예 (`mobile-375-slow3g`): `--device "iPhone SE" --viewport-size 375,667`
- **Chrome DevTools MCP 에뮬레이션 (`devtoolsEmulate`)**:
  - `viewport`: `{ width, height, deviceScaleFactor, isMobile, hasTouch }`
  - `networkConditions`: `{ offline, profile, latency, downloadThroughput, uploadThroughput }`
  - `cpuThrottlingRate`: `1` (일반) / `2` (`chaos-doubleclick-fuzzer`) / `4` (`mobile-375-slow3g`)

```bash
# 5대 페르소나 목록 확인
node scripts/qa/persona-browser-audit.ts --list-personas

# 특정 페르소나 에뮬레이션 설정 및 서브에이전트 프롬프트 출력
node scripts/qa/persona-browser-audit.ts --emulate mobile-375-slow3g --url http://localhost:3000

# 5인 병렬 스웜 실행 계획 JSON 초기화
node scripts/qa/persona-browser-audit.ts --init-plan --url http://localhost:3000 --out artifacts/persona-audit
```

---

## 3. 증거 캡처 트리거 (Evidence Capture Triggers)

각 페르소나 하위 에이전트는 아래 트리거가 발생하는 즉시 `PersonaObservation` 항목을 기록합니다:

1. **시각/레이아웃 결함**: 가로 스크롤 발생, 요소 겹침, `44x44px` 미만 터치 타겟, 빈 모달/빈 화면 → 즉시 스크린샷(`screenshotPath`) 및 대상 DOM 셀렉터(`selector`) 캡처
2. **인터랙션/문구 마찰**: 3초 내 CTA 미발견, 플레이스홀더 예시 입력 실패, 해결 방법이 없는 에러 토스트 → 화면 문구와 재현 단계(`reproductionSteps`) 기록
3. **콘솔 및 네트워크 오류**: `console.error`, `pageerror`(`uncaught exception`), HTTP `4xx`/`5xx` 응답(특히 더블클릭 연타 시 `409`/`500`) → `consoleErrors` 및 `networkErrors` 배열에 원문 기록

---

## 4. 빈도·심각도 집계 규격 (`aggregatePersonaFindings`)

5명의 하위 에이전트가 수집한 관측 JSON을 병합할 때:
- **정규화 병합**: 동일한 결함 ID 또는 정규화된 `(DOM 셀렉터 + 결함 제목)`을 가진 항목들을 단일 고유 결함(`AggregatedFinding`)으로 병합하고 영향받은 페르소나 목록(`personas`)과 빈도(`frequency`)를 합산합니다.
- **심각도 가중치 (`SEVERITY_WEIGHTS`)**:
  - `critical` (`100`) > `high` (`60`) > `medium` (`25`) > `low` (`10`)
- **우선순위 점수 (`priorityScore`)**:
  - `severityWeight * frequency + abortedCount * 15` 공식으로 계산하며, 점수가 높은 순서대로 정렬합니다.
- **동반 보고서 생성**:
  - `persona-audit-report.md` 및 브라우저 즉시 열람용 자립형 `persona-audit-report.html` (한국어 줄바꿈 `word-break: keep-all`, 배지 `white-space: nowrap`, 다크/라이트 테마 지원)을 동시에 생성합니다.

```bash
node scripts/qa/persona-browser-audit.ts --aggregate artifacts/persona-audit/observations-round1.json --out artifacts/persona-audit/round1
```

---

## 5. 일괄 수정 후 5인 재검증(Re-audit) 루프 절차

1. **1차 감사 (Round 1)**: 5개 페르소나 하위 에이전트를 병렬 실행하여 `observations-round1.json`을 수집하고 `--aggregate`로 우선순위 리포트를 생성합니다.
2. **결함 일괄 수정 (Batch Fix)**: 리포트 상위의 `critical` 및 `high` 결함(그리고 다빈도 `medium` 마찰 지점)을 코드에서 일괄 수정합니다.
3. **2차 5인 재검증 (Round 2 Re-audit)**: 동일한 5명의 페르소나 에이전트를 수정된 빌드에 다시 투입하여 `observations-round2.json`을 수집합니다.
4. **델타 비교 및 출시 게이트 판정 (`compareReaudit`)**:
   - `resolved`: 1차에서 발견되었으나 2차에서 완전히 해소된 결함
   - `remaining`: 2차에서도 여전히 재현되는 미해결 결함
   - `regressed`: 1차에 없었으나 수정 과정에서 새로 발생한 회귀 결함
   - **통과 조건 (`pass === true`)**: 미해결 `critical`/`high` 결함이 **0건**이고 신규 회귀(`regressed`) 결함이 **0건**일 때만 출시 게이트를 통과(`exitCode: 0`)합니다. 하나라도 남아 있으면 `exitCode: 1`을 반환하고 재수정 루프를 반복합니다.

```bash
node scripts/qa/persona-browser-audit.ts --reaudit artifacts/persona-audit/observations-round1.json artifacts/persona-audit/observations-round2.json --out artifacts/persona-audit/reaudit
```
