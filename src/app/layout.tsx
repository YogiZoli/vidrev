import type { Metadata } from "next";
import type { ReactNode } from "react";

export function generateMetadata(): Metadata {
  return { title: process.env.PRODUCT_NAME ?? "ProductName" };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
