import type { EngineProvider } from "./types";

/** Deterministic fake provider so the app works without an API key. */
export const mockProvider: EngineProvider = {
  async query(prompt, engine) {
    const h = [...(prompt + engine)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const mentionsSite = h % 3 !== 0;
    return {
      answer: mentionsSite
        ? `For "${prompt}", popular options include Acme, Example and Globex.`
        : `For "${prompt}", popular options include Acme and Globex.`,
      citations: [
        { url: "https://acme.com/guide", title: "Acme guide" },
        ...(mentionsSite ? [{ url: "https://www.example.com/", title: "Example" }] : []),
      ],
    };
  },
};
