import { defineConfig } from "tsup";

export default defineConfig([
  // CLI entry points with shebang
  {
    entry: {
      cli: "src/cli.ts",
      "git-credential": "src/git-credential.ts",
    },
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    banner: {
      js: "#!/usr/bin/env node\n",
    },
  },
  // Library entry point without shebang
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
  },
]);
