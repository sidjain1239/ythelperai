export async function extractTranscriptTextClient({ ytLink, mode = "full", startSec, endSec, ranges, enforceLimit = true }) {
  const res = await fetch("/api/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ytLink, mode, startSec, endSec, ranges, enforceLimit }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "Failed to fetch transcript.");
  }

  return data;
}
