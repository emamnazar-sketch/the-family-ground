-- ============================================================
-- ONE-OFF CLEANUP (2026-10-05): remove test data left behind by the
-- automated kid-flow browser test. The test browser cannot click native
-- confirm() dialogs, so deletions were done here instead.
-- Test artifacts: kid label 'TestKid' (2 duplicate cards),
-- chores 'Test chore bed' (x3) and 'Test chore dishes' (x1).
-- ============================================================

delete from public.chores
where title in ('Test chore bed', 'Test chore dishes');

delete from public.kid_profiles
where kid_label = 'TestKid';

delete from public.invite_codes
where kid_label = 'TestKid';
