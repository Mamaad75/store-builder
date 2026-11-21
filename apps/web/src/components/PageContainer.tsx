import type { ReactNode } from "react";
import Container from "@mui/material/Container";

/** The centred content column of the platform's own pages (store list, new store, account). The store admin has its own shell. */
export default function PageContainer({ children, maxWidth = "lg" }: { children: ReactNode; maxWidth?: "sm" | "md" | "lg" }) {
  return (
    <Container maxWidth={maxWidth} sx={{ py: 4 }}>
      {children}
    </Container>
  );
}
