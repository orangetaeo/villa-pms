<#
  새 Claude 세션용 "격리 worktree" 생성기 — 병렬 세션 충돌(공유 인덱스 휩쓸림·dev서버 클로버) 원천 차단.
  각 세션이 자기 폴더·자기 git 인덱스·자기 .next·자기 포트를 가진다.

  사용:
    powershell -ExecutionPolicy Bypass -File scripts\wt-new.ps1 -Name 로그인버그
    (-Name 생략 시 시간 기반 자동 이름)
#>
param(
  [string]$Name = ("s" + (Get-Date -Format "MMdd-HHmm")),
  [int]$Port = 0
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Main   = Split-Path -Parent $PSScriptRoot          # 리포 루트 (scripts의 상위)
$WtRoot = "C:\Projects\_worktrees"
$WtPath = Join-Path $WtRoot ("villa-pms-" + $Name)
$Branch = "wt/$Name"

if (-not (Test-Path $WtRoot)) { New-Item -ItemType Directory -Path $WtRoot | Out-Null }
if (Test-Path $WtPath) { throw "이미 존재합니다: $WtPath  (다른 -Name 을 쓰세요)" }

Write-Host "→ 최신 main 동기화..." -ForegroundColor DarkGray
git -C $Main fetch origin --quiet

Write-Host "→ worktree 생성: $WtPath  (브랜치 $Branch, origin/main 기준)" -ForegroundColor DarkGray
git -C $Main worktree add -b $Branch $WtPath origin/main

# node_modules 공유(정션) — 빠르고 디스크 절약. 실패 시 그 폴더에서 npm ci 안내
$nm = Join-Path $WtPath "node_modules"
cmd /c mklink /J "$nm" "$(Join-Path $Main 'node_modules')" 2>$null | Out-Null
if (-not (Test-Path $nm)) {
  Write-Host "  ! node_modules 정션 실패 — 그 폴더에서 'npm ci' 한 번 실행하세요." -ForegroundColor Yellow
}

# 환경파일 복사
foreach ($f in @(".env", ".env.local")) {
  $src = Join-Path $Main $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $WtPath $f) -Force }
}

# dev 포트 자동 배정(세션마다 달라야 서버 충돌 없음)
if ($Port -eq 0) { $Port = 3000 + (Get-Random -Minimum 11 -Maximum 89) }

Write-Host ""
Write-Host "OK  격리 세션 준비 완료" -ForegroundColor Green
Write-Host "    폴더  : $WtPath"
Write-Host "    브랜치: $Branch"
Write-Host "    포트  : $Port"
Write-Host ""
Write-Host "다음 두 줄을 실행하세요:" -ForegroundColor Cyan
Write-Host "    cd `"$WtPath`""
Write-Host "    claude"
Write-Host ""
Write-Host "그 세션에서 dev 서버는:  npm run dev -- -p $Port" -ForegroundColor DarkGray
Write-Host "작업이 끝나면 그 세션의 Claude에게 '마무리하고 main에 반영해줘' 라고 하세요." -ForegroundColor DarkGray
