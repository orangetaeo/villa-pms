import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function SupplierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* TODO: 모바일 하단 탭바 추가 (Sprint 1 T1.1) */}
      <main className="pb-6">{children}</main>
    </div>
  );
}
