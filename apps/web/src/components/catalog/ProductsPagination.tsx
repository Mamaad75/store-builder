import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { LinkButton } from "@/components/NextLinks";
import { formatNumberFa } from "@/lib/money";
import { buildProductsUrl } from "@/modules/products/list-url";
import type { ProductListParams } from "@/modules/products/schemas";

/** Plain links: every page URL keeps the active search, filters and page size. */
export default function ProductsPagination({
  storeId, params, page, totalPages, total, pageSize,
}: { storeId: string; params: ProductListParams; page: number; totalPages: number; total: number; pageSize: number }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const href = (p: number) => buildProductsUrl(storeId, { ...params, page: p });
  const window: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(totalPages, page + 2); p++) window.push(p);
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between", pt: 2 }}>
      <Typography variant="body2" color="text.secondary">
        نمایش {formatNumberFa(from)} تا {formatNumberFa(to)} از {formatNumberFa(total)} محصول
      </Typography>
      {totalPages > 1 && (
        <Stack direction="row" component="nav" aria-label="صفحه‌بندی" spacing={0.5}>
          {page > 1 && (
            <LinkButton size="small" href={href(page - 1)} rel="prev">
              قبلی
            </LinkButton>
          )}
          {window.map((p) => (
            <LinkButton key={p} size="small" href={href(p)} variant={p === page ? "contained" : "text"} aria-current={p === page ? "page" : undefined}>
              {formatNumberFa(p)}
            </LinkButton>
          ))}
          {page < totalPages && (
            <LinkButton size="small" href={href(page + 1)} rel="next">
              بعدی
            </LinkButton>
          )}
        </Stack>
      )}
    </Stack>
  );
}
