import { describe, expect, it } from "vitest";
import { MAX_OPEN_TICKETS, MAX_TICKET_MESSAGES } from "@store-builder/shared/modules/support/tickets";
import { canOpenAnother, decideSellerMessage, decideStaffMessage } from "./ticket.js";

describe("ticket rules", () => {
  it("limits the tickets a store has open", () => {
    expect(canOpenAnother(MAX_OPEN_TICKETS - 1)).toBe(true);
    expect(canOpenAnother(MAX_OPEN_TICKETS)).toBe(false);
  });
  it("a merchant message reopens and waits for staff; the message cap is final", () => {
    expect(decideSellerMessage(3)).toEqual({ ok: true, status: "OPEN" });
    expect(decideSellerMessage(MAX_TICKET_MESSAGES - 1)).toEqual({ ok: true, status: "OPEN" });
    expect(decideSellerMessage(MAX_TICKET_MESSAGES)).toMatchObject({ ok: false, field: "body" });
  });
  it("staff answer open tickets, never a closed one, and also stop at the cap", () => {
    expect(decideStaffMessage("OPEN", 1)).toEqual({ ok: true, status: "ANSWERED" });
    expect(decideStaffMessage("CLOSED", 1)).toMatchObject({ ok: false });
    expect(decideStaffMessage("ANSWERED", MAX_TICKET_MESSAGES)).toMatchObject({ ok: false });
  });
});
