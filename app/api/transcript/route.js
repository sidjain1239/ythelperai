import { fetchTranscript } from "youtube-transcript";

const WORD_LIMIT = 5000;

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
  // youtube-transcript returns offset and duration in milliseconds
  const offsetMs = Number(item.offset ?? item.start ?? 0);
  const durationMs = Number(item.duration ?? item.dur ?? 0);
  
  // Convert to seconds
  const startItemSec = offsetMs / 1000;
  const endItemSec = (offsetMs + Math.max(0, durationMs)) / 1000;
  
  // Compare with requested range (in seconds)
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
    if (validRanges.length === 0) {
      throw new Error("No valid ranges found. Example: 0-60 and 120-180.");
    }

    return transcript.filter((item) =>
      validRanges.some((r) => itemInRange(item, r.startSec, r.endSec))
    );
  }

  throw new Error("Invalid mode. Use full, custom, or selected.");
}

export async function POST(request) {
  try {
    const { ytLink, mode = "full", startSec, endSec, ranges } = await request.json();

    if (!ytLink) {
      return Response.json({ error: "ytLink is required." }, { status: 400 });
    }

    const transcript = await fetchTranscript(ytLink);
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
    });
  } catch (error) {
    return Response.json(
      { error: error?.message || "Failed to fetch transcript" },
      { status: 500 }
    );
  }
}