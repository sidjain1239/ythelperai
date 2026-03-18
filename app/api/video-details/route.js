import ytdl from "@distube/ytdl-core";

export const runtime = "nodejs";
const TUBETEXT_ENDPOINT = "https://tubetext.vercel.app/youtube/transcript-with-timestamps";

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

function formatDuration(totalSeconds) {
  const sec = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);

  if (h > 0) {
    return String(h) + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  return String(m) + ":" + String(s).padStart(2, "0");
}

function normalizeChapters(rawChapters, durationSec) {
  if (!Array.isArray(rawChapters)) return [];

  const cleaned = rawChapters
    .map((ch, idx) => {
      const startSec = Number(
        ch?.start_time ??
        ch?.startTime ??
        ch?.start_time_seconds ??
        ((Number(ch?.start_time_ms) || 0) / 1000)
      );

      const title = ch?.title?.simpleText || ch?.title || ("Chapter " + String(idx + 1));

      return {
        title,
        startSec: Number.isFinite(startSec) ? Math.max(0, Math.floor(startSec)) : null,
      };
    })
    .filter((c) => c.startSec !== null)
    .sort((a, b) => a.startSec - b.startSec);

  return cleaned.map((c, i) => {
    const nextStart = cleaned[i + 1]?.startSec;
    const endSec = Number.isFinite(nextStart) ? Math.max(c.startSec, nextStart - 1) : durationSec;
    return { ...c, endSec };
  });
}

function isBotBlockedError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("confirm you're not a bot") ||
    text.includes("confirm you are not a bot") ||
    text.includes("sign in to confirm")
  );
}

function decodeEscapedText(value) {
  return String(value || "")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseTimestampToSeconds(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(?:(\d+):)?([0-5]?\d):([0-5]\d)$/);
  if (!match) return null;

  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  return (h * 3600) + (m * 60) + s;
}

function extractChaptersFromDescription(description, durationSec) {
  const lines = String(description || "").split(/\r?\n/);
  const entries = lines
    .map((line) => String(line || "").trim())
    .map((line) => {
      // Supports: "00:00 Intro", "1:12:30 Deep Dive", "00:00 - Intro"
      const match = line.match(/^((?:(?:\d+):)?[0-5]?\d:[0-5]\d)\s*(?:[-|:])?\s+(.+)$/);
      if (!match) return null;
      const startSec = parseTimestampToSeconds(match[1]);
      if (!Number.isFinite(startSec)) return null;
      return { startSec, title: match[2].trim() };
    })
    .filter(Boolean)
    .sort((a, b) => a.startSec - b.startSec);

  if (!entries.length) return [];

  const deduped = [];
  const seen = new Set();
  for (const item of entries) {
    const key = `${item.startSec}__${item.title.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  return deduped.map((ch, idx) => {
    const nextStart = deduped[idx + 1]?.startSec;
    const endSec = Number.isFinite(nextStart) ? Math.max(ch.startSec, nextStart - 1) : Math.max(ch.startSec, durationSec || ch.startSec);
    return {
      title: ch.title,
      startSec: ch.startSec,
      endSec,
    };
  });
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

function extractChaptersFromWatchHtml(html, durationSec) {
  const chapterRegex = /"chapterRenderer":\{"title":\{"simpleText":"((?:\\.|[^"\\])*)"\}[\s\S]*?"timeRangeStartMillis":"(\d+)"/g;
  const raw = [];
  let match = chapterRegex.exec(html);

  while (match) {
    const title = decodeEscapedText(match[1]);
    const startSec = Math.floor(Number(match[2]) / 1000);
    if (title && Number.isFinite(startSec) && startSec >= 0) {
      raw.push({ title, startSec });
    }
    match = chapterRegex.exec(html);
  }

  if (!raw.length) return [];

  const deduped = [];
  const seen = new Set();
  for (const item of raw) {
    const key = `${item.title}__${item.startSec}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  deduped.sort((a, b) => a.startSec - b.startSec);
  return deduped.map((ch, idx) => {
    const nextStart = deduped[idx + 1]?.startSec;
    const endSec = Number.isFinite(nextStart) ? Math.max(ch.startSec, nextStart - 1) : durationSec;
    return { ...ch, endSec };
  });
}

async function fetchWatchPageMetadata(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
  const res = await fetch(url, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch watch page metadata");
  }

  const html = await res.text();
  const playerResponse = extractInitialPlayerResponse(html);
  const durationSec = Number(playerResponse?.videoDetails?.lengthSeconds || 0);
  const chapters = extractChaptersFromWatchHtml(html, durationSec);

  const title = playerResponse?.videoDetails?.title || "Unknown title";
  const channelTitle = playerResponse?.videoDetails?.author || "Unknown channel";
  const thumbnail = playerResponse?.videoDetails?.thumbnail?.thumbnails?.[0]?.url || null;

  return {
    title,
    channelTitle,
    thumbnail,
    durationSec,
    durationLabel: formatDuration(durationSec),
    videoId,
    isLongVideo: durationSec >= 3600,
    hasCreatorTimeline: chapters.length > 0,
    chapters,
    warning:
      "Primary metadata was blocked on this server. Loaded fallback metadata from watch page.",
  };
}

async function fetchFallbackMetadata(videoId, ytLink) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(ytLink)}&format=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to fetch fallback metadata");
  }

  const data = await res.json();
  return {
    title: data?.title || "Unknown title",
    channelTitle: data?.author_name || "Unknown channel",
    thumbnail: data?.thumbnail_url || null,
    durationSec: 0,
    durationLabel: "Unknown",
    videoId,
    isLongVideo: false,
    hasCreatorTimeline: false,
    chapters: [],
    warning:
      "YouTube blocked detailed metadata on this server. Basic details loaded; chapter/timeline metadata may be unavailable.",
  };
}

