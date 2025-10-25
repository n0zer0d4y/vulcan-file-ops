/**
 * Mock for pdfmake/build/vfs_fonts.js module
 *
 * This mock provides font definitions for pdfmake without loading the actual font files.
 */

export default {
  pdfMake: {
    vfs: {
      "Roboto-Regular.ttf": "mock-font-data",
      "Roboto-Italic.ttf": "mock-font-data",
      "Roboto-Bold.ttf": "mock-font-data",
      "Roboto-BoldItalic.ttf": "mock-font-data",
    },
  },
};
