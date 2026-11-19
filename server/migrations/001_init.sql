-- P2P Trust: core schema. Money is integer paisa (BDT x 100). All timestamps timestamptz.
-- Rules that must hold even if app code is wrong live here as triggers and functions.

create extension if not exists pgcrypto;

create type kyc_level as enum ('none','basic','verified','business');
create type kyc_status as enum ('pending','ai_checked','approved','rejected','resubmit');
create type admin_role as enum ('super_admin','kyc_reviewer','dispute_agent','support','finance');
create type listing_status as enum ('draft','pending_review','active','paused','sold','removed');
create type deal_type as enum ('sale','service','rental','trade');
create type handover_method as enum ('meetup','courier','pickup_point','digital');
create type deal_status as enum (
  'proposed','accepted','payment_pending','funded','handover_pending','shipped',
  'buyer_confirmed','release_queued','released','paid_out','completed',
  'cancelled','disputed','refund_queued','refunded','split_queued','split_done'
);
create type action_type as enum (
  'approve_kyc','reject_kyc','release_escrow','refund_escrow','split_escrow',
  'approve_payout','ban_user','unban_user','remove_listing','police_handover','blacklist_add'
);
create type action_status as enum ('pending','approved','rejected','executed','failed');
create type ledger_account as enum (
  'buyer_external','escrow_hold','seller_payable','seller_external',
  'platform_fees','guarantee_fund','refund_payable'
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  phone text unique,
  avatar_file uuid,
  bio text,
  area text,
  kyc_level kyc_level not null default 'none',
  trust_score int not null default 50 check (trust_score between 0 and 100),
  deals_completed int not null default 0,
  is_banned boolean not null default false,
  locale text not null default 'bn',
  referral_code text unique,
  referred_by uuid references profiles(id),
  shop_name text,
  deleted_at timestamptz,
  delete_requested_at timestamptz,
  created_at timestamptz not null default now()
);

create table admin_users (
  user_id uuid primary key references profiles(id),
  role admin_role not null,
  active boolean not null default true,
  totp_secret text,
  totp_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  device_fingerprint text not null,
  first_seen timestamptz not null default now(),
  unique (device_fingerprint)
);

-- private file storage (buckets): kyc-private, deal-proofs, listing-photos, chat-media, avatars, evidence
create table files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in ('kyc-private','deal-proofs','listing-photos','chat-media','avatars','evidence','documents')),
  owner_id uuid references profiles(id),
  mime text not null,
  bytes int not null,
  data bytea not null,
  source text not null default 'unknown',   -- camera | gallery | web | generated
  created_at timestamptz not null default now()
);

create table kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  level kyc_level not null,
  nid_number_hash text not null,
  nid_number_last4 text not null,
  full_name_en text, full_name_bn text, date_of_birth date,
  nid_front_path text not null, nid_back_path text not null,
  selfie_path text not null,
  selfie_turn_path text,
  liveness_passed boolean not null,
  face_match_score numeric(4,3),
  ocr_json jsonb,
  trade_licence_no text,
  status kyc_status not null default 'pending',
  created_at timestamptz not null default now()
);
create unique index one_approved_nid on kyc_submissions(nid_number_hash) where status = 'approved' and level = 'verified';

create table payout_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  method text not null check (method in ('bkash','nagad','bank')),
  account_number text not null,
  account_name text not null,
  name_matches_kyc boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles(id),
  title text not null, description text not null,
  category text not null, price_paisa bigint not null check (price_paisa > 0),
  deal_type deal_type not null default 'sale',
  condition text, location_area text,
  status listing_status not null default 'pending_review',
  return_days int default 0,
  created_at timestamptz not null default now()
);
create index listings_status_idx on listings(status, created_at desc);

create table listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  path text not null, position int not null default 0
);

create table saved_listings (
  user_id uuid references profiles(id), listing_id uuid references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create table chats (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id),
  created_at timestamptz not null default now()
);

create table chat_members (
  chat_id uuid references chats(id), user_id uuid references profiles(id),
  last_read_at timestamptz,
  primary key (chat_id, user_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id),
  sender_id uuid references profiles(id),
  kind text not null default 'text' check (kind in ('text','image','voice','deal_card','system')),
  body text, media_path text, deal_id uuid,
  ai_flag text,
  created_at timestamptz not null default now()
);
create index messages_chat_idx on messages(chat_id, created_at);

