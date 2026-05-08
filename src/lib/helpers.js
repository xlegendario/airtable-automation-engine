export function getFirstValue(value) {
  return Array.isArray(value)
    ? (value[0] || "").toString().trim()
    : (value || "").toString().trim();
}
