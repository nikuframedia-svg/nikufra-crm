begin;

create table public.pipeline_settings (
  estado public.oportunidade_estado primary key,
  probabilidade_padrao integer not null check (probabilidade_padrao between 0 and 100),
  ordem integer not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.pipeline_settings for each row execute function public.set_updated_at();

insert into public.pipeline_settings(estado,probabilidade_padrao,ordem) values
('nao_contactado',0,1),('contactado',5,2),('reuniao_marcada',15,3),('reuniao_feita',30,4),('proposta',50,5),('piloto',75,6),('cliente',100,7),('perdido',0,8),('adiado',10,9);

create or replace function public.probabilidade_padrao(target public.oportunidade_estado)
returns integer language sql stable strict security definer set search_path = public as $$
  select probabilidade_padrao from public.pipeline_settings where estado = target;
$$;

alter table public.pipeline_settings enable row level security;
alter table public.pipeline_settings force row level security;
create policy pipeline_settings_read on public.pipeline_settings for select to authenticated using (public.is_active_member());
create policy pipeline_settings_admin on public.pipeline_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke delete on public.pipeline_settings from anon, authenticated;
grant select, insert, update on public.pipeline_settings to authenticated;

commit;
