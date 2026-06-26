# 계약서 — 빌라 위치 지도 임베드

## 배경
좌표 필드 없음. 기존 `Villa.googleMapUrl`(ADMIN 입력, 이미 공급자·공개 제안페이지에 링크로 노출됨). 신규 좌표필드/라이브러리 없이 iframe 임베드로 지도 표시.

## 범위
- 신규 컴포넌트 `components/villa/map-embed.tsx`(클라이언트):
  - prop `googleMapUrl: string | null`.
  - googleMapUrl을 `https://maps.google.com/maps?q=...&output=embed` 형태로 안전 변환(허용 호스트 화이트리스트, `https://`만). place URL/short URL은 `q=`로 임베드(가능 범위) + "구글지도에서 열기" 외부 링크 동시 제공.
  - lazy-load(`loading="lazy"`), 고정 종횡비, 반응형. 좌표 추출 불가 URL은 임베드 생략하고 링크만.
- 적용 화면(각자 자기 빌라/제안 범위만 — 재고 비공개 유지):
  - 운영자 `/villas/[id]` 판매정보 위치 섹션 — 링크 옆/아래 임베드.
  - 공급자 `/my-villas/[id]` `villa-sales-section.tsx` 위치 영역 — 임베드(읽기전용).
  - 공개 `/p/[token]` `villa-sales-section.tsx` 위치 영역 — 제안 포함 빌라만 임베드.
- i18n 키("지도에서 보기"/"위치") ko/vi/en.

## 수정 금지 구역
- Villa 스키마 변경 금지(좌표 필드 추가 안 함 — 이번 범위 아님).
- `lib/zalo-share.ts` 공유 본문 변경 금지(별도 범위).
- 다중핀/클러스터 지도(/villas 목록 보드)는 이번 범위 제외 — embed-only 결정.

## 완료 기준
1. googleMapUrl 있는 빌라의 3개 화면에서 지도가 임베드되어 위치 표시.
2. googleMapUrl 없는 빌라는 깨지지 않고 위치 섹션 우아하게 생략.
3. 비-구글 호스트/비-https URL은 임베드 거부(SSRF/오용 방지).
4. 모바일 반응형(공급자·공개 화면 모바일 우선).
5. typecheck/lint/build 통과. 마진·재고 누수 0(지도는 위치만, 가격 비노출).

## 검증 방법
QA: 좌표 있는/없는/비정상 URL 빌라 각각 3화면 확인. 모바일 뷰포트. Stitch 디자인 일관성 1차 자가검토.