create table deals (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id),
  chat_id uuid references chats(id),
  buyer_id uuid not null references profiles(id),
  seller_id uuid not null references profiles(id),
  proposed_by uuid not null references profiles(id),
  deal_type deal_type not null,
  title text not null, terms text not null,
  amount_paisa bigint not null check (amount_paisa > 0),
  fee_paisa bigint not null, guarantee_paisa bigint not null,
  fee_percent numeric(5,2) not null, guarantee_percent numeric(5,2) not null,
  handover handover_method not null,
  return_days int not null default 0,
  status deal_status not null default 'proposed',
  release_code_hash text,
  release_code_salt text,
  release_code_attempts int not null default 0,
  release_code_locked boolean not null default false,
  courier text, tracking_number text, tracking_status text,
  funded_at timestamptz, delivered_at timestamptz,
  auto_release_at timestamptz,
  risk_score int,
  replaces_deal_id uuid references deals(id),
  created_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);

create table deal_events (
  id bigserial primary key,
  deal_id uuid not null references deals(id),
  actor_id uuid, actor_kind text not null check (actor_kind in ('user','admin','ai','system')),
  from_status deal_status, to_status deal_status,
  note text, created_at timestamptz not null default now()
);

create table deal_proofs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  user_id uuid not null references profiles(id),
  stage text not null check (stage in ('handover','dropoff','delivery','condition')),
  selfie_path text not null,
  item_photo_paths text[] default '{}',
  lat double precision not null, lng double precision not null,
  accuracy_m real, is_mock_location boolean not null,
  source text not null default 'unknown',
  face_match_score numeric(4,3),
  captured_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  provider text not null, provider_ref text unique,
  amount_paisa bigint not null,
  status text not null check (status in ('initiated','succeeded','failed','refunded')),
  raw jsonb, created_at timestamptz not null default now()
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id),
  user_id uuid not null references profiles(id),
  payout_account_id uuid not null references payout_accounts(id),
  amount_paisa bigint not null,
  status text not null check (status in ('queued','approved','sent','failed')),
  provider_ref text, created_at timestamptz not null default now()
);

create table ledger_entries (
  id bigserial primary key,
  txn_id uuid not null,
  deal_id uuid references deals(id),
  account ledger_account not null,
  user_id uuid,
  debit_paisa bigint not null default 0 check (debit_paisa >= 0),
  credit_paisa bigint not null default 0 check (credit_paisa >= 0),
  memo text,
  prev_hash text, entry_hash text not null default '',
  created_at timestamptz not null default now(),
  check ((debit_paisa = 0) <> (credit_paisa = 0))
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references deals(id),
  opened_by uuid not null references profiles(id),
  reason text not null, details text,
  status text not null default 'open' check (status in ('open','ai_reviewed','resolved')),
  resolution text, loser_id uuid, created_at timestamptz not null default now()
);

create table dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id),
  user_id uuid not null references profiles(id),
  note text, media_paths text[] default '{}',
  created_at timestamptz not null default now()
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  reviewer_id uuid not null references profiles(id),
  reviewee_id uuid not null references profiles(id),
  stars int not null check (stars between 1 and 5),
  comment text, created_at timestamptz not null default now(),
  unique (deal_id, reviewer_id)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id),
  target_user_id uuid references profiles(id),
  target_listing_id uuid references listings(id),
  target_message_id uuid references messages(id),
  reason text not null, status text not null default 'open',
  created_at timestamptz not null default now()
);

