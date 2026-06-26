# SPEC.md — Villa PMS MVP 기능 명세 v1.3

> 비즈니스 배경은 사업계획서 V1.0 참조. 본 문서는 개발 기준 명세.
> v1.1 (2026-06-11): 오픈 스펙 확정 — F0 가입·온보딩, F6 최소 정산 추가, 가격 계산·재검증·NO_SHOW 규칙 보강, 오픈 이슈 4건 확정 (ADR-0002). 런칭 플랜은 docs/LAUNCH.md.
> v1.2 (2026-06-11): F7 운영자 대시보드·예약 관리 추가 — 관리자 메뉴 구조(IA), 대시보드 정의, 예약 목록·상세, 청소 검수 목록.
> v1.3 (2026-06-11): 테오 신규 요구 4건 반영 (ADR-0003) — F3 채널별 결제 통화(KRW/VND), F1 비품 관리(마법사 5단계), F7 Zalo 채팅(b14)·관리자 반응형.

---

## F0. 가입·온보딩 (v1.1 추가)

**사용자:** SUPPLIER (자가 가입), CLEANER (ADMIN 생성)

### 자가 가입
1. `/signup` (vi, 모바일): 이름, 전화번호, 비밀번호 → SUPPLIER 계정 즉시 생성 + 로그인
2. 별도 계정 승인 절차 없음 — 빌라 승인 게이트(F1 PENDING_REVIEW)가 검증 역할
3. ADMIN은 사용자 목록에서 계정 비활성화(isActive=false) 가능 (스팸·이탈 대응)

### Zalo 계정 연결 (F5 알림 수신의 전제)
- 원리: 사용자는 각자 본인 Zalo 계정을 쓴다. 시스템에는 "PMS 계정 ↔ zaloUserId" 매핑이 한 번 필요
1. 가입 직후 안내 화면 1장: "Zalo OA 친구 추가" 버튼 (OA 링크/QR)
2. 사용자가 OA 팔로우 → Zalo webhook(follow event)으로 zaloUserId 수신
3. OA가 전화번호 공유 요청 메시지 발송 → 사용자 공유 → 가입 전화번호와 매칭 → User.zaloUserId 저장 → 연결 완료 메시지
4. 매칭 실패(전화번호 불일치) 시 ADMIN 수동 매칭 (fallback)
- 미연결 사용자는 알림을 못 받음 → ADMIN 사용자 목록에 "Zalo 미연결" 뱃지 표시

### 화면
- SUPPLIER: `/signup`, 가입 직후 Zalo 연결 안내
- ADMIN: `/users` (목록 + Zalo 연결 상태 + 비활성화 토글)

---

## F1. 빌라 등록

**사용자:** SUPPLIER (베트남어, 모바일)

### 흐름 — 마법사 5단계 (v1.3: 비품 단계 추가 — 디자인 A2→A2b→A1→A9→A5)
1. `내 빌라 → + 추가` → 단계형 마법사 (1화면 1질문, 텍스트 입력 최소화)
2. **1/5 기본 정보**: 이름, 단지(선택 드롭다운: 쏘나씨/썬셋 사나토/직접입력), 침실 수(스테퍼), 화장실 수, 최대 인원, 수영장(토글), 조식 가능(토글)
3. **2/5 위치·참고** (전부 선택 입력, 건너뛰기 가능): 주소, 월 임대 시세(VND)
4. **3/5 사진 업로드**: 공간별 카드 그리드 (외관→거실→주방→침실1..N→화장실1..N→베란다→수영장). 카드 탭 → 카메라/갤러리. 침실·화장실은 bedrooms/bathrooms 수만큼 카드 자동 생성
5. **4/5 비품** (v1.3, 선택 입력·건너뛰기 가능): 카테고리 탭 4종 — 주방용품/화장실용품/가전류/미니바. 품목 사전(itemKey, vi 라벨) 기반 체크박스, 미니바만 수량 스테퍼(물/음료/과자 비치 수량). 직접 입력은 "기타" 품목만 — 텍스트 입력 최소화 원칙
6. **5/5 원가 입력**: 시즌 3칸 (비수기/성수기/극성수기, VND). 숫자 키패드 + 천단위 자동 구분
7. 제출 → `PENDING_REVIEW` → ADMIN 승인 시 `ACTIVE`

### 규칙
- 필수: 이름, 침실, 외관·거실·침실 사진 각 1장 이상, 비수기 원가. **비품은 필수 아님** (등록 장벽 최소화) — 등록 후 내 빌라 상세에서 수정 가능
- 업로드된 사진은 `isBaseline=true` (체크아웃 비교 기준)
- ADMIN은 승인 화면에서 시즌별 판매가 2종 설정 (v1.3 — ADR-0003): `salePriceVnd` = 원가+마진 자동 제안, `salePriceKrw` = salePriceVnd × 환율 환산 제안 — 각각 오버라이드 가능
- 비품(VillaAmenity)은 Phase 1에서 **표기·조회만**. 미니바 소모 자동 차감은 Phase 2 (IDEAS.md)

