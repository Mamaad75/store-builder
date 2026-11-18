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
    // Keyboard focus must be clearly visible (WCAG 2.4.7; M3 audit): MUI's default is only a faint ripple, so every button, icon
    // button, link-button, tab and accordion header gets a solid outline when focused from the keyboard. The page and header
    // backgrounds are light, where this indigo reaches about 6:1.
    MuiButtonBase: {
      styleOverrides: {
        root: { "&.Mui-focusVisible": { outline: "3px solid #4f46e5", outlineOffset: "2px" } },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: { "&:focus-visible": { outline: "3px solid #4f46e5", outlineOffset: "2px", borderRadius: "2px" } },
      },
    },
  },
});
