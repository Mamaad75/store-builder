import type { Metadata } from "next";
import { requireUser } from "@/modules/auth/session";
import TeamManager from "@/components/team/TeamManager";

export const metadata: Metadata = { title: "تیم" };

/** The owner's team page. The layout already hides the store from anyone without access; the API refuses everyone but the owner. */
export default async function TeamPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <TeamManager storeId={storeId} />;
}