create table ai_reviews (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  subject_type text not null, subject_id uuid not null,
  recommendation text not null,
  confidence numeric(4,3) not null,
  risk_score int,
  summary text not null,
  evidence jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table admin_actions (
  id uuid primary key default gen_random_uuid(),
  type action_type not null,
  subject_type text not null, subject_id uuid not null,
  payload jsonb not null default '{}',
  ai_review_id uuid references ai_reviews(id),
  priority int not null default 3,
  status action_status not null default 'pending',
  requested_by text not null,
  decided_by uuid references admin_users(user_id),
  decided_at timestamptz, decision_note text,
  executed_at timestamptz, error text,
  created_at timestamptz not null default now()
);
create index admin_actions_queue on admin_actions(status, priority, created_at);

create table audit_log (
  id bigserial primary key,
  actor_id uuid, actor_kind text not null,
  action text not null, subject_type text, subject_id uuid,
  data jsonb, ip inet, created_at timestamptz not null default now()
);

create table blacklist (
  id uuid primary key default gen_random_uuid(),
  nid_number_hash text, device_fingerprint text, phone text, payout_account_number text, email text,
  reason text not null, added_by uuid references admin_users(user_id),
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  title text not null, body text not null, data jsonb,
  read_at timestamptz, created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, created_at desc);

-- alerts for admins that are not money actions: SOS, release-code lockouts, ledger mismatches, fraud flags
create table alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  priority int not null default 2,
  subject_type text, subject_id uuid,
  title text not null, body text,
  data jsonb,
  resolved_at timestamptz, resolved_by uuid,
  created_at timestamptz not null default now()
);

-- later-phase tables
create table wanted_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  title text not null, details text, max_price_paisa bigint, category text, area text,
  status text not null default 'open', created_at timestamptz not null default now()
);
create table e_contracts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references deals(id),
  file_id uuid not null references files(id),
  content_hash text not null,
  buyer_signed_at timestamptz, seller_signed_at timestamptz,
  created_at timestamptz not null default now()
);
create table sos_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id), deal_id uuid references deals(id),
  lat double precision, lng double precision, accuracy_m real,
  status text not null default 'open', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table trip_shares (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id), user_id uuid not null references profiles(id),
  share_token text not null unique, expires_at timestamptz not null,
  lat double precision, lng double precision, updated_at timestamptz,
  created_at timestamptz not null default now()
);
create table safe_spots (
  id uuid primary key default gen_random_uuid(),
  name text not null, area text not null, note text,
  lat double precision not null, lng double precision not null,
  active boolean not null default true, created_at timestamptz not null default now()
);
create table vouches (
  voucher_id uuid references profiles(id), vouchee_id uuid references profiles(id),
  note text, created_at timestamptz not null default now(),
  primary key (voucher_id, vouchee_id), check (voucher_id <> vouchee_id)
);
create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  subject text not null, status text not null default 'open',
  created_at timestamptz not null default now()
);
create table support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  ticket_id uuid references support_tickets(id),
  role text not null check (role in ('user','ai','admin')),
  body text not null, created_at timestamptz not null default now()
);
create table trust_history (
  id bigserial primary key, user_id uuid not null references profiles(id),
  score int not null, reason text, created_at timestamptz not null default now()
);

-- ===================== DATABASE RULES =====================

-- is_admin: a session sets app.user_id; true when that user is an active admin (with the role if given)
create or replace function is_admin(r admin_role default null) returns boolean language sql stable as $$
  select exists (
    select 1 from admin_users a
    where a.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      and a.active and (r is null or a.role = r or a.role = 'super_admin')
  );
$$;

-- Append-only tables
create or replace function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'append_only: % on % is not allowed', tg_op, tg_table_name using errcode = 'P0001';
end $$;
create trigger ledger_append_only before update or delete on ledger_entries for each row execute function forbid_change();
create trigger deal_events_append_only before update or delete on deal_events for each row execute function forbid_change();
create trigger audit_append_only before update or delete on audit_log for each row execute function forbid_change();
create trigger ai_reviews_append_only before update or delete on ai_reviews for each row execute function forbid_change();

-- admin_actions: never deleted; the request itself can't be edited; status only moves forward
create or replace function guard_admin_actions() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'append_only: admin_actions rows are never deleted'; end if;
  if new.type <> old.type or new.subject_type <> old.subject_type or new.subject_id <> old.subject_id
     or new.payload <> old.payload or coalesce(new.ai_review_id::text,'') <> coalesce(old.ai_review_id::text,'')
     or new.requested_by <> old.requested_by or new.created_at <> old.created_at then
    raise exception 'admin_actions: the request can''t be edited';
  end if;
  if old.status <> new.status and not (
     (old.status = 'pending' and new.status in ('approved','rejected')) or
     (old.status = 'approved' and new.status in ('executed','failed'))) then
    raise exception 'admin_actions: illegal status change % -> %', old.status, new.status;
  end if;
  if old.status in ('rejected','executed','failed') and (new.decided_by is distinct from old.decided_by or new.decision_note is distinct from old.decision_note) then
    raise exception 'admin_actions: decided history can''t be edited';
  end if;
  if new.status = 'approved' and old.status = 'pending' and new.decided_by is null then
    raise exception 'admin_actions: approval needs an admin';
  end if;
  return new;
