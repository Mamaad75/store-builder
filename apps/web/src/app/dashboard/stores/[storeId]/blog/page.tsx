import type { Metadata } from "next";
import BlogManager from "@/components/content/BlogManager";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "وبلاگ" };

export default async function BlogPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <BlogManager storeId={storeId} />;
}
