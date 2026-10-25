import { afterEach, describe, expect, it } from "vitest";
import { cacheTtlSeconds } from "../src/main";

const WEEK = 60 * 60 * 24 * 7;

afterEach(() => {
	delete process.env.COVER_CACHE_TTL_SECONDS;
});

describe("cacheTtlSeconds", () => {
	it("defaults to a week", () => {
		expect(cacheTtlSeconds(undefined)).toBe(WEEK);
	});

	it("honours an override", () => {
		expect(cacheTtlSeconds("3600")).toBe(3600);
	});

	it("falls back for garbage, zero and negatives", () => {
		expect(cacheTtlSeconds("not-a-number")).toBe(WEEK);
		expect(cacheTtlSeconds("0")).toBe(WEEK);
		expect(cacheTtlSeconds("-5")).toBe(WEEK);
	});

	it("reads the environment variable", () => {
		process.env.COVER_CACHE_TTL_SECONDS = "120";
		expect(cacheTtlSeconds()).toBe(120);
	});
});
