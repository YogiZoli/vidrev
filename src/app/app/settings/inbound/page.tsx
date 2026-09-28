import { CopyMono } from "@/components/motion/CopyButton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { appBaseUrl, requireEnv } from "@/lib/env";
import { requireSession } from "@/server/auth/current";
import { ensureHookToken } from "@/server/integrations/inbound";
import { Notice } from "../../../ui";
import { Mono } from "../_integrations";

export const dynamic = "force-dynamic";

export default async function InboundSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const hookToken = await ensureHookToken(getDb(), requireEnv("ENCRYPTION_KEY"), account.id);

  return (
    <Page width="md">
      <PageHeader title="Inbound endpoints" lead="For a form tool or checkout outside GoHighLevel and Stripe." />
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}

      <Card className="grid gap-3">
        <SectionTitle>Send us subscribers and buyers</SectionTitle>
        <Meta className="text-[15px]">
          Any form tool, checkout, Zapier, Make or n8n can tell us when someone opts in or buys. That is how a comment turns into a subscriber, a
          buyer and revenue. Send a <Mono>POST</Mono> with your token:
        </Meta>
        <TableWrap>
          <Table>
            <tbody>
              <tr>
                <Th>Subscriber</Th>
                <Td>
                  <CopyMono text={`${appBaseUrl()}/api/hooks/optin`} />
                </Td>
              </tr>
              <tr>
                <Th>Buyer</Th>
                <Td>
                  <CopyMono text={`${appBaseUrl()}/api/hooks/purchase`} />
                </Td>
              </tr>
              <tr>
                <Th>Token</Th>
                <Td>
                  <CopyMono text={hookToken} />
                </Td>
              </tr>
            </tbody>
          </Table>
        </TableWrap>
        <Meta>
          Send the token as <Mono>Authorization: Bearer &lt;token&gt;</Mono>, as <Mono>X-Hook-Token</Mono>, or, if your tool cannot set headers, as{" "}
          <Mono>?token=</Mono> at the end of the URL. JSON and form posts both work.
          <br />
          Subscriber fields: <Mono>email</Mono> (required), <Mono>c2c_tid</Mono> (the hidden field on your form), <Mono>name</Mono>, <Mono>consent_marketing</Mono>. Buyer
          fields: <Mono>email</Mono> or <Mono>c2c_tid</Mono>, <Mono>external_id</Mono> (order id, required), <Mono>amount</Mono> and <Mono>currency</Mono>,{" "}
          <Mono>subscription_id</Mono>, <Mono>refunded_amount</Mono>. Sending the same order again is safe.
        </Meta>
        <form method="post" action="/api/integrations">
          <input type="hidden" name="action" value="hook_rotate" />
          <Button type="submit" variant="outline" size="sm">
            New token
          </Button>
        </form>
        {params.hook_rotated ? <Notice tone="info">New token created. The old one no longer works; update it where you use it.</Notice> : null}
      </Card>
    </Page>
  );
}
