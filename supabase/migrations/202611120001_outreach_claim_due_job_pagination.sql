-- A fixed scan of the oldest 100 due jobs can starve eligible canary jobs
-- when older jobs are outside the canary audience. Walk the ordered queue in
-- bounded pages until all mailboxes have an eligible job or no jobs remain.
create or replace function private.outreach_claim_jobs(
  worker_id text,
  claim_limit integer default 20,
  lease_seconds integer default 120
)
returns setof public.outreach_jobs
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  candidate public.outreach_jobs%rowtype;
  decision jsonb;
  claimed integer := 0;
  claimed_mailboxes uuid[] := '{}'::uuid[];
  page_size integer;
  page_scanned integer;
  last_scheduled_at timestamptz;
  last_id uuid;
begin
  if char_length(trim(worker_id)) = 0 then raise exception 'worker_id obrigatório'; end if;
  if claim_limit not between 1 and 100 then raise exception 'claim_limit inválido'; end if;
  if lease_seconds not between 30 and 900 then raise exception 'lease_seconds inválido'; end if;
  page_size := claim_limit * 5;

  -- A committed delivery ledger means the provider may already have accepted
  -- the message; only a lease without a ledger can return to pending.
  update public.outreach_jobs
  set status = case
        when exists (
          select 1 from private.outreach_delivery_ledger ledger
          where ledger.job_id = outreach_jobs.id
        ) then 'reconciliation_required'::public.outreach_job_status
        else 'pending'::public.outreach_job_status
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_error = case
        when exists (
          select 1 from private.outreach_delivery_ledger ledger
          where ledger.job_id = outreach_jobs.id
        ) then 'lease_expired_after_dispatch_reservation'
        else 'lease_expired_before_dispatch_reservation'
      end,
      updated_at = now()
  where status = 'leased' and lease_expires_at <= now();

  loop
    page_scanned := 0;
    for candidate in
      select j.*
      from public.outreach_jobs j
      where j.status = 'pending' and j.scheduled_at <= now()
        and (last_scheduled_at is null
          or (j.scheduled_at, j.id) > (last_scheduled_at, last_id))
      order by j.scheduled_at, j.id
      for update skip locked
      limit page_size
    loop
      page_scanned := page_scanned + 1;
      last_scheduled_at := candidate.scheduled_at;
      last_id := candidate.id;

      if candidate.mailbox_id is null then
        update public.outreach_jobs
        set last_error = '["mailbox_not_sendable"]', updated_at = now()
        where id = candidate.id
          and last_error is distinct from '["mailbox_not_sendable"]';
        continue;
      end if;

      -- One live lease per mailbox is a durable inter-worker barrier.
      if candidate.mailbox_id = any(claimed_mailboxes)
         or not pg_try_advisory_xact_lock(
           hashtextextended('outreach-mailbox:' || candidate.mailbox_id::text, 0)
         ) then
        continue;
      end if;
      if exists (
        select 1
        from public.outreach_jobs active_lease
        where active_lease.mailbox_id = candidate.mailbox_id
          and active_lease.id <> candidate.id
          and active_lease.status = 'leased'
          and active_lease.lease_expires_at > now()
      ) then
        continue;
      end if;

      decision := private.outreach_recipient_eligibility(
        candidate.recipient_id, candidate.mailbox_id, now()
      );
      if coalesce((decision ->> 'eligible')::boolean, false) then
        update public.outreach_jobs
        set status = 'leased', lease_owner = worker_id,
            lease_expires_at = now() + make_interval(secs => lease_seconds),
            last_error = null, updated_at = now()
        where id = candidate.id
        returning * into candidate;
        return next candidate;
        claimed := claimed + 1;
        claimed_mailboxes := array_append(claimed_mailboxes, candidate.mailbox_id);
        exit when claimed >= claim_limit;
      else
        -- Transient pacing is retried. Avoid rewriting an unchanged error on
        -- every scheduler tick while a canary audience remains restricted.
        if not ((decision -> 'reasons') ? 'mailbox_gap_not_elapsed') then
          update public.outreach_jobs
          set last_error = (decision -> 'reasons')::text, updated_at = now()
          where id = candidate.id
            and last_error is distinct from (decision -> 'reasons')::text;
        end if;
      end if;
    end loop;
    exit when claimed >= claim_limit or page_scanned < page_size;
  end loop;
  return;
end;
$$;
