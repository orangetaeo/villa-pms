# Skill: 금액 처리 패턴 (환전 프로젝트 교훈 계승)

- VND = BigInt(동 단위), KRW = Int(원), USD = BigInt(센트). Float/Number 연산 절대 금지
- JSON 직렬화 시 BigInt → string 변환 유틸 사용 (JSON.stringify 기본 동작은 throw)
- 환율은 Decimal(14,4), 적용 시점 스냅샷 저장 — 소급 재계산 금지
- 합계 검증: 정산 totalVnd === items 합 (QA 필수 체크)
- 표시 포맷: VND 천단위 콤마+₫, KRW 천단위 콤마+원 — 포맷은 표시 계층에서만

## 교훈 축적
- 환전 프로젝트: 필드명 혼용(asset.name vs assetName)으로 버그 발생 → 이 프로젝트는 Prisma 타입만 신뢰, 수동 인터페이스 중복 정의 금지
- (T1.7 QA, 2026-06-11) **Currency enum 전 멤버가 통화 분기에 도달 가능** — KRW/VND 2분기 if/else로 짜면 USD가 조용히 VND 경로로 합산되는 "조용한 오답" 발생. 금액 분기 함수는 첫 줄에서 지원 통화 화이트리스트 검증(throw) 필수 (lib/pricing.ts assertSupportedSaleCurrency 패턴)
- (T1.7, 2026-06-11) 환율 Decimal 문자열은 1e4 스케일 BigInt로 파싱해 `(분자 + 분모/2n) / 분모` half-up 반올림 — float 경유 금지. BigInt 리터럴은 tsconfig target ES2020 필요
