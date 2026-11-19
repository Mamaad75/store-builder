import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublishPanel from "@/components/publish/PublishPanel";
import { publicStoreUrl } from "@/lib/store-url";
import { requireUser } from "@/modules/auth/session";
import { getPublishState, listVersions } from "@/gateway/publishing";
import { getSubdomainState } from "@/gateway/publishing";
import { NotFoundError } from "@store-builder/shared/modules/stores/errors";

export const metadata: Metadata = { title: "انتشار" };
export const dynamic = "force-dynamic";

export default async function PublishPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  let state, versions, sub;
  try {
    [state, versions, sub] = await Promise.all([getPublishState(storeId), listVersions(storeId), getSubdomainState(storeId)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <PublishPanel
      storeId={storeId}
      status={state.status}
      draftRevision={state.draftRevision}
      liveNumber={state.live?.number ?? null}
      mayHaveUnpublishedChanges={state.mayHaveUnpublishedChanges}
      subdomain={sub.current}
      liveUrl={sub.current ? publicStoreUrl(sub.current) : null}
      reserved={sub.reserved.map((r) => ({ host: r.host, until: r.until }))}
      versions={versions.map((v) => ({ number: v.number, createdAt: v.createdAt, snapshotBytes: v.snapshotBytes }))}
    />
  );
}
