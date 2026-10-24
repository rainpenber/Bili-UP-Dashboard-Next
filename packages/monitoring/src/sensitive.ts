const SECRET_PATTERNS: readonly RegExp[] = [
  /SESSDATA=[^;\s&"]*/gi,
  /bili_jct=[^;\s&"]*/gi,
  /DedeUserID__ckMd5=[^;\s&"]*/gi,
  /COLLECTOR_SECRET_KEY[=:][^\s]*/gi,
];

export function scrubSensitive(value: string): string {
  let text = value;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match) => {
      const eq = match.indexOf('=');
      const colon = match.indexOf(':');
      const splitAt = eq >= 0 ? eq : colon;
      const name = splitAt >= 0 ? match.slice(0, splitAt) : match;
      return `${name}=redacted`;
    });
  }
  return text;
}
