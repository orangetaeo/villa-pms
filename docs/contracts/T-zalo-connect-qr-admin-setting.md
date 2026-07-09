# T-zalo-connect-qr-admin-setting — Zalo 연결 QR·친구추가 링크 관리자 설정화

- 상태: 진행 중 (2026-07-09, 메인 폴더 세션)
- 배경: /zalo-connect(공급자·청소 온보딩)의 QR 이미지·친구추가 딥링크가 env(NEXT_PUBLIC_ZALO_QR_URL / NEXT_PUBLIC_ZALO_OA_URL) 고정. 테오 요청: 회사 공용 Zalo 계정으로 바뀔 수 있으니 **관리자 설정 화면에서 QR 이미지 업로드·링크 등록** 가능해야 함.

## 범위 (신규 API 없음 — 기존 인프라 재사용)

1. `app/api/settings/` 키 화이트리스트에 2키 추가 (둘 다 CLEARABLE — 비우면 env 폴백):
   - `ZALO_CONNECT_QR_URL` — QR 이미지 공개 URL
   - `ZALO_CONNECT_OA_URL` — 친구추가 딥링크 (https://zalo.me/… 형식 검증)
2. `app/(admin)/settings/page.tsx`에 "Zalo 연결" 카드 추가 (기존 카드 패턴 준수):
   - QR 이미지 업로드(기존 `/api/uploads` 사용, 미리보기) + 친구추가 링크 input + 저장
   - 저장은 기존 `/api/settings` PUT (writeAuditLog 기존 경로로 자동 기록)
3. `app/(supplier)/zalo-connect/page.tsx` — AppSetting 우선, env 폴백으로 변경
4. i18n: `adminSettings` NS에 ko+vi 키 동시 추가 (하드코딩 금지)

## 수정 금지 구역
- prisma/schema.prisma (스키마 변경 없음), lib/zalo*.ts, 다른 설정 카드 컴포넌트 로직

## 완료 기준 (QA 검증 방법)
- [ ] ADMIN이 설정에서 QR 이미지 업로드+링크 저장 → /zalo-connect(공급자 계정)에 즉시 반영
- [ ] 설정 비우면 env 값으로 폴백, env도 없으면 기존 플레이스홀더
- [ ] 비ADMIN이 /api/settings PUT으로 해당 키 저장 시도 → 403 (기존 가드)
- [ ] 링크 형식 검증: https:// 이외 스킴 거부 (javascript: 등 주입 차단)
- [ ] AuditLog에 설정 변경 기록 존재
- [ ] ko/vi 키 패리티 (누락 시 raw 키 노출 없음)
- [ ] npm run lint && typecheck && next build 통과
