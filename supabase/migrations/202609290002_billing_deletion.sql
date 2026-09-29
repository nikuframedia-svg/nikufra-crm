begin;

alter table public.audit_log drop constraint if exists audit_log_acao_check;
alter table public.audit_log add constraint audit_log_acao_check check (acao in ('INSERT', 'UPDATE', 'ARCHIVE', 'DELETE', 'RGPD_DELETE'));

commit;
