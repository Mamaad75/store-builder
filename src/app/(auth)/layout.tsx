import type { ReactNode } from "react";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Container maxWidth="xs" sx={{ py: { xs: 4, md: 10 } }}>
      <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
        {children}
      </Paper>
    </Container>
  );
}
