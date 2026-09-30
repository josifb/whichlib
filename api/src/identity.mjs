// Who is calling, without storing who is calling: the daily user id is
// SHA-256(ip | IP_SALT | UTC day), so ids cannot be linked across days and
// the raw IP never leaves the request.

const DAY_MS = 86_400_000;

export function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Epoch ms of the next UTC midnight (when the daily counter resets). */
export function nextUtcMidnight(nowMs) {
  return (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function userHash(ip, salt, day) {
  return sha256Hex(`${ip}|${salt}|${day}`);
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
