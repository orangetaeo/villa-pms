# Skill: Stitch → Next.js 변환 패턴

1. design/stitch/<화면>/ HTML을 읽고 구조 파악 (docs/DESIGN.md 변환 규칙 선행 확인)
2. 첫 변환 시 색·radius·간격을 tailwind.config/globals.css 토큰으로 추출 → 이후 화면은 토큰 재사용, 임의값(text-[#123456]) 남발 금지
3. Stitch의 더미 데이터·이미지는 Prisma 쿼리·next/image로 전부 교체
4. 폼: react-hook-form + zod (서버 zod 스키마 재사용)
5. 상태 색상(공실/홀드/확정/차단)은 전 화면 공통 변수로 통일

## 교훈 축적
- (2026-06-11 T3.4-FE QA) **쿼리 파라미터(?task=) 기반 선택 전환 시 클라이언트 useState가 유지됨** — 같은 라우트에서 searchParams만 바뀌면 클라 컴포넌트는 리마운트되지 않아 반려 사유 입력·rejectMode·성공/게이트 배너가 이전 선택의 것 그대로 다음 선택에 남는다(잘못된 사유를 다른 태스크에 제출 가능). 선택 대상 ID가 props로 바뀌는 뷰는 ① 부모(RSC)에서 `key={selectedId}`로 리마운트시키거나 ② 액션·메시지 상태를 selectedId와 묶어 저장하고 렌더 시 일치 검사할 것.
