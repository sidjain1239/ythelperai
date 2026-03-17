import Groq from "groq-sdk";

const client = new Groq({
  apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
});

const MAX_TOKENS = 6000;

function countTokensApprox(text) {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

export async function POST(req) {
  try {
    const { transcript, language } = await req.json();

    if (!transcript) {
      return new Response(
        JSON.stringify({ error: "Transcript is required" }),
        { status: 400 }
      );
    }

    if (!process.env.NEXT_PUBLIC_GROQ_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "Groq API key not configured",
        }),
        { status: 500 }
      );
    }

    // Truncate transcript if too long
    let truncatedTranscript = transcript;
    const transcriptTokens = countTokensApprox(transcript);

    if (transcriptTokens > 4000) {
      const words = transcript.split(/\s+/);
      truncatedTranscript = words.slice(0, Math.floor(words.length * 0.5)).join(" ");
    }

    const response = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `Summarize the transcript in concise bullet points. Language: ${language === "hindi" ? "Hindi" : "English"}. Keep headings and key terms in bold markdown using **text** where helpful.`,
        },
        {
          role: "user",
          content: `Please provide a concise summary (in 3-5 bullet points) of the following YouTube video transcript in ${language === "hindi" ? "Hindi" : "English"}:\n\n${truncatedTranscript}`,
        },
      ],
    });

    const summary = response.choices?.[0]?.message?.content?.trim() || "No summary generated.";
    return Response.json({ summary });
  } catch (error) {
    console.error("Summarize error:", error);
    return Response.json(
      { error: error.message || "Failed to summarize" },
      { status: 500 }
    );
  }
}
