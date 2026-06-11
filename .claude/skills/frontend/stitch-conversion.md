# Skill: Stitch → Next.js 변환 패턴

1. design/stitch/<화면>/ HTML을 읽고 구조 파악 (docs/DESIGN.md 변환 규칙 선행 확인)
2. 첫 변환 시 색·radius·간격을 tailwind.config/globals.css 토큰으로 추출 → 이후 화면은 토큰 재사용, 임의값(text-[#123456]) 남발 금지
3. Stitch의 더미 데이터·이미지는 Prisma 쿼리·next/image로 전부 교체
4. 폼: react-hook-form + zod (서버 zod 스키마 재사용)
5. 상태 색상(공실/홀드/확정/차단)은 전 화면 공통 변수로 통일

## 교훈 축적
- (없음)
