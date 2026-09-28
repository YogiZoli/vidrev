"use client";

import { type ReactNode, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Meta, SectionTitle } from "@/components/ui/page";
import { formatMultiple, formatUsd, moneyLeft, ownershipComparison, validMoneyInput } from "@/lib/audit/money";

// The creator's price and buying rate are required (DECISIONS L-12): the
// comparison and everything after it stay dimmed until both are entered.
export function MoneyGate({ signals, videos, children }: { signals: number; videos: number; children: ReactNode }) {
  const [price, setPrice] = useState("");
  const [rate, setRate] = useState("");
  const p = Number(price);
  const r = Number(rate);
  const ok = validMoneyInput(p, r);
  const left = ok ? moneyLeft({ signals, price: p, buyRate: r }) : null;
  const own = ok ? ownershipComparison(p, r) : ownershipComparison(97, 10);

  return (
    <>
      <Card className="grid gap-3">
        <SectionTitle>What are these {signals} people worth to you?</SectionTitle>
        <Meta className="m-0 text-[15px]">Your numbers, not ours. Nothing to sell yet? Enter the price you want to charge.</Meta>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="price">Your offer price (USD a month)</Label>
            <Input id="price" type="number" inputMode="decimal" min={1} placeholder="97" value={price} onChange={(e) => setPrice(e.target.value)} large />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rate">Of 100 interested people, how many buy?</Label>
            <Input id="rate" type="number" inputMode="numeric" min={1} max={100} placeholder="10" value={rate} onChange={(e) => setRate(e.target.value)} large />
          </div>
        </div>
        {left ? (
          <div className="rounded-xl bg-ink p-4 text-white" aria-live="polite">
            <div>From your last {videos} videos alone, you left on the table</div>
            <div className="text-4xl font-extrabold text-[#FF7AA0]">{formatUsd(left.monthly)} a month</div>
            <div className="text-sm opacity-85">
              {signals} buying signals x {r}% buy x {formatUsd(p)} a month.
            </div>
          </div>
        ) : (
          <Meta className="m-0 text-[15px]">Enter both numbers to see your result.</Meta>
        )}
      </Card>

      <div className={ok ? "grid gap-5" : "pointer-events-none grid gap-5 opacity-45 select-none"} aria-hidden={!ok}>
        <Card className="grid gap-3">
          <SectionTitle>Stop playing for pocket money like AdSense. Aim for real money.</SectionTitle>
          <Meta className="m-0 text-[15px]">Per 1,000 views, with the numbers you entered above.</Meta>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted p-4">
              <h3 className="m-0 text-[17px] font-bold">YouTube Parrots</h3>
              <div className="text-3xl font-extrabold">{formatUsd(own.adsense)}</div>
              <div>one-time, and only if the CPM is high</div>
              <ul className="mt-2 grid gap-1 pl-5 text-[15px]">
                <li>IF and ONLY IF the YouTube algorithm god favours your channel</li>
                <li>and you do not get banned as AI slop</li>
                <li>and GaryVee does not fart on the internet</li>
                <li>Result: low income, forever on the YouTube content treadmill. For {formatUsd(own.adsense)}?!</li>
              </ul>
            </div>
            <div className="rounded-xl border-2 border-live bg-live-50 p-4">
              <h3 className="m-0 text-[17px] font-bold">The Ownership Method</h3>
              <div className="text-3xl font-extrabold">{formatUsd(own.monthly)}</div>
              <div>every month, recurring</div>
              <ul className="mt-2 grid gap-1 pl-5 text-[15px]">
                <li>{own.leads} real subscribers or leads with an email YouTube never gives you</li>
                <li>
                  {Math.round(own.buyers * 10) / 10} buyers x {formatUsd(ok ? p : 97)} a month
                </li>
                <li>The list is yours, whatever the algorithm does</li>
              </ul>
            </div>
          </div>
          <p className="m-0 text-lg font-bold">
            {formatMultiple(own.multiple)} times the AdSense revenue. One-time versus recurring. Rented audience versus your own leads.
          </p>
          <Meta className="m-0">Example figures: 10% of 1,000 viewers become leads; your price and buying rate from above.</Meta>
        </Card>
        {children}
      </div>
    </>
  );
}
