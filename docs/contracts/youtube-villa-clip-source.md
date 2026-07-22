# 계약서 — 쇼츠 편집 소재로 VillaClip 사용 (소비처 연결)

- 태스크 ID: `youtube-villa-clip-source`
- 브랜치: `wt/clip-source` (worktree `C:\Projects\_worktrees\villa-pms-clip-source`)
- 기준 커밋: origin/main `fce2b8a`
- 담당: BE(API·검증) → FE(마법사 UI) → QA
- 작성일: 2026-07-22

## 배경 (왜 지금 이걸 하나)

`VillaClip`(P1)은 **소비처가 0개**다. 프로덕션 실측:

- `VillaClip` 행 = **0** (공급자 업로드 0건)
- 지금까지 발행된 쇼츠·릴스의 소재는 전부 ADMIN 전용 경로(`/api/youtube/clips/presign`,
  키 `youtube-clips/…`)로 **그때그때 다시 올린 파일**이다.

즉 P1의 목적("관리인이 찍은 영상을 빌라 자산으로 승격해 쇼츠·릴스·제안링크에서 재사용")이
**연결이 없어서 성립하지 않는다**. 공급자에게 업로드를 독려해도 쓸 데가 없으므로 **연결이 먼저**다.

현재 구조:

| | 소재 키 | 출처 | 재사용 |
|---|---|---|---|
| 지금 | `youtube-clips/{hex}.mp4` | 마법사 STEP 1에서 매번 새 업로드 | 불가(쇼츠 1건에 종속) |
| 목표 | `villa-clips/{hex}.mp4` | 빌라의 **APPROVED** VillaClip | 가능(빌라 자산) |

## 범위 (포함)

1. **편집 잡 생성 API가 VillaClip을 소재로 받는다**
   - `POST /api/youtube/edit-jobs` — `params.clips[]` 항목에 `key` 대신 **`villaClipId`** 허용
   - 서버가 `villaClipId` → `r2Key`로 **해석**한다. ★클라이언트는 `r2Key`를 애초에 볼 수 없다
     (`GET /api/villas/[id]/clips`의 `CLIP_SELECT`에 `r2Key`가 없다) — 이 비대칭을 유지한다.
2. **소재 자격 검증(서버 단독 판단)**
   - `status === APPROVED`만 소재가 된다(검수 게이트 = 사업 원칙 3)
   - 한 잡의 모든 클립은 **같은 빌라** 소속이어야 한다(다른 빌라 영상 혼입 차단)
   - `params.villaId`가 있으면 클립의 빌라와 **일치**해야 한다
   - 미존재·미승인·타빌라 = 400(어느 경우든 같은 코드로 수렴 — 존재 누설 차단)
3. **키 형식 화이트리스트 확장** — `lib/youtube/edit.ts` `CLIP_KEY_RE`가 `villa-clips/` 접두도 허용.
   ★ 이 정규식의 목적은 "임의 R2 키 조회 차단"이므로 **접두 2종으로 한정**한다(와일드카드 금지).
   ★ 추가 방어: 라우트에서 `villa-clips/` 키는 **APPROVED VillaClip 행으로 존재함**을 확인한다
   (params에 키를 직접 써넣는 우회 경로도 같은 게이트를 지나게 한다).
4. **마법사 UI** — `/marketing/youtube/create` STEP 1에 **「빌라 영상 불러오기」** 패널
   - 빌라 선택 → APPROVED 클립 목록(공간 라벨·길이·해상도) → 체크해서 소재로 추가
   - 불러온 클립은 업로드 없이 즉시 "완료" 상태(재업로드 0)
   - 여기서 고른 빌라는 STEP 2의 빌라 선택에 **prefill**(같은 값을 두 번 고르게 하지 않는다)
5. **`sourceClipsJson`** — 기존대로 키 목록을 기록한다. `villa-clips/` 접두 자체가 출처 증빙이므로
   **스키마 변경 0**(컬럼 추가 없음).
