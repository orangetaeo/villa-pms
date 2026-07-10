"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";

export type LoginState = { error?: string; success?: boolean } | null;

export async function loginAction(
  prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  try {
    // redirect:false — 서버 액션 내부 리다이렉트 체인 금지.
    // 액션 안에서 redirectTo로 리다이렉트하면 Next가 같은 요청 안에서 대상 경로를 따라가는데,
    // 이때 미들웨어가 다시 리다이렉트(임시비번 게이트 "/"→"/account" 등)하면 그 내부 재요청에는
    // 방금 발급된 세션 쿠키가 실리지 않아 auth()가 null → /logout(쿠키 삭제) → /login 무한 루프.
    // (mustChangePassword=true 계정 전원이 로그인 불가였던 실사고, 2026-07-10)
    // 성공만 알리고 실제 이동은 클라이언트 전체 리로드(window.location)로 — 패스키 로그인과 동일 패턴.
    await signIn("credentials", {
      phone: formData.get("phone"),
      password: formData.get("password"),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return { error: "invalidCredentials" };
        default:
          return { error: "serverError" };
      }
    }
    // NEXT_REDIRECT는 re-throw (리다이렉트 정상 처리)
    throw error;
  }
  // 루트 페이지에서 role별 분기 (ADMIN→/dashboard, SUPPLIER→/my-villas)
  return { success: true };
}
