import type { Content } from "@google/genai";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { runAssistantTurn } from "@/modules/assistant/orchestrator";

interface ChatRequestBody {
  message?: string;
  history?: Content[];
}

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = (await req.json().catch(() => null)) as ChatRequestBody | null;
  if (!body?.message || typeof body.message !== "string" || !body.message.trim()) {
    return new Response(JSON.stringify({ error: "message is required", requestId }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runAssistantTurn(ctx, {
          message: body.message!,
          history: Array.isArray(body.history) ? body.history : [],
        })) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache",
      "x-request-id": requestId,
    },
  });
});
