/** Form validation used by auth and every data-entry module. */

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function isUsername(value) {
  return /^[a-zA-Z0-9._-]{3,24}$/.test(String(value || '').trim());
}

export function passwordIssues(password) {
  const pw = String(password || '');
  const issues = [];
  if (pw.length < 8) issues.push('at least 8 characters');
  if (!/[a-z]/.test(pw)) issues.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) issues.push('an uppercase letter');
  if (!/[0-9]/.test(pw)) issues.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push('a symbol');
  return issues;
}

/** 0–4 score for the strength meter. */
export function passwordScore(password) {
  const pw = String(password || '');
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return score;
}

export function passwordLabel(score) {
  return ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][score] || 'Too weak';
}

export function requiredText(value) {
  return String(value ?? '').trim();
}

export function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function nonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}
