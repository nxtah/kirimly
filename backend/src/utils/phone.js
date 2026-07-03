/**
 * Phone number normalizer for Indonesian numbers.
 * Input: any format (0812xxx, +62812xxx, 62812xxx, 0812-xxx)
 * Output: 62xxxxxxxxx (digits only, without leading +)
 */
function normalizePhone(input) {
  if (!input) return null;

  // Strip everything except digits
  let cleaned = input.replace(/[^\d]/g, '');

  // Handle leading 0 → 62
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  }

  // Minimal length check (62 + at least 8 digits)
  if (cleaned.length < 10 || cleaned.length > 15) return null;

  return cleaned;
}

function isValidPhone(input) {
  return normalizePhone(input) !== null;
}

module.exports = { normalizePhone, isValidPhone };
