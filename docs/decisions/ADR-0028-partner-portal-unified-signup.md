# ADR-0028 — 파트너 포털 + 통합 회원가입 + 사용자 관리 통합

- 상태: Accepted (구현 진행 중)
- 날짜: 2026-06-26
- 관련: ADR-0022(파트너 B2B 미수·여신), ADR-0023(원천 공급자 VENDOR 로그인 패턴), ADR-0013(S-RBAC)

## 배경

파트너(여행사·랜드사)는 현재 **로그인이 없는** B2B 엔티티다. 운영자가 `/partners`에서
미수·여신·청구서를 관리할 뿐, 파트너 본인은 자기 고객의 예약 현황·미수를 직접 볼 수 없다.
테오 요청:

1. 파트너가 **로그인**해서 자기 고객의 **빌라 예약 현황**과 **미수(받을/낼 돈)**만 확인.
2. 미니바·옵션 구매 내역 등은 파트너에게 **불필요·비노출**. 순수 빌라 예약만.
3. 파트너가 **본인이 받은 제안서**(Proposal)는 볼 수 있어야 함.
4. 회원가입 시 **어떤 포지션의 업체인지**(빌라공급자/부가서비스공급자/파트너)를 처음부터 구분.
5. 운영자 화면에서 회원이 여러 곳에 흩어진 느낌 → 파트너 계정도 **사용자(Users) 목록**에 통합 표시.

## 결정

### D1. 데이터 모델 — VENDOR 패턴(ADR-0023) 복제

- `Role` enum에 **`PARTNER`** 추가 (additive).
- `Partner.userId String? @unique` → `User(role=PARTNER)` 1:1 연결. **엔티티(Partner)≠계정(User) 분리**,
  선택적 1:1 (ServiceVendor.userId와 동형). 한 파트너사 = 하나의 로그인 계정.
- `Partner`에 자가가입 승인 게이트 추가 (ServiceVendor 미러):
  - `approvalStatus PartnerApprovalStatus @default(APPROVED)` — 자가가입=PENDING_APPROVAL, 기존·운영자생성=APPROVED
  - `rejectionReason String?`, `approvedAt DateTime?`
  - 신규 enum `PartnerApprovalStatus { PENDING_APPROVAL, APPROVED, REJECTED }`
- 라이브 공유 DB는 **additive raw SQL ALTER**로 적용(`prisma db push` 금지 — 드리프트 방지, 메모리 db-schema-drift).
  스키마 변경은 **이 세션 전담**(CLAUDE.md 병렬세션 규칙 6).

### D2. 회원가입 — 통합 진입 + 유형 선택 (자가가입 + 운영자 승인)

- `/signup`을 **유형 선택 화면**으로: ① 빌라 공급자(SUPPLIER) ② 부가서비스 공급자(VENDOR) ③ 파트너(여행사·랜드사, PARTNER).
- 세 유형 모두 **자가가입 → 운영자 승인** 흐름. (기존 `/vendor-signup`은 통합 진입으로 흡수/별칭)
- 파트너 자가가입(`POST /api/partner-signup`): `User(PARTNER)` + `Partner(PENDING_APPROVAL)` 트랜잭션 생성.
  여신/신용한도/결제조건은 **운영자가 승인 시 설정**(파트너가 못 정함). 가입 시엔 회사명·전화·유형(여행사/랜드사)만.
- 계정 생성 기준은 기존과 동일(bcryptjs, phone 숫자정규화, mustChangePassword=false 자가가입).

### D3. 파트너 포털 `/partner` (스코프 = 본인 partnerId만)

- 루트 라우팅: `PARTNER` → `/partner`. 가드: `role===PARTNER` 아니면 `/login`.
- 모든 쿼리는 **로그인 User의 연결된 partnerId로 강제 스코프**(SUPPLIER의 supplierId 스코프와 동형).
- 화면(3): 
  1. **예약 현황** — 본인 고객 예약: 빌라명·기간·인원·상태·객실료(채권액). `Booking.partnerId = 내 partner`.
  2. **미수 관리** — `PartnerReceivable`·`PartnerInvoice` 읽기 전용(받을/낼 잔액·기한·청구서 PDF).
  3. **받은 제안서** — `Proposal.partnerId = 내 partner` → `/p/[token]` 열람.
- **누수 차단(사업원칙2 — QA 게이트)**: 파트너 화면에 미니바·서비스 옵션 주문·운영자 마진·타 파트너·전체재고 **절대 비노출**.
  객실료(파트너가 청구받는 금액)만 노출. 게스트 셀프체크인(`/g`) 데이터와 분리.

### D4. 운영자 — 재무 유지 + 사용자 목록 통합

- `/partners`(미수·여신·청구서 = 재무 운영)는 **유지**.
- `/users`(사용자 관리)에 **PARTNER 역할 계정도 표시**(역할 필터에 파트너 추가). 흩어진 느낌 해소.
- **파트너 자가가입 승인 UI**: 운영자가 PENDING_APPROVAL 파트너를 승인/거절(VENDOR 승인 흐름 재사용).
  승인 시 여신등급·한도·결제조건 설정.

## 구현 순서(스프린트)

- **PP1** 스키마 기반: Role+PARTNER, Partner.userId+approval, PartnerApprovalStatus, 라이브 ALTER, permissions.isPartner. ← (이 ADR과 함께)
- **PP2** 통합 회원가입: /signup 유형선택, /api/partner-signup.
- **PP3** /partner 포털 3화면 + 루트 라우팅 + 가드 + 누수가드.
- **PP4** 운영자: users 목록 PARTNER 표시 + 파트너 승인 UI.
- **PP5** QA 누수검사 + i18n(ko/vi) + build.

## 누수 체크리스트(QA 필수)

- [ ] `/partner/*` 모든 라우트 첫 줄 `role===PARTNER` + partnerId 스코프 강제
- [ ] 응답에 미니바/서비스주문/원가(costVnd)/운영자 마진(KRW 판매가-VND 원가 차) 0
- [ ] 타 partnerId 데이터 조회 불가(IDOR — 토큰/ID 직접조작 차단)
- [ ] 제안서는 본인 partnerId 매칭 Proposal만
- [ ] PENDING_APPROVAL/REJECTED 파트너는 포털 접근 차단(승인 전 안내 화면)
