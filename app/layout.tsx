import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Villa PMS",
  description: "푸꾸옥 빌라 임대 관리 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
