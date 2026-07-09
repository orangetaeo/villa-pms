# T-zalo-connect-role-coverage — Zalo 연결(QR) 역할별 커버리지 완결

- 상태: 진행 중 (2026-07-09, 메인 폴더 세션)
- 배경(테오 지시): 역할별 QR 등록 화면 공백 해소. 현황 — SUPPLIER ✅ / CLEANER 화면 있으나 자동매칭 누락 / VENDOR·PARTNER 화면 없음(관리자 수동 연결만, 벤더 D-01·02·08은 Zalo 채널인데 미연결 시 인앱만).

## 범위

### ① CLEANER 자동 매칭 (버그성 갭)
- lib/zalo-inbound.ts `tryMatchSupplierByPhone` — role 검색을 SUPPLIER 단일 → SUPPLIER·CLEANER·VENDOR·PARTNER 확대 (함수명·주석 정합화)
- 기존 안전 규칙 유지: 정확 일치·이미 다른 zaloUserId 점유 시 자동 덮어쓰기 금지·경합 조용히 실패(수동 fallback)

### ② /zalo-connect VENDOR·PARTNER 개방 (래퍼 라우트 방식)
- 기존 app/(supplier)/zalo-connect/page.tsx 본문을 공용 서버 컴포넌트로 추출 (role별 doneHref/locale 파라미터)
- 신규: app/vendor/zalo-connect/page.tsx (VENDOR 전용, done→/vendor), app/partner/zalo-connect/page.tsx (PARTNER 전용, done→/partner) — 각 포털 레이아웃·locale 규칙 준수
- 진입점: vendor/profile·partner/profile에 "Zalo 알림 연결" 링크(연결 여부 표시)
- QR·딥링크 소스는 기존 그대로: AppSetting(ZALO_CONNECT_*) 우선 → env 폴백 (T-zalo-connect-qr-admin-setting)

### ③ PARTNER 매칭 시 contactZaloUid 동기화
- 자동 매칭된 User가 PARTNER면 연결된 Partner(userId=user.id)의 contactZaloUid가 **비어있을 때만** 같은 uid로 채움(기존 값 덮어쓰기 금지 — 관리자 수동 세팅 존중)

## 수정 금지 구역
- prisma/schema.prisma(변경 없음), 발송 경로(lib/zalo.ts 등), 관리자 수동 LINK_ZALO 경로, components/tour/**

## 완료 기준 (QA)
- [ ] CLEANER·VENDOR·PARTNER 전화번호로 봇에 메시지 → User.zaloUserId 자동 연결 (단위테스트로 role별 검증)
- [ ] PARTNER 매칭 시 contactZaloUid 채움(비어있을 때만) 검증
- [ ] /vendor/zalo-connect·/partner/zalo-connect 렌더 + 타 역할 접근 시 리다이렉트(권한 격리)
- [ ] 기존 SUPPLIER·CLEANER /zalo-connect 회귀 없음
- [ ] 공급자 화이트리스트(SUPPLIER_CLIENT_NAMESPACES)·admin 누수 없음, ko/vi 키 패리티
- [ ] tsc·vitest·next build 통과
