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

# node_modules — ★정션(mklink /J) 금지★.
#   정션 + 재귀삭제 조합이 정리 시 공유 메인 node_modules 를 통째로 삭제하는 사고를
#   14회 재발시켰다(worktree-junction-recursive-delete-hazard). 그래서 여기서는
#   정션 대신 "전용(dedicated) 실폴더"를 만든다 — 어떤 정리 방법(스크립트/수동/git remove)
#   으로도 100% 안전하고, 병렬 install 충돌(같은 공유 폴더 동시 재설치)도 없다.
#   메인이 건강하면 오프라인 robocopy 로 복제(빠름), 아니면 npm ci.
$nm     = Join-Path $WtPath "node_modules"
$mainNm = Join-Path $Main "node_modules"
$healthy = (Test-Path (Join-Path $mainNm ".bin")) -and (Test-Path (Join-Path $mainNm "next"))
if ($healthy) {
  Write-Host "→ node_modules 전용 복사(robocopy, 오프라인)..." -ForegroundColor DarkGray
  # /E 하위폴더 포함, /MT 병렬, 로그 억제. exit code >=8 이면 실패.
  robocopy "$mainNm" "$nm" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    Write-Host "  ! robocopy 실패($LASTEXITCODE) — npm ci 로 대체" -ForegroundColor Yellow
    Push-Location $WtPath; npm ci; Pop-Location
  }
} else {
  Write-Host "→ 메인 node_modules 불완전 — 워크트리에서 npm ci..." -ForegroundColor DarkGray
  Push-Location $WtPath; npm ci; Pop-Location
}
# Prisma client 는 이 worktree 브랜치의 schema 기준으로 재생성(스키마가 다를 수 있음)
Push-Location $WtPath
try { npx prisma generate 2>$null | Out-Null } catch {}
Pop-Location
if (-not (Test-Path (Join-Path $nm ".bin"))) {
  Write-Host "  ! node_modules 준비 불완전 — 그 폴더에서 'npm ci' 를 직접 실행하세요." -ForegroundColor Yellow
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
Write-Host ""
Write-Host "정리는 반드시 스크립트로 (수동 rmdir 금지):" -ForegroundColor DarkGray
Write-Host "    반영+정리 :  scripts\wt-finish.ps1 -Name $Name" -ForegroundColor DarkGray
Write-Host "    정리만    :  scripts\wt-remove.ps1 -Name $Name" -ForegroundColor DarkGray
