"use client";

import PrintOutlined from "@mui/icons-material/PrintOutlined";
import Button from "@mui/material/Button";

/** Opens the browser's print dialog (the merchant can also "print" to a PDF file there). */
export default function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="contained" startIcon={<PrintOutlined />} onClick={() => window.print()}>
      {label}
    </Button>
  );
}
