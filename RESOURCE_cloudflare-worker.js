// Copy this code into your Cloudflare Worker script

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const WEB_SEARCH_GUIDANCE = [
  "Stay strictly within L'Oréal and beauty topics (skincare, haircare, makeup, fragrance, and beauty routines), and keep the beauty-only redirect rule for unrelated input.",
  "When using web search for beauty questions, prefer official L'Oréal and brand websites (such as loreal.com, lorealparisusa.com, cerave.com, laroche-posay.us, vichyusa.com, lancome-usa.com, garnierusa.com, maybelline.com, kiehls.com, kerastase-usa.com, skinceuticals.com, urbandecay.com, yslbeautyus.com, and redken.com) whenever available.",
  "Keep replies concise and in plain text. Never invent sources or URLs.",
].join(" ");

// Keep only safe http/https URLs from OpenAI citation annotations
function getSafeUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

// Extract assistant text and url_citation annotations from a Responses API payload
function extractResponsesOutput(data) {
  let answer = "";
  const citations = [];

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type !== "message" || !Array.isArray(item.content)) continue;

      for (const part of item.content) {
        if (part.type !== "output_text" || typeof part.text !== "string") {
          continue;
        }

        const textOffset = answer.length;
        answer += part.text;

        if (Array.isArray(part.annotations)) {
          for (const annotation of part.annotations) {
            if (annotation?.type !== "url_citation") continue;

            const safeUrl = getSafeUrl(annotation.url);
            if (!safeUrl) continue;

            const startIndex = Number.isInteger(annotation.start_index)
              ? annotation.start_index + textOffset
              : null;
            const endIndex = Number.isInteger(annotation.end_index)
              ? annotation.end_index + textOffset
              : null;

            citations.push({
              type: "url_citation",
              url: safeUrl,
              title: typeof annotation.title === "string" ? annotation.title : "",
              start_index: startIndex,
              end_index: endIndex,
            });
          }
        }
      }
    }
  }

  if (!answer && typeof data.output_text === "string") {
    answer = data.output_text;
  }

  return { answer, citations };
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: { message: "Method not allowed." } }),
        { status: 405, headers: corsHeaders }
      );
    }

    const apiKey = env.OPENAI_API_KEY; // Set OPENAI_API_KEY as a Worker secret in Cloudflare
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: { message: "Worker API key is not configured." } }),
        { status: 500, headers: corsHeaders }
      );
    }

    let userInput;
    try {
      userInput = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: { message: "Invalid JSON request body." } }),
        { status: 400, headers: corsHeaders }
      );
    }

    const messages = Array.isArray(userInput.messages) ? userInput.messages : [];
    const useWebSearch = Boolean(userInput.webSearch);

    // Web Search path: OpenAI Responses API with built-in web_search tool
    if (useWebSearch) {
      const systemInstructions = messages
        .filter((msg) => msg.role === "system" && typeof msg.content === "string")
        .map((msg) => msg.content.trim())
        .filter(Boolean);

      const instructions = [...systemInstructions, WEB_SEARCH_GUIDANCE].join(" ");

      const conversationInput = messages
        .filter(
          (msg) =>
            (msg.role === "user" || msg.role === "assistant") &&
            typeof msg.content === "string"
        )
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      const responsesBody = {
        model: "gpt-4.1",
        instructions,
        input: conversationInput,
        tools: [{ type: "web_search" }],
        max_output_tokens: 450,
      };

      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(responsesBody),
      });

      const data = await response.json();

      if (!response.ok) {
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: corsHeaders,
        });
      }

      const { answer, citations } = extractResponsesOutput(data);

      return new Response(
        JSON.stringify({
          answer,
          citations,
          webSearch: true,
          choices: [
            {
              message: {
                role: "assistant",
                content: answer,
              },
            },
          ],
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Standard chat & routine generation path: OpenAI Chat Completions API
    const requestBody = {
      model: "gpt-4o",
      messages,
      max_completion_tokens: 300,
    };

    const response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: corsHeaders,
    });
  },
};
