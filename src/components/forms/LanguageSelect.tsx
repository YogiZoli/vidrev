import { Select } from "@/components/ui/input";
import { LANGUAGE_OPTIONS } from "@/lib/language";

// The reply languages a creator can choose (templates, default language).
export function LanguageSelect({ name, value, label }: { name: string; value?: string | null; label?: string }) {
  return (
    <Select name={name} defaultValue={value ?? "en"} aria-label={label}>
      {LANGUAGE_OPTIONS.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </Select>
  );
}
