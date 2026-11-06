import Button from "@mui/material/Button";
import { changeProductStatusAction } from "@/app/dashboard/catalog-actions";
import { TRANSITION_LABEL_FA, allowedTransitions, type ProductStatus } from "@/modules/products/status";
import type { ProductListParams } from "@/modules/products/schemas";

/** One tiny form per allowed transition. The server validates the transition again. */
export default function StatusButtons({
  storeId, productId, status, returnTo, listParams,
}: { storeId: string; productId: string; status: ProductStatus; returnTo: "list" | "edit"; listParams?: ProductListParams }) {
  return (
    <>
      {allowedTransitions(status).map((to) => (
        <form key={to} action={changeProductStatusAction} style={{ display: "inline" }}>
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="status" value={to} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="q" value={listParams?.q ?? ""} />
          <input type="hidden" name="category" value={listParams?.category ?? ""} />
          <input type="hidden" name="filterStatus" value={listParams?.status ?? ""} />
          <input type="hidden" name="page" value={String(listParams?.page ?? 1)} />
          <input type="hidden" name="pageSize" value={String(listParams?.pageSize ?? "")} />
          <Button type="submit" size="small" variant="text" color={to === "ARCHIVED" ? "warning" : "primary"}>
            {TRANSITION_LABEL_FA[to]}
          </Button>
        </form>
      ))}
    </>
  );
}
