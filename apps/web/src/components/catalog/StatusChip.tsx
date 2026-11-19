import Chip from "@mui/material/Chip";
import { STATUS_LABEL_FA, type ProductStatus } from "@/modules/products/status";

const COLOR = { DRAFT: "default", ACTIVE: "success", ARCHIVED: "warning" } as const;

export default function StatusChip({ status }: { status: ProductStatus }) {
  return <Chip size="small" color={COLOR[status]} variant={status === "DRAFT" ? "outlined" : "filled"} label={STATUS_LABEL_FA[status]} />;
}
