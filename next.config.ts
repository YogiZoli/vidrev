import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Old app paths stay valid for bookmarks and emails already sent.
  async redirects() {
    return [
      { source: "/app/queue", destination: "/app", permanent: false },
      { source: "/app/integrations", destination: "/app/settings/integrations", permanent: false },
      { source: "/app/domain", destination: "/app/settings/domain", permanent: false },
      { source: "/app/cancel", destination: "/app/settings/billing", permanent: false },
    ];
  },
};

export default nextConfig;
