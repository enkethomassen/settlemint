import { walletConfig } from "../config";

// Pluggable LLM dispatcher. Four backends, all returning plain string.
//
// - "ollama"  : fully local, $0, no key. Closest to ACE's QVAC on-device layer.
//               Run `ollama pull llama3.1` then set AI_PROVIDER=ollama.
// - "groq"    : free tier, very fast, OpenAI-compatible. Best default if you want AI.
//               Get a key at https://console.groq.com
// - "gemini"  : free tier. Key from https://aistudio.google.com
//               Set AI_MODEL=gemini-2.0-flash
// - "openai"  : paid. Overkill for this use case — heuristics do 80% of the work.
// - "none"    : skip LLM entirely, heuristics only. This is the zero-key default.

export async function llm(system: string, user: string): Promise<string> {
  const { provider, apiKey, model, ollamaBase } = walletConfig.ai;

  if (provider === "none") {
    throw new Error("AI_PROVIDER=none. Set groq | gemini | ollama | openai to enable LLM layer.");
  }

  if (provider === "ollama") {
    const res = await fetch(`${ollamaBase}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: model || "llama3.1",
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as any;
    return json.message?.content ?? "";
  }

  if (provider === "gemini") {
    const m = model || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
      }),
    });
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as any;
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  // Groq + OpenAI share the OpenAI chat-completions shape.
  const baseUrl =
    provider === "groq"
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
  const defaultModel = provider === "groq" ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || defaultModel,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${provider} error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as any;
  return json.choices?.[0]?.message?.content ?? "";
}

export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const startObj = cleaned.indexOf("{");
  const startArr = cleaned.indexOf("[");
  const i =
    startArr >= 0 && (startArr < startObj || startObj < 0) ? startArr : startObj;
  if (i < 0) return null;
  try {
    return JSON.parse(cleaned.slice(i)) as T;
  } catch {
    return null;
  }
}
