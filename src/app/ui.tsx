import type { CSSProperties } from "react";

// Shared inline styles for pages not yet moved to the components in
// src/components/ui. They read the brand tokens (globals.css), so every page
// already follows the design system.
export const styles = {
  main: { maxWidth: 720, margin: "0 auto", padding: "40px var(--gutter-mobile)" } satisfies CSSProperties,
  card: { border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20, margin: "16px 0", background: "var(--surface)", boxShadow: "var(--shadow-xs)" } satisfies CSSProperties,
  input: {
    padding: "12px 16px", minHeight: 44, fontSize: "var(--text-base)", fontFamily: "inherit", border: "1px solid var(--input)", borderRadius: "var(--radius-md)",
    background: "var(--surface)", color: "var(--foreground)", width: "100%", boxSizing: "border-box",
  } satisfies CSSProperties,
  button: {
    padding: "12px 24px", minHeight: 44, fontSize: "var(--text-base)", fontFamily: "inherit", fontWeight: 600, border: 0, borderRadius: "var(--radius-md)",
    background: "var(--primary)", color: "var(--primary-foreground)", cursor: "pointer", boxShadow: "var(--shadow-sm)",
  } satisfies CSSProperties,
  secondary: {
    padding: "8px 16px", minHeight: 40, fontSize: "var(--text-sm)", fontFamily: "inherit", fontWeight: 600, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)",
    background: "var(--surface)", color: "var(--foreground)", cursor: "pointer",
  } satisfies CSSProperties,
  muted: { color: "var(--muted-foreground)" } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" } satisfies CSSProperties,
  cell: { borderBottom: "1px solid var(--border)", padding: "8px 6px", textAlign: "left", verticalAlign: "top" } satisfies CSSProperties,
};

export { Notice } from "@/components/ui/notice";

export function productName(): string {
  return process.env.PRODUCT_NAME ?? "ProductName";
}
