REVOKE EXECUTE ON FUNCTION public.user_entitlement(uuid) FROM authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_entitlement(uuid) TO service_role;

-- Insert Test Drive plan (one-time $1)
INSERT INTO public.billing_plans (tier, interval, amount_cents, upload_limit, ai_cost_cap_cents)
VALUES ('test_drive', 'one_time', 100, 1, 200)
ON CONFLICT (tier, interval) DO NOTHING;