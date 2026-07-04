import { useCallback, useRef } from "react";

/**
 * Admin API fetch hook — wraps fetch with:
 * - credentials: "include" (cookie auto-send)
 * - 401 auto-refresh via /api/admin/auth/refresh
 * - If refresh also fails, redirect to /admin/login
 */
export function useAdminAuth() {
  const isRefreshing = useRef(false);

  const adminFetch = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const res = await fetch(url, {
      ...options,
      credentials: "include",
    });

    // If 401, try to refresh the access token
    if (res.status === 401 && !isRefreshing.current) {
      isRefreshing.current = true;
      try {
        const refreshRes = await fetch("/api/admin/auth/refresh", {
          method: "POST",
          credentials: "include",
        });

        if (refreshRes.ok) {
          // Retry the original request with the new access token
          isRefreshing.current = false;
          return fetch(url, {
            ...options,
            credentials: "include",
          });
        } else {
          // Refresh failed — session expired
          isRefreshing.current = false;
          window.location.href = "/admin/login";
          return res;
        }
      } catch {
        isRefreshing.current = false;
        window.location.href = "/admin/login";
        return res;
      }
    }

    return res;
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/admin/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    window.location.href = "/admin/login";
  }, []);

  return { adminFetch, logout };
}
