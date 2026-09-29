begin;

-- The browser client only needs synchronization status. Even encrypted refresh-token
-- material remains server-only and cannot be selected through PostgREST.
revoke select on public.google_tokens from authenticated;
grant select (
  user_id,
  backfill_complete,
  messages_synced,
  contacts_created,
  people_contacts_synced,
  calendar_events_synced,
  people_sync_token,
  other_contacts_sync_token,
  calendar_sync_token,
  last_sync_at,
  calendar_last_sync_at,
  sync_error,
  import_confirmed_at,
  preview_messages_found,
  preview_contacts_found,
  preview_contacts_existing,
  preview_scanned_at
) on public.google_tokens to authenticated;

notify pgrst, 'reload schema';

commit;
