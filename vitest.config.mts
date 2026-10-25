import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// .direnv holds the flake sources, which ship their own *.spec.ts files.
		include: ["test/**/*.spec.ts"],
	},
});
