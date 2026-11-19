"use client";

import { useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { deleteProductAction } from "@/app/dashboard/catalog-actions";

interface Props {
  storeId: string;
  productId: string;
  productName: string;
  ctx?: { q?: string; category?: string; status?: string; page?: number; pageSize?: number };
}

export default function DeleteProductButton({ storeId, productId, productName, ctx }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="small" color="error" onClick={() => setOpen(true)}>
        حذف
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <form action={deleteProductAction}>
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="confirmDelete" value="yes" />
          <input type="hidden" name="q" value={ctx?.q ?? ""} />
          <input type="hidden" name="category" value={ctx?.category ?? ""} />
          <input type="hidden" name="filterStatus" value={ctx?.status ?? ""} />
          <input type="hidden" name="page" value={String(ctx?.page ?? 1)} />
          <input type="hidden" name="pageSize" value={String(ctx?.pageSize ?? "")} />
          <DialogTitle>حذف محصول</DialogTitle>
          <DialogContent>
            <DialogContentText>
              محصول «{productName}» برای همیشه حذف می‌شود. این کار قابل بازگشت نیست.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button type="button" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" color="error" variant="contained">
              حذف محصول
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
