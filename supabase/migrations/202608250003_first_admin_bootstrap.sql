begin;

-- Evita o impasse de uma instalação vazia: a primeira pessoa que prova controlar
-- um endereço @nikufra.ai torna-se admin. O lock impede duas primeiras contas.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first_admin boolean;
begin
  if lower(new.email) not like '%@nikufra.ai' then
    raise exception 'Apenas endereços @nikufra.ai são permitidos';
  end if;

  perform pg_advisory_xact_lock(hashtext('nikufra:first-admin'));
  select not exists (
    select 1 from public.profiles where role = 'admin' and ativo
  ) into is_first_admin;

  insert into public.profiles(id, nome, email, role, ativo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    lower(new.email),
    case when is_first_admin then 'admin'::public.profile_role else 'member'::public.profile_role end,
    is_first_admin
  );
  return new;
end $$;

commit;
