"use client";

import { useActionState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { MediaFormState } from "@/app/dashboard/media-actions";

type Action = (prev: MediaFormState, fd: FormData) => Promise<MediaFormState>;

interface Props {
  title: string;
  help: string;
  testId: string;
  hidden: Record<string, string>;
  /** Public URL of the current image (built on the server), or null. */
  imageUrl: string | null;
  image: { width: number; height: number } | null;
  uploadAction: Action;
  removeAction: Action;
}

/**
 * One uploader for every kind of image (product image, store logo). The file input is the only thing the browser
 * contributes; the server decides everything else. The accept list is a convenience: the server validates the bytes.
 */
export default function ImageUploader({ title, help, testId, hidden, imageUrl, image, uploadAction, removeAction }: Props) {
  // One state for both buttons, so the message always reflects the LAST action (upload or remove).
  const [state, act, pending] = useActionState(
    async (prev: MediaFormState, fd: FormData) => (fd.get("intent") === "remove" ? removeAction(prev, fd) : uploadAction(prev, fd)),
    {},
  );
  return (
    <Stack spacing={1.5} data-testid={testId}>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {state.error && <Alert severity="error">{state.error}</Alert>}
      {state.success && <Alert severity="success">{state.success}</Alert>}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
        <Box
          sx={{ width: 112, height: 112, flexShrink: 0, borderRadius: 2, border: 1, borderColor: "divider", overflow: "hidden", display: "grid", placeItems: "center", bgcolor: "action.hover" }}
        >
          {imageUrl && image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" width={image.width} height={image.height} data-testid={`${testId}-image`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Typography variant="caption" color="text.secondary">
              بدون تصویر
            </Typography>
          )}
        </Box>
        <Stack spacing={1.5} sx={{ flex: 1 }}>
          <form action={act}>
            {Object.entries(hidden).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
              <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required aria-label={`${title}: انتخاب فایل`} />
              <Button type="submit" variant="outlined" size="small" disabled={pending}>
                {pending ? "در حال ارسال…" : imageUrl ? "جایگزینی تصویر" : "بارگذاری تصویر"}
              </Button>
            </Stack>
          </form>
          {imageUrl && (
            <form action={act}>
              <input type="hidden" name="intent" value="remove" />
              {Object.entries(hidden).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <Button type="submit" color="error" size="small" disabled={pending}>
                حذف تصویر
              </Button>
            </form>
          )}
          <Typography variant="caption" color="text.secondary">
            {help}
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
}
