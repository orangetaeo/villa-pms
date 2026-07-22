# 계약서 — 빌라 영상 클립(VillaClip) + AI 나레이션 쇼츠

- 태스크 ID: `villa-clip-narration`
- 브랜치: `wt/villa-clip` (worktree `C:\Projects\_worktrees\villa-pms-villa-clip`)
- 기준 커밋: origin/main `a425fee`
- 담당: BE(스키마·API) → UX-VN/FE(UI) → QA
- 작성일: 2026-07-22

## 배경

빌라 등록 시 관리인(SUPPLIER)·운영자가 **직접 촬영한 영상**을 올리고, 이를 소재로
인스타 릴스·유튜브 쇼츠(15초)를 만든다. 영상에는 **음악 대신 Gemini TTS 나레이션 + 자막**을 넣는다.

기존 자산(재사용):
- `lib/youtube/edit.ts` — 클립 자동 편집(9:16 정규화·트림·xfade·워터마크·인트로·자막·CTA)
- `lib/storage.ts` — R2 presigned PUT (`presignR2PutUrl`, `youtubeClipKey`, `YT_CLIP_MAX_BYTES`)
- `app/api/youtube/clips/presign/route.ts` — ADMIN 전용 클립 업로드

문제: 클립이 `YoutubeShort.sourceClipsJson`에 종속되어 **빌라 자산이 아니다**.
한 번 올린 영상을 릴스·쇼츠·제안링크에서 재사용할 수 없다.

## 범위 (P1 — 이 계약서)

### 포함
1. **`VillaClip` 모델 신설** (additive raw SQL, `prisma/migrations-manual/`)
   - 빌라 소유 미디어 자산. `VillaPhoto`의 형제 모델
   - 상태: `UPLOADING → UPLOADED → APPROVED / REJECTED`
2. **업로드 API** — 빌라 스코프 presign + 업로드 완료 커밋(실측 검증)
   - `POST /api/villas/[id]/clips/presign` — SUPPLIER(자기 빌라)·ADMIN
   - `POST /api/villas/[id]/clips` — R2 HeadObject + ffprobe로 **실제 크기·길이·해상도 검증** 후 행 생성
   - `GET /api/villas/[id]/clips` / `DELETE .../[clipId]` / `PATCH .../[clipId]`(ADMIN 승인·반려)
3. **쿼터** — AppSetting 기반 상한(코드 배포 없이 조정 가능)
4. **UI**
   - 공급자: 빌라 등록 **직후 영상 온보딩 화면**(선택 — "나중에 하기" 가능) + `/my-villas/[id]/videos`
   - 운영자: 빌라 상세에 "영상 클립" 카드(승인·반려·삭제)

   > **설계 변경(구현 중 확정)**: 당초 "마법사 안의 선택 단계"로 잡았으나, 마법사는 마지막 단계에서
   > 한 번에 `POST /api/villas`를 호출하는 구조라 **제출 전에는 villaId가 없다**. 영상 presign은
   > 빌라 스코프(권한 검사의 근거)이므로 마법사 내부에 두면 ⑴ 최대 8×80MB File을 브라우저 메모리에
   > 들고 있다가 ⑵ 등록 성공 후 순차 업로드해야 하고, ⑶ 업로드 실패 시 등록 전체가 불확정 상태가 된다.
   > → 등록 완료 후 `/my-villas/{id}/videos?created=1`로 자동 이동하는 **사실상의 마지막 단계**로 구현.
   > 사용자 흐름(등록하면서 영상도 올린다)은 동일하고, 각 클립이 즉시 커밋돼 실패해도 클립 1개만 잃는다.
5. **감사 로그** — 전 변경 경로 `writeAuditLog()` 동시 구현 (글로벌 절대 규칙)
6. **i18n** — ko/vi 키 동시 추가

### 제외 (P2 이후 — 별도 계약서)
- Gemini TTS 나레이션 생성(`lib/gemini-tts.ts`), 대본 생성(`lib/youtube/narration.ts`)
- `edit.ts` 오디오 우선 타이밍 전환 + `narration` 오디오 모드
- ADMIN 대본 편집·재TTS UI
- Gemini vision 컷 자동선정, 원본 라이프사이클 삭제, 스토리지 대시보드

## 정책값 (확정)

| 항목 | 값 | 근거 |
|---|---|---|
| 클립 1개 최대 크기 | 80MB | 베트남 모바일 데이터. ADMIN 500MB와 별개 상한 |
| 클립 1개 최대 길이 | 30초 | 쇼츠 소재는 짧은 컷이 유리 |
| 빌라당 클립 수 | 8개 | `edit.ts` `CLIP_COUNT_MAX = 8`과 정합 |
| 허용 MIME | `video/mp4`, `video/quicktime` | 기존 `isAllowedClipMime` 재사용 |
| 최소 해상도 | 짧은 변 ≥ 540px | 9:16 1080×1920 업스케일 방지 |
| 마케팅 사용 | `APPROVED`만 | 검수 게이트 원칙 3 정합 |

AppSetting 키: `VILLA_CLIP_MAX_BYTES`, `VILLA_CLIP_MAX_DURATION_SEC`, `VILLA_CLIP_MAX_PER_VILLA`
(미설정 시 위 기본값 폴백 — 무중단)

## 완료 기준 (테스트 가능)

