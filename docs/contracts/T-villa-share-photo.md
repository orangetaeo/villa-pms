# T-villa-share-photo — 빌라 공유 대표 사진 첨부

> 착수: 2026-07-09. T-zalo-notify-enrichment(PR #201) 후속. 담당 세션: villa-share-photo worktree.

## 범위
- 운영자 /messages 빌라 공유(S3) 발송 시 빌라 **대표 사진 1장**을 이미지로 함께 발송.
- 대표 사진 선정: 빌라 사진 중 정렬 규칙(외관 우선 등 기존 대표 규칙 재사용, 없으면 첫 사진). 사진 0장이면 기존 텍스트만(무변경 동작).
- 이미지 로드·발송 실패 시 **텍스트 공유는 반드시 성공** (사진은 best-effort).
- ZaloMessage 미러의 attachmentUrls에 사진 URL 기록 (기존 photo share 패턴).

## 완료 기준
1. 공급자/고객 양쪽 빌라 공유에서 사진 1장 + 기존 텍스트 발송
2. 사진 없음·로드 실패 시 텍스트만 발송(공유 실패로 처리되지 않음)
3. 보안 불변식 유지: select 화이트리스트 무변경(사진 URL은 금액 무관), D2 매트릭스 게이트 그대로
4. 기존 테스트 + 신규 케이스 통과, next build 통과

## 수정 금지 구역
- prisma/schema.prisma (스키마 무변경)
- worker/ · lib/zalo-listener* (ADR-0032 영역)

## 비범위
- 사진 여러 장·앨범 발송, 워터마크 생성(기존 저장본 그대로 사용)
