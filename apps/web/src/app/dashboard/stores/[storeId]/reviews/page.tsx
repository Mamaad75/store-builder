import type { Metadata } from "next";
import ReviewsManager from "@/components/content/ReviewsManager";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "نظرات خریداران" };

export default async function ReviewsPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <ReviewsManager storeId={storeId} />;
}
