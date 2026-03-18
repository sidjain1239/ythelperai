import ytdl from "@distube/ytdl-core";
import { fetchTranscript } from "youtube-transcript";

export const runtime = "nodejs";

const YT_PLAYER_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const TUBETEXT_ENDPOINT = "https://tubetext.vercel.app/youtube/transcript-with-timestamps";
const WORD_LIMIT = 5000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const transcriptCache = new Map();
const rateLimitStore = new Map();

function countWords(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function getClientIp(request) {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0].trim();
  }

  return request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const current = rateLimitStore.get(ip);

  if (!current || now - current.windowStart >= RATE_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return false;
  }

  if (current.count >= RATE_LIMIT_MAX) {
    return true;
  }

  current.count += 1;
  rateLimitStore.set(ip, current);
  return false;
}

function getCachedTranscript(cacheKey) {
  const value = transcriptCache.get(cacheKey);
  if (!value) return null;

  if (Date.now() > value.expiresAt) {
    transcriptCache.delete(cacheKey);
    return null;
  }

  return value.data;
}

function setCachedTranscript(cacheKey, data) {
  transcriptCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function normalizeRange(range) {
  const startSec = Number(range?.startSec);
  const endSec = Number(range?.endSec);

  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null;
  if (startSec < 0 || endSec < 0 || endSec <= startSec) return null;

  return { startSec, endSec };
}

function itemInRange(item, startSec, endSec) {
  const offsetMs = Number(item.offset ?? item.start ?? 0);
  const durationMs = Number(item.duration ?? item.dur ?? 0);

  const startItemSec = offsetMs / 1000;
  const endItemSec = (offsetMs + Math.max(0, durationMs)) / 1000;

  return endItemSec >= startSec && startItemSec <= endSec;
}

function filterByMode(transcript, mode, startSec, endSec, ranges) {
  if (mode === "full") return transcript;

  if (mode === "custom") {
    const valid = normalizeRange({ startSec, endSec });
    if (!valid) throw new Error("Invalid custom timeline. Use start < end and both >= 0.");
    return transcript.filter((item) => itemInRange(item, valid.startSec, valid.endSec));
  }

  if (mode === "selected") {
    if (!Array.isArray(ranges) || ranges.length === 0) {
      throw new Error("Selected mode needs at least one range.");
    }

    const validRanges = ranges.map(normalizeRange).filter(Boolean);
    if (!validRanges.length) {
      throw new Error("No valid ranges found. Example: 0-60 and 120-180.");
    }

    return transcript.filter((item) => validRanges.some((r) => itemInRange(item, r.startSec, r.endSec)));
  }

  throw new Error("Invalid mode. Use full, custom, or selected.");
}

function isBotBlockedError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("confirm you're not a bot") ||
    text.includes("confirm you are not a bot") ||
    text.includes("sign in to confirm")
  );
}

function isTranscriptDisabledError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("transcript is disabled") || text.includes("captions are unavailable");
}

function resolveVideoId(input) {
  const value = String(input || "").trim();
  if (!value) return null;

  if (ytdl.validateID(value)) {
    return value;
  }

  if (ytdl.validateURL(value)) {
    try {
      return ytdl.getURLVideoID(value);
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(value);
    const v = url.searchParams.get("v");
    if (v && ytdl.validateID(v)) {
      return v;
    }
  } catch {
    // Ignore invalid URL parsing.
  }

  return null;
}

function pickCaptionTrack(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return null;

  const manualEnglish = tracks.find((t) => !t.kind && t.languageCode === "en");
  if (manualEnglish) return manualEnglish;

  const anyEnglish = tracks.find((t) => String(t.languageCode || "").startsWith("en"));
  if (anyEnglish) return anyEnglish;

  const firstManual = tracks.find((t) => !t.kind);
  return firstManual || tracks[0];
}

function pickCaptionTrackByLanguage(tracks, lang) {
  if (!Array.isArray(tracks) || !tracks.length) return null;

  const normalizedLang = String(lang || "").trim().toLowerCase();
  if (!normalizedLang) {
    return pickCaptionTrack(tracks);
  }

  const exact = tracks.find((t) => String(t.languageCode || "").toLowerCase() === normalizedLang);
  if (exact) return exact;

  const startsWith = tracks.find((t) => String(t.languageCode || "").toLowerCase().startsWith(normalizedLang));
  if (startsWith) return startsWith;

  return pickCaptionTrack(tracks);
}

async function fetchPlayerDataFromYoutubei(videoId) {
  const endpoint = `https://www.youtube.com/youtubei/v1/player?key=${YT_PLAYER_API_KEY}&prettyPrint=false`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...REQUEST_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20240101.00.00",
          hl: "en",
          gl: "US",
        },
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("YouTube player endpoint request failed.");
  }

  return res.json();
}