- [ ] C1. SUPPLIER가 **자기 빌라**에 presign 요청 → 200 + `key`·`uploadUrl` 반환
- [ ] C2. SUPPLIER가 **남의 빌라**에 presign 요청 → 403, 행 생성 없음
- [ ] C3. 비로그인 → 401 / VENDOR·PARTNER → 403
- [ ] C4. 클라 신고 크기를 속여도(작게 신고 후 큰 파일 PUT) **커밋 단계 HeadObject 실측**에서 거부 → `TOO_LARGE`, R2 객체 삭제
- [ ] C5. 31초 클립 커밋 → ffprobe 실측으로 `TOO_LONG` 거부
- [ ] C6. 9번째 클립 커밋 시도 → `QUOTA_EXCEEDED`
- [ ] C7. 허용 외 MIME(`video/webm`) → 400
- [ ] C8. SUPPLIER는 `PATCH`(승인) 호출 시 403 — 자기 영상을 스스로 승인할 수 없음
- [ ] C9. 승인·반려·삭제·생성 전 경로에 AuditLog 행이 남는다
- [ ] C10. 공급자 화면 어디에도 원가·마진·판매가가 없다 (원칙 2)
- [ ] C11. 마법사에서 영상 단계를 **건너뛰어도** 빌라 등록이 완료된다
- [ ] C12. ko/vi 양쪽 키 존재, 하드코딩 한국어 0 (공급자 화면)
- [ ] C13. `npm run lint && npm run typecheck && npx next build` 통과
- [ ] C14. 기존 ADMIN 경로(`/api/youtube/clips/presign`) 동작 무변경 — 회귀 없음

## 검증 방법

1. `npm run typecheck` + `npm run lint` + `next build` (배포 게이트)
2. `npx vitest run` — 신규 유닛 테스트(쿼터·검증 순수함수)
3. QA 서브에이전트가 권한 매트릭스 수기 검증 (C1~C10) — **작성자 자기평가 무효**
4. 프로덕션 배포 후 Playwright로 공급자 업로드 1회 실사용 확인

## 수정 금지 구역 (다른 세션 작업 중)

아래는 다른 worktree가 점유 중이므로 **절대 수정하지 않는다**:
- `wt/marketing-s2` — `lib/youtube/edit.ts`, `app/(admin)/marketing/youtube/**`
- `wt/marketing-list-collapse` — `app/(admin)/marketing/instagram/**`
- `wt/agreement-editor` — `lib/agreement*.ts`, `app/(admin)/settings/**`
- `wt/supplier-settlement-ui`, `wt/settlement-status` — `app/(supplier)/earnings/**`, `lib/checkout-settlement.ts`
- `wt/mobile-opt` — 전역 CSS 레이아웃 규칙

공유 파일은 **추가만**: `messages/ko.json`·`vi.json`(키 추가), `prisma/schema.prisma`(모델 추가).
`package.json`은 동결 — 신규 의존성 없음(ffprobe-static·@aws-sdk 모두 기존 설치분 재사용).

## 리스크

| 리스크 | 대응 |
|---|---|
| presigned PUT은 브라우저→R2 직결이라 서버가 완료를 모름 | 커밋 API에서 HeadObject 실측. 미커밋 객체는 고아 → P3 정리 cron |
| Railway 컨테이너에서 ffprobe 다운로드+실행 부하 | 커밋 시 1회, 클립당 수백ms. 편집(ffmpeg)은 기존 잡 러너가 담당 |
| 공급자 영상의 마케팅 이용 허락 | 사업 계약서 `termsJson`에 콘텐츠 이용허락 조항 추가 — **별도 태스크로 분리**(법무 검토 필요) |
| 공유 node_modules generate 레이스 | worktree의 `node_modules`는 메인 폴더 정션 → 다른 세션 `prisma generate`가 additive 타입을 되돌림. **메인 폴더 schema.prisma에 VillaClip 블록 선반영**(미커밋)으로 안정화 |

## 구현 결과 (2026-07-22)

| 게이트 | 결과 |
|---|---|
| `npx tsc --noEmit` | 통과 |
| `npm run lint` | 신규 파일 error·warning 0 |
| `npx next build` | 통과 — `/my-villas/[id]/videos` 라우트 등록 확인 |
| `npx vitest run` (villa-clip, villa-notify) | 18 passed |
| 라이브 DB 마이그레이션 | 적용·검증 완료(컬럼 18·인덱스 4·Prisma 조회 OK) |

신규 파일: `lib/villa-clip.ts`, `lib/villa-clip.test.ts`,
`app/api/villas/[id]/clips/{presign/route.ts, route.ts, [clipId]/route.ts}`,
`app/(supplier)/my-villas/[id]/videos/{page.tsx, clip-manager.tsx}`,
`app/(admin)/villas/[id]/clip-review.tsx`, `prisma/migrations-manual/2026-07-22-villa-clip.sql`

수정 파일: `prisma/schema.prisma`, `lib/storage.ts`, `lib/villa-notify.ts`, `lib/zalo.ts`,
`app/(supplier)/layout.tsx`, `app/(supplier)/my-villas/new/villa-wizard.tsx`,
`app/(supplier)/my-villas/[id]/page.tsx`, `app/(admin)/villas/[id]/page.tsx`,
`messages/{ko,vi}.json`
