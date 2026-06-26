import { getTranslations } from "next-intl/server";
import { Metadata } from "next";
import SignupForm from "./SignupForm";
import SignupTypeChooser from "./SignupTypeChooser";
import PartnerSignupForm from "./PartnerSignupForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signup");
  return { title: `${t("title")} - Villa Go` };
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;

  // 빌라 공급자(SUPPLIER) — 기존 폼 그대로 (현행 동작 보존, 가입 후 자동 로그인)
  if (type === "supplier") {
    const t = await getTranslations("auth.signup");
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
      submit: t("submit"),
      submitting: t("submitting"),
      hasAccount: t("hasAccount"),
      loginLink: t("loginLink"),
      back: t("back"),
      errorMessages: {
        phoneExists: t("errors.phoneExists"),
        passwordTooShort: t("errors.passwordTooShort"),
        serverError: t("errors.serverError"),
      },
    };
    return <SignupForm labels={labels} />;
  }

  // 파트너(여행사·랜드사, Role=PARTNER) — 자가가입 PENDING_APPROVAL (ADR-0028 PP2)
  if (type === "partner") {
    const t = await getTranslations("partnerSignup");
    const labels = {
      headerTitle: t("headerTitle"),
      title: t("title"),
      subtitle: t("subtitle"),
      name: t("name"),
      namePlaceholder: t("namePlaceholder"),
      typeLabel: t("typeLabel"),
      typeTravel: t("typeTravel"),
      typeLand: t("typeLand"),
      phone: t("phone"),
      phonePlaceholder: t("phonePlaceholder"),
      password: t("password"),
      passwordPlaceholder: t("passwordPlaceholder"),
      email: t("email"),
      emailPlaceholder: t("emailPlaceholder"),
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
        serverError: t("errors.serverError"),
      },
    };
    return <PartnerSignupForm labels={labels} />;
  }

  // 유형 미지정 — 가입 유형 선택 화면 (통합 진입)
  const t = await getTranslations("signupChooser");
  const chooserLabels = {
    headerTitle: t("headerTitle"),
    title: t("title"),
    subtitle: t("subtitle"),
    supplierTitle: t("supplierTitle"),
    supplierDesc: t("supplierDesc"),
    vendorTitle: t("vendorTitle"),
    vendorDesc: t("vendorDesc"),
    partnerTitle: t("partnerTitle"),
    partnerDesc: t("partnerDesc"),
    hasAccount: t("hasAccount"),
    loginLink: t("loginLink"),
    back: t("back"),
  };
  return <SignupTypeChooser labels={chooserLabels} />;
}
