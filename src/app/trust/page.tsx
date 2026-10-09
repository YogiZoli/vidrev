import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/ui/page";
import { env } from "@/lib/env";
import { CRM_SCOPES, FAQ, GOOGLE_SCOPES, type Permission, SECURITY, STRIPE_ACCESS, YOUTUBE_POLICY } from "./content";

export const metadata: Metadata = { title: "Trust and data" };

const H2 = "m-0 mt-6 text-[22px] font-bold leading-tight";
const BODY = "m-0 text-base leading-relaxed";

function Permissions({ title, rows }: { title: string; rows: Permission[] }) {
  return (
    <div className="grid gap-2">
      <h3 className="m-0 text-lg font-semibold">{title}</h3>
      <dl className="m-0 grid gap-3">
        {rows.map((p) => (
          <div key={p.scope} className="rounded-lg border border-border bg-surface p-3">
            <dt className="font-mono text-sm [overflow-wrap:anywhere]">{p.scope}</dt>
            <dd className="m-0 mt-1 text-[15px]">{p.why}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Public: how vidrev handles access, data and security (src/app/trust/content.ts).
export default function TrustPage() {
  const brand = env().BRAND_BASE_URL ?? "https://vidrev.app";
  const contact = env().LEGAL_CONTACT_EMAIL;
  return (
    <Page width="md" className="grid gap-4 px-4 pb-16 pt-6">
      <h1 className="m-0 text-[32px] font-bold leading-tight">Trust and data</h1>
      <p className={BODY}>
        What vidrev can access, why, how long it keeps it, and how you remove it. Short version: nothing is posted without your approval, YouTube data is deleted
        within 30 days, nothing is sold, and you can delete everything yourself.
      </p>
      <nav className="flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
        <a href="#permissions">Permissions</a>
        <a href="#youtube">YouTube data</a>
        <a href="#security">Security</a>
        <a href="#faq">Questions</a>
        <Link href="/data-deletion">Data deletion</Link>
        <a href={`${brand}/privacy`}>Privacy Policy</a>
        <a href={`${brand}/terms`}>Terms</a>
      </nav>

      <h2 id="permissions" className={H2}>
        Permissions we ask for, and why
      </h2>
      <p className={BODY}>Each permission is the narrowest one that makes a feature work. Google and your CRM show you the permissions again on their own screen when you connect.</p>
      <Permissions title="YouTube (Google)" rows={GOOGLE_SCOPES} />
      <Permissions title="CRM sub-account (optional)" rows={CRM_SCOPES} />
      <Permissions title="Stripe (optional)" rows={STRIPE_ACCESS} />

      <h2 id="youtube" className={H2}>
        YouTube data: the rules we follow
      </h2>
      <p className={BODY}>
        vidrev uses YouTube API Services and follows the YouTube API Services Terms and Developer Policies and the Google API Services User Data Policy, including the
        Limited Use requirements.
      </p>
      <div className="grid gap-3">
        {YOUTUBE_POLICY.map((r) => (
          <div key={r.rule} className="rounded-lg border border-border bg-surface p-3">
            <p className="m-0 font-semibold">{r.rule}</p>
            <p className="m-0 mt-1 text-[15px]">{r.how}</p>
          </div>
        ))}
      </div>

      <h2 id="security" className={H2}>
        Security
      </h2>
      <div className="grid gap-3">
        {SECURITY.map((s) => (
          <div key={s.title}>
            <p className="m-0 font-semibold">{s.title}</p>
            <p className="m-0 text-[15px]">{s.text}</p>
          </div>
        ))}
      </div>
      <p className={BODY}>
        Found a security issue? Write to <a href={`mailto:${contact}`}>{contact}</a>; we answer within 2 working days.
      </p>

      <h2 id="faq" className={H2}>
        Questions
      </h2>
      <div className="grid gap-4">
        {FAQ.map((f) => (
          <div key={f.q}>
            <p className="m-0 font-semibold">{f.q}</p>
            <p className="m-0 text-[15px]">{f.a}</p>
          </div>
        ))}
      </div>
      <p className={BODY}>
        Anything else: <a href={`mailto:${contact}`}>{contact}</a>.
      </p>
    </Page>
  );
}
