import { getTranslations } from "next-intl/server";
import { Metadata } from "next";
import SignupForm from "./SignupForm";
import SignupTypeChooser from "./SignupTypeChooser";
import PartnerSignupForm from "./PartnerSignupForm";
import CleanerSignupForm from "./CleanerSignupForm";

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
      bankSection: t("bankSection"),
      bankBank: t("bankBank"),
      bankBankPlaceholder: t("bankBankPlaceholder"),
      bankAccount: t("bankAccount"),
      bankAccountPlaceholder: t("bankAccountPlaceholder"),
      bankHolder: t("bankHolder"),
      bankHolderPlaceholder: t("bankHolderPlaceholder"),
      zaloContact: t("zaloContact"),
      zaloContactPlaceholder: t("zaloContactPlaceholder"),
      submit: t("submit"),
      submitting: t("submitting"),
      hasAccount: t("hasAccount"),
      loginLink: t("loginLink"),
      back: t("back"),
      errorMessages: {
        phoneExists: t("errors.phoneExists"),
        passwordTooShort: t("errors.passwordTooShort"),
        serverError: t("errors.serverError"),
        // 가입 완료 후 자동 로그인이 rate limit에 걸린 경우 안내(계정은 이미 생성됨)
        signupDoneLoginLater: t("errors.signupDoneLoginLater"),
      },
    };
    return <SignupForm labels={labels} />;
  }

  // 청소원(CLEANER) — 자가가입 후 자동 로그인(승인 게이트 없음, 배정 전 빈 목록만 노출)
  if (type === "cleaner") {
    const t = await getTranslations("cleanerSignup");
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
      zaloContact: t("zaloContact"),
      zaloContactPlaceholder: t("zaloContactPlaceholder"),
      submit: t("submit"),
      submitting: t("submitting"),
      hasAccount: t("hasAccount"),
      loginLink: t("loginLink"),
      back: t("back"),
      errorMessages: {
        phoneExists: t("errors.phoneExists"),
        passwordTooShort: t("errors.passwordTooShort"),
        serverError: t("errors.serverError"),
        // 가입 완료 후 자동 로그인이 rate limit에 걸린 경우 안내(계정은 이미 생성됨)
        signupDoneLoginLater: t("errors.signupDoneLoginLater"),
      },
    };
    return <CleanerSignupForm labels={labels} />;
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
    cleanerTitle: t("cleanerTitle"),
    cleanerDesc: t("cleanerDesc"),
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
