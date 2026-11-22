/**
 * The storefront kit's own line icons (24×24, stroke = currentColor). Purely decorative: every icon is aria-hidden and
 * sits next to visible text or inside a control that has its own accessible name.
 */
const PATHS = {
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4.2-4.2",
  phone: "M5 4h3.5l2 5-2.3 1.4a11 11 0 0 0 5.4 5.4L15 13.5l5 2V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  chat: "M4 20l1.4-4.3A8 8 0 1 1 8.6 19L4 20z M9 10.5h.01 M12 10.5h.01 M15 10.5h.01",
  mail: "M3.5 6h17v12h-17z M4 7l8 6 8-6",
  pin: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z M12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z",
  instagram: "M7.5 3.5h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4z M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z M17 7h.01",
  telegram: "M20.5 4.5L3.5 11l5.5 2 2 6 3-3.8 4 3 2.5-13.7z M9 13l7.5-5.5",
  grid: "M4 4h6.5v6.5H4z M13.5 4H20v6.5h-6.5z M4 13.5h6.5V20H4z M13.5 13.5H20V20h-6.5z",
  menu: "M4 7h16 M4 12h16 M4 17h10",
  home: "M4 11l8-7 8 7 M6 9.5V20h4.5v-5h3v5H18V9.5",
  info: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 11v5.5 M12 7.5h.01",
  truck: "M2.5 6.5h11v9h-11z M13.5 9.5h4l3 3.5v2.5h-7 M6.5 19a2 2 0 1 0 0-4a2 2 0 0 0 0 4z M17 19a2 2 0 1 0 0-4a2 2 0 0 0 0 4z",
  shield: "M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6L12 3z M8.8 12l2.2 2.2 4.2-4.4",
  headset: "M4.5 14v-2a7.5 7.5 0 0 1 15 0v2 M4.5 14h3v5.5h-2a1 1 0 0 1-1-1V14z M19.5 14h-3v5.5h2a1 1 0 0 0 1-1V14z",
  returns: "M4.5 12a7.5 7.5 0 0 1 13.2-4.9L20 9.5 M20 4.5v5h-5 M19.5 12a7.5 7.5 0 0 1-13.2 4.9L4 14.5 M4 19.5v-5h5",
  card: "M3 6.5h18v11H3z M3 10.5h18 M7 14.5h4",
  clock: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 7v5l3.2 2",
  gift: "M4.5 10.5h15V20h-15z M3.5 7.5h17v3h-17z M12 7.5V20 M12 7.5C10.5 4 6.5 4.2 7.3 6.8 M12 7.5c1.5-3.5 5.5-3.3 4.7-.7",
  tag: "M3.5 12V3.5H12l8.5 8.5-8.5 8.5-8.5-8.5z M8 8h.01",
  check: "M5 12.5l4.5 4.5L19 7",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z",
  leaf: "M5 19c0-8 5-13 14-14-1 9-6 14-14 14z M5 19l7-7",
  bag: "M5.5 8h13l-1 12.5h-11L5.5 8z M9 8V6.5a3 3 0 0 1 6 0V8",
  sort: "M7 4v16 M4 7l3-3 3 3 M17 20V4 M14 17l3 3 3-3",
  chevron: "M14.5 6l-6 6 6 6",
  close: "M6 6l12 12 M18 6L6 18",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, size = 20 }: { name: IconName; className?: string; size?: number }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Keyword → icon for the owner's "title: text" points (delivery, warranty, support…); a check mark otherwise. */
const KEYWORDS: [RegExp, IconName][] = [
  [/ارسال|تحویل|پست|حمل/, "truck"],
  [/گارانتی|ضمانت|اصالت|اصل|بیمه|تضمین|سالم/, "shield"],
  [/پشتیبانی|مشاوره|راهنما/, "headset"],
  [/مرجوع|بازگشت|تعویض|برگشت/, "returns"],
  [/پرداخت|درگاه|قسط/, "card"],
  [/ساعت|سریع|فوری|همان روز|روزانه/, "clock"],
  [/هدیه|کادو|کارت پیام|بسته‌بندی/, "gift"],
  [/تخفیف|قیمت|ارزان/, "tag"],
  [/تازه|طبیعی|گیاه|گل/, "leaf"],
  [/کیفیت|ممتاز|ویژه|نصب/, "star"],
];

export function highlightIcon(text: string): IconName {
  return KEYWORDS.find(([re]) => re.test(text))?.[1] ?? "check";
}

/** Icon of a contact route (the kinds `buildContactLinks` produces). */
export const CONTACT_ICON: Record<"phone" | "email" | "address" | "instagram" | "telegram" | "whatsapp", IconName> = {
  phone: "phone",
  email: "mail",
  address: "pin",
  instagram: "instagram",
  telegram: "telegram",
  whatsapp: "chat",
};
