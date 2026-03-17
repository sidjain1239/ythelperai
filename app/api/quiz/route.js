import { Groq } from "groq-sdk";

const client = new Groq({
  apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
});

export async function POST(request) {
  try {
    const { transcript, questionCount = 5, language = 'english' } = await request.json();

    if (!transcript) {
      return Response.json({ error: "Transcript required" }, { status: 400 });
    }

    const languageText = language === 'hindi' ? 'Hindi' : 'English';
    const prompt = `Based on the following transcript, generate exactly ${questionCount} multiple choice questions in ${languageText}.

TRANSCRIPT:
${transcript.substring(0, 3000)}

For each question, provide:
1. The question text IN ${languageText}
2. Exactly 4 options (A, B, C, D)
3. The index of the correct answer (0-3)

Format your response as a JSON array with this structure:
[
  {
    "question": "Question text here",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0
  }
]

Generate only valid JSON, no additional text.`;

    const response = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 2000,
      temperature: 0.7
    });

    const content = response.choices[0]?.message?.content || "";
    
    // Parse JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("Failed to generate valid quiz");
    }

    const questions = JSON.parse(jsonMatch[0]);

    // Validate questions structure
    const validQuestions = questions
      .filter(q => q.question && q.options?.length === 4 && typeof q.correctIndex === 'number')
      .slice(0, questionCount);

    if (validQuestions.length === 0) {
      throw new Error("Failed to generate valid quiz questions");
    }

    return Response.json({
      success: true,
      questions: validQuestions,
      language,
      count: validQuestions.length
    });

  } catch (error) {
    console.error("Quiz generation error:", error);
    return Response.json(
      { error: error.message || "Failed to generate quiz" },
      { status: 500 }
    );
  }
}
