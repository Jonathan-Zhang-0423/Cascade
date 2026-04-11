/**
 * CodestartLoader — branded loading animation matching the CodeStart logo.
 *
 * Three vertical bars of ascending height (left=short, right=tall) that:
 *   1. Drop in from above, left-to-right staggered (80ms apart)
 *   2. Hold together for ~1 second
 *   3. Drop out below, left-to-right staggered
 *   4. Brief gap, then repeat
 *
 * Color is `currentColor` — inherits from the parent's text color,
 * so it is white on dark backgrounds and dark on light backgrounds
 * without any extra configuration.
 *
 * Usage:
 *   <CodestartLoader className="text-muted-foreground" />
 *   <CodestartLoader className="text-blue-400/80" />
 */
export function CodestartLoader({ className }: { className?: string }) {
  return (
    <>
      <style>{`
        @keyframes cs-drop {
          /* start hidden above */
          0%   { transform: translateY(-220%); opacity: 0; }
          /* drop in */
          8%   { transform: translateY(0);     opacity: 1; }
          /* hold */
          52%  { transform: translateY(0);     opacity: 1; }
          /* drop out below */
          62%  { transform: translateY(220%);  opacity: 0; }
          /* gap before repeat */
          100% { transform: translateY(220%);  opacity: 0; }
        }
        .cs-bar     { animation: cs-drop 2.2s ease-in infinite; }
        .cs-bar-l   { animation-delay: 0s;    }
        .cs-bar-m   { animation-delay: 0.08s; }
        .cs-bar-r   { animation-delay: 0.16s; }
      `}</style>
      <div
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "flex-end",
          gap: "3px",
          height: "14px",
          overflow: "hidden",
          verticalAlign: "middle",
          flexShrink: 0,
        }}
        aria-label="Loading"
        role="status"
      >
        {/* left bar — shortest, drops in first */}
        <div
          className="cs-bar cs-bar-l"
          style={{ width: "3px", height: "7px", background: "currentColor", borderRadius: "1px" }}
        />
        {/* middle bar */}
        <div
          className="cs-bar cs-bar-m"
          style={{ width: "3px", height: "10px", background: "currentColor", borderRadius: "1px" }}
        />
        {/* right bar — tallest, drops in last */}
        <div
          className="cs-bar cs-bar-r"
          style={{ width: "3px", height: "14px", background: "currentColor", borderRadius: "1px" }}
        />
      </div>
    </>
  );
}
