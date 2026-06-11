# Skill: API Route 작성 패턴

## 표준 구조 (모든 route handler)
1. 첫 줄: 세션·role 검사 → 미통과 시 401/403 즉시 반환
2. SUPPLIER 요청은 where절에 supplierId 스코프 강제 (타인 데이터 차단)
3. 입력 검증: zod 스키마 → 실패 시 400 + 필드별 메시지
4. 응답 DTO: SUPPLIER용 응답에서 salePriceKrw·marginValue·marginType 필드 제거한 select/serializer 사용 — include 통째로 반환 금지
5. 에러는 try/catch 후 로그 + 일반화된 메시지 (내부 구조 노출 금지)

## 교훈 축적 (버그 발생 시 여기 추가)
- (없음 — 개발 착수 전)
