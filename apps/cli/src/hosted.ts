/**
 * The hosted clai service (`clai-cloud`, a separate private repo running `@claii/server`'s API
 * behind Supabase Auth) on its vercel.app domain. `clai login` targets this URL by default;
 * `--server` or `CLAI_SYNC_SERVER` point it at a self-hosted `clai-server` instead.
 * Domain decided 2026-10-19 (docs/decisions.md).
 */
export const HOSTED_URL = 'https://clai-cloud.vercel.app';
