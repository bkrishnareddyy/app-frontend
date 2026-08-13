import type { Content } from "@google/genai";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { runAssistantTurn } from "@/modules/assistant/orchestrator";
import { checkCopilotRate } from "@/modules/copilot/copilotRateLimit";
import { checkAiQuota } from "@/lib/ai/aiQuota";

interface ChatRequestBody {
  message?: string;
  history?: Content[];
}

// Flat { error: string, requestId } — matches the 400 branch below and what
// ChatClient.tsx already parses (`(e as { error?: string }).error`). The
// richer { error: { code, message, ... } } shape aiQuotaGate/checkAiQuota's
// other callers use elsewhere would read as "[object Object]" here.
function refusalResponse(message: string, retryAfterSeconds: number, requestId: string): Response {
  return new Response(JSON.stringify({ error: message, requestId }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds) },
  });
}

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = (await req.json().catch(() => null)) as ChatRequestBody | null;
  if (!body?.message || typeof body.message !== "string" || !body.message.trim()) {
    return new Response(JSON.stringify({ error: "message is required", requestId }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const rate = checkCopilotRate({ accountId: ctx.accountId, userId: ctx.userId });
  if (!rate.allowed) {
    return refusalResponse(
      `You've sent messages too quickly. Try again in about ${rate.retryAfterSeconds} second${rate.retryAfterSeconds === 1 ? "" : "s"}.`,
      rate.retryAfterSeconds,
      requestId
    );
  }

  const quota = await checkAiQuota({ accountId: ctx.accountId, userId: ctx.userId, surface: "copilot" });
  if (!quota.allowed) {
    const message =
      quota.reason === "account_tokens"
        ? "Your account has used its daily AI allowance. Try again tomorrow, or ask an administrator to raise the limit."
        : `You've sent messages too quickly. Try again in about ${quota.retryAfterSeconds} second${quota.retryAfterSeconds === 1 ? "" : "s"}.`;
    return refusalResponse(message, quota.retryAfterSeconds, requestId);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runAssistantTurn(ctx, {
          message: body.message!,
          history: Array.isArray(body.history) ? body.history : [],
          requestId,
        })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-request-id": requestId,
    },
  });
});
