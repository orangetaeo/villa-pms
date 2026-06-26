import { getTranslations } from "next-intl/server";
import { Metadata } from "next";
import ForgotPasswordForm from "./ForgotPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.reset");
  return { title: `${t("forgotTitle")} - Villa Go` };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.reset");

  const labels = {
    forgotTitle: t("forgotTitle"),
    forgotSubtitle: t("forgotSubtitle"),
    phone: t("phone"),
    phonePlaceholder: t("phonePlaceholder"),
    sendCode: t("sendCode"),
    sending: t("sending"),
    sentTitle: t("sentTitle"),
    sentBody: t("sentBody"),
    notLinkedHint: t("notLinkedHint"),
    goReset: t("goReset"),
    backToLogin: t("backToLogin"),
    errorMessages: {
      serverError: t("errors.serverError"),
    },
  };

  return <ForgotPasswordForm labels={labels} />;
}
