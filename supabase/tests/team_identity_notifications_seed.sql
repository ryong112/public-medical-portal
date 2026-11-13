-- Seeds before the new migration, to exercise the real approved-device backfill.
insert into auth.users(id)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 11) as n;
insert into public.device_access(user_id, device_name, status, is_admin) values
('00000000-0000-4000-8000-000000000001', '운영 관리자', 'approved', true),
('00000000-0000-4000-8000-000000000002', '홍길동 사내PC', 'approved', false),
('00000000-0000-4000-8000-000000000003', '홍길동/병원PC', 'approved', false),
('00000000-0000-4000-8000-000000000004', '대기자 사내PC', 'pending', false),
('00000000-0000-4000-8000-000000000005', '차단자 사내PC', 'blocked', false),
('00000000-0000-4000-8000-000000000006', '홍길동 사내PC · 전광판', 'approved', false),
('00000000-0000-4000-8000-000000000007', '관리자 · 전광판', 'approved', false),
('00000000-0000-4000-8000-000000000008', '미래 승인자 병원 PC', 'pending', false),
('00000000-0000-4000-8000-000000000010', '김팀원 사내PC', 'approved', false);
insert into public.kiosk_pair_requests(target_user_id, approved_by, used_at) values
('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000002', now()),
('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', now());
