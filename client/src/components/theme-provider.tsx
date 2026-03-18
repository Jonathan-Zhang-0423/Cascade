import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { type ThemeId, getThemeConfig, isValidThemeId, THEME_LIST, THEMES } from "@/lib/themes";

type Mode = "light" | "dark";

interface ThemeContextType {
  themeId: ThemeId;
  mode: Mode;
  setThemeId: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  themeId: "vs-dark",
  mode: "dark",
  setThemeId: () => {},
});

const STORAGE_KEY = "codestart-theme-id";

const ALL_CSS_VAR_KEYS: Set<string> = new Set(
  Object.values(THEMES).flatMap((t) => Object.keys(t.cssVars ?? {}))
);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && isValidThemeId(stored)) return stored;
    }
    return "vs-dark";
  });

  const config = getThemeConfig(themeId);

  useEffect(() => {
    const root = document.documentElement;

    if (config.mode === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    ALL_CSS_VAR_KEYS.forEach((key) => root.style.removeProperty(key));

    if (config.cssVars) {
      Object.entries(config.cssVars).forEach(([key, value]) => {
        root.style.setProperty(key, value);
      });
    }

    localStorage.setItem(STORAGE_KEY, themeId);
  }, [themeId, config.mode]);

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
  }, []);

  return (
    <ThemeContext.Provider value={{ themeId, mode: config.mode, setThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export { THEME_LIST };
export type { ThemeId };
