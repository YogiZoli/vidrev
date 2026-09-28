// Settings menu: small logical groups, a few pages each. Used by the Settings
// dropdown in the top tabs and the side menu on Settings pages.
export type SettingsLink = { href: string; label: string };
export type SettingsGroup = { label: string; links: SettingsLink[] };

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Account",
    links: [
      { href: "/app/settings", label: "Account" },
      { href: "/app/settings/billing", label: "Billing and cancel" },
    ],
  },
  {
    label: "Connections",
    links: [
      { href: "/app/settings/youtube", label: "YouTube channel" },
      { href: "/app/settings/integrations", label: "Integrations" },
    ],
  },
  {
    label: "Links",
    links: [{ href: "/app/settings/domain", label: "Linked domain" }],
  },
];
