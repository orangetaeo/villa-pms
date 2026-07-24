<#
  격리 worktree 를 "병합 없이" 안전하게 정리한다.
  (병합까지 하려면 wt-finish.ps1 을 쓰세요.)

  ★수동 rmdir / git worktree remove 직접 실행 금지★ — node_modules 정션이 남은 채
  재귀삭제하면 공유 메인 node_modules 를 통째로 지운다(14회 재발). 이 스크립트는
  wt-lib.ps1 의 Remove-WtSafely 로 정션을 먼저 안전 제거·검증한 뒤에만 remove 한다.

  사용:
    powershell -ExecutionPolicy Bypass -File scripts\wt-remove.ps1 -Name 로그인버그
    powershell -ExecutionPolicy Bypass -File scripts\wt-remove.ps1 -Path C:\Projects\_worktrees\villa-pms-xxx
#>
param(
  [string]$Name,
  [string]$Path,
  [switch]$KeepBranch
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Main = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "wt-lib.ps1")

if ($Path)      { $WtPath = $Path; $Branch = $null }
elseif ($Name)  { $WtPath = Join-Path "C:\Projects\_worktrees" ("villa-pms-" + $Name); $Branch = "wt/$Name" }
else            { throw "-Name 또는 -Path 중 하나를 지정하세요." }

if ($KeepBranch) { $Branch = $null }

Write-Host "→ 안전 정리: $WtPath" -ForegroundColor DarkGray
Remove-WtSafely -Main $Main -WtPath $WtPath -Branch $Branch

Write-Host ""
Write-Host "OK  정리 완료 (공유 node_modules 미접촉)." -ForegroundColor Green
