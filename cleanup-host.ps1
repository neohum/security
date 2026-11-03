<#
.SYNOPSIS
    메타스플로잇 2/e 3장 시뮬레이션 호스트 정리 스크립트
.DESCRIPTION
    실행 중인 시뮬레이션 컨테이너를 중지하고, 필요 시 Windows Defender 방화벽에
    등록된 인바운드 허용 규칙(3000, 2222 포트)을 정리합니다.
.PARAMETER RemoveFirewallRules
    시뮬레이션 전용으로 생성된 방화벽 인바운드 규칙 제거
.PARAMETER RemoveVolumes
    도커 볼륨(msf_db, kali_data)까지 완전 삭제 (초기화)
#>

[CmdletBinding()]
param(
    [switch]$RemoveFirewallRules,
    [switch]$RemoveVolumes,
    [switch]$Help
)

if ($Help) {
    Get-Help $MyInvocation.MyCommand.Path -Detailed
    exit 0
}

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host " [Metasploit 2/e Ch.3 Simulation] Host Cleanup" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Docker 컨테이너 종료
Write-Host "[1/2] 시뮬레이션 도커 컨테이너 중지 중..." -ForegroundColor Yellow

$downArgs = @("down")
if ($RemoveVolumes) {
    $downArgs += "-v"
    Write-Host "  -> 컨테이너 데이터 볼륨 삭제 옵션(-v) 적용" -ForegroundColor Yellow
}

$composeFiles = @("docker-compose.sim.yaml", "lab/lab/compose.yaml")
foreach ($cf in $composeFiles) {
    if (Test-Path $cf) {
        Write-Host "  -> docker compose -f $cf down 실행..." -ForegroundColor Gray
        docker compose -f $cf @downArgs 2>$null
    }
}
Write-Host "  -> 도커 컨테이너 정리 완료." -ForegroundColor Green

# 2. 방화벽 규칙 정리 (옵션)
$ruleWebName = "Metasploit-Sim-Web-3000"
$ruleSshName = "Metasploit-Sim-SSH-2222"

if ($RemoveFirewallRules) {
    Write-Host "[2/2] Windows Defender 방화벽 인바운드 규칙 삭제 중..." -ForegroundColor Yellow
    try {
        Remove-NetFirewallRule -DisplayName $ruleWebName -ErrorAction SilentlyContinue
        Remove-NetFirewallRule -DisplayName $ruleSshName -ErrorAction SilentlyContinue
        Write-Host "  -> 방화벽 인바운드 규칙($ruleWebName, $ruleSshName) 제거 완료." -ForegroundColor Green
    } catch {
        Write-Warning "방화벽 규칙 제거 중 예외 발생 (관리자 권한 필요할 수 있음): $_"
    }
} else {
    Write-Host "[2/2] 방화벽 규칙 유지 (삭제하려면 -RemoveFirewallRules 플래그 사용)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[✓] 시뮬레이션 호스트 환경 정리가 완료되었습니다." -ForegroundColor Cyan
Write-Host ""
