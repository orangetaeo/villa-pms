# img-compress-coverage — 이미지 압축/리사이즈 적용범위 사각지대 보완

## 배경
클라이언트 이미지 리사이즈 유틸 `lib/image-resize.ts`(`resizeImage(file, maxEdge=1600, quality=0.82)`)는
업로드 직전 긴 변 기준 축소 + JPEG 재인코딩을 수행한다(EXIF 회전 반영, 300KB·1600px 미만은 원본 유지,
HEIC 디코딩 실패 시 원본 폴백). 서버 sharp 압축은 ADR-0004에서 nixpacks 네이티브 바이너리 리스크로 **미채택**.

전수 점검 결과 `resizeImage`가 **일부 업로드 UI에만** 적용되어 있고, 대용량 원본(특히 아이폰 HEIC)이
서버로 직격하는 사각지대가 **4곳** 존재한다(특히 게스트 여권 촬영). 본 계약은 이 사각지대를 메운다.

> **상태: 합의 완료(구현 착수 가능)** — QA 독립검토 조건부 합의(2026-06-27). blocking 1건(게스트 여권 HEIC 폴백 가드)을 v1 범위에 포함하고 권장사항 4건 반영하여 합의 완료.
> ⚠️ **코드 미작성 — 본 문서는 계약서(범위·완료기준·검증)만.** 착수 가능.

---

## 1. 현황 표 — 모든 이미지 업로드 UI별 resizeImage 적용 여부 (실측, 2026-06-27)

| # | 업로드 UI (파일) | 업로더 역할 | 호출 라우트 | resizeImage |
|---|---|---|---|---|
| A | `app/(supplier)/my-villas/new/step-photos.tsx` (빌라사진 신규) | SUPPLIER | `/api/uploads` | **O** |
| B | `app/(supplier)/my-villas/[id]/photos/photo-manager.tsx` (빌라사진 편집) | SUPPLIER | `/api/uploads` | **O** |
| C | `app/(supplier)/my-bookings/[id]/checkin/checkin-form.tsx` | SUPPLIER | `/api/uploads/passport` | **O** |
| D | `app/(supplier)/my-bookings/[id]/checkout/checkout-form.tsx` | SUPPLIER | `/api/uploads/passport` | **O** |
| E | `app/(supplier)/cleaning/[id]/cleaning-submit.tsx` (청소제출) | SUPPLIER/CLEANER | `/api/uploads` | **O** |
| F | `app/(admin)/bookings/[id]/checkin/checkin-form.tsx` | ADMIN | `/api/uploads/passport` | **O** |
| G | `app/(admin)/bookings/[id]/checkout/checkout-form.tsx` | ADMIN | `/api/uploads/passport` | **O** |
| **1** | **`app/g/_components/guest-passport-step.tsx`** (게스트 여권 촬영) | **게스트(비로그인 토큰)** | `/api/g/[token]/passport` | **X ← 핵심** |
| **2** | **`app/(admin)/bookings/[id]/paper-docs-section.tsx`** (종이서류) | **ADMIN** | `/api/uploads/passport` (kind=paper-doc) | **X** |
| **3** | **`app/(admin)/settings/services/catalog-manager.tsx`** (서비스 사진) | **ADMIN** | `/api/uploads` | **X** |
| **4** | `app/(admin)/messages/chat-pane.tsx` (Zalo 채팅 사진 첨부) | ADMIN | `/api/zalo/conversations/[id]/share` | **X ← 범위 밖 후속(아래 §6)** |

