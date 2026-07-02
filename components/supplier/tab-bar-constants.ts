// 공급자 탭바 관련 경로 상수 — 서버(레이아웃)·클라이언트(탭바) 공용.
// ⚠️ 서버 컴포넌트(app/(supplier)/layout.tsx)가 이 배열을 spread([...])하므로
//    "use client" 모듈(tab-bar.tsx)에 두면 RSC가 클라이언트 참조 프록시로 바꿔 "not iterable"이 된다.
//    따라서 반드시 이 순수 모듈(서버 안전)에 정의한다.

/** 탭바를 숨기는 풀스크린 플로우 경로 접두사 (당겨서 새로고침도 동일하게 제외).
 *  체크인·아웃 검수 상세는 자체 앱바 + fixed 하단 CTA라 풀스크린(탭바·당겨새로고침 제외).
 *  목록 "/my-bookings"는 일반 탭이므로 "/my-bookings/" (하위 상세)만 매칭. */
export const SUPPLIER_FULLSCREEN_PREFIXES = ["/my-villas/new", "/my-bookings/"];

/** 자체 상단 앱바(뒤로가기 + 중앙 제목)를 그리는 페이지 접두사.
 *  여기서는 레이아웃의 상단 트리오(브랜드 로고·계정 아이콘)를 숨겨 중앙/좌상단 겹침을 막는다.
 *  (탭바는 유지 — 상세·하위 페이지는 하단 탭으로 이동 가능.)
 *  "/my-villas/" = 등록 마법사·상세·사진·비품·요율·판매링크·수정 모두 포함(목록 "/my-villas"는 제외).
 *  "/my-bookings/" = 체크인·아웃 등 자체 앱바 플로우. */
export const SUPPLIER_OWN_HEADER_PREFIXES = ["/my-villas/", "/my-bookings/"];
