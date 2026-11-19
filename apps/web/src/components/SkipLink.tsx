import Box from "@mui/material/Box";

/**
 * "Skip to main content" link (WCAG 2.4.1), the first focusable element of every platform page. Off-screen until focused. Every
 * platform layout renders its main landmark with `id="main"`. (Storefront themes have their own, styled per theme.)
 */
export default function SkipLink() {
  return (
    <Box
      component="a"
      href="#main"
      sx={{ position: "absolute", insetInlineStart: 8, top: -48, zIndex: 2000, bgcolor: "background.paper", p: 1, borderRadius: 1, "&:focus": { top: 8 } }}
    >
      پرش به محتوای اصلی
    </Box>
  );
}