### 화면
- SUPPLIER: `/my-villas`, `/my-villas/new` (마법사), 비품 입력 (디자인 A9)
- ADMIN: `/villas` (목록 + 승인 대기 필터), `/villas/[id]` (상세 + 요율 편집 + 비품 섹션 읽기 전용, 디자인 B10)
- ADMIN: `/settings/seasons` — 시즌 달력(SeasonPeriod) 연 단위 입력 (요율 계산의 기준, v1.1 추가)

---

## F2. 캘린더

**사용자:** SUPPLIER(자기 빌라), ADMIN(전체)

### 흐름
- 월 달력. 날짜 셀 상태: 🟢 공실 / 🔵 예약(HOLD=점선, CONFIRMED=실선) / ⚫ 차단(외부판매·수리)
- SUPPLIER: 빈 날짜 탭 → "차단할까요?" 바텀시트 → 기간 선택 → CalendarBlock(MANUAL) 생성. 차단 탭 → 해제
- SUPPLIER는 예약 상세(고객명·금액)를 볼 수 없고 "예약됨"만 표시 ← **마진 비공개 원칙**
- ADMIN: 전체 빌라 가로 타임라인 뷰 (빌라 × 날짜 매트릭스) — 재고 조망 핵심 화면

### iCal 동기화 (수신만)
- Villa.icalImportUrls 등록 → cron 30분마다 fetch → VEVENT를 CalendarBlock(ICAL, icalUid)으로 upsert
- 사라진 UID는 블록 삭제. 기존 내부 예약과 겹치면 ADMIN에게 충돌 알림 (더블부킹 경보)

### 가용성 판정 (lib/availability.ts — 단일 소스)
```
available(villa, range) =
  no Booking(HOLD|CONFIRMED|CHECKED_IN) overlap
  AND no CalendarBlock overlap
  AND villa.status == ACTIVE
판매 가능 = available AND villa.isSellable  (검수 게이트)
```
- 겹침 비교는 [checkIn, checkOut) half-open
- HOLD 생성은 DB 트랜잭션 + 빌라/기간 단위 잠금으로 동시성 보호 (동일 날짜 중복 홀드 불가)

---

## F3. 예약·가예약 (제안 링크)

**사용자:** ADMIN 생성 → 비로그인 고객 열람

### 흐름
1. ADMIN `/proposals/new`: 날짜·인원 입력 → 판매 가능 빌라 목록에서 2~3개 선택 → 고객명·채널·유효기간(기본 48h) → 링크 생성. **채널 선택 시 결제 통화 자동 전환** (v1.3 — 아래 결제 통화 참조)
2. 고객이 `/p/[token]` 열람 (ko): 빌라별 사진 캐러셀·시설·가격(제안 통화)·총액·조건(조식 포함 여부, 보증금 안내)·유효기간 카운트다운
3. `이 빌라로 가예약` 탭 → 이름·연락처 입력 → Booking(HOLD, holdExpiresAt=now+24~48h) 생성 → 다른 item 비활성화, Proposal=USED
4. ADMIN 입금 확인 → `확정` 버튼 → CONFIRMED → 공급자 Zalo 알림
5. cron(5분): holdExpiresAt 경과 HOLD → EXPIRED → 재고 자동 복귀 + Zalo 알림

### 결제 통화 (v1.3 — ADR-0003)
- **채널 → 통화 기본값**: DIRECT(직접 소비자) → **KRW**, TRAVEL_AGENCY·LAND_AGENCY(여행사·랜드사) → **VND**. 제안 생성 시 `Proposal.saleCurrency` 확정, ADMIN 오버라이드 가능
- **가격 산정 기준통화 = VND**: VillaRate에 시즌별 판매가 2종 사전 확정 — `salePriceVnd` = 원가+마진(% 또는 고정 VND), `salePriceKrw` = salePriceVnd × 환율 환산 제안 후 ADMIN 라운딩 오버라이드. 제안·예약은 판매 통화의 요율을 그대로 스냅샷 (제안 시점 환율 계산에 가격이 의존하지 않음)
- **환율**: AppSetting `FX_VND_PER_KRW` (1 KRW = x VND) — Phase 1은 ADMIN이 /settings에서 수동 갱신, 자동 갱신은 Phase 2(IDEAS). 제안 생성 시 `Proposal.fxVndPerKrw` 스냅샷 → HOLD 시 Booking에 복사 (참고 환산·Phase 2 마진 리포팅용)
- **표기**: VND는 ₫ + 천단위 점(8.500.000₫), KRW는 ₩ + 천단위 쉼표. 금액 목록 화면(b5/b11/b12)은 통화 기호 병기, 매출 집계(b1/b7)는 **통화별 분리 — KRW+VND 합산 금지**
- **마진 비공개 유지**: /p/[token]은 해당 통화 판매가만 노출 — 원가·마진·타통화 환산값 비노출. 통화가 무엇이든 여행사가 보는 건 판매가뿐
- 정산(F6) 무영향: 공급자 지급은 supplierCostVnd 기준 VND 그대로

