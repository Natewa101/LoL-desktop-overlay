/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DDRAGON_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