async function fetchTubeTextMetadata(videoId) {
  const url = `${TUBETEXT_ENDPOINT}?video_id=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch Tubetext metadata");
  }

  const payload = await res.json();
  if (!payload?.success || !payload?.data) {
    throw new Error("Tubetext metadata payload invalid");
  }

  const details = payload.data.details || {};
  const title = details.title || "Unknown title";
  const channelTitle = details.channel || "Unknown channel";
  const description = details.description || "";

  const chapters = extractChaptersFromDescription(description, 0);

  return {
    title,
    channelTitle,
    thumbnail: null,
    durationSec: 0,
    durationLabel: "Unknown",
    videoId,
    isLongVideo: false,
    hasCreatorTimeline: chapters.length > 0,
    chapters,
    warning:
      "Primary YouTube metadata was blocked on this server. Loaded fallback details via Tubetext.",
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const ytLink = body?.ytLink;

    if (!ytLink) {
      return Response.json({ error: "ytLink is required." }, { status: 400 });
    }

    if (!ytdl.validateURL(ytLink)) {
      return Response.json({ error: "Invalid YouTube URL." }, { status: 400 });
    }

    const videoId = ytdl.getURLVideoID(ytLink);

    try {
      const info = await ytdl.getBasicInfo(videoId);
      const durationSec = Number(info?.videoDetails?.lengthSeconds || 0);

      const rawChapters =
        info?.videoDetails?.chapters ||
        info?.player_response?.videoDetails?.chapters ||
        [];

      const chapters = normalizeChapters(rawChapters, durationSec);

      return Response.json({
        title: info?.videoDetails?.title || "Unknown title",
        channelTitle: info?.videoDetails?.author?.name || info?.videoDetails?.ownerChannelName || "Unknown channel",
        thumbnail: info?.videoDetails?.thumbnails?.[0]?.url || null,
        durationSec,
        durationLabel: formatDuration(durationSec),
        videoId,
        isLongVideo: durationSec >= 3600,
        hasCreatorTimeline: chapters.length > 0,
        chapters,
      });
    } catch (innerError) {
      if (!isBotBlockedError(innerError?.message)) {
        throw innerError;
      }

      try {
        const watchPageFallback = await fetchWatchPageMetadata(videoId);
        return Response.json(watchPageFallback);
      } catch {
        // Continue to next fallback.
      }

      try {
        const tubeTextFallback = await fetchTubeTextMetadata(videoId);
        return Response.json(tubeTextFallback);
      } catch {
        // Final fallback below.
      }

      const fallback = await fetchFallbackMetadata(videoId, ytLink);
      return Response.json(fallback);
    }
  } catch (error) {
    return Response.json(
      { error: error?.message || "Failed to fetch video details" },
      { status: 500 }
    );
  }
}