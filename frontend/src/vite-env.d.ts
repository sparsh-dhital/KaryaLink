/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the KaryaLink API, e.g. https://karyalink-api.onrender.com. Empty = same origin (local dev proxy). */
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
