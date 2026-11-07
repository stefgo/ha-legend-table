import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import { defineConfig } from "rollup";
import { createRequire } from "node:module";
import { nextBuild } from "./scripts/build-number.mjs";

const pkg = createRequire(import.meta.url)("./package.json");

// Only `builddeploy.sh` asks for a build counter (LEGENDTABLE_BUILD_COUNTER);
// every other build, the GitHub release included, reports the bare semver.
// Bumped once per rollup run — a `watch` session keeps the number it started
// with, exactly like the build it stands in for.
const { build, builtAt, full } = nextBuild(pkg.version);
console.log(`legend-table ${full} (${builtAt})`);

// Only the GitHub release workflow sets LEGENDTABLE_MINIFY; local builds and
// `watch` keep the readable bundle.
const minify = process.env.LEGENDTABLE_MINIFY === "1";

export default defineConfig({
  input: "src/index.ts",
  output: {
    file: "dist/legend-table.js",
    format: "es",
    sourcemap: true,
  },
  plugins: [
    replace({
      "process.env.NODE_ENV": JSON.stringify("production"),
      __CARD_VERSION__: JSON.stringify(full),
      __CARD_SEMVER__: JSON.stringify(pkg.version),
      __CARD_BUILD__: JSON.stringify(build),
      __CARD_BUILD_TIME__: JSON.stringify(builtAt),
      preventAssignment: true,
    }),
    resolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs(),
    json(),
    typescript({
      tsconfig: "./tsconfig.json",
      declaration: false,
    }),
    minify &&
      terser({
        format: {
          comments: false,
          preamble: `/*! legend-table ${full} | MIT */`,
        },
      }),
  ].filter(Boolean),
  context: "window",
  onwarn: (warning) => {
    if (warning.code === "THIS_IS_UNDEFINED") return;
    console.warn(warning.message);
  },
});
