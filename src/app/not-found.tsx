import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { TextLink } from "@/components/NextLinks";
import ThemeRegistry from "@/theme/ThemeRegistry";

export default function NotFound() {
  return (
    <ThemeRegistry>
      <Container component="main" id="main" maxWidth="sm" sx={{ py: 12, textAlign: "center" }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
          صفحه پیدا نشد
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          آدرس واردشده وجود ندارد.
        </Typography>
        <TextLink href="/">بازگشت به صفحه اصلی</TextLink>
      </Container>
    </ThemeRegistry>
  );
}
