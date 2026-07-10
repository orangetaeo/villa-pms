# DB 채우기 계획 — 다음 세션 핸드오프 (2026-07-07)

## 현황
- **프로덕션 DB**: Railway PostgreSQL, 스키마 v1.5 완성 (안정화 ✅)
- **현재 데이터**: ZALO만 실제, 나머지는 테스트 데이터
- **목표**: 8월 1일까지 25일 안에 현실적 데이터로 채우기
- **예상 소요**: 2~3주(스크립트 실행 + QA)

---

## 준비된 Seed 스크립트 (총 17개)

### 📋 [필수] 핵심 3개 (데이터 기초)

| # | 스크립트 | 목적 | 실행 명령 | 멱등성 |
|---|---------|------|---------|--------|
| **1** | `seed.ts` | AppSetting(환율·계좌·문구)·파일럿 빌라 4개·요율·사진 | `npx tsx prisma/seed.ts` | ✅ |
| **2** | `seed-villas-realistic.ts` | 푸꾸옥 주요 단지 빌라 61개 추가 (총 ~67개 ACTIVE) | `npx tsx --env-file=.env prisma/seed-villas-realistic.ts` | ✅ |
| **3** | `seed-villa-bookings-random.ts` | 2026-02~09 구간 현실적 예약 생성 (과거/현재/미래 혼합) | `npx tsx --env-file=.env prisma/seed-villa-bookings-random.ts` | ✅ |

**→ 단독으로 실행 가능 (1+2+3 = 빌라 60+예약 현황 완성)**

---

### 🔧 [보정] 데이터 정규화 5개 (필수)

| # | 스크립트 | 목적 | 실행 명령 | 주의 |
|---|---------|------|---------|------|
| **4** | `prep-occupancy-realistic.ts` | 정크 빌라 비활성화 (ACTIVE만 유지)·기존 정크 자식데이터 정리 | `npx tsx --env-file=.env prisma/prep-occupancy-realistic.ts` | **#3 직후** |
| **5** | `backfill-finance-fields.ts` | KRW 예약 환율 스냅샷 백필·부가서비스 가격 복원 | `npx tsx --env-file=.env prisma/backfill-finance-fields.ts` | ✅ 멱등 |
| **6** | `fix-villa-pricing.ts` | 빌라 요율 비정상(0·낮은 금액) 보정 | `npx tsx --env-file=.env prisma/fix-villa-pricing.ts` | ✅ 멱등 |
| **7** | `fix-zero-sale-bookings.ts` | 판매가 0/누락 예약 정상화 (마진 20% 적용) | `npx tsx --env-file=.env prisma/fix-zero-sale-bookings.ts` | ✅ 멱등 |
| **8** | `backfill-service-options.ts` | 부가서비스 변형(코스) 스냅샷 정합 | `npx tsx --env-file=.env prisma/backfill-service-options.ts` | ✅ 멱등 |

**→ 순차 실행 권장 (4 → 5,6,7,8)**

---

### 🎯 [거래처·부가판매] 10개 (선택적)

**거래처 설정 (1개)**
| # | 스크립트 | 목적 | 실행 명령 |
|---|---------|------|---------|
| **9** | `seed-vendors-assign.ts` | 부가서비스 거래처 10개 + 카탈로그 연결 | `npx tsx --env-file=.env prisma/seed-vendors-assign.ts` |

