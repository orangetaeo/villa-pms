# 병렬 세션 격리 — git worktree 워크플로

여러 Claude 세션을 동시에 돌릴 때 **공유 폴더·공유 git 인덱스·공유 dev 서버** 때문에
생기던 충돌(내 staged 파일이 다른 세션 커밋에 휩쓸림, ko.json 동시 편집, dev서버 500 클로버)을
**구조적으로 제거**한다. 각 세션이 자기 폴더·자기 인덱스·자기 .next·자기 포트를 가진다.

## 사용자: 새 세션 여는 법 (명령 2~3줄)

```powershell
# 1) 격리 폴더 생성 (이름은 작업 내용으로)
powershell -ExecutionPolicy Bypass -File scripts\wt-new.ps1 -Name 로그인버그

# 2) 출력된 안내대로:
cd C:\Projects\_worktrees\villa-pms-로그인버그
claude
```

그 세션에서 평소처럼 작업을 시키면 된다. **dev 서버는 안내된 포트로** 뜬다(세션마다 다름 → 충돌 없음).
작업이 끝나면 그 세션의 Claude에게 **"마무리하고 main에 반영해줘"** 라고 한다.

## Claude 세션: 워크트리 안에서의 규칙

이 폴더가 `C:\Projects\_worktrees\villa-pms-*` 이면 **격리 워크트리**다 (브랜치 `wt/<이름>`).

- **인덱스가 격리됐으므로** `git add`/`git commit` 을 평소처럼 써도 다른 세션을 휩쓸지 않는다.
  (단 `git add -A` 는 여전히 이 워크트리의 의도치 않은 파일을 담을 수 있으니 자기 파일만 add 권장)
- `messages/ko.json` 등 공유 파일도 **여기선 자유롭게 편집**한다. 병합 때 git이 합친다(겹치는 줄만 실제 충돌).
- dev 서버는 **배정된 포트**로만 띄운다: `npm run dev -- -p <포트>`.
- 작업 완료 후 main 반영:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\wt-finish.ps1 -Name <이름>
  ```
  이 스크립트는 공유 main 폴더를 건드리지 않고, 워크트리 안에서 `origin/main`을 병합한 뒤
  `origin/main`을 fast-forward로 갱신한다. **충돌이 나면** 이 폴더에서 해결 후 다시 실행한다.

## 왜 계약서(선점)만으로는 부족했나

- **계약서**: "누가 무슨 *작업*을 하나"(작업 단위 중복)를 막는다. → 여전히 필요(아래 병행).
- **worktree**: "한 폴더·한 인덱스를 동시에 *만지는*"(파일 단위) 충돌을 막는다. → 계약서로는 불가능.

둘은 보완 관계다. worktree로 폴더를 나눠도, 같은 *작업*을 둘이 잡는 걸 막으려면 계약서 선점은 계속 쓴다.

## 전환 주의

- 기존에 main 폴더(`C:\Projects\villa-pms`)에서 직접 작업하던 세션들이 남아 있으면 혼재 상태가 된다.
  이상적으로는 **main 폴더는 통합(merge) 전용**이 되고, 모든 실제 작업은 worktree에서 한다.
- 새 작업은 `wt-new.ps1`로 시작하고, 진행 중인 main-폴더 세션은 마무리되는 대로 자연히 정리한다.
