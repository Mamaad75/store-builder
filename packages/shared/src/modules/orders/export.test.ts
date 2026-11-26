import { describe, expect, it } from "vitest";
import { csvCell, csvRow, jalaliDate, localPhone, ORDER_CSV_HEADERS, ordersToCsv, tehranDateTime, CSV_BOM, type ExportOrder } from "./export.js";

describe("csvCell", () => {
  it("plain text and numbers are written as they are; empty and null are empty", () => {
    expect([csvCell("سلام"), csvCell(1200), csvCell(0), csvCell(null), csvCell(undefined), csvCell("")]).toEqual(["سلام", "1200", "0", "", "", ""]);
  });
  it("quotes a cell with a comma, a quote or a line break, doubling the quotes", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("cr\rx")).toBe('"cr\rx"');
  });
  it("neutralises a text that would start a spreadsheet formula (CSV injection)", () => {
    for (const evil of ["=1+1", "+98912", "-2+3", "@SUM(A1)", "\tcmd", "=HYPERLINK(\"http://evil\",\"x\")"]) {
      const out = csvCell(evil);
      expect(out.replace(/^"/, "").startsWith("'"), evil).toBe(true);
    }
    expect(csvCell("=A1,B1")).toBe('"\'=A1,B1"'); // neutralised AND quoted
  });
  it("a negative NUMBER is data, not a formula", () => expect(csvCell(-5)).toBe("-5"));
  it("a row joins the cells with commas", () => expect(csvRow(["a", 1, null, "b,c"])).toBe('a,1,,"b,c"'));
});

describe("dates and phone", () => {
  it("Tehran local time and the Solar Hijri date of the Tehran day", () => {
    expect(tehranDateTime("2026-11-26T10:00:00.000Z")).toBe("2026-11-26 13:30");
    expect(tehranDateTime("2026-11-25T21:00:00.000Z")).toBe("2026-11-26 00:30"); // already the next Tehran day
    expect(jalaliDate("2026-11-26T10:00:00.000Z")).toBe("1405/09/05");
    expect(jalaliDate("2026-03-21T10:00:00.000Z")).toBe("1405/01/01"); // Nowruz
  });
  it("+98 numbers are written as 09…; anything else is untouched", () => {
    expect(localPhone("+989121234567")).toBe("09121234567");
    expect(localPhone("0912")).toBe("0912");
  });
});

const order = (o: Partial<ExportOrder> = {}): ExportOrder => ({
  number: 128, status: "SHIPPED", createdAt: "2026-11-26T10:00:00.000Z",
  address: { recipientName: "مریم احمدی", phone: "+989121234567", province: "tehran", city: "تهران", line: "خیابان ولیعصر، پلاک ۸", postalCode: "1384567891" },
  shipping: { name: "پیک", cost: 30_000 }, paymentMethod: "COD", discountCode: null, discountAmount: 0, subtotal: 120_000, total: 150_000,
  trackingCode: "RR123456789IR", note: "", items: [{ name: "چای سبز", variantLabel: "", quantity: 2 }, { name: "پیراهن", variantLabel: "قرمز / M", quantity: 1 }],
  ...o,
});

describe("ordersToCsv", () => {
  it("starts with a BOM, has the header and one CRLF-terminated row per order with every column", () => {
    const csv = ordersToCsv([order(), order({ number: 129 })]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(4); // header, 2 rows, trailing empty
    expect(lines[3]).toBe("");
    expect(lines[0]).toBe(ORDER_CSV_HEADERS.join(","));
    expect(lines[1]).toBe('128,2026-11-26 13:30,1405/09/05,ارسال‌شده,مریم احمدی,09121234567,تهران,تهران,خیابان ولیعصر، پلاک ۸,1384567891,پیک,30000,پرداخت در محل,,0,120000,150000,RR123456789IR,,چای سبز × 2 ؛ پیراهن (قرمز / M) × 1');
    expect(lines[1]!.split(",").length).toBeGreaterThanOrEqual(ORDER_CSV_HEADERS.length);
  });
  it("a hostile buyer cannot inject a formula through name, address, note or discount code", () => {
    const row = ordersToCsv([order({ address: { recipientName: "=cmd|' /C calc'!A0", phone: "+989121234567", province: "tehran", city: "@x", line: "+SUM(1)", postalCode: "1384567891" }, note: "-1+1", discountCode: "=EVIL" })]).split("\r\n")[1]!;
    for (const raw of ["=cmd", "@x", "+SUM", "-1+1", "=EVIL"]) {
      expect(row.includes(`'${raw}`) || row.includes(`"'${raw}`), raw).toBe(true);
    }
  });
  it("an empty list is just the header", () => expect(ordersToCsv([]).slice(1)).toBe(ORDER_CSV_HEADERS.join(",") + "\r\n"));
});