### 규칙
- 제안 링크는 포함된 빌라·날짜·가격만 노출. 전체 재고·다른 날짜 조회 불가 ← **재고 비공개 원칙**
- HOLD 시점에 판매가(saleCurrency 통화 컬럼)·supplierCostVnd·fxVndPerKrw 스냅샷 저장 (이후 요율·환율 변경 무영향)
- ProposalItem·Booking 금액은 통화별 듀얼 컬럼(`*Krw Int` / `*Vnd BigInt`) — saleCurrency에 해당하는 컬럼만 필수 (lib/pricing.ts에서 검증)
- 취소: CONFIRMED → CANCELLED은 ADMIN만, cancelReason 필수

### 가격 계산 (lib/pricing.ts — 단일 소스, v1.1 추가 / v1.3 통화 분기)
- 총액 = **박별 합산**: 각 숙박일이 속한 시즌(SeasonPeriod)의 판매 통화 요율(salePriceVnd 또는 salePriceKrw)을 1박씩 더한다 — 시즌 경계에 걸친 예약은 박마다 다른 요율 적용
- SeasonPeriod 미등록 날짜는 LOW(비수기) 요율 적용
- 원가(supplierCostVnd)도 동일 방식으로 박별 합산
- 홀드 기본 시간은 AppSetting `HOLD_HOURS_DEFAULT` (기본 48) — 제안 생성 시 24h/48h 선택 가능

### 엣지 케이스 (v1.1 추가)
- **가예약 직전 재검증**: `이 빌라로 가예약` 클릭 시점에 가용성을 다시 검사 (제안 발송 후 iCal 차단 등으로 재고가 사라질 수 있음). 실패 시 HOLD 생성 거부 + "마감되었습니다" 안내 — 더블부킹 최종 방어선
- **예약 변경**(날짜·빌라 변경)은 MVP에서 지원하지 않음 — 취소 후 재생성으로 처리 (가격 스냅샷 무결성 유지). 오픈 후 수요 보고 개선
- **NO_SHOW**: 체크인 예정일이 지나도 미체크인 시 ADMIN이 수동 전환. 청소 태스크 미생성(미사용), 공급자 정산에는 기본 포함(날짜 점유 보상) — 케이스별 ADMIN 제외 가능

---

## F4. 체크인·아웃 검수

**사용자:** ADMIN (또는 위임 스태프)

### 체크인 `/bookings/[id]/checkin`
1. 여권 사진 업로드 (인원수만큼) → Gemini OCR → 이름·여권번호 자동 추출
2. `공급자에게 전달` → 여권 사진을 공급자 Zalo로 발송 (임시거주신고 위임) → tamTruSentAt 기록
3. 보증금 수취 기록 (금액·통화) → depositStatus=HELD
4. 동의서: 화면에 안전수칙(수영장 빌라는 수영장 조항 자동 포함)·기물파손·보증금 조항 표시 → 터치 서명 패드 → signatureUrl 저장
5. 완료 → status=CHECKED_IN

### 체크아웃 `/bookings/[id]/checkout`
1. 공간별 사진 촬영 (기준 사진과 나란히 비교 UI)
2. **미니바 확인** (v1.3 — ADR-0003): 빌라 비품 중 MINIBAR 품목·비치 수량을 **읽기 전용 체크리스트**로 표시 — 소모분은 차감액(VND)에 수기 반영. 수량 자동 차감·재고 추적은 Phase 2 (IDEAS.md)
3. 파손 없음 → 보증금 환불 기록(REFUNDED) / 파손 → 파손 사진 + 차감액(VND) → PARTIAL_DEDUCTED
4. 완료 → status=CHECKED_OUT → **CleaningTask(CHECKOUT) 자동 생성 + villa.isSellable=false**

### 청소 검수 게이트
1. 공급자/청소자 Zalo 알림 수신 → `/cleaning/[id]`에서 공간별 청소 완료 사진 업로드 → PHOTOS_SUBMITTED
2. ADMIN 승인 → APPROVED → **villa.isSellable=true** / 반려 → REJECTED(사유) → 재업로드
3. 정기 방역: cron 월 1회 빌라별 CleaningTask(PERIODIC) 자동 생성 (주기 고정 — ADR-0002)

### CLEANER 운영 방식 (Phase 1, v1.1 추가)
- 기본: 청소 요청 알림은 **공급자** Zalo로 발송, 공급자가 청소 사진 업로드 — CLEANER 계정 없이 운영 가능
- 선택: ADMIN이 CLEANER 계정 생성 + 태스크 배정 시 청소자에게 직접 알림·업로드 권한
- `/cleaning/[id]`는 로그인 필수 (공급자=자기 빌라만, 청소자=배정된 태스크만)

### 여권 사진 보존 정책 (v1.1 추가)
- 목적(임시거주신고) 달성 후 장기 보관 금지: **체크아웃 90일 후 삭제**
- Phase 1은 분기별 수동 삭제, 자동 삭제 cron은 Phase 2 (IDEAS.md)

