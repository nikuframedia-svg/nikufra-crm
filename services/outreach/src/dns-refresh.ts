import { pool } from "./db.js";
import { inspectDomain } from "./dns.js";

// The dispatch gate requires a DNS check newer than 24 hours. Keep checks
// fresh while a running campaign uses the mailbox, including over weekends.
export async function refreshDueDnsChecks() {
  const due = await pool.query<{ id: string; email: string; selector: string }>(`
    select mailbox.id,mailbox.email::text,
           coalesce(nullif(latest.details->>'selector',''),'google') selector
    from public.outreach_mailboxes mailbox
    left join lateral (
      select checked_at,spf_status,dkim_status,dmarc_status,mx_status,details
      from public.outreach_dns_checks check_row
      where check_row.mailbox_id=mailbox.id
      order by checked_at desc,id desc limit 1
    ) latest on true
    where mailbox.provider='google' and mailbox.status='active' and mailbox.send_enabled
      and exists (
        select 1 from public.outreach_campaign_mailboxes selection
        join public.outreach_campaigns campaign on campaign.id=selection.campaign_id
        where selection.mailbox_id=mailbox.id and campaign.status='running'
      )
      and (
        latest.checked_at is null
        or latest.checked_at < now() - interval '12 hours'
        or (
          (latest.spf_status<>'pass' or latest.dkim_status<>'pass'
            or latest.dmarc_status<>'pass' or latest.mx_status<>'pass')
          and latest.checked_at < now() - interval '15 minutes'
        )
      )
    order by mailbox.id limit 100`);
  let refreshed = 0;
  const failures: Array<{ mailboxId: string; error: string }> = [];
  for (const mailbox of due.rows) {
    try {
      const domain = mailbox.email.split("@")[1];
      if (!domain) throw new Error("Mailbox sem domínio válido.");
      const checked = await inspectDomain(domain, mailbox.selector);
      const status = (value: string) => value === "pass" ? "pass" : value === "missing" ? "fail" : "warn";
      await pool.query(`
        with inserted as (
          insert into public.outreach_dns_checks(
            mailbox_id,domain,spf_status,dkim_status,dmarc_status,mx_status,details,checked_at
          ) values (
            $1,$2,$3::public.outreach_check_status,$4::public.outreach_check_status,
            $5::public.outreach_check_status,$6::public.outreach_check_status,$7::jsonb,$8
          )
          returning mailbox_id
        )
        insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details)
        select null,'mailbox.dns.automatically_checked','mailbox',mailbox_id,
               jsonb_build_object('domain',$2::text,'spf',$3::text,'dkim',$4::text,
                 'dmarc',$5::text,'mx',$6::text)
        from inserted`, [
        mailbox.id,domain,status(checked.spf.status),status(checked.dkim.status),
        status(checked.dmarc.status),status(checked.mx.status),JSON.stringify(checked),checked.checkedAt,
      ]);
      refreshed += 1;
    } catch (error) {
      failures.push({ mailboxId: mailbox.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { due: due.rows.length, refreshed, failures };
}
