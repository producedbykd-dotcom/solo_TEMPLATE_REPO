DO $$
DECLARE
  r record;
  grant_amount bigint;
  tier_text text;
  kind_text text;
BEGIN
  FOR r IN
    SELECT s.user_id, s.id AS sub_id, s.tier::text AS tier, s.kind::text AS kind
    FROM public.subscriptions s
    LEFT JOIN public.user_credits uc ON uc.user_id = s.user_id
    WHERE s.status = 'active' AND uc.user_id IS NULL
  LOOP
    tier_text := r.tier;
    kind_text := r.kind;
    grant_amount := CASE
      WHEN kind_text = 'test_drive' THEN 1400
      WHEN tier_text = 'starter' THEN 19200
      WHEN tier_text = 'pro' THEN 68600
      WHEN tier_text = 'label' THEN 190400
      ELSE 0
    END;
    IF grant_amount > 0 THEN
      PERFORM public.grant_credits(
        r.user_id, grant_amount,
        'backfill_plan_grant:' || COALESCE(tier_text, kind_text),
        grant_amount, r.sub_id, NULL,
        jsonb_build_object('backfill', true, 'tier', tier_text, 'kind', kind_text)
      );
    END IF;
  END LOOP;
END $$;