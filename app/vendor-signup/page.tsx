// /vendor-signup — 원천 공급자(ServiceVendor) 자가 회원가입 (ADR-0023 S5, 공개·비인증)
//   vi 기본·라이트·모바일. 빌라 공급자 가입(/(auth)/signup) UX 미러.
//   POST /api/vendor-signup → 운영자 승인 대기. 성공 시 안내 + 로그인 링크.
//   미들웨어: /vendor-signup은 보호경로 화이트리스트에 없어 비인증 통과(/vendor 하위 아님).
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import VendorSignupForm from "./VendorSignupForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("vendorSignup");
  return { title: `${t("title")} - Villa Go` };
}

export default async function VendorSignupPage() {
  const t = await getTranslations("vendorSignup");

  // 라벨을 서버에서 모아 클라 폼에 전달 (가입 페이지 패턴 동일).
  const labels = {
    headerTitle: t("headerTitle"),
    title: t("title"),
    subtitle: t("subtitle"),
    name: t("name"),
    namePlaceholder: t("namePlaceholder"),
    phone: t("phone"),
    phonePlaceholder: t("phonePlaceholder"),
    password: t("password"),
    passwordPlaceholder: t("passwordPlaceholder"),
    passwordConfirm: t("passwordConfirm"),
    passwordConfirmPlaceholder: t("passwordConfirmPlaceholder"),
    zalo: t("zalo"),
    zaloPlaceholder: t("zaloPlaceholder"),
    zaloHint: t("zaloHint"),
    bankTitle: t("bankTitle"),
    bank: t("bank"),
    bankPlaceholder: t("bankPlaceholder"),
    account: t("account"),
    accountPlaceholder: t("accountPlaceholder"),
    holder: t("holder"),
    holderPlaceholder: t("holderPlaceholder"),
    note: t("note"),
    notePlaceholder: t("notePlaceholder"),
    submit: t("submit"),
    submitting: t("submitting"),
    back: t("back"),
    hasAccount: t("hasAccount"),
    loginLink: t("loginLink"),
    successTitle: t("successTitle"),
    successBody: t("successBody"),
    goLogin: t("goLogin"),
    errorMessages: {
      phoneExists: t("errors.phoneExists"),
      passwordTooShort: t("errors.passwordTooShort"),
      passwordMismatch: t("errors.passwordMismatch"),
      serverError: t("errors.serverError"),
    },
  };

  return <VendorSignupForm labels={labels} />;
}