---

## F5. Zalo 알림

**수신:** SUPPLIER·CLEANER (Zalo OA 메시지)

| 이벤트 | 수신자 | 내용(vi) |
|---|---|---|
| HOLD 생성 | 공급자 | 빌라·날짜 가예약 발생 |
| CONFIRMED | 공급자 | 예약 확정 (원가 기준 금액만 표기) |
| HOLD 만료/취소 | 공급자 | 날짜 복귀 |
| 체크아웃 | 공급자·청소자 | 청소 요청 + 링크 |
| 청소 승인/반려 | 청소자 | 결과 |
| 여권 전달 | 공급자 | 임시거주신고용 여권 사진 |
| 정산 확정 | 공급자 | 월 정산서 링크 (Phase 2) |

### 구현
- lib/zalo.ts: OA 메시지 발송 래퍼. Notification 레코드 생성 → 발송 → SENT/FAILED 갱신
- 실패 시 3회 재시도 cron. zaloUserId 없는 사용자는 SMS 폴백 검토(Phase 2)
- **알림에 판매가(KRW)·마진 절대 포함 금지**

---

## F6. 최소 정산 (Phase 1 — v1.1 추가)

> 전체 정산(다중 통화·환차·PDF)은 Phase 2. 하지만 오픈 다음 달부터 "공급자에게 줄 돈"은 계산돼야 하므로 최소 기능만 Phase 1에 포함. 공급자 신뢰가 이 사업의 기반.

**사용자:** ADMIN, SUPPLIER

### 흐름
1. ADMIN `/settlements`: 월 선택 → 공급자별 대상 예약(CHECKED_OUT·NO_SHOW)의 supplierCostVnd 합계 자동 집계 → Settlement(DRAFT) 생성
2. 내역 확인 → CONFIRMED → 계좌이체는 수동 → `지급 완료` → PAID (paidAt 기록) → 공급자 Zalo 알림(SETTLEMENT_READY)
3. SUPPLIER `/my-earnings`: 자기 빌라 예약별 원가와 월 합계 조회 — **자기 원가만, 판매가·마진·고객 상세 미노출**

### 규칙
- 집계 기준 = 체크아웃이 속한 월
- 보증금 차감액(deductionVnd)은 공급자 정산과 무관 (고객↔운영자 간 처리)
- Phase 1은 VND 단일 통화 지급. 다중 통화 수납·환차 기록은 Phase 2 (환전 LEDGER 패턴)
- 매출 요약 표기는 **통화별 분리** (v1.3 — ADR-0003): KRW 매출 / VND 매출을 합산하지 않고 나란히 표시. 공급자 지급(supplierCostVnd 기준 VND)은 결제 통화 도입과 무관하게 동일

---

## F7. 운영자 대시보드·예약 관리 (v1.2 추가)

**사용자:** ADMIN

### 관리자 메뉴 구조 (사이드바 — 이 순서대로, v1.3: 메시지 추가)
1. 대시보드 `/dashboard` 2. 예약 `/bookings` 3. 제안 `/proposals` 4. 빌라 `/villas` 5. 청소 검수 `/inspections` 6. 메시지 `/messages` (v1.3) 7. 정산 `/settlements` 8. 사용자 `/users` 9. 설정 `/settings` (시즌 달력·홀드 기본 시간·환율 FX_VND_PER_KRW)

### 대시보드 `/dashboard` (디자인 B1)
- **경보 배너 (최상단)**: iCal 더블부킹 충돌 미해결 건 — 해결(차단 해제 또는 예약 취소) 전까지 상시 노출
- 스탯 카드 4종 — 클릭 시 해당 필터가 걸린 목록으로 이동:
  | 카드 | 내용 | 클릭 시 |
  |---|---|---|
  | 오늘 체크인 | 오늘 checkIn인 CONFIRMED 수 | /bookings?filter=today-checkin |
  | 오늘 체크아웃 | 오늘 checkOut인 CHECKED_IN 수 | /bookings?filter=today-checkout |
  | 가예약 진행 중 | HOLD 수 + 가장 임박한 만료 카운트다운 | /bookings?status=HOLD |
  | 청소 승인 대기 | PHOTOS_SUBMITTED 수 | /inspections |
- 타임라인 매트릭스: 빌라 × 향후 30일. 셀 상태색 = 공실/홀드(빗금)/확정(실선)/차단(회색)/판매불가(빨강 테두리) — F2 ADMIN 뷰와 동일 컴포넌트 재사용
- 활동 피드: 최근 이벤트 20건 (가예약 생성·확정·만료, 청소 제출, iCal 충돌, 정산 지급) — Notification·AuditLog 기반

