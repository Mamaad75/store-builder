"use client";

import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  direction: "rtl",
  cssVariables: true,
  palette: {
    primary: { main: "#4f46e5" },
    secondary: { main: "#0f766e" },
    background: { default: "#f7f8fa" },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Vazirmatn Variable", Vazirmatn, Tahoma, sans-serif',
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
  },
});
