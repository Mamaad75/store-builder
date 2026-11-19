import type { ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import SiteFooter from "@/components/SiteFooter";
import SkipLink from "@/components/SkipLink";
import { TextLink } from "@/components/NextLinks";
import { assertPlatformHost } from "@/lib/host-guard";
import ThemeRegistry from "@/theme/ThemeRegistry";

/** Legal pages exist on the platform host only (never on a store subdomain). */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  await assertPlatformHost();
  return (
    <ThemeRegistry>
      <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <SkipLink />
        <Container component="main" id="main" maxWidth="md" sx={{ py: 6, flexGrow: 1 }}>
          <TextLink href="/">بازگشت به صفحه اصلی</TextLink>
          <Alert severity="warning" data-testid="legal-draft" sx={{ my: 3 }}>
            این متن پیش‌نویس است و هنوز توسط مشاور حقوقی بازبینی نشده است. پیش از راه‌اندازی عمومی باید با متن نهایی جایگزین شود.
          </Alert>
          {children}
        </Container>
        <SiteFooter />
      </Box>
    </ThemeRegistry>
  );
}
