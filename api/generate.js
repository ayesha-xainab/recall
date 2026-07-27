// /api/generate.js
// Vercel Serverless Function (Node.js runtime)
// Calls the Google Gemini API (free tier) to turn raw study notes into
// flashcards, a quiz, or a summary.

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "Server is missing GEMINI_API_KEY. Set it as an environment variable in your hosting dashboard.",
    });
  }

  // ---- The AI feature's instructions (system prompt) ----
  // This is the core of Recall's AI feature: it forces the model to act as a
  // study-material generator and to ALWAYS return strict, parseable JSON so the
  // frontend can render flashcards / quiz questions / a summary reliably.
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

Return JSON for mode = "${mode}" only.`;

  const userMessage = `Notes:\n"""\n${notes.trim()}\n"""\n\nGenerate the "${mode}" JSON as instructed, with about ${itemCount} items.`;

  try {
    // Check https://ai.google.dev/gemini-api/docs/models for the current
    // recommended free-tier flash model name if this one is ever retired.
    const model = "gemini-2.0-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 2048,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return res
        .status(502)
        .json({ error: "The AI service returned an error. Please try again." });
    }

    const data = await response.json();
    const raw =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
      "";

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

