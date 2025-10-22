/**
 * Type definitions for html-to-pdfmake
 * Since html-to-pdfmake doesn't have official TypeScript types,
 * we declare them here.
 */

declare module "html-to-pdfmake" {
  interface HtmlToPdfmakeOptions {
    window?: Window;
    defaultStyles?: Record<string, any>;
    tableAutoSize?: boolean;
    imagesByReference?: boolean;
    removeExtraBlanks?: boolean;
    removeTagClasses?: boolean;
    ignoreStyles?: string[];
    fontSizes?: number[];
    customTag?: (params: any) => any;
    replaceText?: (text: string, nodes: any[]) => string;
  }

  function htmlToPdfmake(html: string, options?: HtmlToPdfmakeOptions): any;

  export = htmlToPdfmake;
}