### 예약 목록 `/bookings` (디자인 B5) — 운영자가 가장 자주 여는 화면
- 필터: 상태(HOLD/CONFIRMED/CHECKED_IN/CHECKED_OUT/CANCELLED·EXPIRED·NO_SHOW), 기간, 빌라, 채널
- 기본 정렬: 체크인 임박순. HOLD 행에는 만료 카운트다운 뱃지
- 행 클릭 → 예약 상세 `/bookings/[id]`: 예약 정보·가격 스냅샷·결제 기록 + **상태별 액션 버튼** (HOLD→확정/취소, CONFIRMED→체크인/취소/노쇼, CHECKED_IN→체크아웃) — F4 체크인·아웃의 진입점

### 청소 검수 목록 `/inspections` (디자인 B6)
- PHOTOS_SUBMITTED 우선 정렬 → 클릭 시 공간별 사진 그리드 (기준 사진 대조) → 승인 / 반려(사유 필수)
- 승인 시 villa.isSellable=true 즉시 반영 (F4 게이트)

### Zalo 메시지 `/messages` (디자인 B14 — v1.3, ADR-0003)
- **양방향 채팅**: 좌측 인박스(대화 목록 — Zalo 프로필명·매핑된 공급자명·마지막 메시지·미읽음 뱃지·48h 창 상태) + 우측 대화창
- 수신: Zalo webhook(user_send_text/image) → ZaloConversation/ZaloMessage 저장 (zaloMsgId 멱등). T3.7 follow webhook과 동일 엔드포인트에서 이벤트 분기
- 발신: Zalo OA **CS(상담) 메시지 — 공급자의 마지막 발신(lastInboundAt) 후 48시간 창 내에서만 발신 가능**. 창 경과 시 입력창 비활성 + "공급자 응답 대기 중" 안내 (창 밖 유료 메시지는 Phase 2 — IDEAS.md)
- **Gemini 번역 통합**: 수신 vi → ko 자동 번역 표시(원문 토글, translatedText 캐시), 발신은 ko 작성 → vi 번역 미리보기 확인 후 전송
- F5 시스템 알림 발송도 ZaloMessage(OUTBOUND, source=SYSTEM)로 미러 기록 — 대화창에서 알림 이력까지 한 흐름으로 조회. Notification 모델은 상태 추적·재시도용으로 유지
- 시스템 알림(F5)은 거래성 메시지 정책으로 48h 창과 무관하게 기존대로 발송

### 관리자 반응형 (v1.3 — ADR-0003)
- PWA 전제 — **관리자 전 화면 반응형 필수**
- **브레이크포인트 1024px(lg)**: ≥1024 고정 사이드바 / <1024 상단 헤더 + 햄버거 드로어 (하단 탭 미도입 — 오픈 후 사용 패턴 보고, IDEAS.md)
- **테이블 → 카드 전환 768px(md)**: b5·b9·b12·b13 등 테이블 화면은 <768에서 카드 리스트 — 카드 = 식별자 + 상태 뱃지 + 핵심 2필드 + 우측 chevron. 공통 컴포넌트(ResponsiveTable) 1회 구현 후 재사용
- 별도 모바일 변형 디자인은 **b1(대시보드)만** 생성 — 타임라인 매트릭스는 모바일에서 "오늘 중심 리스트"로 재구성. 나머지는 변환 규칙으로 처리

### 비고
- 감사 로그·알림 발송 로그 조회 화면은 오픈 후 개선 (IDEAS.md) — Phase 1은 DB 직접 조회로 운영

---

## F8. 재고·부가서비스 판매 (Phase 2 — ADR-0019)

> 미니바 = 실재고 추적 / 서비스(BBQ·티켓·가이드·차량·오토바이 렌트) = 주문형 발주. 상세 설계·스키마는 ADR-0019.

**사용자:** ADMIN

### 미니바 실재고
- 빌라별 **현재고(onHandQty)** 와 **비치 목표(par, VillaMinibarStock.qty)** 를 분리 관리
- **입고 화면**: 빌라·품목·입고수량·**매입 단가(VND)** 입력 → 현재고 증가 + `MinibarItem.costVnd` 갱신(회사표준 1세트) → 미니바 마진 통계 자동 활성
- **부족 경보**: `현재고 < 비치 목표` 빌라·품목을 대시보드 배너 + 재고 화면 필터로 노출
- 체크아웃 소모(F4)는 현재고 차감 + 이동이력(`MinibarStockMovement`) 기록
- **가격·품목은 빌라별로 두지 않음**(ADR-0016 유지) — 빌라별은 수량·현재고뿐

### 서비스 카탈로그(주문형)
- `ServiceCatalogItem`: 판매 메뉴 1세트(회사 공통) — 이름(ko/vi/en)·판매가(KRW/VND)·**원가(운영자 전용)**·단위·사진·옵션(차량 기사 포함/불포함 등)·active/정렬
- `ServiceType`에 추가: `MOTORBIKE_RENTAL`(오토바이), `MASSAGE`(마사지), `BARBER`(이발소(귀))
  - **마사지**(종류별 카탈로그 항목, 출장 가능): 풋마사지(30/60분) · 바디마사지 아로마/핫스톤/건식(30/60/90/120분)
  - **이발소(귀)**: 60/90분 + 세부시술 족욕·귀청소·면도·손발톱·콧털·스톤마사지·오이팩·허벌케어·전신/발/두피 마사지·태국식 스트레칭·베트남식 샴푸
