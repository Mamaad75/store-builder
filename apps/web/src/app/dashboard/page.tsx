import PageContainer from "@/components/PageContainer";
import { businessCategoryLabel } from "@store-builder/shared/lib/business-categories";
import { resolveThemeDefinition } from "@store-builder/shared/templates/theme-catalog";
import type { Metadata } from "next";
import AddRounded from "@mui/icons-material/AddRounded";
import StorefrontOutlined from "@mui/icons-material/StorefrontOutlined";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { LinkButton, LinkCardActionArea } from "@/components/NextLinks";
import StoreCard from "@/components/StoreCard";
import { mediaPublicUrl } from "@/lib/media-url";
import { requireUser } from "@/modules/auth/session";
import { MAX_STORES_PER_USER } from "@store-builder/shared/modules/stores/schemas";
import Onboarding from "@/components/Onboarding";
import { buildOnboarding } from "@store-builder/shared/modules/stores/onboarding";
import { getOnboardingFacts, listStores } from "@/gateway/stores";

export const metadata: Metadata = { title: "فروشگاه‌های من" };

const HEX = /^#[0-9a-fA-F]{6}$/;
const brandColor = (settings: unknown): string | null => {
  const c = (settings as { primaryColor?: unknown } | null)?.primaryColor;
  return typeof c === "string" && HEX.test(c) ? c : null;
};
const logoUrl = (logo: { key: string } | null): string | null => {
  try {
    return logo ? mediaPublicUrl(logo.key) : null;
  } catch {
    return null; // an unconfigured media URL must never break the dashboard
  }
};
const fa = (n: number) => n.toLocaleString("fa-IR");

export default async function DashboardPage() {
  const user = await requireUser();
  const [stores, facts] = await Promise.all([listStores(), getOnboardingFacts()]);
  const onboarding = buildOnboarding(facts);
  const canCreate = stores.length < MAX_STORES_PER_USER;
  return (
    <PageContainer>
      <Stack spacing={4}>
        <Box sx={{ display: "flex", alignItems: { sm: "center" }, justifyContent: "space-between", gap: 2, flexDirection: { xs: "column", sm: "row" } }}>
          <Box>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 800, fontSize: { xs: 26, md: 32 } }}>
              فروشگاه‌های من
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              سلام {user.name}، فروشگاه‌هایتان را از اینجا مدیریت کنید.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Chip label={`${fa(stores.length)} از ${fa(MAX_STORES_PER_USER)} فروشگاه`} variant="outlined" />
            {canCreate && (
              <LinkButton href="/dashboard/stores/new" variant="contained" size="large" startIcon={<AddRounded />} sx={{ borderRadius: 3 }}>
                ساخت فروشگاه جدید
              </LinkButton>
            )}
          </Stack>
        </Box>
        {onboarding && <Onboarding data={onboarding} />}
        {stores.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 8, px: 2, border: "2px dashed", borderColor: "#cfd4ef", borderRadius: 4, bgcolor: "#fafbff" }}>
            <Box sx={{ width: 72, height: 72, mx: "auto", mb: 2, borderRadius: "50%", bgcolor: "#eef0ff", color: "#4f46e5", display: "grid", placeItems: "center" }}>
              <StorefrontOutlined sx={{ fontSize: 36 }} />
            </Box>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 800 }}>
              هنوز فروشگاهی نساخته‌اید
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2.5 }}>
              اولین فروشگاه خود را بسازید؛ فقط چند دقیقه طول می‌کشد.
            </Typography>
            <LinkButton href="/dashboard/stores/new" variant="contained" size="large" startIcon={<AddRounded />} sx={{ borderRadius: 3 }}>
              ساخت اولین فروشگاه
            </LinkButton>
          </Box>
        ) : (
          <Grid container spacing={3} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {stores.map((s) => (
              <Grid key={s.id} component="li" size={{ xs: 12, sm: 6, lg: 4 }}>
                <StoreCard
                  id={s.id}
                  name={s.name}
                  status={s.status}
                  category={businessCategoryLabel(s.businessCategory)}
                  theme={resolveThemeDefinition(s.templateVersion.template.key, s.templateVersion.version)?.meta.name ?? s.templateVersion.template.name}
                  color={brandColor(s.settings)}
                  logoUrl={logoUrl(s.logo)}
                />
              </Grid>
            ))}
            {canCreate && (
              <Grid component="li" size={{ xs: 12, sm: 6, lg: 4 }}>
                <LinkCardActionArea
                  href="/dashboard/stores/new"
                  sx={{ height: "100%", minHeight: 220, display: "flex", flexDirection: "column", gap: 1, border: "2px dashed", borderColor: "#cfd4ef", borderRadius: 4, bgcolor: "#fafbff", color: "primary.main", "&:hover": { bgcolor: "#f1f3ff" } }}
                >
                  <AddRounded sx={{ fontSize: 40 }} />
                  <Typography sx={{ fontWeight: 700 }}>فروشگاه جدید</Typography>
                </LinkCardActionArea>
              </Grid>
            )}
          </Grid>
        )}
      </Stack>
    </PageContainer>
  );
}
