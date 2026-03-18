import ytdl from "@distube/ytdl-core";

export const runtime = "nodejs";

const YT_PLAYER_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const WORD_LIMIT = 5000;
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

function countWords(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
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

async function fetchTimedtextTranscript(videoId) {
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
  const selected = pickTimedtextTrack(tracks);

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

  return transcript;
}

async function fetchTranscriptWithFallback(ytLink) {
  const videoId = resolveVideoId(ytLink);
  if (!videoId) {
    throw new Error("Invalid YouTube URL.");
  }

  let primaryError = null;
  try {
    const tracks = await getCaptionTracks(videoId);
    const selectedTrack = pickCaptionTrack(tracks);

    if (!selectedTrack?.baseUrl) {
      throw new Error("Captions are unavailable for this video.");
    }

    const captionData = await fetchCaptionEvents(selectedTrack.baseUrl);
    const transcript = toTranscriptSegments(captionData?.events || []);

    if (!transcript.length) {
      throw new Error("No transcript text found for this video.");
    }

    return { transcript, videoId };
  } catch (error) {
    primaryError = error;
  }

  try {
    const transcript = await fetchTimedtextTranscript(videoId);
    return { transcript, videoId };
  } catch {
    throw primaryError || new Error("Failed to fetch transcript");
  }
}

export async function POST(request) {
  try {
    const { ytLink, mode = "full", startSec, endSec, ranges } = await request.json();

    if (!ytLink) {
      return Response.json({ error: "ytLink is required." }, { status: 400 });
    }

    const { transcript, videoId } = await fetchTranscriptWithFallback(ytLink);
    const filtered = filterByMode(transcript, mode, startSec, endSec, ranges);
    const combinedText = filtered.map((item) => item.text).join(" ").trim();
    const wordCount = countWords(combinedText);

    if (wordCount > WORD_LIMIT) {
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
    });
  } catch (error) {
    if (isBotBlockedError(error?.message)) {
      return Response.json(
        {
          error:
            "YouTube blocked transcript access on this server (bot-check). Please try another video with public captions or try again later.",
        },
        { status: 403 }
      );
    }

    if (isTranscriptDisabledError(error?.message)) {
      return Response.json(
        {
          error:
            "Captions are unavailable for this video on the deployed server. If it works locally, this is usually region/cookie/bot-policy related on hosting. Try another public-caption video or retry later.",
        },
        { status: 422 }
      );
    }

    return Response.json(
      { error: error?.message || "Failed to fetch transcript" },
      { status: 500 }
    );
  }
}
