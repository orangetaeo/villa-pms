import { getTranslations } from "next-intl/server";
import { Metadata } from "next";
import LoginForm from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: `${t("title")} - Villa Go` };
}

export default async function LoginPage() {
  const t = await getTranslations("auth.login");

  const labels = {
    title: t("title"),
    phone: t("phone"),
    phonePlaceholder: t("phonePlaceholder"),
    password: t("password"),
    passwordPlaceholder: t("passwordPlaceholder"),
    submit: t("submit"),
    submitting: t("submitting"),
    forgotPassword: t("forgotPassword"),
    noAccount: t("noAccount"),
    signupLink: t("signupLink"),
    errorMessages: {
      invalidCredentials: t("errors.invalidCredentials"),
      accountDisabled: t("errors.accountDisabled"),
      serverError: t("errors.serverError"),
    },
  };

  return <LoginForm labels={labels} />;
}
