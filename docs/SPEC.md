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
