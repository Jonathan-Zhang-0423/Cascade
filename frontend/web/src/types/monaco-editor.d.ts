declare module "monaco-editor" {
  export namespace editor {
    export interface ITokenThemeRule {
      token: string;
      foreground?: string;
      background?: string;
      fontStyle?: string;
    }

    export interface IStandaloneThemeData {
      base: "vs" | "vs-dark" | "hc-black" | "hc-light";
      inherit: boolean;
      rules: ITokenThemeRule[];
      colors: Record<string, string>;
      encodedTokensColors?: string[];
    }
  }
}
