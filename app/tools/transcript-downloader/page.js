"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, FileText, Loader } from "lucide-react";
import { extractTranscriptTextClient } from "@/lib/client-transcript";

export default function TranscriptDownloader() {
  const [videoUrl, setVideoUrl] = useState("");
  const [format, setFormat] = useState("txt");
  const [mode, setMode] = useState("full");
  const [timelineClock, setTimelineClock] = useState({
    startH: "0",
    startM: "0",
    startS: "0",
    endH: "0",
    endM: "5",
    endS: "0",
  });
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedChapterIndexes, setSelectedChapterIndexes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState("");

  const toSecondsFromClock = (clock, prefix) => {
    const h = Number(clock[`${prefix}H`]) || 0;
    const m = Number(clock[`${prefix}M`]) || 0;
    const s = Number(clock[`${prefix}S`]) || 0;
    return h * 3600 + m * 60 + s;
  };

  const toClock = (totalSec) => {
    const safe = Math.max(0, Number(totalSec) || 0);
    return {
      h: String(Math.floor(safe / 3600)),
      m: String(Math.floor((safe % 3600) / 60)),
      s: String(Math.floor(safe % 60)),
    };
  };

  const fetchVideoDetails = async () => {
    if (!videoUrl.trim()) {
      setError("Please enter a YouTube URL");
      return null;
    }

    setDetailsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/video-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ytLink: videoUrl }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load video details");

      setVideoInfo(data);
      setSelectedChapterIndexes([]);
      const defaultEnd = Math.min(Number(data?.durationSec || 300), 300);
      const endClock = toClock(defaultEnd || 300);
      setTimelineClock({
        startH: "0",
        startM: "0",
        startS: "0",
        endH: endClock.h,
        endM: endClock.m,
        endS: endClock.s,
      });

      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setDetailsLoading(false);
    }
  };

  const downloadTranscript = async () => {
    if (!videoUrl.trim()) {
      setError("Please enter a YouTube URL");
      return;
    }

    setLoading(true);
    setError("");

    try {
      let payload = {
        ytLink: videoUrl,
        mode: "full",
      };

      if (mode === "timeline") {
        const startSec = toSecondsFromClock(timelineClock, "start");
        const endSec = toSecondsFromClock(timelineClock, "end");

        if (endSec <= startSec) {
          throw new Error("Timeline end must be greater than start.");
        }

        payload = {
          ytLink: videoUrl,
          mode: "custom",
          startSec,
          endSec,
        };
      }

      if (mode === "chapters") {
        const info = videoInfo || (await fetchVideoDetails());
        if (!info) {
          throw new Error("Failed to load chapter details.");
        }

        const ranges = selectedChapterIndexes
          .map((idx) => info?.chapters?.[idx])
          .filter(Boolean)
          .map((chapter) => ({ startSec: chapter.startSec, endSec: chapter.endSec }));

        if (!ranges.length) {
          throw new Error("Please select at least one chapter.");
        }

        payload = {
          ytLink: videoUrl,
          mode: "selected",
          ranges,
        };
      }

      const data = await extractTranscriptTextClient(payload);

      const transcript = data.transcript;
      let fileContent = transcript;
      let fileName = `transcript-${Date.now()}`;
      let mimeType = "text/plain";

      if (format === "srt") {
        // Simple SRT format (simplified)
        const lines = transcript.split("\n");
        fileContent = lines
          .map((line, i) => `${i + 1}\n00:00:${String(i * 5).padStart(2, "0")},000 --> 00:00:${String(i * 5 + 5).padStart(2, "0")},000\n${line}\n`)
          .join("\n");
        fileName += ".srt";
      } else if (format === "json") {
        fileContent = JSON.stringify({ transcript, timestamp: new Date().toISOString() }, null, 2);
        fileName += ".json";
        mimeType = "application/json";
      } else if (format === "md") {
        fileContent = `# YouTube Transcript\n\n${transcript}`;
        fileName += ".md";
        mimeType = "text/markdown";
      } else {
        fileName += ".txt";
      }

      const element = document.createElement("a");
      element.setAttribute("href", `data:${mimeType};charset=utf-8,${encodeURIComponent(fileContent)}`);
      element.setAttribute("download", fileName);
      element.style.display = "none";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:opacity-80 transition mb-6">
          ← Back to Home
        </Link>

        <section className="glass rounded-2xl p-6 md:p-8 animate-fadeInUp">
          <h1 className="text-3xl md:text-4xl font-black mb-2 flex items-center gap-3">
            <FileText className="w-8 h-8" /> Transcript Downloader
          </h1>
          <p className="text-muted-foreground mb-6">
            Paste your video URL and export transcript as TXT, MD, JSON, or SRT.
          </p>

          <div className="grid gap-5">
            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2">YouTube URL</label>
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => {
                  setVideoUrl(e.target.value);
                  setVideoInfo(null);
                  setSelectedChapterIndexes([]);
                }}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2">Extraction Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full"
              >
                <option value="full">Full Video</option>
                <option value="timeline">Custom Timeline</option>
                <option value="chapters">Chapter Select</option>
              </select>
            </div>

            {mode === "timeline" && (
              <div className="glass rounded-xl p-4">
                <h3 className="font-semibold mb-3">Custom Timeline (hh:mm:ss)</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-muted-foreground mb-2">Start Time</label>
                    <div className="grid grid-cols-3 gap-2">
                      <input type="number" min="0" placeholder="hh" value={timelineClock.startH} onChange={(e) => setTimelineClock((p) => ({ ...p, startH: e.target.value }))} className="w-full" />
                      <input type="number" min="0" max="59" placeholder="mm" value={timelineClock.startM} onChange={(e) => setTimelineClock((p) => ({ ...p, startM: e.target.value }))} className="w-full" />
                      <input type="number" min="0" max="59" placeholder="ss" value={timelineClock.startS} onChange={(e) => setTimelineClock((p) => ({ ...p, startS: e.target.value }))} className="w-full" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-muted-foreground mb-2">End Time</label>
                    <div className="grid grid-cols-3 gap-2">
                      <input type="number" min="0" placeholder="hh" value={timelineClock.endH} onChange={(e) => setTimelineClock((p) => ({ ...p, endH: e.target.value }))} className="w-full" />
                      <input type="number" min="0" max="59" placeholder="mm" value={timelineClock.endM} onChange={(e) => setTimelineClock((p) => ({ ...p, endM: e.target.value }))} className="w-full" />
                      <input type="number" min="0" max="59" placeholder="ss" value={timelineClock.endS} onChange={(e) => setTimelineClock((p) => ({ ...p, endS: e.target.value }))} className="w-full" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {mode === "chapters" && (
              <div className="glass rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-semibold">Select Chapters</h3>
                  <button
                    type="button"
                    onClick={fetchVideoDetails}
                    disabled={detailsLoading}
                    className="btn-secondary"
                  >
                    {detailsLoading ? (
                      <span className="inline-flex items-center gap-2"><Loader className="w-4 h-4 animate-spin" /> Loading...</span>
                    ) : (
                      "Load Chapters"
                    )}
                  </button>
                </div>

                {videoInfo?.warning && (
                  <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    {videoInfo.warning}
                  </div>
                )}

                {videoInfo?.chapters?.length ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Choose one or more chapters ({selectedChapterIndexes.length} selected).</p>
                    <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                      {videoInfo.chapters.map((chapter, idx) => {
                        const checked = selectedChapterIndexes.includes(idx);
                        return (
                          <label key={`${chapter.title}-${idx}`} className="flex items-start gap-3 p-2 rounded-md hover:bg-secondary/40 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setSelectedChapterIndexes((prev) => {
                                  if (e.target.checked) return [...prev, idx];
                                  return prev.filter((item) => item !== idx);
                                });
                              }}
                              className="mt-1"
                            />
                            <span className="text-sm">
                              {chapter.title} ({chapter.startSec}s - {chapter.endSec}s)
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Load video details to select chapters.</p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2">Download Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value)} className="w-full">
                <option value="txt">Text (.txt)</option>
                <option value="md">Markdown (.md)</option>
                <option value="json">JSON (.json)</option>
                <option value="srt">SRT Subtitles (.srt)</option>
              </select>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-lg">
                Warning: {error}
              </div>
            )}

            <button className="btn-primary w-full inline-flex items-center justify-center gap-2" onClick={downloadTranscript} disabled={loading}>
              <Download className="w-4 h-4" />
              {loading ? "Downloading..." : "Download Transcript"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
