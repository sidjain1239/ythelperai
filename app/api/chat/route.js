import Groq from "groq-sdk";

const client = new Groq({
  apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
});

const MAX_OUTPUT_TOKENS = 700;

function trimTextToTokens(text, maxTokens) {
  if (!text) return "";
  const words = text.split(/\s+/).filter(Boolean);
  const maxWords = Math.max(1, Math.floor(maxTokens * 0.75));
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ");
}

export async function POST(req) {
  try {
    const { transcript, messages } = await req.json();

    if (!transcript) {
      return Response.json({ error: "Transcript is required" }, { status: 400 });
    }

    if (!Array.isArray(messages)) {
      return Response.json({ error: "Messages array is required" }, { status: 400 });
    }

    if (!process.env.NEXT_PUBLIC_GROQ_API_KEY) {
      return Response.json(
        { error: "Groq API key not configured. Please add NEXT_PUBLIC_GROQ_API_KEY to .env.local" },
        { status: 500 }
      );
    }

    // Keep only Groq-supported fields from client messages.
    const safeMessages = messages
      .filter((msg) => msg && typeof msg.content === "string")
      .map((msg) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content.slice(0, 500),
      }));

    // Keep only recent messages with strict limits to avoid 413.
    const recentMessages = safeMessages.slice(-4);
    const lastUserMessage = [...safeMessages].reverse().find((m) => m.role === "user");

    const systemPrompt =
      "You are a helpful assistant analyzing a YouTube transcript. Answer clearly and concisely, and only use transcript context.";

    const primaryTranscript = trimTextToTokens(transcript, 2200);
    const fallbackTranscript = trimTextToTokens(transcript, 900);

    const runChat = (transcriptText, chatMessages) => {
      return client.chat.completions.create({
        model: "llama-3.1-8b-instant",
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: `Transcript:\n\n${transcriptText}`,
          },
          ...chatMessages,
        ],
      });
    };

    let response;
    try {
      response = await runChat(primaryTranscript, recentMessages);
    } catch (err) {
      const msg = err?.message || "";
      if (msg.includes("Request too large") || msg.includes("tokens per minute")) {
        const minimalMessages = lastUserMessage ? [lastUserMessage] : [];
        response = await runChat(fallbackTranscript, minimalMessages);
      } else {
        throw err;
      }
    }

    const answer = response.choices?.[0]?.message?.content?.trim() || "No response generated.";
    return Response.json({ answer });
  } catch (error) {
    console.error("Chat error:", error);

    const message = error?.message || "Failed to process chat";
    if (message.includes("Request too large") || message.includes("tokens per minute")) {
      return Response.json(
        {
          error:
            "Input is too long for chat. For long videos, extract only required chapter(s) or a custom timeline and try again.",
        },
        { status: 413 }
      );
    }

    return Response.json(
      { error: message },
      { status: 500 }
    );
  }
}
