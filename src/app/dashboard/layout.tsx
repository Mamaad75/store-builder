import type { Metadata } from "next";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import AppBar from "@mui/material/AppBar";
import { logoutAction } from "@/app/actions-auth";
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
        <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Toolbar>
            <Typography sx={{ flexGrow: 1, fontWeight: 700 }}>سایت‌ساز فروشگاهی</Typography>
            <Typography variant="body2" sx={{ mx: 2 }}>
              {user.name}
            </Typography>
            <form action={logoutAction}>
              <Button type="submit" size="small">
                خروج
              </Button>
            </form>
          </Toolbar>
        </AppBar>
        <Container sx={{ py: 4 }}>{children}</Container>
      </Box>
    </ThemeRegistry>
  );
}
