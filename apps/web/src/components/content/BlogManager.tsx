"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { MAX_POSTS_PER_STORE, POST_STATUS_LABELS } from "@store-builder/shared/modules/blog/blog";
import { getBlogPosts, type BlogPostSummaryDto } from "@/client/api";
import { LinkButton, TextLink } from "@/components/NextLinks";
import { date, failText } from "@/components/orders/labels";

/** The store's blog posts. A post marked "ready to publish" goes live with the next store publish, like the rest of the site. */
export default function BlogManager({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<BlogPostSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => getBlogPosts(storeId).then(setRows).catch((e) => setError(failText(e))), [storeId]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>وبلاگ</Typography>
          <Typography variant="body2" color="text.secondary">
            مقاله‌های «آمادهٔ انتشار» با دکمهٔ «انتشار» فروشگاه در سایت دیده می‌شوند و پیوند «وبلاگ» به منوی سایت اضافه می‌شود. تا {MAX_POSTS_PER_STORE.toLocaleString("fa-IR")} مقاله.
          </Typography>
        </Box>
        <LinkButton href={`/dashboard/stores/${storeId}/blog/new`} variant="contained">مقالهٔ تازه</LinkButton>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!rows && !error && <Skeleton variant="rounded" height={72} />}
      {rows && rows.length === 0 && <Typography color="text.secondary">هنوز مقاله‌ای ننوشته‌اید.</Typography>}
      {rows && rows.length > 0 && (
        <Box component="ul" aria-label="مقاله‌ها" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
          {rows.map((p) => (
            <Paper key={p.id} component="li" variant="outlined" data-testid="post-row" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <Box sx={{ minWidth: 0 }}>
                <TextLink href={`/dashboard/stores/${storeId}/blog/${p.id}`} underline="hover" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{p.title}</TextLink>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>آخرین ویرایش: {date(p.updatedAt)}</Typography>
              </Box>
              <Chip size="small" color={p.status === "PUBLISHED" ? "success" : "default"} variant={p.status === "PUBLISHED" ? "filled" : "outlined"} label={POST_STATUS_LABELS[p.status]} />
            </Paper>
          ))}
        </Box>
      )}
    </Stack>
  );
}
