import { getTranslations } from "next-intl/server";
import { Metadata } from "next";
import ResetPasswordForm from "./ResetPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.reset");
  return { title: `${t("resetTitle")} - Villa Go` };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>;
}) {
  const t = await getTranslations("auth.reset");
  const { phone } = await searchParams;

  const labels = {
    resetTitle: t("resetTitle"),
    resetSubtitle: t("resetSubtitle"),
    phone: t("phone"),
    phonePlaceholder: t("phonePlaceholder"),
    code: t("code"),
    codePlaceholder: t("codePlaceholder"),
    newPassword: t("newPassword"),
    newPasswordPlaceholder: t("newPasswordPlaceholder"),
    submit: t("resetSubmit"),
    submitting: t("resetSubmitting"),
    successTitle: t("successTitle"),
    successBody: t("successBody"),
    goLogin: t("goLogin"),
    backToLogin: t("backToLogin"),
    errorMessages: {
      INVALID_CODE: t("errors.invalidCode"),
      CODE_EXPIRED: t("errors.codeExpired"),
      TOO_MANY_ATTEMPTS: t("errors.tooManyAttempts"),
      PASSWORD_TOO_SHORT: t("errors.passwordTooShort"),
      serverError: t("errors.serverError"),
    },
  };

  return <ResetPasswordForm labels={labels} initialPhone={phone ?? ""} />;
}
