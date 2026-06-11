"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";

export type LoginState = { error?: string } | null;

export async function loginAction(
  prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      phone: formData.get("phone"),
      password: formData.get("password"),
      redirectTo: "/", // 루트 페이지에서 role별 분기 (ADMIN→/dashboard, SUPPLIER→/my-villas)
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
  return null;
}
