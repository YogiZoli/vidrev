import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/ui/page";
import { env } from "@/lib/env";
import { HELP } from "./content";

export const metadata: Metadata = { title: "Help" };

// Public: how to use vidrev, step by step (src/app/help/content.ts).
export default function HelpPage() {
  const contact = env().LEGAL_CONTACT_EMAIL;
  return (
    <Page width="md" className="grid gap-4 px-4 pb-16 pt-6">
      <h1 className="m-0 text-[32px] font-bold leading-tight">Help</h1>
      <p className="m-0 text-base leading-relaxed">
        How to set up vidrev and what each message means. Questions about data and permissions: <Link href="/trust">Trust and data</Link>.
      </p>
      <nav className="flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
        {HELP.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.title}
          </a>
        ))}
      </nav>
      {HELP.map((s) => (
        <section key={s.id} id={s.id} className="grid gap-2">
          <h2 className="m-0 mt-6 text-[22px] font-bold leading-tight">{s.title}</h2>
          {s.steps ? (
            <ol className="m-0 grid gap-1 pl-5 text-base">
              {s.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          {s.notes ? (
            <ul className="m-0 grid gap-1 pl-5 text-[15px] text-label">
              {s.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      <h2 className="m-0 mt-6 text-[22px] font-bold leading-tight">Still stuck?</h2>
      <p className="m-0 text-base">
        Write to <a href={`mailto:${contact}`}>{contact}</a>. We answer within one working day.
      </p>
    </Page>
  );
}
