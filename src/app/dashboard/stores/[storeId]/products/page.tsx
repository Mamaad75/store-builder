import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteProductButton from "@/components/catalog/DeleteProductButton";
import Notice from "@/components/catalog/Notice";
import ProductsPagination from "@/components/catalog/ProductsPagination";
import StatusButtons from "@/components/catalog/StatusButtons";
import StatusChip from "@/components/catalog/StatusChip";
import { LinkButton, TextLink } from "@/components/NextLinks";
import { formatNumberFa, formatToman } from "@/lib/money";
import { analyzeSpecs } from "@/lib/product-specs";
import { requireUser } from "@/modules/auth/session";
import { listCategories } from "@/modules/categories/service";
import { productUrl, productsUrl } from "@/modules/products/list-url";
import { parseProductListParams } from "@/modules/products/schemas";
import { listProducts } from "@/modules/products/service";
import { PRODUCT_STATUSES, STATUS_LABEL_FA, type ProductStatus } from "@/modules/products/status";
import { NotFoundError } from "@/modules/stores/errors";

export const metadata: Metadata = { title: "محصولات" };

/** Small label shown only on narrow screens, where the table header is hidden. */
function MobileLabel({ children }: { children: string }) {
  return (
    <Box component="span" sx={{ display: { md: "none" }, color: "text.secondary", fontSize: 13, marginInlineEnd: 0.5 }}>
      {children}
    </Box>
  );
}

const GRID = { xs: "1fr", md: "minmax(0,2.2fr) 1.1fr 0.9fr 1fr 0.9fr auto" } as const;

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { storeId } = await params;
  const raw = await searchParams;
  const listParams = parseProductListParams(raw);

  let data, categories;
  try {
    [data, categories] = await Promise.all([listProducts(user.id, storeId, listParams), listCategories(user.id, storeId)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const hasFilters = Boolean(listParams.q || listParams.category || listParams.status);
  const ctx = { ...listParams, page: data.page };

  return (
    <Box>
      <Notice code={raw.notice} />
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          محصولات
        </Typography>
        <LinkButton href={`${productsUrl(storeId)}/new`} variant="contained">
          افزودن محصول
        </LinkButton>
      </Stack>

      {/* Plain GET form: works without JavaScript and keeps every filter in the URL. */}
      <Paper variant="outlined" component="form" method="get" action={productsUrl(storeId)} key={JSON.stringify(listParams)} sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ alignItems: { md: "center" } }}>
          <TextField name="q" label="جست‌وجو در نام و آدرس" size="small" defaultValue={listParams.q ?? ""} sx={{ flex: 2 }} />
          <TextField select name="category" label="دسته‌بندی" size="small" defaultValue={listParams.category ?? ""} sx={{ flex: 1 }} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
            <option value="">همه</option>
            <option value="none">بدون دسته</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </TextField>
          <TextField select name="status" label="وضعیت" size="small" defaultValue={listParams.status ?? ""} sx={{ flex: 1 }} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
            <option value="">همه</option>
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL_FA[s]}
              </option>
            ))}
          </TextField>
          <Stack direction="row" spacing={1}>
            <Button type="submit" variant="contained" size="small">
              اعمال
            </Button>
            {hasFilters && (
              <LinkButton href={productsUrl(storeId)} size="small">
                پاک کردن فیلترها
              </LinkButton>
            )}
          </Stack>
        </Stack>
      </Paper>

      {data.total === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">
            {hasFilters ? "محصولی با این جست‌وجو یا فیلتر پیدا نشد." : "هنوز محصولی اضافه نکرده‌اید. اولین محصول خود را بسازید."}
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" component="section" aria-label="فهرست محصولات">
          <Box sx={{ display: { xs: "none", md: "grid" }, gridTemplateColumns: GRID, gap: 2, px: 2, py: 1.25, bgcolor: "action.hover", fontWeight: 700, fontSize: 14 }}>
            <span>نام محصول</span>
            <span>قیمت</span>
            <span>موجودی</span>
            <span>دسته‌بندی</span>
            <span>وضعیت</span>
            <span>عملیات</span>
          </Box>
          {data.items.map((p) => (
            <Box
              key={p.id}
              data-testid="product-row"
              sx={{
                display: { xs: "flex", md: "grid" },
                flexWrap: "wrap",
                gridTemplateColumns: GRID,
                columnGap: { xs: 2, md: 2 },
                rowGap: { xs: 0.75, md: 0 },
                alignItems: "center",
                px: 2,
                py: 1.5,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              <Box sx={{ minWidth: 0, width: { xs: "100%", md: "auto" } }}>
                <TextLink href={productUrl(storeId, p.id)} underline="hover" sx={{ fontWeight: 700, display: "block", overflowWrap: "anywhere" }}>
                  {p.name}
                </TextLink>
                {/* slug is LTR text; "end" (not "right": the RTL plugin mirrors physical left/right) aligns it with the RTL name */}
                <Typography variant="caption" color="text.secondary" dir="ltr" sx={{ display: "block", textAlign: "end", overflowWrap: "anywhere" }}>
                  /{p.slug}
                </Typography>
              </Box>
              <Typography component="span">
                <MobileLabel>قیمت:</MobileLabel>
                {formatToman(p.price)}
              </Typography>
              <Typography component="span" sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                <span>
                  <MobileLabel>موجودی:</MobileLabel>
                  {formatNumberFa(p.stockQuantity)}
                </span>
                {p.stockQuantity === 0 && (
                  <Typography component="span" variant="caption" color="error" data-testid="out-of-stock">
                    ناموجود
                  </Typography>
                )}
              </Typography>
              <Typography component="span" color={p.category ? "text.primary" : "text.secondary"}>
                <MobileLabel>دسته:</MobileLabel>
                {p.category?.name ?? "بدون دسته"}
              </Typography>
              <Box>
                <StatusChip status={p.status as ProductStatus} />
                {!analyzeSpecs(p.specs).ok && (
                  <Chip size="small" color="warning" label="مشخصات نامعتبر" sx={{ mt: 0.5 }} data-testid="specs-invalid-chip" />
                )}
              </Box>
              <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.25, alignItems: "center", width: { xs: "100%", md: "auto" }, mt: { xs: 0.5, md: 0 } }}>
                <StatusButtons storeId={storeId} productId={p.id} status={p.status as ProductStatus} returnTo="list" listParams={ctx} />
                <LinkButton href={productUrl(storeId, p.id)} size="small">
                  ویرایش
                </LinkButton>
                <DeleteProductButton storeId={storeId} productId={p.id} productName={p.name} ctx={ctx} />
              </Stack>
            </Box>
          ))}
        </Paper>
      )}

      {data.total > 0 && (
        <ProductsPagination storeId={storeId} params={listParams} page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} />
      )}
    </Box>
  );
}
