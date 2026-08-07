/**
 * Shared error logging utility for the Qubere Multi-Agent Pipeline.
 *
 * Every agent catch block should call logAgentError() instead of bare
 * console.warn/error. This does two things:
 *   1. Emits a structured log line with enough context to reproduce the failure.
 *   2. Returns a debugError string that agents embed in their output so the
 *      failure is visible in the API JSON response, not just server logs.
 */
export function logAgentError(
  agentName: string,
  shipmentId: string,
  context: string,
  err: unknown
): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : JSON.stringify(err);

  console.error(
    JSON.stringify({
      level: "error",
      agent: agentName,
      shipmentId,
      context,
      error: message,
      ts: new Date().toISOString(),
    })
  );

  return `[${agentName}] ${context}: ${message}`;
}