**확정 사실 (직접 재확인 완료):**
- **#1 게스트 여권**: `upload()`(L27~38)가 원본 `file`을 그대로 `FormData`에 담아 `/api/g/[token]/passport`로 전송. `resizeImage` import 없음. `accept="image/*" capture="environment"` — 폰 카메라 직촬영(HEIC/대용량) 직격. **가장 중요**.
- **#2 종이서류**: `onFiles()`(L32~56)가 `Array.from(files)` 루프에서 원본 `file`을 `/api/uploads/passport`(kind=paper-doc)로 전송. `resizeImage` import 없음. 다중 선택(최대 30장).
- **#3 서비스 카탈로그**: `CatalogModal.handleUpload()`(L669~685)가 원본 `file`을 `/api/uploads`로 전송. `resizeImage` import 없음.
- **#4 채팅 사진(신규 발견)**: `uploadPhoto()`(chat-pane L3171~3187)가 원본 이미지를 `/api/zalo/.../share`로 전송. **다른 라우트(Zalo 외부 전송)** 이고 채팅 회귀 리스크가 있어 본 v1 범위에서 분리(§6 참고).

**서버 방어 현황:** `/api/uploads`·`/api/uploads/passport` 모두 인증·역할가드 + MIME 화이트리스트(`isAllowedImageMime`) + **5MB 제한**. **픽셀 차원(width·height) 제한은 없음.**

---

## 2. 범위(Scope)

사각지대 **#1·#2·#3** 세 곳의 업로드 핸들러에서 전송 직전 `resizeImage()`를 경유시킨다.
기존 적용된 7곳(A~G)은 **무변경**(회귀 금지).

### 2-1. 프리셋 — 일반 사진 vs 증빙(여권·종이서류) 구분
`resizeImage(file, maxEdge, quality)`에 인자가 이미 있으므로 호출부에서 값만 다르게 준다.
(권장: `lib/image-resize.ts` 상단에 named export 상수 2종 추가 — 매직넘버 산재 방지. 이 파일은 §5 수정 허용 구역.)

| 프리셋 | 용도 | maxEdge | quality | 적용 대상 |
|---|---|---|---|---|
| 일반(기존 기본) | 마케팅·일반 사진 | 1600 | 0.82 | **#3 서비스 카탈로그** (기존 A~E와 동일) |
| **증빙(고품질)** | 신원·서류 가독성 필수 | **2400** | **0.90** | **#1 여권**, **#2 종이서류** |

