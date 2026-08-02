import { useRef, useState } from "react";
import { ScanLine } from "lucide-react";

export interface BarcodeScanInputProps {
  onScan: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * A scan-to-fill input (Milestone 16) — a keyboard-wedge USB/Bluetooth
 * barcode scanner types the scanned value then sends Enter, exactly like a
 * very fast typist; a phone camera scanner app behaves the same way once
 * paired as a keyboard input. This component just needs to catch that Enter
 * and hand the accumulated value to the caller — no scanner-specific SDK
 * or camera access required.
 */
export function BarcodeScanInput({
  onScan,
  disabled = false,
  placeholder = "Scan or type a barcode…",
}: BarcodeScanInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onScan(trimmed);
    setValue("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-page px-2 py-1.5">
      <ScanLine aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted disabled:opacity-50"
      />
    </div>
  );
}
