import { useState, useEffect } from "react";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setIsMobile(window.innerWidth <= 768);
    });
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  return isMobile;
}
