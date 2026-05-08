export function getFirstValue(value) {
  return Array.isArray(value)
    ? (value[0]?.name || value[0] || "").toString().trim()
    : (value?.name || value || "").toString().trim();
}

export function getSelectName(value) {
  if (!value) return null;
  if (typeof value === "object" && "name" in value) return value.name;
  if (typeof value === "string") return value;
  return null;
}

export function getNumber(value) {
  if (typeof value === "number") return value;

  if (Array.isArray(value) && value.length) {
    return getNumber(value[0]);
  }

  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

export function getLinkedId(value) {
  if (!value) return null;

  if (Array.isArray(value) && value.length) {
    const first = value[0];

    if (typeof first === "object" && first?.id) {
      return first.id;
    }

    if (typeof first === "string") {
      return first;
    }
  }

  if (typeof value === "object" && value?.id) {
    return value.id;
  }

  return null;
}

export function hasLinkedRecord(value) {
  return Array.isArray(value) && value.length > 0;
}

export function parseVatFraction(value) {
  if (value == null) return null;

  const cleaned = String(value)
    .toLowerCase()
    .replace(/[^\d.,-]/g, "")
    .replace(",", ".");

  if (!cleaned) return null;

  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;

  return n >= 1 ? n / 100 : n;
}
