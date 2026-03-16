import Prism from "prismjs";

declare global {
  interface Window {
    Prism: typeof Prism;
  }
}

if (typeof window !== "undefined") {
  window.Prism = Prism;
}

export { Prism as prism };

export async function loadPrismLanguages() {
  await import("prismjs/components/prism-javascript");
  await import("prismjs/components/prism-typescript");
  await import("prismjs/components/prism-css");
  await import("prismjs/components/prism-markup");
  await import("prismjs/components/prism-json");
  await import("prismjs/components/prism-jsx");
  await import("prismjs/components/prism-tsx");
}

loadPrismLanguages();