end $$;
create trigger admin_actions_guard before update or delete on admin_actions for each row execute function guard_admin_actions();

-- Ledger: only money functions may write; hash chain; every txn balances (deferred)
create or replace function ledger_before_insert() returns trigger language plpgsql as $$
declare last_hash text;
begin
  if coalesce(current_setting('app.money', true), '') <> 'on' then
    raise exception 'ledger: money moves only through fund_deal or execute_admin_action';
  end if;
  perform pg_advisory_xact_lock(7421001);
  select entry_hash into last_hash from ledger_entries order by id desc limit 1;
  new.prev_hash := coalesce(last_hash, 'GENESIS');
  new.entry_hash := ledger_hash(new.prev_hash, new.txn_id, new.account, new.debit_paisa, new.credit_paisa, new.created_at);
  return new;
end $$;

create or replace function ledger_hash(prev text, txn uuid, acct ledger_account, debit bigint, credit bigint, ts timestamptz)
returns text language sql immutable as $$
  select encode(sha256(convert_to(prev || '|' || txn::text || '|' || acct::text || '|' || debit::text || '|' || credit::text || '|' ||
    to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'UTF8')), 'hex');
$$;
create trigger ledger_chain before insert on ledger_entries for each row execute function ledger_before_insert();

create or replace function ledger_check_balance() returns trigger language plpgsql as $$
declare d bigint; c bigint;
begin
  select coalesce(sum(debit_paisa),0), coalesce(sum(credit_paisa),0) into d, c from ledger_entries where txn_id = new.txn_id;
  if d <> c then raise exception 'ledger: txn % does not balance (debit % credit %)', new.txn_id, d, c; end if;
  return null;
end $$;
create constraint trigger ledger_balanced after insert on ledger_entries deferrable initially deferred
  for each row execute function ledger_check_balance();

-- recompute the whole chain; returns the first broken id or null when intact
create or replace function ledger_verify() returns table(ok boolean, entries bigint, broken_id bigint, unbalanced_txns bigint) language plpgsql stable as $$
declare r record; prev text := 'GENESIS'; n bigint := 0; bad bigint := null; unb bigint;
begin
  for r in select * from ledger_entries order by id loop
    n := n + 1;
    if bad is null and (r.prev_hash <> prev or r.entry_hash <> ledger_hash(prev, r.txn_id, r.account, r.debit_paisa, r.credit_paisa, r.created_at)) then
      bad := r.id;
    end if;
    prev := r.entry_hash;
  end loop;
  select count(*) into unb from (select txn_id from ledger_entries group by txn_id having sum(debit_paisa) <> sum(credit_paisa)) x;
  return query select (bad is null and unb = 0), n, bad, unb;
end $$;

create or replace function ledger_move(p_txn uuid, p_deal uuid, p_from ledger_account, p_from_user uuid, p_to ledger_account, p_to_user uuid, p_amount bigint, p_memo text)
returns void language plpgsql as $$
begin
  if p_amount <= 0 then return; end if;
  insert into ledger_entries(txn_id, deal_id, account, user_id, credit_paisa, memo) values (p_txn, p_deal, p_from, p_from_user, p_amount, p_memo);
  insert into ledger_entries(txn_id, deal_id, account, user_id, debit_paisa, memo) values (p_txn, p_deal, p_to, p_to_user, p_amount, p_memo);
end $$;

-- Deal status changes only through transition_deal
create or replace function deals_guard_status() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('app.transition', true), '') <> 'on' then
    raise exception 'deals: status changes only through transition_deal()';
  end if;
  if new.amount_paisa <> old.amount_paisa or new.buyer_id <> old.buyer_id or new.seller_id <> old.seller_id
     or new.fee_paisa <> old.fee_paisa or new.guarantee_paisa <> old.guarantee_paisa then
    raise exception 'deals: amount and parties are fixed once proposed';
  end if;
  return new;
end $$;
create trigger deals_status_guard before update on deals for each row execute function deals_guard_status();

