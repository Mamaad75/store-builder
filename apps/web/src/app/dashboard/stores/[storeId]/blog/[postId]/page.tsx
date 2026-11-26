import type { Metadata } from "next";
import PostEditor from "@/components/content/PostEditor";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "ویرایش مقاله" };

export default async function EditPostPage({ params }: { params: Promise<{ storeId: string; postId: string }> }) {
  await requireUser();
  const { storeId, postId } = await params;
  return <PostEditor storeId={storeId} postId={postId} />;
}