6. i18n ko/vi 키 동시 추가(`adminYoutube` NS — 기존 NS라 화이트리스트 변경 불필요)

## 제외 (별도 판단)

- 공급자 화면에서 "내 영상이 어디에 쓰였는지" 보여주기 — 소비 기록 UI는 별건
- 릴스(`cron/instagram-draft`)의 자동 소재 선정에 VillaClip 투입 — 자동 파이프라인은 승인·품질
  판단이 사람 없이 돌아가므로, **수동 마법사에서 먼저 검증**한 뒤 별도 태스크로
- 원본 라이프사이클(사용된 클립 보존·삭제 정책)

## 완료 기준 (테스트 가능)

- [ ] C1. APPROVED VillaClip id 3개로 편집 잡 생성 → 201, `sourceClipsJson`에 `villa-clips/…` 3건
- [ ] C2. `UPLOADED`(미승인) 클립 id → 400 `CLIP_NOT_USABLE`, 잡 생성 없음
- [ ] C3. 서로 **다른 빌라**의 클립을 섞으면 → 400 `CLIP_VILLA_MISMATCH`
- [ ] C4. `params.villaId`와 클립 소속 빌라가 다르면 → 400 `CLIP_VILLA_MISMATCH`
- [ ] C5. 미존재 villaClipId → 400(C2와 동일 코드 — 존재 누설 없음)
- [ ] C6. `params.clips[].key`에 임의의 `villa-clips/…` 문자열을 직접 넣어도 → 400(DB 확인 게이트)
- [ ] C7. 기존 `youtube-clips/` 업로드 경로는 **동작 무변경**(회귀 없음)
- [ ] C8. SUPPLIER·비로그인이 edit-jobs 호출 → 403/401 (기존 게이트 유지)
- [ ] C9. 마법사에서 불러온 클립으로 렌더까지 성공(길이·순서·자막 정상)
- [ ] C10. 마법사·API 어디에도 원가·마진·판매가 노출 없음
- [ ] C11. ko/vi 키 동시 존재, 하드코딩 한국어 0
- [ ] C12. `npm run lint && npx tsc --noEmit && npx next build` 통과
- [ ] C13. `npx vitest run` — 신규 유닛 통과, 기존 baseline(5건) 외 신규 실패 0

## 검증 방법

1. 신규 유닛 테스트 — 소재 해석·검증 순수함수(`lib/youtube/villa-clip-source.ts`)
2. 배포 게이트 3종
3. 프로덕션: **VillaClip이 0행**이라 실사용 검증에는 클립 1개 업로드가 선행돼야 한다.
   운영자 계정으로 실빌라에 1건 업로드 → 승인 → 마법사에서 불러오기 → 렌더까지 확인.
   (그 자체가 "첫 VillaClip 생산"이라 P1 완성 확인을 겸한다)

## 수정 금지 구역

`wt/marketing-s2`는 **main에 병합 완료**(origin/main..HEAD 비어 있음)라 점유 해제됨 — `lib/youtube/edit.ts`와
`app/(admin)/marketing/youtube/**` 수정 가능. 그 외 활성 worktree(`agreement-editor`, `mobile-opt`,
`supplier-settlement-ui`, `settlement-status`) 영역은 건드리지 않는다.

스키마 변경 0 · 신규 의존성 0 · 마이그레이션 0.

## 리스크

| 리스크 | 대응 |
|---|---|
| `CLIP_KEY_RE` 확장이 임의 R2 키 조회 구멍이 됨 | 접두 2종 한정 + 라우트에서 APPROVED 행 존재 확인(이중) |
| 다른 빌라 영상이 한 쇼츠에 섞임 | 단일 빌라 강제(C3·C4). 소재 출처가 곧 콘텐츠 신뢰도 |
| 마법사 STEP 1(클립)과 STEP 2(빌라)의 순서 역전 | 불러오기 패널이 자체 빌라 선택을 갖고 STEP 2에 prefill |
| 미승인 클립이 발행물에 노출 | APPROVED만 허용(C2) — 검수 게이트 원칙과 동일선 |