function extractInitialPlayerResponse(html) {
  const marker = "var ytInitialPlayerResponse = ";
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const start = idx + marker.length;
  const end = html.indexOf(";</script>", start);
  if (end === -1) return null;

  const jsonText = html.slice(start, end).trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

async function fetchPlayerDataFromWatchPage(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
  const res = await fetch(url, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to load YouTube watch page.");
  }

  const html = await res.text();
  const parsed = extractInitialPlayerResponse(html);

  if (!parsed) {
    throw new Error("Could not parse YouTube player response.");
  }

  return parsed;
}

async function getCaptionTracks(videoId) {
  let playerData = null;
  let lastError = null;

  try {
    playerData = await fetchPlayerDataFromYoutubei(videoId);
  } catch (error) {
    lastError = error;
  }

  if (!playerData) {
    try {
      playerData = await fetchPlayerDataFromWatchPage(videoId);
    } catch (error) {
      lastError = error;
    }
  }

  if (!playerData) {
    throw lastError || new Error("Failed to load video player data.");
  }

  return playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

async function fetchCaptionEvents(trackUrl) {
  const url = trackUrl.includes("fmt=") ? trackUrl : `${trackUrl}&fmt=json3`;
  const res = await fetch(url, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to download caption track.");
  }

  return res.json();
}

function toTranscriptSegments(events) {
  if (!Array.isArray(events)) return [];

  return events
    .map((event) => {
      const text = Array.isArray(event?.segs)
        ? event.segs.map((seg) => seg?.utf8 || "").join("")
        : "";

      const cleaned = text.replace(/\s+/g, " ").trim();
      if (!cleaned) return null;

      return {
        text: cleaned,
        offset: Number(event?.tStartMs || 0),
        duration: Number(event?.dDurationMs || 0),
      };
    })
    .filter(Boolean);
}

function toSecondsFromTimestampText(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(?:(\d+):)?([0-5]?\d):([0-5]\d)$/);
  if (!match) return null;

  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  return (h * 3600) + (m * 60) + s;
}

function parseTubeTextLine(line) {
  const text = String(line || "").trim();
  if (!text) return null;

  // Supports formats like "00:12 Intro", "1:02:13 - Segment"
  const match = text.match(/^(?:(\d+):)?([0-5]?\d):([0-5]\d)\s*(?:[-|:])?\s*(.*)$/);
  if (!match) {
    return { text, offset: null };
  }

  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  const body = String(match[4] || "").trim() || text;
  const offset = ((h * 3600) + (m * 60) + s) * 1000;
  return { text: body, offset };
}

function segmentsFromTubeTextEntries(entries) {
  if (!Array.isArray(entries)) return [];

  const parsed = entries
    .map((item, idx) => {
      if (typeof item === "string") {
        const result = parseTubeTextLine(item);
        if (!result) return null;
        return {
          text: result.text,
          offset: Number.isFinite(result.offset) ? result.offset : idx * 4000,
          duration: 0,
        };
      }

      if (item && typeof item === "object") {
        const text = String(item.text || item.value || item.line || "").trim();
        if (!text) return null;

        let offsetMs = null;
        if (Number.isFinite(Number(item.offset))) {
          offsetMs = Number(item.offset);
        } else if (Number.isFinite(Number(item.start))) {
          offsetMs = Number(item.start);
        } else {
          const timestampSec = toSecondsFromTimestampText(item.timestamp || item.time || "");
          if (Number.isFinite(timestampSec)) {
            offsetMs = timestampSec * 1000;
          }
        }

        return {
          text,
          offset: Number.isFinite(offsetMs) ? offsetMs : idx * 4000,
          duration: Number(item.duration ?? item.dur ?? 0) || 0,
        };
      }

      return null;
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.offset || 0) - Number(b.offset || 0));

  return parsed;
}

async function fetchTranscriptFromTubeText(videoId, lang) {
  const query = new URLSearchParams({ video_id: videoId });
  if (lang) {
    query.set("lang", String(lang));
  }

  const res = await fetch(`${TUBETEXT_ENDPOINT}?${query.toString()}`, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Tubetext fallback request failed (${res.status}).`);
  }

  const data = await res.json();
  if (!data?.success || !data?.data) {
    throw new Error("Tubetext fallback returned invalid payload.");
  }

  const rawEntries = Array.isArray(data.data.transcript) ? data.data.transcript : [];
  let transcript = segmentsFromTubeTextEntries(rawEntries);

  if (!transcript.length && data?.data?.full_text) {
    transcript = [{ text: String(data.data.full_text).trim(), offset: 0, duration: 0 }].filter((x) => x.text);
  }

  if (!transcript.length) {
    throw new Error("Tubetext fallback has no transcript text.");
  }

  return {
    transcript,
    languageCode: String(lang || "unknown"),
    details: data.data.details || null,
  };
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#10;/g, " ")
    .replace(/&#13;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseXmlAttributes(raw) {
  const attrs = {};
  const regex = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
  let match = regex.exec(raw);

  while (match) {
    attrs[match[1]] = match[2];
    match = regex.exec(raw);
  }

  return attrs;
}

function pickTimedtextTrack(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return null;

  const manualEnglish = tracks.find((t) => !t.kind && t.lang_code === "en");
  if (manualEnglish) return manualEnglish;

  const anyEnglish = tracks.find((t) => String(t.lang_code || "").startsWith("en"));
  if (anyEnglish) return anyEnglish;

  const firstManual = tracks.find((t) => !t.kind);
  return firstManual || tracks[0];
}

function pickTimedtextTrackByLanguage(tracks, lang) {
  if (!Array.isArray(tracks) || !tracks.length) return null;

  const normalizedLang = String(lang || "").trim().toLowerCase();
  if (!normalizedLang) {
    return pickTimedtextTrack(tracks);
  }

  const exact = tracks.find((t) => String(t.lang_code || "").toLowerCase() === normalizedLang);
  if (exact) return exact;

  const startsWith = tracks.find((t) => String(t.lang_code || "").toLowerCase().startsWith(normalizedLang));
  if (startsWith) return startsWith;

  return pickTimedtextTrack(tracks);
}

async function fetchTimedtextTranscript(videoId, lang) {
  const listUrl = `https://video.google.com/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
  const listRes = await fetch(listUrl, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
  });

  if (!listRes.ok) {
    throw new Error("Timedtext track list request failed.");
  }

  const listXml = await listRes.text();
  const trackMatches = [...listXml.matchAll(/<track\s+([^>]+?)\s*\/?>(?:<\/track>)?/g)];
  const tracks = trackMatches.map((m) => parseXmlAttributes(m[1] || ""));
  const selected = pickTimedtextTrackByLanguage(tracks, lang);

  if (!selected?.lang_code) {
    throw new Error("Captions are unavailable for this video.");
  }

  const params = new URLSearchParams({
    v: videoId,
    lang: selected.lang_code,
  });

  if (selected.name) params.set("name", selected.name);
  if (selected.kind) params.set("kind", selected.kind);

  const timedtextUrl = `https://www.youtube.com/api/timedtext?${params.toString()}`;
  const textRes = await fetch(timedtextUrl, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
  });

  if (!textRes.ok) {
    throw new Error("Timedtext transcript request failed.");
  }

  const textXml = await textRes.text();
  const textMatches = [...textXml.matchAll(/<text\s+([^>]+)>([\s\S]*?)<\/text>/g)];

  const transcript = textMatches
    .map((m) => {
      const attrs = parseXmlAttributes(m[1] || "");
      const start = Number(attrs.start || 0);
      const dur = Number(attrs.dur || 0);
      const text = decodeXmlText(m[2] || "");

      if (!text) return null;

      return {
        text,
        offset: start * 1000,
        duration: dur * 1000,
      };
    })
    .filter(Boolean);

  if (!transcript.length) {
    throw new Error("No transcript text found for this video.");
  }

  return {
    transcript,
    languageCode: selected.lang_code || "unknown",
  };
}

