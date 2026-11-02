# health.ps1 — Windows fallback for health.sh (weekend dev-box use).
#
# Mirrors health.sh: install (if deps missing) -> build -> lint -> typecheck -> test.
# The Linux server runs health.sh; this exists so you can run the same gate on
# the Windows machine during weekend harness-tuning sessions.
#
# Override any step with an env var (set to "true" to skip):
#   HEALTH_INSTALL  HEALTH_LINT  HEALTH_TYPECHECK  HEALTH_TEST
#
# Exit: 0 = all gates pass; non-zero = first failing gate.

$ErrorActionPreference = "Stop"
# UTF-8 console so Korean output survives (AGENTS.md "Working language & encoding")
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$script:Checks = 0
Set-Location (Join-Path $PSScriptRoot "..\..")   # repo root

function Step($m) { Write-Host "`n▶ $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "✓ $m" -ForegroundColor Green }
function Die($m)  { Write-Host "✗ $m" -ForegroundColor Red; exit 1 }

$script:Required = @()
if (Test-Path ".harness-quality.json") {
  $requiredOutput = & node scripts/loop/quality-profile.ts
  if ($LASTEXITCODE -ne 0) { Die "invalid quality profile" }
  $script:Required = @($requiredOutput | Where-Object { $_ })
}
function Is-Required($name) { return $script:Required -contains $name }
function Profile-Command($name) {
  $value = & node scripts/loop/quality-profile.ts command $name
  if ($LASTEXITCODE -ne 0) { Die "invalid quality profile" }
  return ($value -join "`n").Trim()
}

# --- detect package manager ---
$PM = if (Test-Path pnpm-lock.yaml) { "pnpm" }
      elseif (Test-Path yarn.lock)  { "yarn" }
      elseif (Test-Path bun.lockb)  { "bun" }
      else { "npm" }

function Has-Script($name) {
  if (-not (Test-Path package.json)) { return $false }
  node -e "process.exit(require('./package.json').scripts?.['$name']?0:1)" 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Run($name, [scriptblock]$block) {
  Step "$name"
  & $block
  if ($LASTEXITCODE -ne 0) { Die "$name failed" }
  Ok $name
}

# --- install (only if deps missing) ---
$install = if ($env:HEALTH_INSTALL) { $env:HEALTH_INSTALL } else { "auto" }
if ($install -ne "true" -and (Test-Path package.json) -and -not (Test-Path node_modules)) {
  if ($install -eq "auto") { Run "install" { & $PM install } }
  else { Run "install" { Invoke-Expression $install } }
}

# --- build ---
# See health.sh: without this step a `required: ["build"]` profile matched no
# step at all and the gate passed having verified nothing.
$build = if ($env:HEALTH_BUILD) { $env:HEALTH_BUILD } else { "auto" }
if ((Is-Required "build") -and $build -eq "true") { Die "required build gate cannot be skipped" }
if ($build -eq "auto") {
  if (Has-Script "build") { $script:Checks++; Run "build" { & $PM run build } }
  elseif (Is-Required "build") { Die "required build gate is not configured" }
}
elseif ($build -ne "true") { $script:Checks++; Run "build" { Invoke-Expression $build } }

# --- lint ---
$lint = if ($env:HEALTH_LINT) { $env:HEALTH_LINT } else { "auto" }
if ((Is-Required "lint") -and $lint -eq "true") { Die "required lint gate cannot be skipped" }
if ($lint -eq "auto") {
  if (Has-Script "lint") { $script:Checks++; Run "lint" { & $PM run lint } }
  elseif (Is-Required "lint") { Die "required lint gate is not configured" }
}
elseif ($lint -ne "true") { $script:Checks++; Run "lint" { Invoke-Expression $lint } }

# --- typecheck ---
$tc = if ($env:HEALTH_TYPECHECK) { $env:HEALTH_TYPECHECK } else { "auto" }
if ((Is-Required "typecheck") -and $tc -eq "true") { Die "required typecheck gate cannot be skipped" }
if ($tc -eq "auto") {
  if (Has-Script "typecheck") { $script:Checks++; Run "typecheck" { & $PM run typecheck } }
  elseif (Is-Required "typecheck") { Die "required typecheck gate is not configured" }
}
elseif ($tc -ne "true") { $script:Checks++; Run "typecheck" { Invoke-Expression $tc } }

# --- test ---
$test = if ($env:HEALTH_TEST) { $env:HEALTH_TEST } else { "auto" }
if ((Is-Required "test") -and $test -eq "true") { Die "required test gate cannot be skipped" }
if ($test -eq "auto") {
  if ($env:HEALTH_FOCUSED) { $script:Checks++; Run "test (focused: $env:HEALTH_FOCUSED)" { & $PM test -- $env:HEALTH_FOCUSED } }
  elseif (Has-Script "test") { $script:Checks++; Run "test" { & $PM test } }
  elseif (Is-Required "test") { Die "required test gate is not configured" }
  else { Step "test: no test script — skipping (add one to tighten this gate)" }
} elseif ($test -ne "true") { $script:Checks++; Run "test" { Invoke-Expression $test } }

# --- e2e & visual regression tests (Tier 3) ---
$e2e = if ($env:HEALTH_E2E) { $env:HEALTH_E2E } else { "auto" }
if ((Is-Required "e2e") -and $e2e -eq "true") { Die "required e2e gate cannot be skipped" }
if ($e2e -eq "auto") {
  if (Has-Script "test:e2e") { $script:Checks++; Run "e2e" { & $PM run test:e2e } }
  elseif (Has-Script "e2e") { $script:Checks++; Run "e2e" { & $PM run e2e } }
  elseif (Is-Required "e2e") { Die "required e2e gate is not configured" }
} elseif ($e2e -ne "true") { $script:Checks++; Run "e2e" { Invoke-Expression $e2e } }

$visual = if ($env:HEALTH_VISUAL) { $env:HEALTH_VISUAL } else { "auto" }
if ((Is-Required "visual") -and $visual -eq "true") { Die "required visual gate cannot be skipped" }
if ($visual -eq "auto") {
  if (Has-Script "test:visual") { $script:Checks++; Run "visual" { & $PM run test:visual } }
  elseif (Has-Script "visual") { $script:Checks++; Run "visual" { & $PM run visual } }
  elseif (Is-Required "visual") { Die "required visual gate is not configured" }
} elseif ($visual -ne "true") { $script:Checks++; Run "visual" { Invoke-Expression $visual } }

if ($env:HEALTH_COMMAND) { $script:Checks++; Run "custom" { Invoke-Expression $env:HEALTH_COMMAND } }
if (Is-Required "cli-smoke") {
  $cliSmoke = if ($env:HEALTH_CLI_SMOKE) { $env:HEALTH_CLI_SMOKE } else { Profile-Command "cli-smoke" }
  if (-not $cliSmoke -or $cliSmoke -eq "auto") { Die "required cli-smoke gate is not configured" }
  $script:Checks++
  Run "cli-smoke" { Invoke-Expression $cliSmoke }
}
# --- profile-declared checks the steps above did not handle ------------------
# `required` is authoritative; an unmatched name must still run or fail closed.
$knownChecks = @("build", "lint", "typecheck", "test", "e2e", "visual", "cli-smoke")
foreach ($check in $script:Required) {
  if ($knownChecks -contains $check) { continue }
  $command = Profile-Command $check
  if (-not $command -or $command -eq "auto") { Die "required $check gate is not configured" }
  $script:Checks++
  Run $check { Invoke-Expression $command }
}

# --- expected files validation (Tier 3 physical check) ---
if ($env:HEALTH_EXPECTED_FILES) {
  Step "expected files validation"
  $files = $env:HEALTH_EXPECTED_FILES -split ","
  foreach ($f in $files) {
    $trimmed = $f.Trim()
    if ($trimmed) {
      # 와일드카드 패턴 지원을 위해 Resolve-Path 사용
      $found = $null
      try {
        $found = Resolve-Path $trimmed -ErrorAction SilentlyContinue
      } catch {}
      if (-not $found -and -not (Test-Path $trimmed)) {
        Die "expected file '$trimmed' was not physically found on disk after build. Build tools or SmartScreen silent drops might have interfered."
      }
    }
  }
  Ok "expected files validation"
}

# --- app/web brand completion (fail-closed, no skip variable) ---
Run "behavior-spec" { & node scripts/loop/behavior-spec.ts check }
Run "version-sync" { & node scripts/loop/version-sync.ts check }
Run "brand-assets" { & node scripts/loop/brand-assets.ts verify }
Run "deliverable-preview" { & node scripts/loop/deliverable-preview.ts verify }

if ($env:HEALTH_STRICT -eq "1" -and $script:Checks -eq 0) {
  Die "strict health requires at least one lint, typecheck, test, e2e, visual, or HEALTH_COMMAND gate"
}

Ok "health: all gates passed (multi-layer verification complete)"
