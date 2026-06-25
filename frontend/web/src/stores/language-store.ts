import { create } from "zustand";

export type Lang = "zh" | "en";

const STORAGE_KEY = "cascade-lang";

interface LanguageState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

function applyLangClass(lang: Lang) {
  if (typeof document !== "undefined") {
    if (lang === "zh") {
      document.documentElement.classList.add("lang-zh");
    } else {
      document.documentElement.classList.remove("lang-zh");
    }
  }
}

function getInitialLang(): Lang {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  }
  return "zh";
}

const initialLang = getInitialLang();
applyLangClass(initialLang);

export const useLanguageStore = create<LanguageState>((set) => ({
  lang: initialLang,
  setLang: (lang) => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
    applyLangClass(lang);
    set({ lang });
  },
}));
