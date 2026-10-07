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
      // The free audit has its own page (DECISIONS A-18); links on the GHL landing and in sent emails keep working.
      { source: "/audit", destination: "/where-i-lose-money-on-youtube", permanent: false },
      { source: "/audit/:path*", destination: "/where-i-lose-money-on-youtube/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