- **옵션 3종 구조**(카탈로그 `options`): `variants`(상호배타 1택, 가격 대체 — 시간 티어·기사 포함/불포함), `addons`(다중 선택 가산 — 이발소 세부 시술), `modifiers`(토글 가산 — 출장비). 합계는 서버 재계산
- 주문(ServiceOrder)은 카탈로그에서 가격 스냅샷, 게스트 요청은 `requestedVia=GUEST·status=REQUESTED`
- **처리 흐름**: 게스트/운영자 요청(REQUESTED) → 운영자 가능 여부·가격 확정(CONFIRMED) → 제공(DELIVERED). 예약 상세 패널 + 대시보드 신규 요청 알림
- 결제는 **체크아웃 시 통합 정산**(현금/계좌이체, Phase 1 PG 없음 — ADR-0019 D3)

### 체크아웃 게스트 정산 (ADR-0019 §6.5)
- 체크아웃 화면(F4)에 **게스트 청구서** 합산: 미니바 소비분(소비수량×판매가) + 확정 부가옵션(ServiceOrder CONFIRMED/DELIVERED 판매가)
- 보증금 환불/파손 차감은 별도 표기(보증금은 게스트↔운영자, 공급자 정산 F6 무관)
- 결제수단 기록: 현금/계좌이체/기타 + 수납 시각·메모, 통화별 분리(합산 금지)

### 화면
- ADMIN: 미니바 재고 현황·입고, 서비스 카탈로그 관리(`/settings/services`), 예약 상세 옵션 주문 패널
- 매출·원가·마진은 **운영자(canViewFinance) 전용**, 통화별 분리(ADR-0003)

---

## F9. 게스트 셀프 체크인 (Phase 2 — ADR-0019)

> 한국 여행객(비로그인)이 모바일로 체크인 절차 일부를 셀프 수행. 접근 = 예약별 토큰 링크 + QR.

**사용자:** (비로그인) 게스트

### 접근
- 예약별 `GuestCheckinToken` 발급 → `/g/[token]` (ko 기본, `?lang=`로 ko/vi/en/zh/ru)
- 토큰 전달: 빌라 현관 QR 비치 / 여행사·카톡 링크 전송. 만료(기본 체크아웃+1일)·회수 시 차단
- **단일 예약 스코프** — 다른 예약·전체 재고 도달 불가(재고 비공개 원칙1)

### 흐름 (한 화면 다단계)
1. **예약 확인** — 빌라명·날짜·박수·인원만(마진·재고 비노출)
2. **비품 목록 확인** — 어메니티 + 미니바 비치 품목(미니바 **판매가** 표시, 원가·마진 비노출) → "확인" 체크
3. **이용 동의서 서명** — `lib/agreement.ts` 본문(수영장 빌라 자동 조항), 모바일 서명 패드 → `CheckInRecord.agreementSignedAt·signatureUrl·agreementVersion`
4. **부가옵션 선택** — `ServiceCatalogItem(active)` 카드(사진·판매가·단위·옵션)·수량 선택 → "요청하기" → `ServiceOrder(REQUESTED, GUEST)`. **결제 없음**, "운영자 확인 후 확정" 안내
5. **완료** — 요청 내역 요약 + "현장/체크아웃 정산" 안내. 재진입 시 조회 가능

### 규칙
- 게스트는 **판매가만** 본다(미니바·옵션). `costVnd`·마진은 절대 비노출
- 게스트 요청 금액은 서버 재계산(클라 변조 방지), 운영자 확정 전까지 REQUESTED
- 여권 업로드는 본 범위 제외(현장 ADMIN 체크인 유지) — 후속 옵션

### 화면 (Stitch)
- G1 예약 확인 · G2 비품 확인 · G3 동의서 서명 · G4 옵션 선택 · G5 요청 완료 (모바일, 라이트, ko, `/p` 톤 계승)

---

## F10. 공급자 직접 판매 채널 (양방향 모델 — ADR-0021)

> 원래 사업 모델 복원: 공급자가 자기 빌라를 **자기 고객에게 직접 판매** → 그 공실이 **실시간으로 운영자에게 공유** → 운영자가 **선점해 한국 채널에 재판매**. 현재는 공급자가 정보 입력만 가능(판매 불가)해 단방향. 상세·결정은 ADR-0021.

**사용자:** SUPPLIER (직접예약 생성), ADMIN (선점·재판매)

### 확정 결정 (테오 2026-06-26 — ADR-0021)
- **판매 방식**: 둘 다(단계적) — Phase A 수동 기록 → Phase B 공급자 판매 링크
- **충돌 우선권**: **선착순** (운영자 선점 우선권 없음, 같은 가용성 레이어에 먼저 잡은 쪽이 임자)
- **수익**: **공급자 100%** (직접판매액 전부 공급자 것, 수수료 없음, 정산 제외)
- **검수 미승인 빌라 직접판매**: **허용** (게이트는 우리 재판매만 막음, 직접판매는 공급자 책임)

