"use client";

import { useId, useRef, useState } from "react";
import KeyboardArrowDownRounded from "@mui/icons-material/KeyboardArrowDownRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import ManageAccountsOutlined from "@mui/icons-material/ManageAccountsOutlined";
import StorefrontOutlined from "@mui/icons-material/StorefrontOutlined";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { logoutAction } from "@/app/actions-auth";

/**
 * The signed-in person in the top bar: an avatar with their first letter and name (the name hides on phones, the avatar stays), opening a
 * menu with their stores, their account and sign-out. Sign-out is a real form post, so it works exactly as before.
 */
export default function AccountMenu({ name, username }: { name: string; username: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const logoutForm = useRef<HTMLFormElement>(null);
  const id = useId();
  const open = Boolean(anchor);
  const initial = [...name.trim()][0] ?? "?";
  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={`منوی حساب ${name}`}
        sx={{ display: "flex", alignItems: "center", gap: 1, ps: 0.5, pe: { xs: 0.5, sm: 1 }, py: 0.5, borderRadius: 99, border: 1, borderColor: "divider", bgcolor: open ? "action.selected" : "background.paper", minHeight: 40, "&:hover": { bgcolor: "action.hover" }, "&.Mui-focusVisible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 } }}
      >
        <Avatar sx={{ width: 30, height: 30, fontSize: 15, fontWeight: 800, bgcolor: "#eef0ff", color: "#3730a3" }} aria-hidden>{initial}</Avatar>
        <Typography component="span" sx={{ display: { xs: "none", sm: "block" }, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 600 }}>{name}</Typography>
        <KeyboardArrowDownRounded fontSize="small" aria-hidden sx={{ display: { xs: "none", sm: "block" }, color: "text.secondary", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </ButtonBase>
      <Menu id={`${id}-menu`} anchorEl={anchor} open={open} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { mt: 1, minWidth: 230, borderRadius: 3 } } }} transformOrigin={{ horizontal: "left", vertical: "top" }} anchorOrigin={{ horizontal: "left", vertical: "bottom" }}>
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{name}</Typography>
          <Typography variant="body2" color="text.secondary" dir="ltr" sx={{ textAlign: "start", overflowWrap: "anywhere" }}>@{username}</Typography>
        </Box>
        <Divider />
        <MenuItem component={Link} href="/dashboard" onClick={() => setAnchor(null)}>
          <ListItemIcon><StorefrontOutlined fontSize="small" /></ListItemIcon>
          <ListItemText>فروشگاه‌های من</ListItemText>
        </MenuItem>
        <MenuItem component={Link} href="/dashboard/account" onClick={() => setAnchor(null)}>
          <ListItemIcon><ManageAccountsOutlined fontSize="small" /></ListItemIcon>
          <ListItemText>حساب کاربری</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => logoutForm.current?.requestSubmit()} sx={{ color: "error.dark" }}>
          <ListItemIcon sx={{ color: "inherit" }}><LogoutRounded fontSize="small" /></ListItemIcon>
          <ListItemText>خروج از حساب</ListItemText>
        </MenuItem>
      </Menu>
      <form ref={logoutForm} action={logoutAction} hidden />
    </>
  );
}
