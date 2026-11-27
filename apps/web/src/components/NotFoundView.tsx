import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { TextLink } from "@/components/NextLinks";
import ThemeRegistry from "@/theme/ThemeRegistry";

/** The "page not found" screen of the dashboard and the platform pages (they already use MUI). The root one (app/not-found.tsx) is plain HTML. */
export default function NotFoundView({ href = "/", label = "بازگشت به صفحه اصلی" }: { href?: string; label?: string }) {
  return (
    <ThemeRegistry>
      <Container component="main" id="main" maxWidth="sm" sx={{ py: 12, textAlign: "center" }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
          صفحه پیدا نشد
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          آدرس واردشده وجود ندارد.
        </Typography>
        <TextLink href={href}>{label}</TextLink>
      </Container>
    </ThemeRegistry>
  );
}
