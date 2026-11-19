"use client";

import { useActionState, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
  type CatalogFormState,
} from "@/app/dashboard/catalog-actions";
import { formatNumberFa } from "@/lib/money";

export interface CategoryItem {
  id: string;
  name: string;
  productCount: number;
}

const fe = (s: CatalogFormState, k: string) => s.fieldErrors?.[k]?.[0];

function CreateForm({ storeId }: { storeId: string }) {
  const [state, action, pending] = useActionState(createCategoryAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="storeId" value={storeId} />
      <Stack spacing={1.5}>
        {state.error && <Alert severity="error">{fe(state, "name") ?? state.error}</Alert>}
        {state.success && <Alert severity="success">{state.success}</Alert>}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField name="name" label="نام دسته‌بندی جدید" size="small" required fullWidth error={!!fe(state, "name")} />
          <Button type="submit" variant="contained" disabled={pending} sx={{ flexShrink: 0 }}>
            افزودن دسته
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}

function RenameForm({ storeId, category, onDone }: { storeId: string; category: CategoryItem; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateCategoryAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="categoryId" value={category.id} />
      <Stack spacing={1}>
        {state.error && <Alert severity="error">{fe(state, "name") ?? state.error}</Alert>}
        {state.success && <Alert severity="success">{state.success}</Alert>}
        <Stack direction="row" spacing={1}>
          <TextField name="name" size="small" defaultValue={category.name} required fullWidth slotProps={{ htmlInput: { "aria-label": `نام دسته ${category.name}` } }} />
          <Button type="submit" size="small" variant="contained" disabled={pending}>
            ذخیره
          </Button>
          <Button type="button" size="small" onClick={onDone}>
            بستن
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}

function DeleteDialog({ storeId, category }: { storeId: string; category: CategoryItem }) {
  const [open, setOpen] = useState(false);
  const [moveConfirmed, setMoveConfirmed] = useState(false);
  const hasProducts = category.productCount > 0;
  return (
    <>
      <Button size="small" color="error" onClick={() => setOpen(true)}>
        حذف
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <form action={deleteCategoryAction}>
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="categoryId" value={category.id} />
          <DialogTitle>حذف دسته‌بندی «{category.name}»</DialogTitle>
          <DialogContent>
            {hasProducts ? (
              <>
                <DialogContentText sx={{ mb: 1 }}>
                  این دسته <strong>{formatNumberFa(category.productCount)} محصول</strong> دارد. محصولات حذف نمی‌شوند؛ با تأیید زیر به «بدون دسته» منتقل می‌شوند.
                </DialogContentText>
                <FormControlLabel
                  control={<Checkbox name="moveProducts" checked={moveConfirmed} onChange={(e) => setMoveConfirmed(e.target.checked)} />}
                  label="محصولات این دسته به «بدون دسته» منتقل شوند و دسته حذف شود"
                />
              </>
            ) : (
              <DialogContentText>این دسته‌بندی حذف می‌شود.</DialogContentText>
            )}
          </DialogContent>
          <DialogActions>
            <Button type="button" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" color="error" variant="contained" disabled={hasProducts && !moveConfirmed}>
              حذف دسته
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}

function Row({ storeId, category }: { storeId: string; category: CategoryItem }) {
  const [editing, setEditing] = useState(false);
  return (
    <Box data-testid="category-row" sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: "divider" }}>
      {editing ? (
        <RenameForm storeId={storeId} category={category} onDone={() => setEditing(false)} />
      ) : (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{category.name}</Typography>
            <Chip size="small" variant="outlined" label={`${formatNumberFa(category.productCount)} محصول`} />
          </Stack>
          <Stack direction="row" spacing={0.5}>
            <Button size="small" onClick={() => setEditing(true)}>
              ویرایش نام
            </Button>
            <DeleteDialog storeId={storeId} category={category} />
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

export default function CategoryManager({ storeId, categories }: { storeId: string; categories: CategoryItem[] }) {
  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <CreateForm storeId={storeId} />
      </Paper>
      {categories.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">هنوز دسته‌بندی‌ای نساخته‌اید.</Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" component="section" aria-label="فهرست دسته‌بندی‌ها">
          {categories.map((c, i) => (
            <Box key={c.id} sx={i === 0 ? { "& > div": { borderTop: 0 } } : undefined}>
              <Row storeId={storeId} category={c} />
            </Box>
          ))}
        </Paper>
      )}
    </Stack>
  );
}
