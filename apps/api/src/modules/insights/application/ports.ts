import type { DayRow } from "@store-builder/shared/modules/platform/insights";

export interface NowFigures {
  users: number;
  stores: number;
  publishedStores: number;
  suspendedStores: number;
  openTickets: number;
  answeredTickets: number;
  activeSubscriptions: number;
  expiringSoon: number;
  /** All gift credit the platform owes in the stores' wallets. */
  walletOutstandingToman: number;
}
export interface AccountRow {
  id: string;
  username: string;
  name: string;
  createdAt: Date;
  stores: number;
  isPlatformAdmin: boolean;
}
export interface AccountDetail extends AccountRow {
  recoveredAt: Date | null;
  ownedStores: { id: string; name: string; status: string; suspended: boolean; createdAt: Date }[];
  memberships: number;
}
export interface StoreDetail {
  id: string;
  name: string;
  status: string;
  suspended: boolean;
  createdAt: Date;
  publishedAt: Date | null;
  owner: { id: string; username: string; name: string };
  subdomain: string | null;
  theme: { key: string; version: number };
  counts: { productsActive: number; productsOther: number; orders: number; ordersLast30Days: number; customers: number; members: number; pendingReviews: number; publishedPosts: number; openTickets: number };
  subscription: { planName: string; endsAt: Date } | null;
  walletBalanceToman: number;
  referredByPending: boolean;
}
export interface ActivityRow {
  id: string;
  action: string;
  actor: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface InsightsRepository {
  /** Per Tehran day (key `YYYY-MM-DD`) between the instants [from, to): new stores, new users, tickets opened, cash received and purchases recorded. */
  dailyRows(from: Date, to: Date): Promise<Map<string, Partial<DayRow>>>;
  figures(now: Date, expiringBefore: Date): Promise<NowFigures>;
  accounts(f: { q?: string; before?: Date; limit: number }): Promise<AccountRow[]>;
  account(id: string): Promise<AccountDetail | null>;
  store(id: string, now: Date): Promise<StoreDetail | null>;
  /** Platform audit entries (`platform.*`), newest first; `actions` limits them to a group's actions. */
  activity(f: { actions?: string[]; before?: Date; limit: number }): Promise<ActivityRow[]>;
}
