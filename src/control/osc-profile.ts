export interface OscConnectionProfile {
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

export function createOscConnectionUri(profile: OscConnectionProfile) {
  if (!profile.host.trim()) throw new Error("OSC host is required");
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65_535) throw new Error("OSC port is invalid");
  if (!profile.token.trim()) throw new Error("OSC token is required");
  const query = new URLSearchParams({ host: profile.host.trim(), port: String(profile.port), token: profile.token, tokenArg: "first" });
  return `playback-v3://osc?${query}`;
}
