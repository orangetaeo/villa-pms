# a0-login — 공급자 로그인 (Đăng nhập)

- Stitch screen: projects/14837850287160773673/screens/e940196c0b0a46ce8458cc6a7b75c821
- 대상: SUPPLIER (vi), 모바일 390px, 라이트 teal (#0D9488)
- 디자인 의도: a0-signup과 동일 톤. 1화면 1작업 — 전화번호 + 비밀번호 + 로그인 버튼 1개 + 회원가입 링크. 마케팅 카피 없음.
- 구성: Villa PMS 로고 / "Đăng nhập" / Số điện thoại(전화 아이콘, 숫자 키패드) / Mật khẩu(자물쇠 + 표시 토글) / 주 버튼 "Đăng nhập" / 링크 "Chưa có tài khoản? Đăng ký"
- 용어: "villa" 통일(biệt thự 금지). 가격·마진 요소 없음.
- 변환 메모(UX-VN): 라벨 next-intl 키 추출(vi 기본), 입력은 react-hook-form + zod, 키패드 inputmode="tel"
