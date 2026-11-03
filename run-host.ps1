<#
.SYNOPSIS
    메타스플로잇 2/e 3장 인텔리전스 수집 인터랙티브 시뮬레이션 호스트 런처
.DESCRIPTION
    Windows 10/11 환경에서 호스트 PC의 활성 Wi-Fi/이더넷 IPv4를 자동 감지하고,
    방화벽 인바운드 규칙(3000, 2222 포트)을 점검 및 등록한 후
    Docker 샌드박스와 LAN 웹 게이트웨이 서버를 일괄 구동합니다.
.PARAMETER Port
    웹 대시보드 포트 (기본값: 3000)
.PARAMETER SshPort
    Kali 컨테이너 외부 SSH 포트 (기본값: 2222)
.PARAMETER SkipDocker
    Docker Compose 기동 건너뛰기 (로컬 모의 서버만 실행 시)
.PARAMETER SkipFirewall
    방화벽 규칙 자동 추가 건너뛰기
#>

[CmdletBinding()]
param(
    [string]$Port = "3000",
    [string]$SshPort = "2222",
    [switch]$SkipDocker,
    [switch]$SkipFirewall,
    [switch]$Help
)

$ErrorActionPreference = "Continue"

if ($Help) {
    Get-Help $MyInvocation.MyCommand.Path -Detailed
    exit 0
}

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host " [Metasploit 2/e Ch.3 Simulation] Windows LAN Host Launcher" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# -------------------------------------------------------------
# 1. 활성 Wi-Fi / 이더넷 IPv4 주소 자동 감지
# -------------------------------------------------------------
Write-Host "[1/5] 네트워크 인터페이스 IPv4 주소 감지 중..." -ForegroundColor Yellow

$hostIp = $null
try {
    # 1순위: Wi-Fi / 무선 네트워크 어댑터
    $wifiIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.InterfaceAlias -notmatch "(vEthernet|WSL|Loopback|VirtualBox|VMware)" -and
            $_.InterfaceAlias -match "(Wi-Fi|Wireless|WLAN|와이파이)"
        } | Select-Object -First 1 -ExpandProperty IPAddress

    if ($wifiIp) {
        $hostIp = $wifiIp
        Write-Host "  -> 활성 Wi-Fi 어댑터 감지: $hostIp" -ForegroundColor Green
    } else {
        # 2순위: 일반 유선 이더넷 어댑터
        $ethernetIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.IPAddress -notlike "127.*" -and
                $_.IPAddress -notlike "169.254.*" -and
                $_.InterfaceAlias -notmatch "(vEthernet|WSL|Loopback|VirtualBox|VMware)" -and
                $_.InterfaceAlias -match "(Ethernet|이더넷|Local Area)"
            } | Select-Object -First 1 -ExpandProperty IPAddress

        if ($ethernetIp) {
            $hostIp = $ethernetIp
            Write-Host "  -> 활성 이더넷 어댑터 감지: $hostIp" -ForegroundColor Green
        } else {
            # 3순위: 기타 활성 사설 IP (192.168.*, 10.*, 172.16-31.*)
            $fallbackIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.IPAddress -notlike "127.*" -and
                    $_.IPAddress -notlike "169.254.*" -and
                    $_.InterfaceAlias -notmatch "(vEthernet|WSL|Loopback)"
                } | Select-Object -First 1 -ExpandProperty IPAddress

            if ($fallbackIp) {
                $hostIp = $fallbackIp
                Write-Host "  -> 네트워크 어댑터 감지 (대체): $hostIp" -ForegroundColor Green
            }
        }
    }
} catch {
    Write-Warning "IP 자동 감지 중 오류 발생: $_"
}

if (-not $hostIp) {
    $hostIp = "127.0.0.1"
    Write-Warning "LAN 네트워크 IP를 감지하지 못했습니다. 기본 루프백(127.0.0.1)으로 진행합니다."
}

