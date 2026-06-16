import { getTranslations } from "next-intl/server";
import { Metadata } from "next";
import SignupForm from "./SignupForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signup");
  return { title: `${t("title")} - Villa PMS` };
}

export default async function SignupPage() {
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
    errorMessages: {
      phoneExists: t("errors.phoneExists"),
      passwordTooShort: t("errors.passwordTooShort"),
      serverError: t("errors.serverError"),
    },
  };

  return <SignupForm labels={labels} />;
}