create or replace function setting_int(k text, dflt bigint) returns bigint language sql stable as $$
  select coalesce((select (value #>> '{}')::bigint from settings where key = k), dflt);
$$;

-- max deal amount (paisa) a user may take part in
create or replace function user_deal_limit(p_user uuid) returns bigint language plpgsql stable as $$
declare p profiles; lim bigint;
begin
  select * into p from profiles where id = p_user;
  if p is null or p.is_banned then return 0; end if;
  lim := case p.kyc_level
    when 'none' then 0
    when 'basic' then setting_int('limit_level1', 5000) * 100
    when 'verified' then setting_int('limit_level2', 100000) * 100
    when 'business' then setting_int('limit_level3', 500000) * 100 end;
  if p.deals_completed < 5 then lim := least(lim, setting_int('new_user_deal_limit', 3000) * 100); end if;
  return lim;
end $$;

-- The escrow state machine (spec section 7). p_actor_kind: user | admin | ai | system.
create or replace function transition_deal(p_deal uuid, p_to deal_status, p_actor uuid, p_actor_kind text, p_note text default null)
returns deal_status language plpgsql as $$
declare d deals; who text; ok boolean := false; fr deal_status; hours int;
begin
  select * into d from deals where id = p_deal for update;
  if d is null then raise exception 'deal not found'; end if;
  fr := d.status;
  if p_actor_kind = 'user' then
    who := case when p_actor = d.buyer_id then 'buyer' when p_actor = d.seller_id then 'seller' else null end;
    if who is null then raise exception 'transition: not a party to this deal'; end if;
  else who := p_actor_kind; end if;

  ok := case
    when fr = 'proposed' and p_to = 'accepted' then who in ('buyer','seller') and p_actor <> d.proposed_by
    when fr in ('proposed','accepted','payment_pending') and p_to = 'cancelled' then who in ('buyer','seller','system')
    when fr = 'accepted' and p_to = 'payment_pending' then who = 'buyer'
    when fr = 'payment_pending' and p_to = 'accepted' then who in ('system','buyer')
    when fr = 'payment_pending' and p_to = 'funded' then who = 'system' and current_setting('app.money', true) = 'on'
    when fr = 'funded' and p_to = 'handover_pending' then who = 'system' and d.handover in ('meetup','pickup_point','digital')
    when fr = 'funded' and p_to = 'shipped' then who = 'seller' and d.handover = 'courier'
    when fr in ('handover_pending','shipped') and p_to = 'buyer_confirmed' then who in ('buyer','seller')
    when fr = 'buyer_confirmed' and p_to = 'release_queued' then who in ('ai','system')
    when fr = 'shipped' and p_to = 'release_queued' then who = 'system'
    when fr = 'release_queued' and p_to = 'released' then who = 'admin' and current_setting('app.exec', true) = 'on'
    when fr in ('released','split_done') and p_to = 'paid_out' then who = 'admin' and current_setting('app.exec', true) = 'on'
    when fr = 'paid_out' and p_to = 'completed' then who = 'system'
    when fr in ('funded','handover_pending','shipped','buyer_confirmed','release_queued') and p_to = 'disputed' then who in ('buyer','seller')
    when fr = 'disputed' and p_to in ('refund_queued','release_queued','split_queued') then who in ('ai','system','admin')
    when fr in ('refund_queued','release_queued','split_queued') and p_to = 'disputed' then who = 'admin'
    when fr = 'refund_queued' and p_to = 'refunded' then who = 'admin' and current_setting('app.exec', true) = 'on'
    when fr = 'split_queued' and p_to = 'split_done' then who = 'admin' and current_setting('app.exec', true) = 'on'
    else false end;
  if not ok then
    raise exception 'transition: % -> % is not allowed for %', fr, p_to, who using errcode = 'P0002';
  end if;

  -- extra conditions
  if p_to = 'accepted' and fr = 'proposed' then
    if d.amount_paisa > user_deal_limit(d.buyer_id) or d.amount_paisa > user_deal_limit(d.seller_id) then
      raise exception 'limit: the amount is above a party''s KYC or new-user limit' using errcode = 'P0003';
    end if;
  end if;
  if p_to = 'shipped' then
    if d.tracking_number is null or not exists (select 1 from deal_proofs where deal_id = d.id and user_id = d.seller_id and stage = 'dropoff') then
      raise exception 'proof: add the tracking number and a drop-off proof first' using errcode = 'P0004';
    end if;
  end if;
  if p_to = 'buyer_confirmed' and d.handover in ('meetup','pickup_point') then
    if not exists (select 1 from deal_proofs where deal_id = d.id and user_id = d.buyer_id and stage = 'handover')
       or not exists (select 1 from deal_proofs where deal_id = d.id and user_id = d.seller_id and stage = 'handover') then
      raise exception 'proof: both sides must save a handover selfie and GPS first' using errcode = 'P0004';
    end if;
  end if;
  if p_to = 'release_queued' and fr = 'shipped' then
    hours := setting_int('auto_release_hours', 72);
    if d.delivered_at is null or d.delivered_at > now() - make_interval(hours => hours) then
      raise exception 'auto-release: not delivered long enough' using errcode = 'P0004';
    end if;
  end if;

  perform set_config('app.transition', 'on', true);
  update deals set status = p_to,
    funded_at = case when p_to = 'funded' then now() else funded_at end
    where id = d.id;
  perform set_config('app.transition', 'off', true);
  insert into deal_events(deal_id, actor_id, actor_kind, from_status, to_status, note)
    values (d.id, p_actor, case when p_actor_kind in ('user','admin','ai','system') then p_actor_kind else 'system' end, fr, p_to, p_note);
  return p_to;
end $$;

-- Buyer payment succeeded: funds the deal and writes buyer_external -> escrow_hold
create or replace function fund_deal(p_deal uuid, p_payment uuid) returns void language plpgsql as $$
declare d deals; t uuid := gen_random_uuid();
begin
  select * into d from deals where id = p_deal for update;
  if d.status <> 'payment_pending' then raise exception 'fund: deal is %', d.status; end if;
  perform set_config('app.money', 'on', true);
  perform ledger_move(t, d.id, 'buyer_external', d.buyer_id, 'escrow_hold', null, d.amount_paisa, 'Buyer paid into escrow (payment ' || p_payment || ')');
  perform transition_deal(d.id, 'funded', null, 'system', 'Payment received, money held safely');
  perform set_config('app.money', 'off', true);
  if d.handover in ('meetup','pickup_point','digital') then
    perform transition_deal(d.id, 'handover_pending', null, 'system', 'Ready for handover');
  end if;
end $$;

create or replace function role_can(p_role admin_role, p_type action_type) returns boolean language sql immutable as $$
  select p_role = 'super_admin' or case p_type
    when 'approve_kyc' then p_role = 'kyc_reviewer'
    when 'reject_kyc' then p_role = 'kyc_reviewer'
    when 'release_escrow' then p_role in ('dispute_agent','finance')
    when 'refund_escrow' then p_role = 'dispute_agent'
    when 'split_escrow' then p_role = 'dispute_agent'
    when 'approve_payout' then p_role = 'finance'
    when 'remove_listing' then p_role in ('support','dispute_agent')
    when 'blacklist_add' then p_role = 'dispute_agent'
    else false end;   -- ban_user, unban_user, police_handover: super_admin only
$$;

-- The ONLY way real actions happen. Requires an approved action decided by an admin with the right role.
create or replace function execute_admin_action(p_action uuid) returns text language plpgsql security definer as $$
declare a admin_actions; adm admin_users; d deals; t uuid; net bigint; fee bigint; guar bigint; bp bigint; sp bigint;
  k kyc_submissions; po payouts; acct payout_accounts; lim bigint; refunded bigint;
begin
  select * into a from admin_actions where id = p_action for update;
  if a is null then raise exception 'action not found'; end if;
  if a.status <> 'approved' then raise exception 'execute: action is %, it must be approved by an admin first', a.status using errcode = 'P0005'; end if;
  select * into adm from admin_users where user_id = a.decided_by and active;
  if adm is null then raise exception 'execute: no active approving admin' using errcode = 'P0005'; end if;
  if not role_can(adm.role, a.type) then raise exception 'execute: role % can''t run %', adm.role, a.type using errcode = 'P0005'; end if;

  perform set_config('app.exec', 'on', true);
  perform set_config('app.money', 'on', true);
  t := gen_random_uuid();

  if a.type in ('release_escrow','refund_escrow','split_escrow') then
    select * into d from deals where id = a.subject_id for update;
    if d is null then raise exception 'execute: deal not found'; end if;
  end if;

  case a.type
  when 'approve_kyc' then
    select * into k from kyc_submissions where id = a.subject_id for update;
    if k.status in ('approved','rejected') then raise exception 'execute: KYC already decided'; end if;
    update kyc_submissions set status = 'approved' where id = k.id;
    update profiles set kyc_level = k.level where id = k.user_id and (kyc_level < k.level);
    insert into notifications(user_id, title, body, data) values (k.user_id, 'Verification approved', 'Your identity check was approved. Your deal limit went up.', jsonb_build_object('kind','kyc'));
  when 'reject_kyc' then
    select * into k from kyc_submissions where id = a.subject_id for update;
    update kyc_submissions set status = case when coalesce(a.payload->>'resubmit','true') = 'true' then 'resubmit'::kyc_status else 'rejected'::kyc_status end where id = k.id;
    insert into notifications(user_id, title, body, data) values (k.user_id, 'Verification not approved', coalesce(a.decision_note, 'Please submit your documents again.'), jsonb_build_object('kind','kyc'));
  when 'release_escrow' then
    if d.status <> 'release_queued' then raise exception 'execute: deal is %, release needs release_queued', d.status using errcode = 'P0006'; end if;
    if exists (select 1 from disputes where deal_id = d.id and status <> 'resolved') and coalesce(a.payload->>'resolves_dispute','false') <> 'true' then
      raise exception 'execute: deal has an open dispute' using errcode = 'P0006';
    end if;
    fee := d.fee_paisa; guar := d.guarantee_paisa; net := d.amount_paisa - fee - guar;
    insert into ledger_entries(txn_id, deal_id, account, credit_paisa, memo) values (t, d.id, 'escrow_hold', d.amount_paisa, 'Release from escrow');
    insert into ledger_entries(txn_id, deal_id, account, user_id, debit_paisa, memo) values (t, d.id, 'seller_payable', d.seller_id, net, 'Seller share');
    if fee > 0 then insert into ledger_entries(txn_id, deal_id, account, debit_paisa, memo) values (t, d.id, 'platform_fees', fee, 'Platform fee'); end if;
    if guar > 0 then insert into ledger_entries(txn_id, deal_id, account, debit_paisa, memo) values (t, d.id, 'guarantee_fund', guar, 'Guarantee fund'); end if;
    perform transition_deal(d.id, 'released', a.decided_by, 'admin', 'Admin approved release');
    update disputes set status = 'resolved', resolution = 'release' where deal_id = d.id and status <> 'resolved';
  when 'refund_escrow' then
    if d.status <> 'refund_queued' then raise exception 'execute: deal is %, refund needs refund_queued', d.status using errcode = 'P0006'; end if;
    lim := setting_int('dispute_agent_refund_limit', 20000) * 100;
    if d.amount_paisa > lim and adm.role <> 'super_admin' then raise exception 'execute: refunds above the limit need super_admin' using errcode = 'P0005'; end if;
    perform ledger_move(t, d.id, 'escrow_hold', null, 'refund_payable', d.buyer_id, d.amount_paisa, 'Refund approved');
    perform ledger_move(gen_random_uuid(), d.id, 'refund_payable', d.buyer_id, 'buyer_external', d.buyer_id, d.amount_paisa, 'Refund sent to buyer');
    perform transition_deal(d.id, 'refunded', a.decided_by, 'admin', 'Admin approved refund');
    update disputes set status = 'resolved', resolution = 'refund' where deal_id = d.id and status <> 'resolved';
  when 'split_escrow' then
    if d.status <> 'split_queued' then raise exception 'execute: deal is %, split needs split_queued', d.status using errcode = 'P0006'; end if;
    bp := (a.payload->>'buyer_paisa')::bigint; sp := (a.payload->>'seller_paisa')::bigint;
    if bp is null or sp is null or bp < 0 or sp < 0 or bp + sp <> d.amount_paisa then raise exception 'execute: split must add up to the deal amount'; end if;
    lim := setting_int('dispute_agent_refund_limit', 20000) * 100;
    if bp > lim and adm.role <> 'super_admin' then raise exception 'execute: refunds above the limit need super_admin' using errcode = 'P0005'; end if;
    fee := round(sp * d.fee_percent / 100); guar := round(sp * d.guarantee_percent / 100); net := sp - fee - guar;
    insert into ledger_entries(txn_id, deal_id, account, credit_paisa, memo) values (t, d.id, 'escrow_hold', d.amount_paisa, 'Split from escrow');
    if bp > 0 then insert into ledger_entries(txn_id, deal_id, account, user_id, debit_paisa, memo) values (t, d.id, 'refund_payable', d.buyer_id, bp, 'Buyer share of split'); end if;
    if net > 0 then insert into ledger_entries(txn_id, deal_id, account, user_id, debit_paisa, memo) values (t, d.id, 'seller_payable', d.seller_id, net, 'Seller share of split'); end if;
    if fee > 0 then insert into ledger_entries(txn_id, deal_id, account, debit_paisa, memo) values (t, d.id, 'platform_fees', fee, 'Platform fee'); end if;
    if guar > 0 then insert into ledger_entries(txn_id, deal_id, account, debit_paisa, memo) values (t, d.id, 'guarantee_fund', guar, 'Guarantee fund'); end if;
    if bp > 0 then perform ledger_move(gen_random_uuid(), d.id, 'refund_payable', d.buyer_id, 'buyer_external', d.buyer_id, bp, 'Split refund sent to buyer'); end if;
    perform transition_deal(d.id, 'split_done', a.decided_by, 'admin', 'Admin approved split');
    update disputes set status = 'resolved', resolution = 'split' where deal_id = d.id and status <> 'resolved';
  when 'approve_payout' then
    select * into po from payouts where id = a.subject_id for update;
    if po is null or po.status <> 'queued' then raise exception 'execute: payout is not queued'; end if;
    select * into acct from payout_accounts where id = po.payout_account_id;
    if not acct.name_matches_kyc then raise exception 'payout: account name does not match the KYC name' using errcode = 'P0007'; end if;
    select * into d from deals where id = po.deal_id for update;
    if d.status not in ('released','split_done') then raise exception 'execute: deal is %, payout needs released', d.status using errcode = 'P0006'; end if;
    perform ledger_move(t, d.id, 'seller_payable', d.seller_id, 'seller_external', d.seller_id, po.amount_paisa, 'Payout to ' || acct.method || ' ****' || right(acct.account_number, 4));
    update payouts set status = 'sent', provider_ref = coalesce(a.payload->>'provider_ref', 'manual-' || left(t::text, 8)) where id = po.id;
    perform transition_deal(d.id, 'paid_out', a.decided_by, 'admin', 'Finance approved payout');
    perform transition_deal(d.id, 'completed', null, 'system', 'Deal complete, reviews open');
    update profiles set deals_completed = deals_completed + 1 where id in (d.buyer_id, d.seller_id);
  when 'ban_user' then
    update profiles set is_banned = true where id = a.subject_id;
  when 'unban_user' then
    update profiles set is_banned = false where id = a.subject_id;
  when 'remove_listing' then
    update listings set status = 'removed' where id = a.subject_id;
  when 'police_handover' then
    null; -- the export file is produced by the server only after this executes; the record stays here
  when 'blacklist_add' then
    insert into blacklist(nid_number_hash, device_fingerprint, phone, payout_account_number, email, reason, added_by)
    select (select nid_number_hash from kyc_submissions where user_id = p.id order by created_at desc limit 1),
           (select device_fingerprint from devices where user_id = p.id limit 1), p.phone,
           (select account_number from payout_accounts where user_id = p.id order by created_at desc limit 1),
           p.email, coalesce(a.payload->>'reason', a.decision_note, 'Fraud'), a.decided_by
    from profiles p where p.id = a.subject_id;
    insert into blacklist(payout_account_number, reason, added_by)
      select account_number, 'Linked payout account', a.decided_by from payout_accounts where user_id = a.subject_id
      and account_number <> coalesce((select account_number from payout_accounts where user_id = a.subject_id order by created_at desc limit 1), '');
  end case;

  perform set_config('app.money', 'off', true);
  perform set_config('app.exec', 'off', true);
  update admin_actions set status = 'executed', executed_at = now() where id = a.id;
  insert into audit_log(actor_id, actor_kind, action, subject_type, subject_id, data)
    values (a.decided_by, 'admin', 'execute:' || a.type, a.subject_type, a.subject_id, jsonb_build_object('action_id', a.id, 'payload', a.payload));
  return 'executed';
end $$;
