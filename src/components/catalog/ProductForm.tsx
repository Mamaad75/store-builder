"use client";

import { useActionState, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { createProductAction, updateProductAction, type CatalogFormState } from "@/app/dashboard/catalog-actions";
import { MAX_PRICE_TOMAN, formatToman, parseIntegerInput } from "@/lib/money";
import { slugify } from "@/lib/text";
import ProductSpecsEditor, { type PresetOption, type SpecsInitial } from "./ProductSpecsEditor";

export interface ProductFormValues {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  stockQuantity: number;
  categoryId: string | null;
}

interface Props {
  mode: "create" | "edit";
  storeId: string;
  categories: { id: string; name: string }[];
  product?: ProductFormValues;
  /** Stored specs of the product (valid rows, or an invalid stored value that must be preserved). */
  specs?: SpecsInitial;
  /** Every spec preset (any store may use any preset); optional label suggestions only. */
  presets?: PresetOption[];
}

const fe = (s: CatalogFormState, k: string) => s.fieldErrors?.[k]?.[0];
const ltr = { htmlInput: { dir: "ltr" as const } };

export default function ProductForm({ mode, storeId, categories, product, specs = { state: "valid", rows: [] }, presets = [] }: Props) {
  const [state, action, pending] = useActionState(mode === "create" ? createProductAction : updateProductAction, {});
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [stock, setStock] = useState(product ? String(product.stockQuantity) : "0");

  const priceNum = parseIntegerInput(price);
  const priceOk = price.trim() !== "" && Number.isFinite(priceNum) && priceNum <= MAX_PRICE_TOMAN;

  return (
    <form action={action}>
      <input type="hidden" name="storeId" value={storeId} />
      {product && <input type="hidden" name="productId" value={product.id} />}
      <Stack spacing={2.5}>
        {state.error && <Alert severity="error">{state.error}</Alert>}
        {state.success && <Alert severity="success">{state.success}</Alert>}

        <TextField
          name="name"
          label="نام محصول"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          error={!!fe(state, "name")}
          helperText={fe(state, "name")}
        />

        <Stack spacing={1}>
          <TextField
            name="slug"
            label="آدرس محصول (slug)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            error={!!fe(state, "slug")}
            helperText={fe(state, "slug") ?? (mode === "create" ? "اگر خالی بگذارید از نام محصول ساخته می‌شود." : "با تغییر نام محصول، آدرس تغییر نمی‌کند.")}
            slotProps={ltr}
          />
          {mode === "edit" && product && slug !== product.slug && (
            <FormControlLabel
              control={<Checkbox name="confirmSlugChange" value="true" />}
              label="تغییر آدرس را تأیید می‌کنم (اگر محصول منتشر شده باشد، آدرس قبلی برای همیشه به آدرس جدید هدایت می‌شود)"
            />
          )}
          <Box>
            <Button size="small" type="button" onClick={() => setSlug(slugify(name, "product"))} disabled={!name.trim()}>
              ساخت دوباره از نام
            </Button>
          </Box>
        </Stack>

        <TextField
          name="description"
          label="توضیحات"
          defaultValue={product?.description ?? ""}
          multiline
          minRows={4}
          error={!!fe(state, "description")}
          helperText={fe(state, "description") ?? "متن ساده، حداکثر ۵۰۰۰ کاراکتر"}
        />

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField
            name="price"
            label="قیمت (تومان)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            fullWidth
            error={!!fe(state, "price") || (price.trim() !== "" && !priceOk)}
            helperText={fe(state, "price") ?? (priceOk ? formatToman(priceNum) : "عدد صحیح بین ۰ تا ۱٬۰۰۰٬۰۰۰٬۰۰۰ وارد کنید")}
            slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }}
          />
          <TextField
            name="stockQuantity"
            label="موجودی (عدد)"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            required
            fullWidth
            error={!!fe(state, "stockQuantity")}
            helperText={fe(state, "stockQuantity") ?? "موجودی صفر محصول را مخفی یا بایگانی نمی‌کند."}
            slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }}
          />
        </Stack>

        <TextField
          select
          name="categoryId"
          label="دسته‌بندی"
          defaultValue={product?.categoryId ?? ""}
          error={!!fe(state, "categoryId")}
          helperText={fe(state, "categoryId")}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        >
          <option value="">بدون دسته</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </TextField>

        <ProductSpecsEditor initial={specs} presets={presets} error={fe(state, "specs")} />

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { xs: "stretch", sm: "center" } }}>
          <Button type="submit" variant="contained" disabled={pending} sx={{ whiteSpace: "nowrap", flexShrink: 0 }}>
            {mode === "create" ? "ساخت محصول" : "ذخیره تغییرات"}
          </Button>
          {mode === "create" && (
            <Typography variant="body2" color="text.secondary">
              محصول جدید در وضعیت «پیش‌نویس» ساخته می‌شود.
            </Typography>
          )}
        </Stack>
      </Stack>
    </form>
  );
}
