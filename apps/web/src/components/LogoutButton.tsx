"use client";

import Button from "@mui/material/Button";
import { logoutAction } from "@/app/actions-auth";

export default function LogoutButton() {
  return (
    <form action={logoutAction}>
      <Button type="submit" size="small">
        خروج
      </Button>
    </form>
  );
}
