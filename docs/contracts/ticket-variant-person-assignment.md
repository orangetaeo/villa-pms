# 계약: 티켓 연령구분(variant)별 인원 배정 구매 + 벤더 전체명단 폴백 제거

- 상태: 착수 (2026-07-12)
- 브랜치: wt/ticket-variant-person
- 배경(테오, demo-rbk-277 실측): 차일드/어덜트/시니어 티켓은 가격이 다른데 단일가 묶음 구매라
  연령별 구매·티켓별 인원 배정이 안 됨. 또 미선택 주문의 체크인 전체명단 폴백 때문에
  "1장 티켓에 소비자 3명" 오해 표시 발생.

## 설계 (TDA — ADR-0036 개정)

### 1. 벤더 전체명단 폴백 제거 (표시 정합)
- 벤더 GET `guests` = **주문 스냅샷(ticketGuests)만**. 체크인 전체명단 폴백 삭제(배치 조회 제거).
- 스냅샷 없는 TICKET 주문(구주문·체크인 전 주문)은 "이용자 미지정" 안내로 문구 교체(ko/vi,
  기존 `vendor.tickets.passportEmpty` 문구 갱신). admin 표시는 원래 스냅샷만이라 불변.

### 2. 연령구분별 구매 분리 (기존 variant 구조 재사용 — 스키마 변경 없음)
- 티켓 품목의 어덜트/차일드/시니어 = 카탈로그 `options.variants`(가격 포함, 운영자 설정).
- 게스트 폼(TICKET + 체크인 명단 존재 + variants 존재): 인원 체크 시 **사람마다 variant 선택**
  (행마다 세그먼트/셀렉트, 기본=첫 variant). 카드 단일 variant 선택 UI는 이 경우 인원별 지정으로 대체.
- 제출: **variant별 그룹으로 주문 분리 생성** — 그룹당 1 주문(quantity=그룹 인원수,
  ticketGuests=그 그룹 사람들만, variantKey=그 구분). 가격은 서버 재계산(기존 §9.5 원칙 그대로).
- variants 없는 티켓 품목: 현행(단일가 + 인원 체크박스) 유지.
- 서버(생성 API): ticketGuests **주문 내 중복 인원 400**(TICKET_GUEST_DUPLICATE) 가드 추가
  (QA 관찰 엣지 봉인). 기존 명단 대조·수량 일치 검증 유지.
- 연령 자동 판별(생년월일→구분 추천)은 시설별 기준(신장 등)이 달라 미구현 — IDEAS.md 기록만.

## 범위 (수정 파일)
1. `app/api/vendor/orders/route.ts` — 폴백 제거(체크인 배치 조회 삭제), 스냅샷만
2. `components/vendor/vendor-board.tsx` — 미지정 안내 분기(스냅샷 없을 때)
3. `app/g/_components/option-card.tsx`·`guest-options.tsx` — 인원별 variant 지정 UI + variant 그룹 분리 제출
4. `app/api/g/[token]/service-orders/route.ts` — 중복 인원 가드
5. `lib/guest-i18n.ts`(5언어)·`messages/ko.json`·`vi.json`(vendor 문구 갱신) — 키 추가/문구 수정만
6. ADR-0036 개정, IDEAS.md(연령 자동판별), 테스트 갱신·추가

## 수정 금지 구역
- prisma/schema.prisma(변경 없음), lib/vendor-dispatch.ts(Zalo 문구), 판매가·마진 경계

## 완료 기준 (QA)
- [ ] 벤더 보드: 스냅샷 있는 주문=그 인원만, 없는 주문=미지정 안내(전체명단 노출 0)
- [ ] variants 있는 티켓: 사람별 구분 지정 → 구분별 주문 분리(수량·ticketGuests·variantKey·금액 정합)
- [ ] variants 없는 티켓·체크인 전: 현행 흐름 회귀 없음
- [ ] 서버: 중복 인원 400, 기존 대조·수량 검증 유지, 가격 서버 재계산 불변
- [ ] 누수 0(이름·생년월일 외 금지 유지), next build 통과
