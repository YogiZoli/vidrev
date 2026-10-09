import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { Page } from "@/components/ui/page";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Data deletion" };
export const dynamic = "force-dynamic";

const H2 = "m-0 mt-6 text-[22px] font-bold leading-tight";
const BODY = "m-0 text-base leading-relaxed";

// Public: how to delete data, for creators and for their viewers. The
// account deletion itself is src/server/account-deletion.ts.
export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { requested } = await searchParams;
  const contact = env().LEGAL_CONTACT_EMAIL;
  return (
    <Page width="md" className="grid gap-4 px-4 pb-16 pt-6">
      <h1 className="m-0 text-[32px] font-bold leading-tight">Data deletion</h1>
      {requested ? (
        <Notice tone="info">
          Your account is closed and its deletion has started. It finishes within minutes and we send a confirmation to your email. You have been signed out.
        </Notice>
      ) : null}

      <h2 className={H2}>Delete your vidrev account</h2>
      <ol className="m-0 grid gap-1 pl-5 text-base">
        <li>
          Sign in at <Link href="/login">app.vidrev.app</Link>.
        </li>
        <li>Open Settings, Account.</li>
        <li>Under &quot;Delete my account&quot;, type your account email and press the button.</li>
      </ol>
      <p className={BODY}>
        Can&apos;t sign in? Write to <a href={`mailto:${contact}`}>{contact}</a> from your account email and we delete it for you within 30 days, usually the same day.
      </p>

      <h2 className={H2}>What is deleted, and when</h2>
      <ul className="m-0 grid gap-1 pl-5 text-base">
        <li>At once: YouTube access is revoked and all YouTube data (comments, commenter names and ids, video titles, reply ids) is deleted.</li>
        <li>At once: Beast Mode contacts that vidrev created in your CRM are deleted there, and the CRM and Stripe connections are removed with their tokens and keys.</li>
        <li>Within minutes: your account, sign-in, settings, keywords, replies, tracked links, clicks, opt-ins, purchases and reports.</li>
        <li>Backups roll over and are gone within 30 days.</li>
      </ul>
      <p className={BODY}>
        What stays: contacts and tags of people who opted in or bought stay in your own CRM, because they are yours. Your tracked links stop redirecting. A paid
        subscription is cancelled separately, with the manage link in your purchase receipt email. We keep only a record that a deletion happened, without your
        email.
      </p>

      <h2 className={H2}>Delete only part of it</h2>
      <ul className="m-0 grid gap-1 pl-5 text-base">
        <li>YouTube: Settings, YouTube channel, Disconnect (or https://myaccount.google.com/permissions). All YouTube data of the channel is deleted at once.</li>
        <li>CRM: disconnect in Settings, or uninstall the app in your CRM. The tokens are deleted at once.</li>
        <li>Stripe: Settings, Stripe, Disconnect. The key is deleted at once.</li>
      </ul>

      <h2 className={H2}>You commented on a creator&apos;s video or clicked their link</h2>
      <p className={BODY}>
        The creator decides how your data is used; vidrev works for them. Comment data is deleted within 30 days on its own. To have anything deleted sooner, ask the
        creator, or write to <a href={`mailto:${contact}`}>{contact}</a> with the channel and the video, and we pass it on and help the creator delete it.
      </p>
      <p className={BODY}>
        More about how data is handled: <Link href="/trust">Trust and data</Link>.
      </p>
    </Page>
  );
}
