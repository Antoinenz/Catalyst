// Helpers for the "Custom yt-dlp arguments" field in Settings → Advanced:
// a curated set of one-click flags, and light client-side validation
// (balanced quotes + typo suggestions against a known-flag list). This is a
// convenience layer only — the authoritative parser is shell_split() in
// src-tauri/src/config.rs, which is what actually runs the arguments.

/** Quote-aware tokenizer mirroring the Rust shell_split() in config.rs, so
 *  chip add/remove and validation agree with how the backend will parse the
 *  same text. Not a full shell parser: no escaping inside quotes. */
export function shellSplit(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let hasToken = false;
  for (const c of s) {
    if (c === "'" && !inDouble) { inSingle = !inSingle; hasToken = true; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; hasToken = true; continue; }
    if (/\s/.test(c) && !inSingle && !inDouble) {
      if (hasToken) { out.push(cur); cur = ""; hasToken = false; }
      continue;
    }
    cur += c;
    hasToken = true;
  }
  if (hasToken) out.push(cur);
  return out;
}

function quoteIfNeeded(tok: string): string {
  return /\s/.test(tok) ? `"${tok}"` : tok;
}

export interface QuickArg {
  label: string;
  flag: string;
  takesValue: boolean;
  defaultValue?: string;
  hint: string;
}

/** A curated set of common, genuinely useful yt-dlp flags — not exhaustive
 *  (yt-dlp has hundreds), just the ones people actually reach for often
 *  enough to be worth a one-click toggle instead of typing from scratch. */
export const QUICK_ARGS: QuickArg[] = [
  { label: "Limit speed", flag: "--limit-rate", takesValue: true, defaultValue: "2M",
    hint: "Cap download speed, e.g. 2M = 2 MB/s" },
  { label: "Embed thumbnail", flag: "--embed-thumbnail", takesValue: false,
    hint: "Embed the thumbnail into the downloaded file" },
  { label: "Embed metadata", flag: "--embed-metadata", takesValue: false,
    hint: "Embed title/uploader/etc. metadata into the file" },
  { label: "Download subtitles", flag: "--write-subs", takesValue: false,
    hint: "Download subtitles alongside the video, if available" },
  { label: "Auto subtitles", flag: "--write-auto-subs", takesValue: false,
    hint: "Download auto-generated subtitles if no manual ones exist" },
  { label: "Skip sponsors", flag: "--sponsorblock-remove", takesValue: true, defaultValue: "all",
    hint: "Cut sponsor/self-promo segments (YouTube, via SponsorBlock)" },
  { label: "Parallel fragments", flag: "--concurrent-fragments", takesValue: true, defaultValue: "4",
    hint: "Download fragments of one file in parallel — faster on fast connections" },
  { label: "Retry more", flag: "--retries", takesValue: true, defaultValue: "10",
    hint: "Retry a failed request more times before giving up" },
  { label: "Bypass geo-block", flag: "--geo-bypass", takesValue: false,
    hint: "Try to work around region restrictions" },
  { label: "Ignore cert errors", flag: "--no-check-certificate", takesValue: false,
    hint: "Skip SSL certificate validation — only if you know why you need this" },
  { label: "Use download time", flag: "--no-mtime", takesValue: false,
    hint: "Use download time as the file's date instead of the video's upload date" },
];

export function isQuickArgActive(text: string, arg: QuickArg): boolean {
  return shellSplit(text).includes(arg.flag);
}

/** Add the flag (with its default value, if any) if not present; remove it
 *  (and its value token) if it is. */
export function toggleQuickArg(text: string, arg: QuickArg): string {
  const tokens = shellSplit(text);
  const idx = tokens.indexOf(arg.flag);
  if (idx !== -1) {
    const removeCount = arg.takesValue && tokens[idx + 1] !== undefined ? 2 : 1;
    tokens.splice(idx, removeCount);
  } else {
    tokens.push(arg.flag);
    if (arg.takesValue && arg.defaultValue) tokens.push(arg.defaultValue);
  }
  return tokens.map(quoteIfNeeded).join(" ");
}

/** Common yt-dlp flags, for typo suggestions — not exhaustive. A token that
 *  looks like a flag but isn't close to anything here just isn't flagged;
 *  this only ever suggests, never blocks. */
