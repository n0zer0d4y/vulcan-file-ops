/**
 * Mock for jsdom module
 *
 * This mock provides a minimal JSDOM implementation for tests without loading
 * the full jsdom library which may have ESM dependencies.
 */

export class JSDOM {
  window: {
    document: {
      createElement: (tagName: string) => any;
      createTextNode: (text: string) => any;
    };
  };

  constructor(html?: string, options?: any) {
    // Create a minimal window object with document
    this.window = {
      document: {
        createElement: (tagName: string) => {
          return {
            tagName: tagName.toUpperCase(),
            children: [],
            attributes: {},
            appendChild: (child: any) => {},
            setAttribute: (name: string, value: string) => {},
            textContent: "",
          };
        },
        createTextNode: (text: string) => {
          return {
            nodeType: 3, // TEXT_NODE
            textContent: text,
          };
        },
      },
    };
  }

  static fromURL(url: string, options?: any): Promise<JSDOM> {
    return Promise.resolve(new JSDOM("", options));
  }

  static fromFile(path: string, options?: any): Promise<JSDOM> {
    return Promise.resolve(new JSDOM("", options));
  }
}

// Export default
export default { JSDOM };
