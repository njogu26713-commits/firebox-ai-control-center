type GroqMessage = { role: "system" | "user" | "assistant"; content: string };

const GROQ_URL = process.env.GROQ_API_URL ?? "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

export async function invokeGroq(messages: GroqMessage[]) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.5, max_tokens: 500 }),
  });
  if (!response.ok) throw new Error(`Groq request failed with status ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content ?? "I’m ready to help. Try another message.";
}
