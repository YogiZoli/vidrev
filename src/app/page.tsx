import { ArrowRight, MessageSquare, MousePointerClick, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentSession } from "@/server/auth/current";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: MessageSquare, title: "Comment", text: "A viewer comments your keyword under a video." },
  { icon: Users, title: "Subscriber", text: "They reach your opt-in page through your own link." },
  { icon: Wallet, title: "Buyer", text: "A purchase is matched back by email and tracking id." },
  { icon: MousePointerClick, title: "Revenue", text: "See which video and keyword made money. Real numbers only." },
];

// Front door of the app host. The brand site (landing, Privacy, Terms) lives in
// GoHighLevel, DECISIONS D-28; this page is only the entry to the app.
export default async function HomePage() {
  const signedIn = Boolean(await currentSession());
  return (
    <div className="min-h-screen [background-image:var(--hero-glow)]">
      <header className="mx-auto flex max-w-[var(--container)] items-center justify-between px-4 py-4 md:px-5">
        <Brand />
        <Button asChild variant="outline" size="sm">
          <Link href={signedIn ? "/app" : "/login"}>{signedIn ? "Open your dashboard" : "Sign in"}</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-[var(--container)] px-4 md:px-5">
        <section className="py-10 md:py-16">
          <Badge tone="live">Private beta</Badge>
          <h1 className="mt-4 max-w-3xl text-4xl md:text-6xl">See which video makes money from your comments.</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            A viewer comments a keyword. You approve a reply. The link goes to your own opt-in page, and every purchase is traced back to the video and keyword behind it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild pulse>
              <Link href="/audit">
                See where I lose money on YouTube <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={signedIn ? "/app" : "/login"}>{signedIn ? "Open your dashboard" : "Sign in"}</Link>
            </Button>
          </div>
        </section>

      </main>
    </div>
  );
}