**청소·부가판매 (9개, 독립적)**
| # | 스크립트 | 목적 | 실행 명령 | 비고 |
|---|---------|------|---------|------|
| **10** | `seed-cleaner-demo.mjs` | 청소직원(demo-cleaner-hoa)·배정 태스크·정보 | `node --env-file=.env prisma/seed-cleaner-demo.mjs` | vi 전용 |
| **11** | `seed-massage-random.ts` | 마사지 주문 (과거 DELIVERED·미래 CONFIRMED) | `npx tsx --env-file=.env prisma/seed-massage-random.ts` | |
| **12** | `seed-service-sales-random.ts` | 입장권·조식·가이드·차량·이발·BBQ 등 부가판매 | `npx tsx --env-file=.env prisma/seed-service-sales-random.ts` | |
| **13** | `seed-minibar-random.ts` | 미니바 재고 par(목표)·현재고 | `npx tsx --env-file=.env prisma/seed-minibar-random.ts` | |
| **14** | `seed-minibar-sales-random.ts` | 미니바 판매(체크아웃 소비) | `npx tsx --env-file=.env prisma/seed-minibar-sales-random.ts` | |
| **15** | `seed-minibar-short3.ts` | 미니바 "부족" 상태 3개 | `npx tsx --env-file=.env prisma/seed-minibar-short3.ts` | |
| **16** | `seed-usd-payments.mjs` | USD 예약 + 결제 데이터 | `node --env-file=.env prisma/seed-usd-payments.mjs` | Phase 2 |
| **17** | `seed-direct-bookings-random.ts` | 공급자 직접판매(F10) 예약 | `npx tsx --env-file=.env prisma/seed-direct-bookings-random.ts` | F10 완료 시 |

---

## 📊 실행 시나리오 3가지

### Scenario A: 최소 (운영 기본만)
**소요 시간**: 30분  
**실행 순서**:
```bash
npx tsx prisma/seed.ts
npx tsx --env-file=.env prisma/seed-villas-realistic.ts
npx tsx --env-file=.env prisma/seed-villa-bookings-random.ts
npx tsx --env-file=.env prisma/prep-occupancy-realistic.ts
npx tsx --env-file=.env prisma/backfill-finance-fields.ts
npx tsx --env-file=.env prisma/fix-villa-pricing.ts
npx tsx --env-file=.env prisma/fix-zero-sale-bookings.ts
```
✅ **결과**: 운영자 대시보드·예약·정산 기본 데이터 완성

---

### Scenario B: 표준 (예약+부가판매)
**소요 시간**: 1시간  
**추가 실행** (A 이후):
```bash
npx tsx --env-file=.env prisma/backfill-service-options.ts
npx tsx --env-file=.env prisma/seed-vendors-assign.ts
npx tsx --env-file=.env prisma/seed-cleaner-demo.mjs
npx tsx --env-file=.env prisma/seed-service-sales-random.ts
npx tsx --env-file=.env prisma/seed-minibar-random.ts
npx tsx --env-file=.env prisma/seed-minibar-sales-random.ts
```
✅ **결과**: 부가서비스·청소·미니바 통계까지 완성

---

### Scenario C: 완전 (모든 거래성 데이터)
**소요 시간**: 1.5시간  
**추가 실행** (B 이후):
```bash
npx tsx --env-file=.env prisma/seed-minibar-short3.ts
node --env-file=.env prisma/seed-usd-payments.mjs
# (F10 완료 후) npx tsx --env-file=.env prisma/seed-direct-bookings-random.ts
```
✅ **결과**: 모든 기능 통계·다통화·직판 데이터 완성

---

## ⚠️ 체크리스트 (실행 전)

### 1️⃣ DB 백업
```bash
# Railway 대시보드에서 수동 백업
# 또는 local psql:
pg_dump "postgres://user:pass@*.rlwy.net:5432/villa_pms" > backup-2026-07-07.sql
```

### 2️⃣ 환경 확인
```bash
# .env 파일 존재 확인
ls -la .env
echo "DATABASE_URL: $DATABASE_URL"
echo "GEMINI_API_KEY: ${GEMINI_API_KEY:+SET}"
```

### 3️⃣ 기존 데이터 상태
- 파일럿 빌라 4개(`seed-supplier-pilot` 소유): **유지** (seed.ts upsert)
- Zalo 계정·대화: **전혀 건드리지 않음** (id 접두 demo- 제외)
- 테스트 계정(0900000001~4): **차후 운영 시작 전 삭제** 

### 4️⃣ 스크립트 문제 확인
```bash
# 각 스크립트 문법 검사
npx ts-node --version
npm test -- seed  # 있으면 실행
```

### 5️⃣ 운영 데이터 vs 테스트 데이터 경계
- ✅ **id 접두 demo-**: 모두 테스트 (언제든 삭제 가능)
- ✅ **seed-supplier-pilot**: 파일럿 (유지)
- ⚠️ **실제 공급자·청소원**: 없음 (현재 테오님만)

---

