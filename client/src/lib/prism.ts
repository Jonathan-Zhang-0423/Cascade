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
  await import("prismjs/components/prism-markup");
  await import("prismjs/components/prism-css");
  await import("prismjs/components/prism-clike");
  await import("prismjs/components/prism-javascript");
  await import("prismjs/components/prism-typescript");
  await import("prismjs/components/prism-json");
  await import("prismjs/components/prism-jsx");
  await import("prismjs/components/prism-tsx");

  await import("prismjs/components/prism-python");
  await import("prismjs/components/prism-java");
  await import("prismjs/components/prism-c");
  await import("prismjs/components/prism-cpp");
  await import("prismjs/components/prism-csharp");
  await import("prismjs/components/prism-go");
  await import("prismjs/components/prism-rust");
  await import("prismjs/components/prism-ruby");
  await import("prismjs/components/prism-php");
  await import("prismjs/components/prism-swift");
  await import("prismjs/components/prism-kotlin");
  await import("prismjs/components/prism-r");
  await import("prismjs/components/prism-lua");
  await import("prismjs/components/prism-perl");
  await import("prismjs/components/prism-bash");
  await import("prismjs/components/prism-sql");
  await import("prismjs/components/prism-yaml");
  await import("prismjs/components/prism-dart");
  await import("prismjs/components/prism-scala");
  await import("prismjs/components/prism-elixir");
  await import("prismjs/components/prism-graphql");
  await import("prismjs/components/prism-docker");
  await import("prismjs/components/prism-protobuf");
  await import("prismjs/components/prism-scss");
  await import("prismjs/components/prism-less");
  await import("prismjs/components/prism-ini");
  await import("prismjs/components/prism-toml");
  await import("prismjs/components/prism-markdown");
}

loadPrismLanguages();