### 핵심 원리 — 공유 가용성 + 선착순
- 운영자(`seller=OPERATOR`)와 공급자(`seller=SUPPLIER`)가 같은 빌라·같은 캘린더에 독립 판매를 동시 운영
- 공급자 직접예약 생성도 **기존 lib/availability.ts 트랜잭션 잠금(lockVillaInventory + checkAvailability)을 그대로 통과** → 선착순 자동 보장(우선권 비교 로직 불필요)
- 공급자는 운영자 예약을 "예약됨"만(마진 비공개), 운영자는 공급자 직접예약을 타임라인 별도 셀로 봄(선점 판단)

### Phase A — 공급자 직접예약 수동 기록 (MVP)
1. SUPPLIER `/calendar`: 빈 날짜 탭 → "직접 예약 기록" → 체크인/아웃·고객명·인원·(선택)받은 금액(VND)·(선택)연락처
2. `POST /api/supplier/bookings` → 가용성 게이트 통과 → `Booking(seller=SUPPLIER, status=CONFIRMED)` + `writeAuditLog()`
3. 선착순 패배 시 409 "이미 예약된 날짜입니다"(상세 비노출). 공급자가 먼저 잡으면 운영자가 못 홀드
4. ADMIN: 타임라인 매트릭스 신규 셀 "공급자 직접예약" + `/bookings` seller 필터
5. 정산(F6): `seller=OPERATOR`만 집계 → 직접예약 제외
6. 체크인·아웃 검수(D5 — 정식 F4 적용): 직접예약 게스트도 여권 OCR·이용 동의서 서명·보증금·체크아웃 사진 비교·청소를 모두 받음. **공급자가 자기 빌라 현장에서 vi 모바일로 직접 수행**(임시거주신고도 공급자 본인 처리 → "운영자 전달" 단계 제외). lib/checkin·checkout 재사용, `seller=SUPPLIER`+자기 supplierId 스코프. 체크아웃 시 CleaningTask + isSellable=false 동일. 단 직접판매 *개시*는 게이트 우회(D4)
7. Zalo: 직접예약 생성 시 운영자에게 정보성 알림(`SUPPLIER_DIRECT_BOOKING`)

### Phase B — 공급자 판매 링크 (별도 스프린트)
- 공급자가 자기 판매가(`VillaRatePeriod.supplierSalePriceVnd`) 입력 → 공급자별 공개 토큰 링크 생성(Proposal 재사용, supplierId 스코프) → 자기 고객 셀프 가예약(HOLD) → 공급자 입금 확인 → CONFIRMED
- 보안: 공급자 자기 빌라·자기 판매가만 노출, 우리 salePriceKrw·마진·타 공급자 빌라 절대 비노출

### 데이터 모델 (additive raw SQL ALTER — db push 금지)
- `Booking.seller` enum `BookingSeller{OPERATOR|SUPPLIER}` @default(OPERATOR) — 기존 예약 안전 백필
- `Booking.supplierSalePriceVnd BigInt?` — 공급자 자기 기록용(우리 회계 무관)
- `VillaRatePeriod.supplierSalePriceVnd BigInt?` — Phase B 판매 링크 견적용(salePriceVnd/마진과 별개)
- **네이밍 주의**: 공급자 직접판매는 `seller=SUPPLIER`로 표현. 단어 `DIRECT`(BookingChannel.DIRECT·Villa.source=DIRECT와 충돌) 재사용 금지

### 권한 테스트 필수 케이스
- 공급자가 타인 빌라 직접예약 생성 → 403 / 직접예약 응답에 운영자 판매가·마진 → 0건 / 정산에 seller=SUPPLIER 혼입 → 0건 / Phase B 링크에서 타 공급자 빌라·우리 판매가 도달 → 불가

---

## F11. 부가서비스 원천 공급자 중계 (ADR-0023)

> 부가서비스(과일 바구니·도시락·BBQ·렌트·마사지 등)는 **우리가 중계만** 한다: 요청 접수 → 원천 공급자에 Zalo 발주 → 공급자가 우리 페이지에서 예약현황 확인·가부 결정 → 우리에게 통보 → 우리가 고객 확정·공급자 정산. 상세·결정은 ADR-0023.

**사용자:** VENDOR(신규 역할 — 원천 공급자), ADMIN(중계·확정·정산), PARTNER(여행사/랜드사 요청), GUEST(소비자 요청)

### 확정 결정 (테오 2026-06-26 — ADR-0023)
- **공급자 접근**: **로그인 계정(Role=VENDOR) + 전용 대시보드 `/vendor`** (영구 거래처, 통계까지)
- **엔티티**: **완전 별도 `ServiceVendor`** (빌라 SUPPLIER와 무관한 외부 거래처)
- **정산**: **발주 건별 즉시 정산 기록** (누적 원장 아님)
- **발주 게이트**: 2단계 — 공급자 수락 후에야 운영자가 고객에 확정(거절 시 대체/취소)

