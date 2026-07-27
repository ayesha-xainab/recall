// /api/generate.js
// Vercel Serverless Function (Node.js runtime)
// Calls the Groq API (free tier, OpenAI-compatible) to turn raw study notes
// into flashcards, a quiz, or a summary.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { notes, mode, count } = req.body || {};

  if (!notes || typeof notes !== "string" || notes.trim().length < 20) {
    return res
      .status(400)
      .json({ error: "Please provide at least a few sentences of notes." });
  }

  if (!["flashcards", "quiz", "summary"].includes(mode)) {
    return res.status(400).json({ error: "Invalid mode." });
  }

  const itemCount = Math.min(Math.max(parseInt(count, 10) || 8, 3), 20);

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "Server is missing GROQ_API_KEY. Set it as an environment variable in your hosting dashboard.",
    });
  }

  const systemPrompt = `You are Recall, an expert study assistant used inside a web app.
Your ONLY job is to read a student's raw notes and convert them into study material.

Rules you must always follow:
1. Read the notes carefully and extract the genuinely important concepts, facts, definitions, and relationships. Ignore filler, headers, and formatting noise.
2. Never invent facts that are not supported by the notes. If the notes are thin, produce fewer, higher-quality items rather than padding with invented content.
3. Match the difficulty and terminology to the notes themselves (don't oversimplify technical material, don't overcomplicate simple material).
4. You must respond with ONLY valid JSON matching the shape below. No markdown code fences, no commentary, no preamble, no trailing text.
5. Produce as close to ${itemCount} items as the notes reasonably support (fewer is fine if the notes are short; never fabricate to hit the count).

JSON shapes by mode:

mode = "flashcards":
{ "flashcards": [ { "front": "short question or term", "back": "concise answer or definition" }, ... ] }

mode = "quiz":
{ "quiz": [ { "question": "string", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "1-2 sentence explanation of the correct answer" }, ... ] }
(exactly 4 options per question, correctIndex is 0-based)

mode = "summary":
{ "summary": { "title": "short topic title", "bullets": ["key point 1", "key point 2", ...] } }
(6-12 bullets, each one concise sentence)

Return JSON for mode = "${mode}" only. Respond with a single JSON object, nothing else.`;

  const userMessage = `Notes:\n"""\n${notes.trim()}\n"""\n\nGenerate the "${mode}" JSON as instructed, with about ${itemCount} items.`;

  try {
    const model = "llama-3.3-70b-versatile";
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
          max_tokens: 2048,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API error:", response.status, errText);
      return res
        .status(502)
        .json({ error: "The AI service returned an error. Please try again." });
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("Failed to parse model output:", raw);
      return res
        .status(502)
        .json({ error: "The AI returned an unexpected format. Please try again." });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Unexpected server error." });
  }
}