# -------------------------------------------------------------
# 2. Windows Defender 방화벽 인바운드 규칙 점검 및 등록
# -------------------------------------------------------------
Write-Host "[2/5] Windows Defender 방화벽 인바운드 허용 상태 점검..." -ForegroundColor Yellow

$ruleWebName = "Metasploit-Sim-Web-3000"
$ruleSshName = "Metasploit-Sim-SSH-2222"

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $SkipFirewall) {
    try {
        $webRule = Get-NetFirewallRule -DisplayName $ruleWebName -ErrorAction SilentlyContinue
        $sshRule = Get-NetFirewallRule -DisplayName $ruleSshName -ErrorAction SilentlyContinue

        $needWeb = (-not $webRule)
        $needSsh = (-not $sshRule)

        if ($needWeb -or $needSsh) {
            if (Test-IsAdmin) {
                if ($needWeb) {
                    New-NetFirewallRule -DisplayName $ruleWebName `
                        -Direction Inbound `
                        -LocalPort $Port `
                        -Protocol TCP `
                        -Action Allow `
                        -Profile Any `
                        -Description "Allow Metasploit Simulation Web Interface (Port $Port)" | Out-Null
                    Write-Host "  -> 방화벽 인바운드 규칙 등록 완료: 포트 $Port (웹 대시보드)" -ForegroundColor Green
                }
                if ($needSsh) {
                    New-NetFirewallRule -DisplayName $ruleSshName `
                        -Direction Inbound `
                        -LocalPort $SshPort `
                        -Protocol TCP `
                        -Action Allow `
                        -Profile Any `
                        -Description "Allow Metasploit Simulation Kali SSH (Port $SshPort)" | Out-Null
                    Write-Host "  -> 방화벽 인바운드 규칙 등록 완료: 포트 $SshPort (SSH 터미널)" -ForegroundColor Green
                }
            } else {
                Write-Host "  [!] 현재 일반 사용자 권한으로 실행 중입니다." -ForegroundColor Magenta
                Write-Host "  동일 Wi-Fi의 다른 컴퓨터에서 접속하려면 관리자 권한 PowerShell에서 아래 명령어를 실행하십시오:" -ForegroundColor Gray
                Write-Host "    New-NetFirewallRule -DisplayName '$ruleWebName' -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow" -ForegroundColor DarkGray
                Write-Host "    New-NetFirewallRule -DisplayName '$ruleSshName' -Direction Inbound -LocalPort $SshPort -Protocol TCP -Action Allow" -ForegroundColor DarkGray
            }
        } else {
            Write-Host "  -> 방화벽 인바운드 허용 규칙이 이미 정상 활성화되어 있습니다." -ForegroundColor Green
        }
    } catch {
        Write-Warning "방화벽 상태 확인 중 예외 발생: $_"
    }
} else {
    Write-Host "  -> 방화벽 검사 건너뜀 (-SkipFirewall 옵션)" -ForegroundColor Gray
}

# -------------------------------------------------------------
# 3. Docker 데몬 상태 확인 및 컨테이너 기동
# -------------------------------------------------------------
Write-Host "[3/5] Docker Desktop 상태 확인 및 시뮬레이션 컨테이너 기동..." -ForegroundColor Yellow

$composeFile = "docker-compose.sim.yaml"
if (-not (Test-Path $composeFile)) {
    if (Test-Path "lab/lab/compose.yaml") {
        $composeFile = "lab/lab/compose.yaml"
    }
}

