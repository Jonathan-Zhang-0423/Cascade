import { useLocation } from "wouter";
import { useEffect } from "react";

// Placeholder — profile settings are handled inside dashboard.tsx
export default function ProfileSettingsPage() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/app"); }, []);
  return null;
}
