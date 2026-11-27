import type { Metadata } from "next";
import AccountView from "@/components/platform/AccountView";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "کاربر" };

export default async function UserPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireUser();
  const { userId } = await params;
  return <AccountView userId={userId} />;
}