### 과일 메뉴 + 요청 주체 자격(audience)
- **과일 바구니** = 여행사/랜드사(PARTNER)만 요청 (소비자 비노출)
- **과일 도시락** = 여행사/랜드사 + 소비자(GUEST) 모두 요청
- 일반화: 모든 카탈로그 항목이 `audiences ∈ [ADMIN|PARTNER|GUEST]` 선언 → 채널별 카탈로그 서버 필터

### 채널별 요청 경로
| 채널 | 라우트 | requestedVia | 노출 |
|---|---|---|---|
| 운영자 | 예약 상세 패널(기존) | ADMIN | 전체 |
| 여행사/랜드사 | `/p/[token]` 부가서비스 요청 섹션(신규) | PARTNER | audiences∋PARTNER |
| 소비자 | `/g/[token]` 옵션 선택(ADR-0019) | GUEST | audiences∋GUEST (도시락○ 바구니✕) |

### 흐름 (발주→가부→확정→정산)
1. 요청 → `ServiceOrder(REQUESTED, vendorId=카탈로그 공급자)` → Zalo 발주 to `vendor.zaloUserId`
2. `vendorStatus=PENDING_VENDOR` → 공급자 `/vendor`에서 예약현황 확인 → 수락/거절
3. 수락 → `VENDOR_ACCEPTED` → 운영자 고객확정 `CONFIRMED` → `DELIVERED` → 건별 정산 `vendorSettledAt`
4. 거절 → `VENDOR_REJECTED` → 운영자 대체 공급자 재발주 또는 `CANCELLED`

### `/vendor` 대시보드 (vi, 모바일 — 빌라 공급자 패턴 미러)
- 발주함(가부 응답) · 예약현황(자기 발주만) · 정산내역(건별 미정산/완료) · 통계 `/vendor/stats`(KPI=매출 ΣcostVnd·발주수·수락율·인기품목, lib/vendor-stats supplierId 스코프 패턴 복제)

### 데이터 모델 (additive raw SQL ALTER — db push 금지)
- `Role` += `VENDOR` / `ServiceType` += `FRUIT` / `ServiceRequestedVia` += `PARTNER`
- 신규 `ServiceVendor`(userId 1:1 선택·zaloUserId 발주대상·bankInfo 운영자전용) + `enum ServiceVendorStatus{PENDING_VENDOR|VENDOR_ACCEPTED|VENDOR_REJECTED}`
- `ServiceCatalogItem` += `vendorId`·`audiences Json`
- `ServiceOrder` += `vendorId·vendorStatus·poSentAt·vendorRespondedAt·vendorRejectReason·vendorSettledAt·vendorSettleMethod·vendorSettleNote` (정산액=기존 costVnd 재사용)

### 누수 점검 필수 케이스
- `/vendor/*` 응답에 우리 판매가·마진·타 공급자 발주·전체 재고 → 0건(vendorId 스코프·화이트리스트)
- `/g` 카탈로그·주문에 과일 바구니(audiences∌GUEST) → 0건 / `/p` costVnd·공급자 신원 → 0건
- 공급자 발주 카드에 게스트 개인정보 → 0건 (빌라·날짜·수량·인원만) / `bankInfo`·costVnd는 canViewFinance 전용

---

## 공통 비기능 요구

- 모바일 퍼스트 (공급자 화면 기준 뷰포트 ~390px), PWA 설치 가능
- **관리자 화면 반응형 필수** (v1.3 — ADR-0003): lg(1024px) 사이드바↔햄버거 드로어, md(768px) 테이블↔카드 전환 — 상세 규칙은 F7 관리자 반응형 참조
- 사진 업로드: 클라이언트 리사이즈(최대 1920px, ~300KB) 후 업로드, EXIF 타임스탬프 보존
- 권한 테스트 필수 케이스: ① SUPPLIER가 타인 빌라 접근 ② SUPPLIER 응답에 salePriceKrw/margin 포함 여부 ③ 만료 토큰 /p/ 접근 ④ 비로그인 API 접근
- cron: Railway cron 또는 Vercel-style route + CRON_SECRET 헤더 검증
- 감사 로그: 모든 데이터 변경 API(POST/PUT/PATCH/DELETE)에 `writeAuditLog()` 필수 — 보증금 차감·정산·요율 변경의 분쟁 증빙 (글로벌 audit-log-system 템플릿, AuditLog 모델)

## 확정 결정 (2026-06-11 — ADR-0002, 구 "오픈 이슈")

1. 이미지 저장소: **Cloudflare R2** — 증빙 사진 영구 보존, 서버 재배포와 무관
2. 인증: **전화번호 + 비밀번호 자가 가입** (F0). 계정 승인 없음 — 빌라 승인 게이트가 검증 역할. Zalo 로그인은 Phase 2
3. 홀드 기본 시간: **48h**, AppSetting(`HOLD_HOURS_DEFAULT`)으로 운영 중 조정 가능
4. 정기 방역 주기: **월 1회 고정** — 빌라별 설정은 오픈 후 개선 (IDEAS.md)
