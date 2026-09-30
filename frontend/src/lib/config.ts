/**
 * Where the KaryaLink API lives.
 * - Local dev: leave VITE_API_URL unset - Vite proxies /api to http://127.0.0.1:8000.
 * - Production (Vercel): set VITE_API_URL to the Render service URL (no trailing slash).
 */
const raw = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

export const API_BASE = raw;

/** Turn an API path such as "/api/meta" into a full URL for fetch, <img src> and <a href>. */
export const apiUrl = (path: string): string => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
