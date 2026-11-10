-- Synoptic migration 6: public.rls_auto_enable() ships with the Supabase
-- project and is SECURITY DEFINER. It should not be callable through the
-- REST API by anon or signed-in users (advisor lints 0028 / 0029).
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
