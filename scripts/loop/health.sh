#!/usr/bin/env bash
# health.sh — local verification gate for the autonomous loop.
#
# The Builder runs this between iterations. A non-zero exit means "not done" —
# the loop keeps iterating (up to its cap). A zero exit means the work unit is
# eligible for Reviewer sign-off.
#
# Tighten the checks here over weekend tuning sessions: the sharper this gate,
# the less low-quality code the agents can ever commit.
#
# Override any step with an env var; set to "true" to skip (no-op).
#   HEALTH_INSTALL   default: auto (pm install if node_modules missing)
#   HEALTH_BUILD     default: auto (<pm> run build if a "build" script exists)
#   HEALTH_LINT      default: auto (<pm> run lint if a "lint" script exists)
#   HEALTH_TYPECHECK default: auto (<pm> run typecheck if it exists)
#   HEALTH_TEST      default: auto (<pm> test)
#
# Exit codes: 0 = all gates pass. Non-zero = first failing gate's code.

set -uo pipefail
CHECKS=0

cd "$(dirname "$0")/../.." || exit 1   # repo root

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit "${2:-1}"; }

# The project profile turns absent checks into failures instead of silent skips.
# Conditional lanes are activated from the current git diff.
QUALITY_PROFILE=".harness-quality.json"
REQUIRED=""
if [ -f "$QUALITY_PROFILE" ]; then
  REQUIRED="$(node scripts/loop/quality-profile.ts)" ||
    die "invalid quality profile"
fi
required() { printf '%s\n' "$REQUIRED" | grep -Fxq "$1"; }
profile_command() { node scripts/loop/quality-profile.ts command "$1"; }

# --- detect package manager ------------------------------------------------
if [ -f pnpm-lock.yaml ]; then PM=pnpm
elif [ -f yarn.lock ];    then PM=yarn
elif [ -f bun.lockb ];    then PM=bun
else PM=npm
fi

has_script() {
  [ -f package.json ] && node -e "process.exit(require('./package.json').scripts?.['$1']?0:1)" 2>/dev/null
}

run() {
  local name="$1"; shift
  step "$name: $*"
  if "$@"; then ok "$name"; else die "$name failed" $?; fi
}

# --- install (only if deps are missing) ------------------------------------
if [ "${HEALTH_INSTALL:-auto}" != "true" ] && [ -f package.json ] && [ ! -d node_modules ]; then
  if [ "${HEALTH_INSTALL:-auto}" = "auto" ]; then run "install" "$PM" install
  else run "install" bash -c "${HEALTH_INSTALL}"; fi
fi

# --- build -----------------------------------------------------------------
# Compiling is the cheapest real Tier-1 check, and for a project whose only
# script is "build" it is the ONLY one available. It ran nowhere before, so
# `required: ["build"]` in a quality profile silently matched no step and the
# gate passed having verified nothing.
if required build && [ "${HEALTH_BUILD:-auto}" = "true" ]; then die "required build gate cannot be skipped"; fi
if [ "${HEALTH_BUILD:-auto}" = "auto" ]; then
  if has_script build; then CHECKS=$((CHECKS + 1)); run "build" "$PM" run build; fi
  if required build && ! has_script build; then die "required build gate is not configured"; fi
elif [ "${HEALTH_BUILD:-auto}" != "true" ]; then
  CHECKS=$((CHECKS + 1))
  run "build" bash -c "${HEALTH_BUILD}"
fi

# --- lint ------------------------------------------------------------------
if required lint && [ "${HEALTH_LINT:-auto}" = "true" ]; then die "required lint gate cannot be skipped"; fi
if [ "${HEALTH_LINT:-auto}" = "auto" ]; then
  if has_script lint; then CHECKS=$((CHECKS + 1)); run "lint" "$PM" run lint; fi
  if required lint && ! has_script lint; then die "required lint gate is not configured"; fi
elif [ "${HEALTH_LINT:-auto}" != "true" ]; then
  CHECKS=$((CHECKS + 1))
  run "lint" bash -c "${HEALTH_LINT}"
fi

# --- typecheck -------------------------------------------------------------
if required typecheck && [ "${HEALTH_TYPECHECK:-auto}" = "true" ]; then die "required typecheck gate cannot be skipped"; fi
if [ "${HEALTH_TYPECHECK:-auto}" = "auto" ]; then
  if has_script typecheck; then CHECKS=$((CHECKS + 1)); run "typecheck" "$PM" run typecheck; fi
  if required typecheck && ! has_script typecheck; then die "required typecheck gate is not configured"; fi
elif [ "${HEALTH_TYPECHECK:-auto}" != "true" ]; then
  CHECKS=$((CHECKS + 1))
  run "typecheck" bash -c "${HEALTH_TYPECHECK}"
fi

# --- test ------------------------------------------------------------------
if required test && [ "${HEALTH_TEST:-auto}" = "true" ]; then die "required test gate cannot be skipped"; fi
if [ "${HEALTH_TEST:-auto}" = "auto" ]; then
  if [ -n "${HEALTH_FOCUSED:-}" ]; then
    CHECKS=$((CHECKS + 1)); run "test (focused: ${HEALTH_FOCUSED})" "$PM" test -- "${HEALTH_FOCUSED}"
  elif has_script test; then CHECKS=$((CHECKS + 1)); run "test" "$PM" test
  elif required test; then die "required test gate is not configured"
  else step "test: no test script — skipping (add one to tighten this gate)"; fi
