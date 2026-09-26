export { Notice } from "@/components/ui/notice";

export function productName(): string {
  return process.env.PRODUCT_NAME ?? "vidrev";
}
