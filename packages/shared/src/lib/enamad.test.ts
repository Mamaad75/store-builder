import { describe, expect, it } from "vitest";
import { ENAMAD_ORIGIN, enamadLinks, enamadSchema, parseEnamad } from "./enamad.js";

const SNIPPET = `<a referrerpolicy='origin' target='_blank' href='https://trustseal.enamad.ir/?id=123456&Code=AbCdEfGh12345678'><img referrerpolicy='origin' src='https://trustseal.enamad.ir/logo.aspx?id=123456&Code=AbCdEfGh12345678' alt='' style='cursor:pointer' code='AbCdEfGh12345678'></a>`;

describe("parseEnamad", () => {
  it("reads the id and code from the official snippet, a bare address, or two values", () => {
    const want = { id: "123456", code: "AbCdEfGh12345678" };
    expect(parseEnamad(SNIPPET)).toEqual(want);
    expect(parseEnamad("https://trustseal.enamad.ir/?id=123456&Code=AbCdEfGh12345678")).toEqual(want);
    expect(parseEnamad("trustseal.enamad.ir/?id=123456&amp;Code=AbCdEfGh12345678")).toEqual(want);
    expect(parseEnamad("123456 AbCdEfGh12345678")).toEqual(want);
    expect(parseEnamad("۱۲۳۴۵۶ ، AbCdEfGh12345678".replace("،", ","))).toEqual(want);
  });
  it("takes only the two values: markup, scripts and other hosts in the paste are ignored, never kept", () => {
    const r = parseEnamad(`<script>alert(1)</script>${SNIPPET}<img src=x onerror=alert(2)>`);
    expect(r).toEqual({ id: "123456", code: "AbCdEfGh12345678" });
    expect(JSON.stringify(r)).not.toMatch(/[<>]|script/i);
  });
  it("a link that is not from eNamad is refused, as are broken, empty or oversized values", () => {
    expect(parseEnamad("https://evil.example/?id=123456&Code=AbCdEfGh12345678")).toBeNull();
    for (const bad of ["", "   ", "hello", "12 short", "id=abc&Code=AbCdEfGh12345678 enamad", "enamad id=12345678901&Code=AbCdEfGh12345678", "123456 " + "x".repeat(65)]) expect(parseEnamad(bad), bad).toBeNull();
  });
});

describe("enamadLinks / enamadSchema", () => {
  it("builds both addresses on the eNamad host from the validated pair only", () => {
    const l = enamadLinks({ id: "123456", code: "AbCdEfGh12345678" });
    expect(l.href).toBe(`${ENAMAD_ORIGIN}/?id=123456&Code=AbCdEfGh12345678`);
    expect(l.src).toBe(`${ENAMAD_ORIGIN}/logo.aspx?id=123456&Code=AbCdEfGh12345678`);
    for (const u of [l.href, l.src]) expect(new URL(u).origin).toBe("https://trustseal.enamad.ir");
  });
  it("the schema refuses anything that could break out of a URL or attribute", () => {
    for (const bad of [{ id: "12 3", code: "AbCdEfGh12345678" }, { id: "123", code: "AbCdEfGh\"onerror=x" }, { id: "123", code: "short" }, { id: "1", code: "AbCdEfGh12345678", extra: 1 }]) expect(enamadSchema.safeParse(bad).success).toBe(false);
  });
});
