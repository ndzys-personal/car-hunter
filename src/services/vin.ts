/** Normalize and validate the VIN format used for vehicle identity. */
export function normalizeVin(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[\s-]+/g, '');
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(normalized) ? normalized : null;
}
