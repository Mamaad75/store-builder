import type { Metadata } from "next";
import PostEditor from "@/components/content/PostEditor";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "مقالهٔ تازه" };

export default async function NewPostPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <PostEditor storeId={storeId} postId={null} />;
}