export const KNOWN_YTDLP_FLAGS: string[] = [
  "--proxy", "--socket-timeout", "--source-address", "--force-ipv4", "--force-ipv6", "-4", "-6",
  "--limit-rate", "--throttled-rate", "--retries", "-R", "--fragment-retries", "--retry-sleep",
  "--no-check-certificate", "--prefer-insecure",
  "--geo-bypass", "--geo-bypass-country", "--geo-bypass-ip-block", "--geo-verification-proxy",
  "--playlist-items", "--no-playlist", "--yes-playlist", "--max-downloads",
  "--min-filesize", "--max-filesize", "--download-archive",
  "--no-continue", "--continue", "--no-part", "--part",
  "--concurrent-fragments", "-N", "--abort-on-error", "--ignore-errors",
  "--output", "-o", "--output-na-placeholder", "--restrict-filenames", "--windows-filenames",
  "--no-overwrites", "--force-overwrites", "--write-description", "--write-info-json",
  "--write-comments", "--load-info-json", "--cookies", "--cookies-from-browser", "--no-cookies",
  "--write-thumbnail", "--embed-thumbnail", "--write-subs", "--write-auto-subs",
  "--sub-langs", "--sub-format", "--embed-subs", "--convert-subs", "--convert-thumbnails",
  "--embed-metadata", "--add-metadata", "--embed-chapters", "--embed-info-json", "--parse-metadata",
  "--xattrs", "--sponsorblock-mark", "--sponsorblock-remove", "--sponsorblock-api",
  "--extract-audio", "-x", "--audio-format", "--audio-quality", "--remux-video", "--recode-video",
  "--postprocessor-args", "--ffmpeg-location",
  "--format", "-f", "--format-sort", "--format-sort-force",
  "--video-multistreams", "--audio-multistreams", "--merge-output-format",
  "--username", "-u", "--password", "-p", "--video-password", "--user-agent", "--referer",
  "--impersonate", "--no-impersonate", "--add-header",
  "--quiet", "-q", "--no-warnings", "--verbose", "-v", "--print", "--no-mtime", "--no-progress",
  "--newline", "--no-playlist-reverse", "--playlist-random", "--date", "--datebefore", "--dateafter",
];

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export interface ArgSuggestion { token: string; suggestion: string; }

export interface CustomArgsValidation {
  /** Set if there's an odd number of that quote character — likely a
   *  missing closing quote somewhere in the field. */
  unbalancedQuote: '"' | "'" | null;
  suggestions: ArgSuggestion[];
}

/** Live validation for the custom-args field: balanced quotes, and
 *  close-but-not-exact flag names that are probably typos. Advisory only —
 *  never blocks saving, just surfaces a "did you mean" a user can accept or
 *  ignore. Skipped entirely while quotes are unbalanced, since shellSplit's
 *  tokenization can't be trusted until that's fixed. */
export function validateCustomArgs(text: string): CustomArgsValidation {
  const doubleCount = (text.match(/"/g) ?? []).length;
  const singleCount = (text.match(/'/g) ?? []).length;
  const unbalancedQuote = doubleCount % 2 !== 0 ? '"' : singleCount % 2 !== 0 ? "'" : null;
  if (unbalancedQuote) return { unbalancedQuote, suggestions: [] };

  const suggestions: ArgSuggestion[] = [];
  for (const tok of shellSplit(text)) {
    if (!tok.startsWith("-") || tok.length < 3 || KNOWN_YTDLP_FLAGS.includes(tok)) continue;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const known of KNOWN_YTDLP_FLAGS) {
      const d = levenshtein(tok, known);
      if (d < bestDist) { bestDist = d; best = known; }
    }
    if (best && bestDist > 0 && bestDist <= 2) suggestions.push({ token: tok, suggestion: best });
  }
  return { unbalancedQuote: null, suggestions };
}

/** Replace the first occurrence of `token` with `suggestion` in the raw
 *  text (not the rejoined token list, to preserve the user's original
 *  spacing/quoting everywhere else). */
export function applySuggestion(text: string, s: ArgSuggestion): string {
  const idx = text.indexOf(s.token);
  if (idx === -1) return text;
  return text.slice(0, idx) + s.suggestion + text.slice(idx + s.token.length);
}
