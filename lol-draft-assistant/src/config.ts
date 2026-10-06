// Build-time configuration sourced from the repository-root .env file
// (see vite.config.ts `envDir`). Only VITE_-prefixed keys are exposed.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');

export const DDRAGON_VERSION = import.meta.env.VITE_DDRAGON_VERSION || '15.1.1';
