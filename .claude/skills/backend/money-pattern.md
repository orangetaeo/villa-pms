# Skill: 금액 처리 패턴 (환전 프로젝트 교훈 계승)

- VND = BigInt(동 단위), KRW = Int(원), USD = BigInt(센트). Float/Number 연산 절대 금지
- JSON 직렬화 시 BigInt → string 변환 유틸 사용 (JSON.stringify 기본 동작은 throw)
- 환율은 Decimal(14,4), 적용 시점 스냅샷 저장 — 소급 재계산 금지
- 합계 검증: 정산 totalVnd === items 합 (QA 필수 체크)
- 표시 포맷: VND 천단위 콤마+₫, KRW 천단위 콤마+원 — 포맷은 표시 계층에서만

## 교훈 축적
- 환전 프로젝트: 필드명 혼용(asset.name vs assetName)으로 버그 발생 → 이 프로젝트는 Prisma 타입만 신뢰, 수동 인터페이스 중복 정의 금지
