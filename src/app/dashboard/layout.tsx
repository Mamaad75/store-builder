import type { Metadata } from "next";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import AppBar from "@mui/material/AppBar";
import { logoutAction } from "@/app/actions-auth";
import { TextLink } from "@/components/NextLinks";
import SiteFooter from "@/components/SiteFooter";
import ThemeRegistry from "@/theme/ThemeRegistry";
import { assertPlatformHost } from "@/lib/host-guard";
import { requireUser } from "@/modules/auth/session";

// Per-request: always evaluates the session on the server.
export const dynamic = "force-dynamic";

// The application is never indexed (it also sits behind a login).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await assertPlatformHost(); // never through a store host
  const user = await requireUser();
  return (
    <ThemeRegistry>
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <Box
          component="a"
          href="#main"
          sx={{ position: "absolute", insetInlineStart: 8, top: -48, zIndex: 2000, bgcolor: "background.paper", p: 1, borderRadius: 1, "&:focus": { top: 8 } }}
        >
          پرش به محتوای اصلی
        </Box>
        <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Toolbar>
            <Typography sx={{ flexGrow: 1, fontWeight: 700 }}>سایت‌ساز فروشگاهی</Typography>
            <Box component="nav" aria-label="منوی حساب" sx={{ display: "flex", alignItems: "center", gap: 2, mx: 2 }}>
              <TextLink href="/dashboard">فروشگاه‌ها</TextLink>
              <TextLink href="/dashboard/account">{user.name}</TextLink>
            </Box>
            <form action={logoutAction}>
              <Button type="submit" size="small">
                خروج
              </Button>
            </form>
          </Toolbar>
        </AppBar>
        <Container component="main" id="main" sx={{ py: 4 }}>
          {children}
        </Container>
        <SiteFooter />
      </Box>
    </ThemeRegistry>
  );
}
