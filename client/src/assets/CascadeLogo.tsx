import React from "react";

interface CascadeLogoProps {
  className?: string;
  width?: number;
  height?: number;
}

export function CascadeLogo({ className, width = 40, height = 40 }: CascadeLogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 800 800"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="175" y="155" width="56" height="260" fill="currentColor" />
      <rect x="355" y="275" width="56" height="245" fill="currentColor" />
      <rect x="540" y="380" width="65" height="255" fill="currentColor" />
    </svg>
  );
}
