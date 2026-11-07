import { businessCategoryLabel } from "@/lib/business-categories";
import { resolveThemeDefinition } from "@/templates/theme-catalog";
import type { Metadata } from "next";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { LinkButton, LinkCardActionArea } from "@/components/NextLinks";
import { requireUser } from "@/modules/auth/session";
import { MAX_STORES_PER_USER } from "@/modules/stores/schemas";
import { listStores } from "@/modules/stores/service";

export const metadata: Metadata = { title: "فروشگاه‌های من" };

const STATUS_LABEL = { DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده", UNPUBLISHED: "لغو انتشار" } as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const stores = await listStores(user.id);
  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>
          فروشگاه‌های من
        </Typography>
        {stores.length < MAX_STORES_PER_USER && (
          <LinkButton href="/dashboard/stores/new" variant="contained">
            ساخت فروشگاه جدید
          </LinkButton>
        )}
      </Stack>
      {stores.length === 0 ? (
        <Typography color="text.secondary">هنوز فروشگاهی نساخته‌اید. اولین فروشگاه خود را بسازید.</Typography>
      ) : (
        <Grid container spacing={2}>
          {stores.map((s) => (
            <Grid key={s.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card variant="outlined">
                <LinkCardActionArea href={`/dashboard/stores/${s.id}`}>
                  <CardContent>
                    <Typography sx={{ fontWeight: 700 }}>{s.name}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {businessCategoryLabel(s.businessCategory)} · قالب: {resolveThemeDefinition(s.templateVersion.template.key, s.templateVersion.version)?.meta.name ?? s.templateVersion.template.name}
                    </Typography>
                    <Chip size="small" label={STATUS_LABEL[s.status]} />
                  </CardContent>
                </LinkCardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
