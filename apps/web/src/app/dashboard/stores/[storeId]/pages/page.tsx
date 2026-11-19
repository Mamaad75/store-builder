import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import PagesList from "@/components/pages/PagesList";
import { requireUser } from "@/modules/auth/session";
import { listPages } from "@/modules/pages/service";
import { pageUrl } from "@/modules/pages/urls";
import { NotFoundError } from "@/modules/stores/errors";

export const metadata: Metadata = { title: "صفحه‌ها" };

export default async function PagesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await requireUser();
  const { storeId } = await params;
  let result;
  try {
    result = await listPages(user.id, storeId); // ownership enforced in SQL: missing and foreign are both 404
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        بخش‌ها، ترتیب و نمایش صفحه‌ها را ویرایش کنید. همهٔ تغییرات فقط روی پیش‌نویس اعمال می‌شود و تا زمان انتشار برای بازدیدکنندگان دیده نمی‌شود.
      </Typography>
      {!result.supported ? (
        <Alert severity="info">ویرایش صفحه‌ها برای قالب این فروشگاه هنوز در دسترس نیست. اطلاعات فروشگاه شما تغییری نکرده است.</Alert>
      ) : (
        <PagesList
          storeId={storeId}
          pages={result.pages.map((p) => ({
            type: p.type,
            slug: p.slug,
            title: p.title,
            isVisible: p.isVisible,
            canHide: p.canHide,
            revision: p.revision,
            sectionCount: p.sectionCount,
            invalidCount: p.invalidCount,
            href: pageUrl(storeId, p.type),
          }))}
        />
      )}
    </Stack>
  );
}
