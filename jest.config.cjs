const path = require("path");

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // IMPORTANT: Use path.resolve() instead of <rootDir> for mock paths
    // This ensures tests work regardless of:
    // - Package name changes (filesystem-of-a-down → vulcan-file-ops)
    // - Directory name changes (users can clone repo anywhere with any name)
    // - Where users install the project
    // Using __dirname makes paths relative to THIS config file location
    "^pdf-parse$": path.resolve(__dirname, "src/tests/__mocks__/pdf-parse.ts"),
    "^pdfmake/build/pdfmake\\.js$": path.resolve(
      __dirname,
      "src/tests/__mocks__/pdfmake/build/pdfmake.js.ts"
    ),
    "^pdfmake/build/vfs_fonts\\.js$": path.resolve(
      __dirname,
      "src/tests/__mocks__/pdfmake/build/vfs_fonts.js.ts"
    ),
    "^html-to-pdfmake$": path.resolve(
      __dirname,
      "src/tests/__mocks__/html-to-pdfmake.ts"
    ),
    "^jsdom$": path.resolve(__dirname, "src/tests/__mocks__/jsdom.ts"),
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        diagnostics: {
          ignoreCodes: [151002],
          warnOnly: true,
        },
      },
    ],
  },
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/src/tests/__mocks__/",
    "\\.d\\.ts$",
  ],
  testMatch: ["**/tests/**/*.test.ts", "**/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  collectCoverageFrom: ["src/**/*.ts", "!src/tests/**", "!src/__tests__/**"],
};