async function fetchTranscriptWithFallback(ytLink, lang) {
  const videoId = resolveVideoId(ytLink);
  if (!videoId) {
    throw new Error("Invalid YouTube URL.");
  }

  // Keep library-based extraction first because it is often the most stable in local dev.
  try {
    const transcript = await fetchTranscript(`https://www.youtube.com/watch?v=${videoId}`);
    if (Array.isArray(transcript) && transcript.length) {
      return {
        transcript,
        videoId,
        languageCode: String(lang || "unknown"),
        provider: "youtube-transcript",
      };
    }
  } catch {
    // Continue with custom endpoint fallbacks below.
  }

  let primaryError = null;
  try {
    const tracks = await getCaptionTracks(videoId);
    const selectedTrack = pickCaptionTrackByLanguage(tracks, lang);

    if (!selectedTrack?.baseUrl) {
      throw new Error("Captions are unavailable for this video.");
    }

    const captionData = await fetchCaptionEvents(selectedTrack.baseUrl);
    const transcript = toTranscriptSegments(captionData?.events || []);

    if (!transcript.length) {
      throw new Error("No transcript text found for this video.");
    }

    return {
      transcript,
      videoId,
      languageCode: selectedTrack.languageCode || "unknown",
    };
  } catch (error) {
    primaryError = error;
  }

  try {
    const timedtextData = await fetchTimedtextTranscript(videoId, lang);
    return {
      transcript: timedtextData.transcript,
      videoId,
      languageCode: timedtextData.languageCode,
    };
  } catch {
    // Continue to provider fallback.
  }

  try {
    const tubeTextData = await fetchTranscriptFromTubeText(videoId, lang);
    return {
      transcript: tubeTextData.transcript,
      videoId,
      languageCode: tubeTextData.languageCode,
      provider: "tubetext",
    };
  } catch {
    throw primaryError || new Error("Failed to fetch transcript");
  }
}

