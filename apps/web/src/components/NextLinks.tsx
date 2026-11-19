"use client";

import Link from "next/link";
import Button, { type ButtonProps } from "@mui/material/Button";
import CardActionArea, { type CardActionAreaProps } from "@mui/material/CardActionArea";
import MuiLink, { type LinkProps } from "@mui/material/Link";

// MUI components are Client Components, so `component={Link}` must be set from a client module
// (a Server Component cannot pass a function prop to them).
export function LinkButton(props: Omit<ButtonProps<typeof Link>, "component">) {
  return <Button component={Link} {...props} />;
}

export function LinkCardActionArea(props: Omit<CardActionAreaProps<typeof Link>, "component"> & { href: string }) {
  return <CardActionArea component={Link} {...props} />;
}

export function TextLink(props: Omit<LinkProps<typeof Link>, "component">) {
  return <MuiLink component={Link} {...props} />;
}
