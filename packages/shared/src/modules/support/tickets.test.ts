import { describe, expect, it } from "vitest";
import { afterSellerMessage, afterStaffMessage, createTicketSchema, ticketReplySchema, ticketStatusSchema } from "./tickets.js";

describe("ticket input", () => {
  it("trims, strips control and bidi-override characters, and keeps Persian text", () => {
    const r = createTicketSchema.parse({ subject: "  مشکل در پرداخت‮ ", body: "سلام\u0000 وقت بخیر\n\nمشکل دارم" });
    expect(r.subject).toBe("مشکل در پرداخت");
    expect(r.body).toBe("سلام وقت بخیر\n\nمشکل دارم");
  });
  it("refuses too short and too long text with a Persian sentence, and unknown fields", () => {
    expect(createTicketSchema.safeParse({ subject: "ab", body: "متن کافی است" }).error?.issues[0]?.message).toContain("موضوع");
    expect(createTicketSchema.safeParse({ subject: "موضوع", body: "کم" }).success).toBe(false);
    expect(ticketReplySchema.safeParse({ body: "x".repeat(4001) }).success).toBe(false);
    expect(ticketReplySchema.safeParse({ body: "متن کافی", extra: 1 }).success).toBe(false);
    expect(ticketStatusSchema.safeParse({ status: "DELETED" }).success).toBe(false);
  });
});

describe("status after a message", () => {
  it("a merchant message always waits for the platform, even on a closed ticket", () => {
    expect(afterSellerMessage()).toBe("OPEN");
    expect(afterSellerMessage()).toBe("OPEN");
    expect(afterSellerMessage()).toBe("OPEN");
  });
  it("staff answer open tickets; a closed one must be reopened first", () => {
    expect(afterStaffMessage("OPEN")).toBe("ANSWERED");
    expect(afterStaffMessage("ANSWERED")).toBe("ANSWERED");
    expect(afterStaffMessage("CLOSED")).toBeNull();
  });
});
