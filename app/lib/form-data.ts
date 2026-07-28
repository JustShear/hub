// FormData.get() returns FormDataEntryValue | null (string | File | null) —
// this rejects a File value as empty rather than stringifying it to
// "[object File]", which String(x ?? "") would silently do.
export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Returns null if the field is absent/empty — useful for "optional date" style inputs. */
export function formStringOrNull(formData: FormData, key: string): string | null {
  const value = formString(formData, key);
  return value.length > 0 ? value : null;
}
