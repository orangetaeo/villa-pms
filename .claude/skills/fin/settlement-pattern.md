# Skill: 정산·환율 패턴 (환전 시스템 LEDGER 계승)

- 수납: 통화·수단별 Payment 기록, fxRateToVnd는 수납 시점 스냅샷
- vndEquivalent = amount × fxRateToVnd (KRW·USD), 환차 마진 = vndEquivalent − 공급자원가 − 객실마진 분리 기록
- 월 정산: SettlementItem 합 === Settlement.totalVnd 강제 (불일치 시 생성 거부)
- 지급 확정(PAID) 후 항목 수정 금지 — 정정은 차월 조정 항목으로
- 환율 소스: 운영자 수동 입력(환전업 요율표) 우선, 자동 조회는 참고값

## 교훈 축적
- 환전 시스템: 수익 데이터 저장 위치 혼동 버그 → 손익은 발생 시점에 확정 기록, 조회 시 재계산 금지
