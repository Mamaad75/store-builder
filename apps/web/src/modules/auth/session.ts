import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSafeUser, type SafeUser } from "./service";

/** Current user from the validated session (jwt callback already checked authVersion), or null. */
export async function getCurrentUser(): Promise<SafeUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return getSafeUser(id);
}

/** Server-side guard for pages, layouts and server actions. */
export async function requireUser(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
