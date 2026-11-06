import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import StoreTabs from "@/components/StoreTabs";
import { requireUser } from "@/modules/auth/session";
import { NotFoundError } from "@/modules/stores/errors";
import { getStore } from "@/modules/stores/service";

const STATUS_LABEL = { DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده", UNPUBLISHED: "لغو انتشار" } as const;

/** The layout checks ownership too, but every page re-checks through the owner-scoped service. */
export default async function StoreLayout({ children, params }: { children: ReactNode; params: Promise<{ storeId: string }> }) {
  const user = await requireUser();
  const { storeId } = await params;
  let store;
  try {
    store = await getStore(user.id, storeId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <Box sx={{ maxWidth: 960, mx: "auto" }}>
      <Stack spacing={2}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>
            {store.name}
          </Typography>
          <Chip size="small" label={STATUS_LABEL[store.status]} />
          <Button
            component="a"
            href={`/preview/${encodeURIComponent(store.id)}`}
            target="_blank"
            rel="noopener"
            size="small"
            variant="outlined"
            sx={{ marginInlineStart: "auto" }}
          >
            پیش‌نمایش پیش‌نویس
          </Button>
        </Stack>
        <StoreTabs storeId={store.id} />
        {children}
      </Stack>
    </Box>
  );
}