- **여권/종이서류 고품질 근거**: tạm trú(거주 임시신고)·신원확인용으로 여권번호·서명·도장 가독성이 필수. 일반 1600px/0.82는 과압축 위험.
- **확정값 2400px / 0.90** — QA 독립검토가 5MB 정합·여권 글자 가독성 충분 확인. 합의 완료(추가 확인 불요).
- 5MB 상한과의 정합: 2400px/0.90 JPEG는 통상 1~3MB로 5MB 이내. `resizeImage` 출력이 그래도 5MB 초과 시 기존 호출부 패턴(`blob.size > MAX_FILE_SIZE` 체크 후 에러 표시 — cleaning-submit L88 참고)을 그대로 따른다(#1·#2 사이즈 가드 — §2-2·§7).

### 2-2. 호출부 패턴 (기존 cleaning-submit과 동일)
```
import { resizeImage } from "@/lib/image-resize";
const blob = await resizeImage(file, EVIDENCE_MAX_EDGE, EVIDENCE_QUALITY); // 증빙은 고품질 프리셋
form.append("file", blob, file.name);
```
- #1·#2는 증빙 프리셋, #3은 기존 기본값(인자 생략).
- 다중 업로드(#2)는 루프 내 각 파일에 await 적용.
- **#1·#2 사이즈 가드**: `resizeImage` 출력 `blob.size > MAX_FILE_SIZE`(5MB)면 전송하지 않고 재촬영/재선택 안내(cleaning-submit L88 패턴 동일).
- **#1 게스트 여권 — HEIC 폴백 가드(QA blocking, v1 필수)**: `resizeImage`는 클라 디코딩 실패 시 원본을 그대로 반환하므로, **출력 blob이 여전히 HEIC/HEIF**(MIME `image/heic`·`image/heif` 또는 `.heic`/`.heif` 확장자)이면 = 변환 실패. 이 경우 **silent 통과·저장 금지**, 게스트에게 재촬영 안내("이 사진은 처리할 수 없습니다. 다시 촬영해 주세요")를 **5개 언어(ko/en/ru/zh/vi)** 로 표시. 비용 = if문 1개 + i18n 문구(`GuestLabels.passport`에 키 추가). 라이브러리 도입 아님, `package.json` 무변경.
  - 판정 기준(권장): `resizeImage`가 JPEG로 재인코딩 성공하면 출력 MIME은 `image/jpeg`. 출력이 jpeg가 아니면(원본 폴백) = 디코딩 실패로 간주 → 차단. (원본 file 객체의 type/name으로 heic/heif 확인.)

---

## 3. HEIC 처리 — 리스크 명시 (대응은 범위 밖/후속 분리)

**갭:** 아이폰 기본 포맷 HEIC는 다수 브라우저(특히 데스크톱 Chrome/Firefox)에서 `createImageBitmap` 디코딩이 실패한다.
`resizeImage`는 이때 **원본(HEIC)을 그대로 반환** → 서버가 heic/heif를 허용하므로 저장은 되지만,
(a) 압축 미적용으로 대용량 그대로 저장, (b) **관리인·일부 뷰어가 못 여는** HEIC 파일이 증빙으로 남는다.
게스트 여권(#1)은 폰 직촬영이라 HEIC 발생 확률이 가장 높다.

**본 계약의 처리 (QA 조건부 합의 반영):**
- **#1 게스트 여권은 v1에서 HEIC 폴백 가드 포함**(§2-2): 변환 실패(출력이 여전히 HEIC)면 silent 저장하지 않고 재촬영 안내. **라이브러리 도입은 아님** — if문 1개 + i18n. 가독성·증빙 신뢰성이 가장 중요한 여권에서 "못 여는 HEIC가 증빙으로 남는" 사고를 v1에서 차단.
- **#2 종이서류·#3 카탈로그의 HEIC는 후속 분리 유지**: 종이서류는 ADMIN이 현장 재촬영 가능하고 카탈로그는 ADMIN 데스크톱 운영이라 위험도가 낮음. 일괄 가드/라이브러리는 후속.
- **클라 HEIC 디코딩 라이브러리 도입(heic2any 등)은 전 경로 공통으로 v1 범위 밖 → 후속 태스크로 분리**. 근거: 라이브러리 추가는 번들 비용·`package.json` 변경(병렬 동결 대상)·별도 검증이 필요해 본 압축커버리지 작업과 결합하면 과설계.
- 잔여 리스크: HEIC 디코딩 가능 여부는 **브라우저·OS·버전 의존**이다(특정 브라우저가 "항상 디코딩한다"고 가정하지 않는다). 디코딩 실패 시 #1은 재촬영 안내로 수렴, #2·#3은 원본(HEIC) 저장으로 잔존 → 후속 라이브러리 도입 시 해소.
- 후속 결정 항목: HEIC 디코딩 라이브러리 도입 여부(별 계약 `img-heic-decode`로 분리 권장) — §10.

---

## 4. 서버측 방어 정책 재검토 (간단 — 과설계 금지)

클라 리사이즈는 **우회 가능**(클라 코드를 거치지 않는 직접 POST). 따라서 클라 압축은 "성능·UX 최적화"이지 보안 경계가 아니다.

- **현 5MB 제한은 유지·충분.** sharp 미채택(ADR-0004) 존중 — 서버 디코딩/리샘플은 도입하지 않는다.
- **픽셀 폭탄(decompression bomb)**: 5MB JPEG도 픽셀 차원이 거대할 수 있으나, 현재 서버는 디코딩하지 않고 바이트를 그대로 저장(saveFile)하므로 **서버 메모리 폭발 위험은 낮음**. 다운스트림(PDF 임베드·썸네일)에서 차원 의존이 생기면 그때 차원 가드 검토.
- **결론: 본 계약에서 서버 코드 변경 없음.** 차원 가드는 sharp 없이는 정확 측정이 어렵고(헤더 파싱은 별 작업), 현 위험도 대비 과설계 → **별 후속(보안 백로그)로만 기록**. (보안 에픽 `docs/SECURITY-HARDENING-PLAN-2026-06-27.md` 백로그에 1줄 추가 권장.)

---

## 5. 수정 금지 구역 (병렬 세션 충돌 방지)

본 계약은 **아래 파일만** 수정한다:
1. `app/g/_components/guest-passport-step.tsx` (#1) — **파일 업로드 부분(`upload()` 핸들러 + 재촬영 안내 i18n)만**. ⚠️ **여권 동의 미서명 시 체크인 차단(필수 게이트) 로직은 ADR-0029(여권 Zalo 전달) 담당이 별도 처리** — 본 압축 계약은 동의 게이트·체크인 흐름을 건드리지 않는다. 같은 파일을 양쪽이 만질 수 있으니 착수 시 git status·해당 세션 계약서 확인 후 핸들러 단위로만 편집(충돌 회피).
2. `app/(admin)/bookings/[id]/paper-docs-section.tsx` (#2)
3. `app/(admin)/settings/services/catalog-manager.tsx` (#3)
4. `lib/image-resize.ts` — **프리셋 상수 추가(additive)만**. 기존 `resizeImage` 시그니처·기본값·로직 변경 금지(7곳 회귀 방지).
5. (선택) `docs/SECURITY-HARDENING-PLAN-2026-06-27.md` — 차원 가드 백로그 1줄 추가만.

**비접촉(절대 수정 금지):**
- 기존 적용 7곳(A~G) — `step-photos`·`photo-manager`·공급자/운영자 checkin·checkout·`cleaning-submit`.
- `app/(admin)/messages/chat-pane.tsx` (#4) 및 `lib/watermark.ts`, `app/api/uploads/**`(서버 라우트), `lib/storage.ts`.
- `package.json`(동결 — HEIC 라이브러리는 후속 별 계약).

---

## 6. 범위 밖 (Out of Scope) → 후속 분리

- **#4 채팅 사진 첨부(chat-pane `uploadPhoto`)**: 라우트가 `/api/zalo/.../share`로 다르고 외부 Zalo 전송 경로. 압축 미적용이 트래픽·저장에 영향은 있으나 채팅 송수신·인용 회귀 리스크가 커 v1 분리. ⚠️ **테오/QA 확인**: 별 계약 `img-compress-chat`으로 후속 처리 여부.
- **HEIC 클라 디코딩 라이브러리 도입** (§3).
- **서버 차원 가드/sharp** (§4, ADR-0004 존중).

---

## 7. 완료 기준 (테스트 가능)

- [ ] **#1 게스트 여권**: 업로드 시 `resizeImage` 경유(증빙 프리셋 2400/0.90 — 확정값 적용). 디코딩 가능한 대용량 JPEG가 1600px 초과 원본 대비 축소·재인코딩되어 전송됨(네트워크 페이로드 또는 저장 파일 크기로 확인).
- [ ] **#2 종이서류**: 다중 선택 각 파일이 `resizeImage`(증빙 프리셋) 경유. 30장 루프 정상.
- [ ] **#3 서비스 카탈로그**: `resizeImage`(기존 기본 1600/0.82) 경유.
- [ ] **여권·종이서류는 일반보다 고품질 프리셋** 적용됨(코드상 maxEdge·quality가 2400/0.90).
- [ ] **가독성(측정가능)**: 2400px 출력 여권 이미지에서 **여권번호·MRZ(하단 기계판독영역) 100% 판독 가능**(QA 실측).
- [ ] **#1 여권 HEIC 블로킹(QA blocking)**: 디코딩 실패(출력이 여전히 HEIC/HEIF)면 **silent 저장되지 않고 재촬영 안내(5언어) 표시** — 변환 안 된 여권이 증빙으로 남지 않음.
- [ ] **#1·#2 사이즈 가드**: `resizeImage` 출력이 5MB 초과면 전송 차단 + 재촬영/재선택 안내(silent 실패 금지).
- [ ] **#2·#3 HEIC 폴백 보존**: 디코딩 실패 시 원본 그대로 전송돼 업로드 자체는 성공(에러 안 남) — 기존 폴백 동작 유지(이 두 경로는 후속까지 차단 안 함).
- [ ] **회귀 0**: 기존 7곳(A~G) 무변경, `resizeImage` 시그니처·기본값 무변경.
- [ ] `npm run typecheck` 0, `npm test` 그린, `next build` 통과.
- [ ] 누수 0: 본 작업은 압축만 — 여권·종이서류 비공개 증빙 경계(서빙 가드) 무변경, 마진·판매가 무관.

---

## 8. 검증 방법

- **수동/Playwright**: #1은 `/g/[token]` 여권 단계에서 대용량 이미지 업로드 → `browser_network_requests`로 전송된 `file` 파트 크기가 원본보다 작은지 확인. #2·#3 동일 방식.
- **프리셋 확인**: 코드 리뷰로 #1·#2 호출부가 증빙 프리셋(2400/0.90), #3이 기본값임을 확인.
- **#1 HEIC 블로킹**: HEIC 샘플(또는 디코딩 실패 강제)을 여권 단계에 업로드 → 저장 안 되고 5언어 재촬영 안내가 뜨는지 확인. 정상 JPEG/디코딩 가능 케이스는 통과.
- **가독성 측정**: 2400px 출력 여권 샘플에서 여권번호·MRZ 100% 판독 QA 실측(육안 + 필요 시 OCR 대조).
- **회귀**: 기존 7곳 grep로 `resizeImage` 호출 인자 무변경 확인 + build/typecheck/test 그린.
- **QA 독립 평가**(작성자≠평가자): 가독성 측정, #1 HEIC 블로킹, #2·#3 폴백 보존, 사이즈 가드, 누수 0.

---

## 9. 담당 / 파이프라인
**UX-VN**(#1 게스트 여권 — 업로드 핸들러 + HEIC 블로킹 + 5언어 재촬영 안내) · **FE**(#2 종이서류·#3 카탈로그 호출부) · **QA**(독립 평가). TDA 계약 합의 완료.
(스키마 변경 없음 — 마이그레이션 불필요. DB 무관.)

## 10. 합의 상태 / 후속 결정 항목
**합의 완료(구현 착수 가능)** — QA 독립검토 조건부 합의(2026-06-27). blocking 1건(§2-2 #1 HEIC 폴백 가드) v1 포함, 권장 4건 반영(사이즈 가드·측정가능 가독성 기준·§3 톤다운·프리셋 확정).

확정/정리됨:
- **증빙 프리셋 2400px / 0.90 확정**(QA 5MB 정합·가독성 충분 확인).

후속 분리(본 v1 범위 밖 — 별도 백로그/계약):
1. **HEIC 디코딩 라이브러리** 도입 여부(#2·#3 및 전 경로 공통 — 별 계약 `img-heic-decode` 권장).
2. **#4 채팅 사진 압축**(별 계약 `img-compress-chat` 권장).
3. **서버 차원 가드/sharp**(§4, ADR-0004 존중 — 보안 백로그).

분리 메모(충돌 회피):
- **여권 동의 미서명 시 체크인 차단(필수 게이트)** = 별개 결정 사항, **ADR-0029(여권 Zalo 전달) 범위**. 본 압축 계약과 분리하며, `guest-passport-step.tsx`는 양쪽이 만질 수 있으니 §5 메모대로 핸들러 단위로만 편집한다.
