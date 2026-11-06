import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import ThemeRegistry from "@/theme/ThemeRegistry";

export default function NotFound() {
  return (
    <ThemeRegistry>
      <Container maxWidth="sm" sx={{ py: 12, textAlign: "center" }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
          صفحه پیدا نشد
        </Typography>
        <Typography color="text.secondary">آدرس واردشده وجود ندارد.</Typography>
      </Container>
    </ThemeRegistry>
  );
}
