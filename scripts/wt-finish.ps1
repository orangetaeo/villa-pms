<#
  격리 worktree 작업을 main에 반영하고 정리한다.
  핵심: 공유 main 폴더를 절대 건드리지 않는다 — 워크트리 안에서 origin/main을 병합한 뒤
        origin/main 을 fast-forward 로 갱신한다(다른 세션의 main 작업과 충돌 없음).

  사용:
    powershell -ExecutionPolicy Bypass -File scripts\wt-finish.ps1 -Name 로그인버그
#>
param(
  [Parameter(Mandatory=$true)][string]$Name
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Main   = Split-Path -Parent $PSScriptRoot
$WtPath = Join-Path "C:\Projects\_worktrees" ("villa-pms-" + $Name)
$Branch = "wt/$Name"

. (Join-Path $PSScriptRoot "wt-lib.ps1")   # Remove-WtSafely (정션 안전 정리)

if (-not (Test-Path $WtPath)) { throw "worktree 없음: $WtPath" }

# 1) 커밋 안 된 변경이 남아있으면 중단(세션 Claude가 먼저 커밋하도록)
$dirty = git -C $WtPath status --porcelain
if ($dirty) { throw "커밋되지 않은 변경이 있습니다. 먼저 커밋하세요:`n$dirty" }

Write-Host "→ 최신 main 가져와 병합(충돌은 이 격리 폴더 안에서만)..." -ForegroundColor DarkGray
git -C $WtPath fetch origin --quiet
git -C $WtPath merge origin/main --no-edit
# 여기서 충돌이 나면 스크립트가 멈춥니다 → 그 폴더에서 충돌 해결 후 다시 실행하세요.

Write-Host "→ main 을 fast-forward 로 갱신(공유 폴더 미접촉)..." -ForegroundColor DarkGray
git -C $WtPath push origin "HEAD:main"
git -C $WtPath push origin $Branch   # 브랜치 기록도 원격에 보존(선택)

Write-Host "→ worktree·브랜치 정리(정션 안전 제거 + 검증)..." -ForegroundColor DarkGray
# ★ 공유 node_modules 삭제 사고 방지: 정션이면 링크만 제거→검증→그 다음에만 remove.
#   정션 제거에 실패하면 Remove-WtSafely 가 THROW 로 중단하므로 공유 트리는 안전하다.
Remove-WtSafely -Main $Main -WtPath $WtPath -Branch $Branch

Write-Host ""
Write-Host "OK  $Branch 의 작업이 main 에 반영되고 정리되었습니다." -ForegroundColor Green
Write-Host "    (main 폴더는 다음 'git pull' 때 자동으로 최신이 됩니다)" -ForegroundColor DarkGray
