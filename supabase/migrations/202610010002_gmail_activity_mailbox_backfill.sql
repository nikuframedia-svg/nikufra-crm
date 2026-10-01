begin;

-- Legacy Gmail activities predate source_mailbox_email. Without a stable
-- mailbox identity they do not participate in the shared claim and can be
-- replayed when Outreach sees the same provider message first. Serialize the
-- repair with writers, resolve any projected-key conflicts deterministically,
-- then rebuild the canonical per-contact uniqueness boundary.
lock table public.atividades in share row exclusive mode;

drop index if exists public.atividades_mailbox_provider_message_unique;

with projected as (
  select
    activity.id,
    coalesce(
      nullif(lower(trim(activity.source_mailbox_email::text)), '')::citext,
      nullif(lower(trim(profile.email::text)), '')::citext
    ) as mailbox_email,
    row_number() over (
      partition by
        coalesce(
          nullif(lower(trim(activity.source_mailbox_email::text)), '')::citext,
          nullif(lower(trim(profile.email::text)), '')::citext
        ),
        activity.message_id,
        activity.contacto_id
      order by
        (nullif(trim(activity.source_mailbox_email::text), '') is not null) desc,
        activity.created_at,
        activity.id
    ) as duplicate_rank
  from public.atividades activity
  left join public.profiles profile on profile.id=activity.user_id
  where activity.message_id is not null
    and activity.contacto_id is not null
), duplicates as (
  select id
  from projected
  where mailbox_email is not null and duplicate_rank > 1
)
delete from public.atividades activity
using duplicates
where activity.id=duplicates.id;

update public.atividades activity
set source_mailbox_email=coalesce(
  nullif(lower(trim(activity.source_mailbox_email::text)), '')::citext,
  nullif(lower(trim(profile.email::text)), '')::citext
)
from public.profiles profile
where profile.id=activity.user_id
  and activity.message_id is not null
  and coalesce(
    nullif(lower(trim(activity.source_mailbox_email::text)), '')::citext,
    nullif(lower(trim(profile.email::text)), '')::citext
  ) is not null
  and activity.source_mailbox_email::text is distinct from coalesce(
    nullif(lower(trim(activity.source_mailbox_email::text)), ''),
    nullif(lower(trim(profile.email::text)), '')
  );

create unique index atividades_mailbox_provider_message_unique
  on public.atividades(source_mailbox_email, message_id, contacto_id)
  where source_mailbox_email is not null
    and message_id is not null
    and contacto_id is not null;

-- Fail safe for any older importer or manual repair that still omits the new
-- column after this migration. Gmail sync sends it explicitly; this trigger is
-- the deterministic compatibility path only.
create or replace function private.set_atividade_source_mailbox_email()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  if new.message_id is null then
    return new;
  end if;

  new.source_mailbox_email := nullif(
    lower(trim(new.source_mailbox_email::text)),
    ''
  )::citext;
  if new.source_mailbox_email is null then
    select nullif(lower(trim(profile.email::text)), '')::citext
    into new.source_mailbox_email
    from public.profiles profile
    where profile.id=new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function private.set_atividade_source_mailbox_email()
  from public, anon, authenticated, service_role;

drop trigger if exists set_atividade_source_mailbox_email on public.atividades;
create trigger set_atividade_source_mailbox_email
before insert or update of user_id, message_id, source_mailbox_email
on public.atividades
for each row execute function private.set_atividade_source_mailbox_email();

notify pgrst, 'reload schema';

commit;