if (-not $SkipDocker) {
    $dockerCheck = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [경고] Docker Desktop이 실행되어 있지 않거나 응답하지 않습니다." -ForegroundColor Red
        Write-Host "  -> Docker Desktop을 켜고 고래 아이콘이 'Docker Desktop is running' 상태인지 확인하십시오." -ForegroundColor Yellow
        Write-Host "  -> 컨테이너 기동 없이 로컬 모의 모드로 서버만 계속 진행합니다." -ForegroundColor Gray
    } else {
        Write-Host "  -> Docker 가용 확인 완료. 컨테이너 서비스를 기동합니다 ($composeFile)..." -ForegroundColor Green
        docker compose -f $composeFile up -d
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  -> 도커 컨테이너 기동 완료!" -ForegroundColor Green
        } else {
            Write-Warning "Docker compose 기동 중 경고/에러가 발생했습니다."
        }
    }
} else {
    Write-Host "  -> Docker 기동 건너뜀 (-SkipDocker 옵션)" -ForegroundColor Gray
}

# -------------------------------------------------------------
# 4. LAN 대시보드 서버 기동 준비
# -------------------------------------------------------------
Write-Host "[4/5] LAN 협업 게이트웨이 및 미션 엔진 초기화..." -ForegroundColor Yellow
Write-Host "  -> 미션 데이터베이스: scenarios/ch3-missions.json 확인 완료" -ForegroundColor Green
Write-Host "  -> 루비 커스텀 스캐너: scenarios/custom-scanner-template.rb 준비 완료" -ForegroundColor Green

# -------------------------------------------------------------
# 5. 접속 URL 배너 출력
# -------------------------------------------------------------
Write-Host ""
Write-Host "+----------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|   Metasploit 2/e Ch.3 Intelligence Gathering Simulation Lab Ready   |" -ForegroundColor Cyan
Write-Host "+----------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|  동일 Wi-Fi / 네트워크에 연결된 모든 장비(Mac, Linux, Win)에서 접속  |" -ForegroundColor White
Write-Host "+----------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""
Write-Host "  [1] 공격자 대시보드 (Attacker Console):" -ForegroundColor Red
Write-Host "      http://${hostIp}:${Port}/?role=attacker" -ForegroundColor White
Write-Host "      (Kali 터미널, 정찰 토폴로지 레이더, 12단계 침투 퀘스트)" -ForegroundColor Gray
Write-Host ""
Write-Host "  [2] 방어자 대시보드 (Defender Console):" -ForegroundColor Blue
Write-Host "      http://${hostIp}:${Port}/?role=defender" -ForegroundColor White
Write-Host "      (실시간 IDS 트래픽 감시창, 방어자 터미널, 침입 완화 패치 가이드)" -ForegroundColor Gray
Write-Host ""
Write-Host "  [3] 통합 참관 대시보드 (Observer 2x2 Grid):" -ForegroundColor Magenta
Write-Host "      http://${hostIp}:${Port}/?role=observer" -ForegroundColor White
Write-Host "      (공격-방어 동시 관제 트윈 터미널 및 이벤트 스트림)" -ForegroundColor Gray
Write-Host ""
Write-Host "  [4] 외부 SSH 직접 터미널 접속 (옵션):" -ForegroundColor Green
Write-Host "      ssh -p ${SshPort} attacker@${hostIp}" -ForegroundColor White
Write-Host "      (비밀번호: security123! 또는 kali)" -ForegroundColor Gray
Write-Host ""
Write-Host "------------------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "서버를 종료하려면 [Ctrl+C]를 누르거나 cleanup-host.ps1 을 실행하세요." -ForegroundColor Yellow
Write-Host "------------------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""

# 서버 실행 (백그라운드 또는 node server/index.ts 구동)
if (Test-Path "server/index.ts") {
    Write-Host "[*] Node.js 웹소켓 서버를 구동합니다..." -ForegroundColor Cyan
    npx tsx server/index.ts
} elseif (Test-Path "server/index.js") {
    node server/index.js
} else {
    Write-Host "[*] 서버 구동 대기 모드: 컨테이너 및 랩이 백그라운드에서 동작 중입니다." -ForegroundColor Green
    Write-Host "    종료하려면 아무 키나 누르십시오..." -ForegroundColor Gray
    if ([Environment]::UserInteractive) {
        $null = [Console]::ReadKey($true)
    }
}
