export const dynamic = "force-dynamic";

export default function HomePage() {
  const productName = process.env.PRODUCT_NAME ?? "ProductName";
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 16px" }}>
      <h1>{productName}</h1>
      <p>See which video makes money from your comments.</p>
      <p style={{ color: "#666" }}>Private beta. Not open yet.</p>
      <p>
        <a href="/login">Sign in</a>
      </p>
    </main>
  );
}
