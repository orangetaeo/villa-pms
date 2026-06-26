// /settings/minibar — 미니바 회사표준은 재고(/inventory) "미니바 품목" 탭으로 이동(2026-06-26).
//   기존 북마크·링크 호환을 위해 영구 리다이렉트만 유지(미니바=우리 회사 재고 → 재고 카테고리 일원화).
import { redirect } from "next/navigation";

export default function MinibarSettingsRedirect() {
  redirect("/inventory");
}
