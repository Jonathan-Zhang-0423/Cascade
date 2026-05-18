import { create } from "zustand";

export type Lang = "zh" | "en";

const STORAGE_KEY = "cascade-lang";

interface LanguageState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

function getInitialLang(): Lang {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  }
  return "zh";
}

export const useLanguageStore = create<LanguageState>((set) => ({
  lang: getInitialLang(),
  setLang: (lang) => {
    localStorage.setItem(STORAGE_KEY, lang);
    set({ lang });
  },
}));
