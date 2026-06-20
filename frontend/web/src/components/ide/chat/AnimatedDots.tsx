/**
 * AnimatedDots — "." → ".." → "..." 循环，纯水平，无上下位移
 */
import { useEffect, useState } from "react";

export function AnimatedDots({ color }: { color?: string }) {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const id = setInterval(() => setCount((c) => (c % 3) + 1), 300);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        minWidth: "2em",
        color: color ?? "currentColor",
        letterSpacing: "0.05em",
        fontSize: "1.3em",
        lineHeight: 1,
        verticalAlign: "middle",
      }}
    >
      {".".repeat(count)}
    </span>
  );
}
