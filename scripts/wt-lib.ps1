<#
  wt-lib.ps1 — worktree 안전 정리 공용 함수 (dot-source 전용).

  존재 이유: node_modules 정션(Junction)이 남은 채 `git worktree remove --force`
  또는 `Remove-Item -Recurse` 를 실행하면 재귀 삭제가 정션을 "따라 들어가"
  공유 메인 node_modules 를 통째로 삭제한다(14회 재발한 사고).

  이 라이브러리의 계약:
    1) node_modules 가 reparse point(정션/심링크)이면 링크만 제거하고 대상은 절대 안 건드린다.
    2) 제거 후 반드시 검증한다 — 정션이 살아있으면 THROW 로 중단(삭제로 진행하지 않는다).
    3) 재귀 삭제 직전마다 다시 한 번 "reparse point 아님"을 단언한다(이중 안전장치).

  wt-new.ps1 은 애초에 정션을 만들지 않으므로(전용 node_modules) 신규 worktree 엔
  이 hazard 자체가 없다. 이 라이브러리는 (a) 과거 정션 worktree, (b) 수동 생성 정션을
  안전하게 걷어내기 위한 방어선이다.
#>

# node_modules 를 안전하게 제거한다.
#  - reparse point(정션/심링크): 링크만 삭제(대상 보존) + 검증
#  - 실제 폴더(전용 설치): 재귀 삭제(자기 것이므로 안전)
function Remove-WtNodeModules {
  param([Parameter(Mandatory=$true)][string]$WtPath)

  $nm = Join-Path $WtPath "node_modules"
  if (-not (Test-Path $nm)) { return }

  $item    = Get-Item $nm -Force
  $reparse = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0

  if ($reparse) {
    $target = ($item.Target -join ";")
    Write-Host "  · node_modules 정션 감지 → 링크만 제거 (대상 보존: $target)" -ForegroundColor DarkGray
    # 비재귀 삭제: reparse point 는 링크 자체만 지워지고 대상 내용은 보존된다.
    try { [System.IO.Directory]::Delete($nm, $false) } catch {}
    # 폴백 (혹시 위가 실패하면 rmdir 도 정션엔 링크만 제거)
    if (Test-Path $nm) { cmd /c rmdir "$nm" 2>$null | Out-Null }
  } else {
    Write-Host "  · node_modules 전용 실폴더 → 재귀 삭제(자기 것)" -ForegroundColor DarkGray
    Remove-Item -Recurse -Force $nm
  }

  # ★검증: 아직 존재하고 reparse point 이면 절대 진행 금지 — 공유 트리 삭제 방지
  if (Test-Path $nm) {
    $still = Get-Item $nm -Force
    $stillReparse = ($still.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    if ($stillReparse) {
      throw "치명적 중단: node_modules 정션을 제거하지 못했습니다 → $nm`n" +
            "  (dev 서버가 잠갔을 수 있음). 이 상태로 worktree remove 를 진행하면 공유 node_modules 가 삭제됩니다.`n" +
            "  해당 worktree 의 dev/build 프로세스를 종료한 뒤 다시 실행하세요."
    }
    # reparse 는 아닌데 남아있음(부분 삭제 등) — 재시도
    Remove-Item -Recurse -Force $nm -ErrorAction SilentlyContinue
    if (Test-Path $nm) { throw "중단: $nm 제거 실패(수동 확인 필요)." }
  }
}

# worktree 전체를 안전하게 정리한다. node_modules → git remove → 잔여폴더 순.
function Remove-WtSafely {
  param(
    [Parameter(Mandatory=$true)][string]$Main,
    [Parameter(Mandatory=$true)][string]$WtPath,
    [string]$Branch
  )

  if (-not (Test-Path $WtPath)) {
    Write-Host "  (이미 없음: $WtPath)" -ForegroundColor DarkGray
    git -C $Main worktree prune
    if ($Branch) { git -C $Main branch -D $Branch 2>$null | Out-Null }
    return
  }

  # 1) node_modules 먼저 안전 제거 + 검증(THROW 시 여기서 중단 → 아무것도 안 지워짐)
  Remove-WtNodeModules -WtPath $WtPath

  # 2) 이중 안전장치: git remove 도 살아있는 정션을 따라간다 → reparse 없음 재확인
  $nm = Join-Path $WtPath "node_modules"
  if (Test-Path $nm) {
    $i = Get-Item $nm -Force
    if (($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "중단: $nm 이 아직 정션입니다. worktree remove 를 진행하지 않습니다."
    }
  }

  # 3) git worktree remove (이제 정션 없음 → 안전)
  git -C $Main worktree remove $WtPath --force

  # 4) 잔여 폴더만 재귀 삭제 — 삭제 직전 node_modules 재파스 최종 단언
  if (Test-Path $WtPath) {
    $nm2 = Join-Path $WtPath "node_modules"
    if (Test-Path $nm2) {
      $i2 = Get-Item $nm2 -Force
      if (($i2.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "치명적 중단: git remove 후에도 node_modules 정션이 남음 → $nm2. 수동 확인 필요."
      }
    }
    Remove-Item -Recurse -Force $WtPath
  }

  git -C $Main worktree prune
  if ($Branch) { git -C $Main branch -D $Branch 2>$null | Out-Null }
}
