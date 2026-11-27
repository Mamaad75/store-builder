"use client";

import { useEffect } from "react";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ThemeRegistry from "@/theme/ThemeRegistry";

/**
 * The error screen of the dashboard and the platform pages (they already use MUI). Shows no technical detail (the digest is the only thing logged
 * client-side, for correlation). The ROOT boundary is a plain one (app/error.tsx): it is bundled into every route, and must not drag MUI into a storefront.
 */
export default function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app-error]", error.digest ?? "no-digest");
  }, [error]);
  return (
    <ThemeRegistry>
      <Container component="main" id="main" maxWidth="sm" sx={{ py: 12, textAlign: "center" }}>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }} data-testid="error-title">
            مشکلی پیش آمد
          </Typography>
          <Typography color="text.secondary">درخواست شما انجام نشد. دوباره تلاش کنید؛ اگر مشکل ادامه داشت، کمی بعد برگردید.</Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={reset}>
              تلاش دوباره
            </Button>
            <Button href="/">صفحه اصلی</Button>
          </Stack>
        </Stack>
      </Container>
    </ThemeRegistry>
  );
}
