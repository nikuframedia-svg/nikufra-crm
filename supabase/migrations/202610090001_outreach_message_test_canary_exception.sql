begin;

-- A confirmed, single-recipient message test may reach a contact outside the
-- canary allowlist. Ordinary campaigns remain allowlisted; quotas, mailbox
-- readiness, suppression and every other provider permit remain in force.
create or replace function private.outreach_recipient_eligibility(
  target_recipient_id uuid,
  target_mailbox_id uuid,
  eligibility_time timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  decision jsonb;
  target_campaign_id uuid;
  target_contact_id uuid;
  target_email text;
  is_message_test boolean;
  remaining_reasons jsonb;
begin
  decision := private.outreach_recipient_eligibility_without_campaign_scope(
    target_recipient_id, target_mailbox_id, eligibility_time
  );

  if not coalesce((
    select dns.spf_status='pass'
      and dns.dkim_status='pass'
      and dns.dmarc_status='pass'
      and dns.mx_status='pass'
      and dns.checked_at > eligibility_time - interval '24 hours'
    from public.outreach_dns_checks dns
    where dns.mailbox_id=target_mailbox_id
    order by dns.checked_at desc, dns.id desc
    limit 1
  ), false) and not (coalesce(decision -> 'reasons', '[]'::jsonb) ? 'dns_not_ready') then
    decision := jsonb_set(decision, '{reasons}',
      coalesce(decision -> 'reasons', '[]'::jsonb) || jsonb_build_array('dns_not_ready'), true);
    decision := jsonb_set(decision, '{eligible}', 'false'::jsonb, true);
  end if;

  select recipient.campaign_id, recipient.contact_id, contact.email::text,
         campaign.test_source_campaign_id is not null
           and campaign.daily_limit = 1
           and (select count(*) from public.outreach_recipients test_recipient
                where test_recipient.campaign_id=campaign.id) = 1
           and exists (
             select 1 from public.outreach_recipients source_recipient
             where source_recipient.campaign_id=campaign.test_source_campaign_id
               and source_recipient.contact_id=recipient.contact_id
           )
  into target_campaign_id, target_contact_id, target_email, is_message_test
  from public.outreach_recipients recipient
  join public.outreach_campaigns campaign on campaign.id=recipient.campaign_id
  left join public.contactos contact on contact.id=recipient.contact_id
  where recipient.id=target_recipient_id;
  is_message_test := coalesce(is_message_test, false);

  if target_campaign_id is not null and not exists (
    select 1 from public.outreach_campaign_mailboxes selection
    where selection.campaign_id=target_campaign_id
      and selection.mailbox_id=target_mailbox_id
  ) then
    decision := jsonb_set(decision, '{reasons}',
      coalesce(decision -> 'reasons', '[]'::jsonb)
        || jsonb_build_array('campaign_mailbox_not_selected'), true);
    decision := jsonb_set(decision, '{eligible}', 'false'::jsonb, true);
  end if;

  if (coalesce(decision -> 'reasons', '[]'::jsonb) ? 'email_not_verified'
      and private.outreach_has_owned_mailbox_email(target_contact_id, target_email))
    or (is_message_test and (
      coalesce(decision -> 'reasons', '[]'::jsonb) ? 'lawful_basis_missing'
      or coalesce(decision -> 'reasons', '[]'::jsonb) ? 'not_in_canary_allowlist'
    )) then
    select coalesce(jsonb_agg(reason), '[]'::jsonb) into remaining_reasons
    from jsonb_array_elements_text(coalesce(decision -> 'reasons', '[]'::jsonb)) as entries(reason)
    where not (reason = 'email_not_verified'
      and private.outreach_has_owned_mailbox_email(target_contact_id, target_email))
      and not (reason in ('lawful_basis_missing', 'not_in_canary_allowlist') and is_message_test);
    decision := jsonb_set(decision, '{reasons}', remaining_reasons, true);
    decision := jsonb_set(decision, '{eligible}',
      to_jsonb(jsonb_array_length(remaining_reasons) = 0), true);
  end if;
  return decision;
end;
$$;

comment on function private.outreach_recipient_eligibility(uuid, uuid, timestamptz)
  is 'Authoritative send eligibility; one-recipient message tests may send outside the canary allowlist while retaining quota and suppression gates.';

notify pgrst, 'reload schema';
commit;
