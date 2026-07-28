/** Trims a possibly-null/undefined string, collapsing an empty result to null. */
export function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}
