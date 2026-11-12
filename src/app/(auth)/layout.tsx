import type { ReactNode } from "react";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import { assertPlatformHost } from "@/lib/host-guard";
import ThemeRegistry from "@/theme/ThemeRegistry";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  await assertPlatformHost(); // login/registration are platform-only
  return (
    <ThemeRegistry>
      <Container maxWidth="xs" sx={{ py: { xs: 4, md: 10 } }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
          {children}
        </Paper>
      </Container>
    </ThemeRegistry>
  );
}
