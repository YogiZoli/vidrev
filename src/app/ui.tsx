import type { CSSProperties, ReactNode } from "react";

// Minimal shared styles until the design system lands in the app.
export const styles = {
  main: { maxWidth: 720, margin: "0 auto", padding: "48px 16px" } satisfies CSSProperties,
  card: { border: "1px solid #ddd", borderRadius: 8, padding: 20, margin: "16px 0" } satisfies CSSProperties,
  input: { padding: "10px 12px", fontSize: 15, border: "1px solid #bbb", borderRadius: 6, width: "100%", boxSizing: "border-box" } satisfies CSSProperties,
  button: { padding: "10px 16px", fontSize: 15, border: 0, borderRadius: 6, background: "#111", color: "#fff", cursor: "pointer" } satisfies CSSProperties,
  secondary: { padding: "8px 12px", fontSize: 14, border: "1px solid #bbb", borderRadius: 6, background: "#fff", color: "#111", cursor: "pointer" } satisfies CSSProperties,
  muted: { color: "#666" } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 } satisfies CSSProperties,
  cell: { borderBottom: "1px solid #eee", padding: "8px 6px", textAlign: "left", verticalAlign: "top" } satisfies CSSProperties,
};

export function Notice({ tone, children }: { tone: "info" | "error"; children: ReactNode }) {
  const color = tone === "error" ? { background: "#fdecec", borderColor: "#f3b5b5" } : { background: "#eef6ee", borderColor: "#b9dcb9" };
  return <p style={{ ...styles.card, ...color, padding: 12 }}>{children}</p>;
}

export function productName(): string {
  return process.env.PRODUCT_NAME ?? "ProductName";
}