elif [ "${HEALTH_TEST:-auto}" != "true" ]; then
  CHECKS=$((CHECKS + 1))
  run "test" bash -c "${HEALTH_TEST}"
fi

# --- e2e & visual regression tests (Tier 3) --------------------------------
if required e2e && [ "${HEALTH_E2E:-auto}" = "true" ]; then die "required e2e gate cannot be skipped"; fi
if [ "${HEALTH_E2E:-auto}" = "auto" ]; then
  if has_script test:e2e; then CHECKS=$((CHECKS + 1)); run "e2e" "$PM" run test:e2e
  elif has_script e2e; then CHECKS=$((CHECKS + 1)); run "e2e" "$PM" run e2e; fi
  if required e2e && ! has_script test:e2e && ! has_script e2e; then die "required e2e gate is not configured"; fi
elif [ "${HEALTH_E2E:-auto}" != "true" ]; then
  CHECKS=$((CHECKS + 1))
  run "e2e" bash -c "${HEALTH_E2E}"
fi

if required visual && [ "${HEALTH_VISUAL:-auto}" = "true" ]; then die "required visual gate cannot be skipped"; fi
if [ "${HEALTH_VISUAL:-auto}" = "auto" ]; then
  if has_script test:visual; then CHECKS=$((CHECKS + 1)); run "visual" "$PM" run test:visual
  elif has_script visual; then CHECKS=$((CHECKS + 1)); run "visual" "$PM" run visual; fi
  if required visual && ! has_script test:visual && ! has_script visual; then die "required visual gate is not configured"; fi
elif [ "${HEALTH_VISUAL:-auto}" != "true" ]; then
  CHECKS=$((CHECKS + 1))
  run "visual" bash -c "${HEALTH_VISUAL}"
fi

if [ -n "${HEALTH_COMMAND:-}" ]; then
  CHECKS=$((CHECKS + 1))
  run "custom" bash -c "${HEALTH_COMMAND}"
fi

if required cli-smoke; then
  CLI_SMOKE="${HEALTH_CLI_SMOKE:-$(profile_command cli-smoke)}"
  if [ -z "$CLI_SMOKE" ] || [ "$CLI_SMOKE" = "auto" ]; then
    die "required cli-smoke gate is not configured"
  fi
  CHECKS=$((CHECKS + 1))
  run "cli-smoke" bash -c "$CLI_SMOKE"
fi

if required security-triad; then
  if [ "${HEALTH_SECURITY_TRIAD:-auto}" = "true" ]; then die "required security-triad gate cannot be skipped"; fi
  SECURITY_TRIAD="${HEALTH_SECURITY_TRIAD:-$(profile_command security-triad)}"
  if [ -z "$SECURITY_TRIAD" ] || [ "$SECURITY_TRIAD" = "auto" ]; then
    die "required security-triad gate is not configured"
  fi
  CHECKS=$((CHECKS + 1))
  run "security-triad" bash -c "$SECURITY_TRIAD"
elif [ -n "${HEALTH_SECURITY_TRIAD:-}" ] && [ "${HEALTH_SECURITY_TRIAD}" != "true" ] && [ "${HEALTH_SECURITY_TRIAD}" != "auto" ]; then
  CHECKS=$((CHECKS + 1))
  run "security-triad" bash -c "${HEALTH_SECURITY_TRIAD}"
fi

# --- profile-declared checks the steps above did not handle ------------------
# `required` is authoritative. A name in it that no step above matched used to be
# a silent no-op — the profile promised a gate that never ran, which is the same
# failure the build-gate comment above describes, one level more general. Run it
# from its configured command, or fail closed if there is none.
KNOWN_CHECKS="build lint typecheck test e2e visual cli-smoke security-triad"
for check in $REQUIRED; do
  case " $KNOWN_CHECKS " in *" $check "*) continue ;; esac
  COMMAND="$(profile_command "$check")"
  if [ -z "$COMMAND" ] || [ "$COMMAND" = "auto" ]; then
    die "required $check gate is not configured"
  fi
  CHECKS=$((CHECKS + 1))
  run "$check" bash -c "$COMMAND"
done

# --- expected files validation (Tier 3 physical check) ---
if [ -n "${HEALTH_EXPECTED_FILES:-}" ]; then
  step "expected files validation"
  # 쉼표 구분자 파싱
  IFS=',' read -r -a files <<< "$HEALTH_EXPECTED_FILES"
  for f in "${files[@]}"; do
    trimmed=$(echo "$f" | xargs)
    if [ -n "$trimmed" ]; then
      # 와일드카드 패턴 지원을 위해 ls/find 로 검증
      if ! ls $trimmed >/dev/null 2>&1; then
        die "expected file '$trimmed' was not physically found on disk after build. Silent quarantines or compiler bugs might have occurred."
      fi
    fi
  done
  ok "expected files validation"
fi

# --- app/web brand completion (fail-closed, no skip variable) ---------------
run "behavior-spec" node scripts/loop/behavior-spec.ts check
run "version-sync" node scripts/loop/version-sync.ts check
run "brand-assets" node scripts/loop/brand-assets.ts verify
run "deliverable-preview" node scripts/loop/deliverable-preview.ts verify

if [ "${HEALTH_STRICT:-0}" = "1" ] && [ "$CHECKS" -eq 0 ]; then
  die "strict health requires at least one lint, typecheck, test, e2e, visual, or HEALTH_COMMAND gate"
fi

ok "health: all gates passed (multi-layer verification complete)"