## 실행 후 검증 (QA 체크리스트)

### 데이터 완성도
- [ ] 대시보드 KPI 표시 (빌라 수, 예약 수, 매출, 가동률)
- [ ] /villas 목록 60+ 빌라
- [ ] /bookings 과거·현재·미래 혼합 예약
- [ ] /settlements 월별 정산 집계
- [ ] /revenue 통화별·유형별 매출

### 통계 정합성
- [ ] 매출 = booking.totalSaleKrw/Vnd 합계 (CHECKED_OUT·NO_SHOW만)
- [ ] 부가판매 = ServiceOrder 합계
- [ ] 미니바 = CheckoutMinibarLine 합계
- [ ] 정산액 = 수납 누적

### 권한·누수 재확인
- [ ] SUPPLIER는 자기 빌라·예약만 조회
- [ ] 마진·원가·고객정보 ADMIN만 노출
- [ ] 공개 제안 링크에 판매가/마진 노출 0

---

## 주의사항

### ⚠️ 스크립트 재실행
- **멱등성 보장**: 모든 스크립트는 id 접두(`demo-`) 재삭제 후 재생성 → **같은 명령 여러 번 실행 안전**
- **BUT**: 수동 편집 후 재실행 시 손으로 건 데이터 사라짐

### 🔴 금지 사항
- ❌ 스크립트 중단 후 DB 롤백 없이 재실행 (불일치 위험)
- ❌ seed.ts·seed-demo.ts 외 스크립트를 `npm run seed` 내에 등록 (수동만 실행)
- ❌ 파일럿 데이터(`seed-supplier-pilot`) 포함 환경에서 seed.ts만 재실행 (이미 upsert 안전)

### ✅ 안전한 방법
1. 목표 데이터 상태 정의 (Scenario A/B/C)
2. `.env` 확인
3. 각 스크립트 **순차 실행** (병렬 실행 금지 — race condition)
4. 실행 후 DB 정합성 검증

---

## 다음 단계

### 이 세션(7월 7일)
- ✅ 준비 문서 완성 (이 파일)
- ✅ 스크립트 목록화
- ✅ 메모리 업데이트

### 다음 세션 (7월 8일 이후)
1. **dry-run** (로컬 Postgres 또는 스테이징)
   - Scenario A 전체 실행
   - 데이터 정합성 확인
   - 예상 소요 시간 측정

2. **프로덕션 본실행** (테오님 확인 후)
   - 백업 확인
   - Scenario B 또는 C 선택 실행
   - 라이브 데이터 검증

3. **QA** (체크리스트 전수)
   - 통계 정합성 (매출·정산·부가판매)
   - 권한·누수 재확인
   - 성능 테스트 (대량 데이터 조회)

4. **운영 준비** (7월 28일까지)
   - demo 계정 정리
   - Zalo 실송수신 최종 검증
   - T4.4 파일럿 사용자 테스트

---

## 파일 위치 & 명령어 복사용

```bash
# Scenario A (필수)
cd C:\Projects\villa-pms && \
npx tsx prisma/seed.ts && \
npx tsx --env-file=.env prisma/seed-villas-realistic.ts && \
npx tsx --env-file=.env prisma/seed-villa-bookings-random.ts && \
npx tsx --env-file=.env prisma/prep-occupancy-realistic.ts && \
npx tsx --env-file=.env prisma/backfill-finance-fields.ts && \
npx tsx --env-file=.env prisma/fix-villa-pricing.ts && \
npx tsx --env-file=.env prisma/fix-zero-sale-bookings.ts

# Scenario B (표준)
# ... 위의 A 완료 후
npx tsx --env-file=.env prisma/backfill-service-options.ts && \
npx tsx --env-file=.env prisma/seed-vendors-assign.ts && \
node --env-file=.env prisma/seed-cleaner-demo.mjs && \
npx tsx --env-file=.env prisma/seed-service-sales-random.ts && \
npx tsx --env-file=.env prisma/seed-minibar-random.ts && \
npx tsx --env-file=.env prisma/seed-minibar-sales-random.ts
```

---

**작성**: 2026-07-07 / Claude Code  
**대상**: 다음 세션 (7월 8일~)  
**담당**: PM / OPS / QA
