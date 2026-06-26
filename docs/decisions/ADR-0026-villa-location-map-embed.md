# ADR-0026 — 빌라 위치 지도(googleMapUrl iframe 임베드)

- 상태: Accepted
- 날짜: 2026-06-26
- 관련: `Villa.googleMapUrl`(ADMIN 입력), 재고/마진 비공개 원칙

## 맥락
빌라에 좌표 필드가 없고 지도 라이브러리도 미설치. 기존 `Villa.googleMapUrl`(ADMIN 입력)은 공급자·공개 제안페이지에 링크로만 노출돼 있었다. "지도로 위치 확인" 요구.

## 결정
1. **좌표 필드/지도 라이브러리 추가 없이** 기존 `googleMapUrl`을 **iframe 임베드**(`output=embed`)로 표시. Leaflet+좌표필드(다중핀 보드)는 이번 범위 **제외**(embed-only) — 스키마 변경·신규 의존성 회피.
2. **안전 변환 `toEmbedUrl`**: 호스트 화이트리스트(`google.com`/`*.google.com`/`goo.gl`/`maps.app.goo.gl`) + **https만**. 그 외/비-https/`javascript:`/사칭 도메인(`google.com.evil.com`)/short URL은 임베드 거부(null) → SSRF·임의 iframe 주입 차단. 좌표 추출 불가 시 임베드 생략하고 부모의 외부 링크만 유지.
3. **노출 범위**: 공개 제안페이지(`/p/[token]`, 제안 포함 빌라만)·공급자(`/my-villas/[id]`, 자기 빌라)·운영자(`/villas/[id]`). 각 화면이 **자기 범위 빌라만** 렌더 → 재고 비공개 유지. 지도는 위치만, 가격·마진 비노출.

## 근거 / 트레이드오프
- 다중핀 "지도 보드"는 좌표 필드가 있어야 가능 → embed-only로는 빌라별 개별 지도만. 전체 빌라를 한 지도에 모으는 운영자 뷰는 후속(좌표 필드 도입 시) 과제로 남김.
- short URL(goo.gl)은 리다이렉트 전이라 좌표 추출 불가 → 임베드 생략, 링크 폴백.

## 영향
- 신규: `components/villa/map-embed.tsx`.
- 수정: 3개 위치 섹션(공개/공급자/운영자) + `messages/{ko,vi}.json`·`lib/public-i18n.ts`(지도 라벨).
