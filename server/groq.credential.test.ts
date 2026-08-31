import { describe, expect, it } from "vitest";

describe("Groq credential", () => {
  it("authenticates against the lightweight models endpoint when configured", async () => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      expect(apiKey).toBeTruthy();
      return;
    }

    const response = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(response.ok).toBe(true);
  }, 15000);
});
