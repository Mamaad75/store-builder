"use client";

import { useActionState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { addGalleryImageAction, makeGalleryPrimaryAction, removeGalleryImageAction, type MediaFormState } from "@/app/dashboard/media-actions";
import { MAX_GALLERY_EXTRAS } from "@store-builder/shared/modules/products/gallery";

export interface GalleryTile {
  mediaId: string;
  url: string | null;
  width: number;
  height: number;
}

const fa = (n: number) => n.toLocaleString("fa-IR");

/**
 * The extra images after the product's main image (up to five): upload one, make one the main image (the old main takes its place) or
 * remove one. The main image itself is handled by the uploader above. The server decides everything else (limit, key, type, size).
 */
export default function ProductGalleryManager({ storeId, productId, hasMain, tiles }: { storeId: string; productId: string; hasMain: boolean; tiles: GalleryTile[] }) {
  const [state, act, pending] = useActionState(async (prev: MediaFormState, fd: FormData) => {
    const intent = fd.get("intent");
    return intent === "remove" ? removeGalleryImageAction(prev, fd) : intent === "primary" ? makeGalleryPrimaryAction(prev, fd) : addGalleryImageAction(prev, fd);
  }, {} as MediaFormState);
  const full = tiles.length >= MAX_GALLERY_EXTRAS;
  const hidden = (mediaId?: string) => (
    <>
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="productId" value={productId} />
      {mediaId && <input type="hidden" name="mediaId" value={mediaId} />}
    </>
  );
  return (
    <Stack spacing={1.5} component="section" aria-labelledby="gallery-h" data-testid="product-gallery">
      <Typography id="gallery-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>تصاویر بیشتر (گالری)</Typography>
      <Typography variant="body2" color="text.secondary">
        تا {fa(MAX_GALLERY_EXTRAS)} تصویر دیگر کنار تصویر اصلی؛ خریدار آن‌ها را در صفحهٔ محصول می‌بیند. تصویر اصلی در کارت‌ها و فهرست‌ها نمایش داده می‌شود.
      </Typography>
      {state.error && <Alert severity="error" role="alert">{state.error}</Alert>}
      {state.success && <Alert severity="success" role="status">{state.success}</Alert>}
      {tiles.length > 0 && (
        <Box component="ul" aria-label="تصاویر گالری" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", gap: 2, flexWrap: "wrap" }}>
          {tiles.map((t, i) => (
            <Box key={t.mediaId} component="li" data-testid="gallery-tile" sx={{ width: 132 }}>
              <Box sx={{ width: 132, height: 132, borderRadius: 2, border: 1, borderColor: "divider", overflow: "hidden", display: "grid", placeItems: "center", bgcolor: "action.hover" }}>
                {t.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.url} alt={`تصویر ${fa(i + 2)} محصول`} width={t.width} height={t.height} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <Typography variant="caption" color="text.secondary">بدون پیش‌نمایش</Typography>
                )}
              </Box>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                <form action={act}>
                  <input type="hidden" name="intent" value="primary" />
                  {hidden(t.mediaId)}
                  <Button type="submit" size="small" disabled={pending} aria-label={`تصویر ${fa(i + 2)} را تصویر اصلی کن`}>تصویر اصلی</Button>
                </form>
                <form action={act}>
                  <input type="hidden" name="intent" value="remove" />
                  {hidden(t.mediaId)}
                  <Button type="submit" size="small" color="error" disabled={pending} aria-label={`حذف تصویر ${fa(i + 2)}`}>حذف</Button>
                </form>
              </Stack>
            </Box>
          ))}
        </Box>
      )}
      {!hasMain ? (
        <Typography variant="body2" color="text.secondary">اول تصویر اصلی محصول را بارگذاری کنید؛ بعد می‌توانید تصویرهای بیشتری اضافه کنید.</Typography>
      ) : full ? (
        <Typography variant="body2" color="text.secondary" data-testid="gallery-full">گالری پر است ({fa(MAX_GALLERY_EXTRAS)} تصویر). برای افزودن تصویر تازه، یکی را حذف کنید.</Typography>
      ) : (
        <form action={act}>
          <input type="hidden" name="intent" value="add" />
          {hidden()}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
            <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required aria-label="گالری: انتخاب فایل تصویر" />
            <Button type="submit" variant="outlined" size="small" disabled={pending}>{pending ? "در حال ارسال…" : "افزودن تصویر"}</Button>
          </Stack>
        </form>
      )}
    </Stack>
  );
}
