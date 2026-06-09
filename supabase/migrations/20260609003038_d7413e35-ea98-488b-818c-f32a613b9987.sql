-- Restrict authenticated role from reading OAuth tokens via Data API.
-- Edge functions use service_role and remain unaffected.
REVOKE SELECT ON public.stores FROM authenticated;
GRANT SELECT (id, user_id, name, ml_seller_id, ml_nickname, token_expires_at, last_sync_at, created_at, updated_at) ON public.stores TO authenticated;