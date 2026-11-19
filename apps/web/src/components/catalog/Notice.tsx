import Alert from "@mui/material/Alert";
import { getNotice } from "@/modules/products/notices";

/** Renders a banner for a whitelisted notice code from the URL; unknown codes render nothing. */
export default function Notice({ code }: { code: string | string[] | undefined }) {
  const n = getNotice(code);
  if (!n) return null;
  return (
    <Alert severity={n.severity} role="status" sx={{ mb: 2 }}>
      {n.text}
    </Alert>
  );
}