function mapTranscriptError(error) {
  if (isBotBlockedError(error?.message)) {
    return {
      status: 403,
      body: {
        error:
          "Sign in to confirm you're not a bot. YouTube blocked transcript access from this server. Please retry later or use another video.",
      },
    };
  }

  if (isTranscriptDisabledError(error?.message)) {
    return {
      status: 422,
      body: {
        error:
          "Captions are unavailable for this video right now. Try another public-caption video or retry later.",
      },
    };
  }

  if (String(error?.message || "").toLowerCase().includes("invalid youtube url")) {
    return {
      status: 400,
      body: { error: "Invalid YouTube video or videoId." },
    };
  }

  return {
    status: 500,
    body: { error: error?.message || "Failed to fetch transcript" },
  };
}

export async function GET(request) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return Response.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("videoId");
    const lang = searchParams.get("lang") || "en";

    if (!videoId) {
      return Response.json({ error: "videoId is required." }, { status: 400 });
    }

    const ytLink = `https://www.youtube.com/watch?v=${videoId}`;
    const cacheKey = `${videoId}:${lang}`;
    const cached = getCachedTranscript(cacheKey);

    if (cached) {
      return Response.json({ ...cached, cached: true });
    }

    const { transcript, languageCode } = await fetchTranscriptWithFallback(ytLink, lang);
    const combinedText = transcript.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
    const wordCount = countWords(combinedText);

    const response = {
      videoId,
      languageCode,
      transcript: combinedText,
      segments: transcript.length,
      wordCount,
      cached: false,
    };

    setCachedTranscript(cacheKey, response);
    return Response.json(response);
  } catch (error) {
    const mapped = mapTranscriptError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return Response.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  try {
    const { ytLink, mode = "full", startSec, endSec, ranges, lang = "en", enforceLimit = true } = await request.json();

    if (!ytLink) {
      return Response.json({ error: "ytLink is required." }, { status: 400 });
    }

    const { transcript, videoId, languageCode } = await fetchTranscriptWithFallback(ytLink, lang);
    const filtered = filterByMode(transcript, mode, startSec, endSec, ranges);
    const combinedText = filtered.map((item) => item.text).join(" ").trim();
    const wordCount = countWords(combinedText);

    if (enforceLimit && wordCount > WORD_LIMIT) {
      return Response.json(
        {
          error: `This much can't be handled. Transcript has ${wordCount} words, limit is ${WORD_LIMIT}.`,
          wordCount,
          limit: WORD_LIMIT,
        },
        { status: 413 }
      );
    }

    return Response.json({
      transcript: combinedText,
      wordCount,
      limit: WORD_LIMIT,
      segments: filtered.length,
      videoId,
      languageCode,
    });
  } catch (error) {
    const mapped = mapTranscriptError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}
