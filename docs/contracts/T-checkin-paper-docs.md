# T-checkin-paper-docs — 체크인 종이서류 사진 업로드 (#1)

## 배경
테오 2026-06-24 신규요구 #1: "체크인 후 종이 서류 받은 걸 담당자가 사진찍어서 업로드할 수 있게."
= 체크인 시 받은 종이 서류(현장 서명 동의서·게스트 등록 양식 등)를 담당자가 촬영·업로드해 증빙 보관.

## 설계 (그라운딩 실측 기반)
- **저장**: 비공개 증빙 — 여권 파이프라인 **그대로 재사용**. `app/api/uploads/passport`가 `kind` 파라미터로
  prefix를 분기(현재 `signature`→`sig-`). **`kind=paper-doc`→`doc-` prefix 추가**(1줄). 저장은 `savePassportFile`
  (비공개 디스크), 서빙은 ADMIN 가드 `/api/passports/[name]`(기존). → 종이서류 URL = `/api/passports/doc-...`.
- **모델**: `CheckInRecord.paperDocUrls String[] @default([])` (additive). 여권(passportPhotoUrls)과 별 필드.
- **추가 API**: 신규 `PATCH app/api/bookings/[id]/checkin/paper-docs/route.ts` — CheckInRecord에 paperDocUrls 추가/교체
  (ADMIN/operator, 체크인 기록 존재 시만, AuditLog). **체크인 폼/agreement-section·checkin route 비접촉**(충돌 회피).
- **UI**: 예약 상세(`app/(admin)/bookings/[id]/page.tsx`)의 체크인 기록 영역에 **종이서류 업로드 섹션**(post-checkin).
  기존 사진 썸네일(`/api/passports/doc-...`, ADMIN 서빙) + 업로드 버튼. 체크인 폼(별 파일)은 손대지 않음.

## 범위
1. 스키마 `CheckInRecord.paperDocUrls String[] @default([])` additive + **db push(TDA 단독 세션 — 현재 활성 세션 0)**.
2. `app/api/uploads/passport` — `kind=paper-doc`→`doc-` prefix 분기 추가(여권/서명/서류 3종 증빙 구분).
3. 신규 `PATCH /api/bookings/[id]/checkin/paper-docs` — paperDocUrls 저장(ADMIN/operator·기록 존재 가드·AuditLog).
4. 예약 상세 체크인 기록 영역에 종이서류 업로드·열람 UI(ADMIN/STAFF, 비공개 썸네일).
5. i18n ko/vi(라벨). 단위테스트 + QA.

## 범위 밖
- 체크인 폼/agreement-section 수정(agreement-editor 세션 영역 — 비접촉, post-checkin 상세에만 추가).
- OCR·자동분류(종이서류는 증빙 보관만, 여권 OCR과 무관).
- 종이서류 Zalo 전달(여권 tamtru와 별개 — 필요 시 후속).

## 수정 금지 구역 (병렬 — 2026-06-25 활성 세션 0이나 보존)
- `app/(admin)/bookings/[id]/checkin/*`(agreement-editor Phase B 대비), `lib/agreement.ts`.
- 비접촉 — 본 태스크는 예약 상세 + 신규 API + 여권 업로드 route(prefix 1줄)만.

## 완료 기준 (테스트 가능)
- [ ] `kind=paper-doc` 업로드 → `/api/passports/doc-<name>` 반환, 비공개 디스크 저장. ADMIN/operator만(401/403 가드).
- [ ] `PATCH /api/bookings/[id]/checkin/paper-docs` → CheckInRecord.paperDocUrls 저장. 체크인 기록 없으면 404/409. AuditLog 기록.
- [ ] 예약 상세에 업로드한 종이서류 썸네일 표시(ADMIN 서빙). 비로그인/SUPPLIER 접근 차단(서빙 라우트 기존 가드).
- [ ] 누수 0: 종이서류는 ADMIN 전용 증빙(공급자·공개 미노출). 마진·판매가 무관.
- [ ] `npm run typecheck` 0, `npm test` 그린(신규 단위테스트), `next build` 통과.

## 검증
- 단위테스트: prefix 분기(paper-doc→doc-), paper-docs PATCH 가드(기록 없음·비ADMIN·AuditLog).
- QA 독립 평가: 업로드·서빙 ADMIN 가드 실증, SUPPLIER/비로그인 차단, 누수 0.

## 담당 / 파이프라인
TDA(스키마 db push) → BE(업로드 prefix·PATCH API) → FE(예약 상세 UI) → QA 독립 평가 → PM 보고.
