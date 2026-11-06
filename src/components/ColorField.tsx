"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Hex text field with a round colour swatch that opens the native picker. Submits as `name`. */
export default function ColorField({ name, label, defaultValue, error }: { name: string; label: string; defaultValue: string; error?: boolean }) {
  const [value, setValue] = useState(defaultValue);
  const valid = HEX.test(value);
  return (
    <TextField
      name={name}
      label={label}
      value={value}
      onChange={(e) => setValue(e.target.value.trim())}
      error={error || !valid}
      helperText={valid ? undefined : "رنگ را به‌صورت #RRGGBB وارد کنید"}
      sx={{ maxWidth: 220 }}
      slotProps={{
        htmlInput: { dir: "ltr", maxLength: 7, "aria-label": label },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Box
                component="label"
                sx={{ position: "relative", width: 28, height: 28, borderRadius: "50%", border: 1, borderColor: "divider", bgcolor: valid ? value : "transparent", cursor: "pointer", overflow: "hidden", display: "inline-block" }}
              >
                <input
                  type="color"
                  aria-label={`${label} (انتخابگر رنگ)`}
                  value={valid ? value : "#000000"}
                  onChange={(e) => setValue(e.target.value)}
                  style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
                />
              </Box>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
