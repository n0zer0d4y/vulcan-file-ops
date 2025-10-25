/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Mock problematic ESM modules that use import.meta and other ESM-only features
    "^pdf-parse$": "<rootDir>/src/tests/__mocks__/pdf-parse.ts",
    "^pdfmake/build/pdfmake\\.js$":
      "<rootDir>/src/tests/__mocks__/pdfmake/build/pdfmake.js.ts",
    "^pdfmake/build/vfs_fonts\\.js$":
      "<rootDir>/src/tests/__mocks__/pdfmake/build/vfs_fonts.js.ts",
    "^html-to-pdfmake$": "<rootDir>/src/tests/__mocks__/html-to-pdfmake.ts",
    "^jsdom$": "<rootDir>/src/tests/__mocks__/jsdom.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        diagnostics: {
          ignoreCodes: [151002],
        },
      },
    ],
  },
  testMatch: ["**/tests/**/*.test.ts", "**/__tests__/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/tests/**", "!src/__tests__/**"],
};
