import { describe, expect, it } from "vitest";
import { decodeQueryValue } from "../src/main";

describe("decodeQueryValue", () => {
	it("decodes percent-escapes from the raw query string", () => {
		expect(decodeQueryValue("American%20Idiot")).toBe("American Idiot");
		expect(decodeQueryValue("%C3%9Cber")).toBe("Über");
	});

	it("turns form-encoded plus signs into spaces", () => {
		expect(decodeQueryValue("Green+Day")).toBe("Green Day");
	});

	it("keeps an encoded plus a plus", () => {
		expect(decodeQueryValue("Ed%20Sheeran%2B")).toBe("Ed Sheeran+");
	});

	it("leaves already-decoded values alone", () => {
		expect(decodeQueryValue("American Idiot")).toBe("American Idiot");
	});

	it("does not throw on a stray percent sign", () => {
		expect(decodeQueryValue("100% Hits")).toBe("100% Hits");
	});
});
