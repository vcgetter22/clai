/**
 * The hosted clai service (`clai-cloud`, a separate private repo running `@claii/server`'s API
 * behind Supabase Auth). `clai login` targets this URL by default; `--server` or `CLAI_SYNC_SERVER`
 * point it at a self-hosted `clai-server` instead. Decided 2026-09-12 (docs/decisions.md).
 */
export const HOSTED_URL = 'https://clai.cobank.ai';
