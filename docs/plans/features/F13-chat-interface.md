# F13 · Chat Interface (AI Assistant)
> Depends on: F01 (OpenAPI spec), and all feature APIs being stable
> Branch: `feat/chat-interface`
> Reference: docs/ai-chat-interface.md

The chat interface is a second surface for every action the UI can perform — not a separate product. The same APIs, the same auth, the same audit logging. The assistant understands the user's account context and calls the same route handlers a browser does.

---

## Capability A — Streaming Chat API

`POST /api/assistant/chat` exists. `AssistantChatSession` model exists.

* **Task A-1**: Refactor `POST /api/assistant/chat` to use SSE (Server-Sent Events) via Next.js streaming response. Emit: `{ type: "text_delta", delta: string }`, `{ type: "tool_call", name: string, input: object }`, `{ type: "tool_result", name: string, result: object }`, `{ type: "done" }`. This allows the client to render text as it streams and show tool calls as they execute.
* **Task A-2**: `GET /api/assistant/chats`: list sessions for the account. Paginated. `GET /api/assistant/chats/[id]`: session detail with full message history. `DELETE /api/assistant/chats/[id]`: delete a session (scoped to account).
* **Task A-3**: Session context: each session carries `{ accountId, clientId?, shipmentId?, documentId? }`. If `shipmentId` is set, the assistant has context about that specific shipment and its documents, exceptions, and decisions. This context is injected into the system prompt.
* **Task A-4**: Message history: persist all messages (user + assistant + tool calls + tool results) to `AssistantChatMessage` rows (new model). `AssistantChatSession.messages` relation.
* **Task A-5**: AI model: use Claude claude-sonnet-5 (or claude-opus-5 for complex multi-step reasoning). Switch from Gemini for the chat interface — Claude's tool use and reasoning is significantly better for structured trade compliance queries. Gemini remains for OCR and document extraction where vision is primary.
* **Task A-6**: Vitest: streaming response emits events in order; session is scoped to account; session with shipmentId includes shipment context.

## Capability B — Tool Definitions (API as Tools)

Every consequential API action needs a tool definition the assistant can call.

* **Task B-1**: Define tool registry in `src/lib/assistant/tools.ts`. Tool definitions are derived from the OpenAPI spec (from F01-H). Each tool: `{ name, description, inputSchema (Zod), handler: (input, ctx) => Promise<ToolResult> }`.
* **Task B-2**: Read-only tools (always available):
  - `list_shipments({ status?, clientId?, limit?, cursor? })` → paginated shipment list
  - `get_shipment({ shipmentId })` → shipment detail with documents, exceptions, decisions
  - `list_exceptions({ shipmentId?, status?, severity? })` → exceptions
  - `get_document({ documentId })` → document with extracted fields
  - `list_decisions({ shipmentId?, triageState? })` → decisions
  - `get_product({ productId })` → product with classifications, attributes
  - `search_hts({ query, limit? })` → HTS code search
  - `search_rulings({ query, htsCode? })` → CROSS ruling search
  - `get_duty_stack({ htsCode, countryOfOrigin, customsValue })` → full duty calculation
  - `get_regulatory_updates({ from?, type? })` → recent updates
  - `get_filing_status({ filingId })` → filing status
* **Task B-3**: Write tools (require permission checks — the tool handler calls `requirePermission` before executing):
  - `approve_decision({ decisionId, humanNotes? })` → requires `decisions.approve`
  - `reject_decision({ decisionId, humanNotes })` → requires `decisions.approve`
  - `resolve_exception({ exceptionId, reasonCode, note })` → requires `exceptions.resolve`
  - `upload_document({ shipmentId, documentType? })` → returns a signed upload URL (actual file upload is client-side)
  - `classify_product({ productId, htsCode, overrideReason? })` → requires `classification.approve`
  - `create_scenario({ name, description })` → create a tariff scenario
  - `run_impact_analysis({ regulatoryUpdateId })` → trigger impact analysis
  - `generate_reasonable_care_record({ shipmentId })` → trigger package generation
* **Task B-4**: Tool call rendering in the chat UI: when the assistant calls a tool, render a "tool call" chip showing the tool name and key inputs. When the result arrives, render a structured card (not prose): e.g. a `get_shipment` result shows a shipment card with status, documents, exceptions. A `get_duty_stack` result shows the duty breakdown table.
* **Task B-5**: Vitest: tool handler respects account isolation (tool with foreign shipmentId returns 404 not 403 to avoid enumeration); permission-gated tools return error if permission missing.

## Capability C — Chat UI

`src/app/chat` exists. Evaluate and improve.

* **Task C-1**: Chat page layout: full-width chat panel on the left; context panel on the right. Context panel shows: current shipment (if context-scoped), recent documents, open exceptions. Selecting a shipment or document from the context panel scopes the assistant's context.
* **Task C-2**: Structured result cards in the chat: instead of rendering tool results as JSON, render them as domain-specific cards:
  - Shipment card: status badge, document count, exception count, readiness score, "View shipment" link
  - Document card: type badge, status, confidence, "View in workspace" link
  - Decision card: proposed value, confidence bar, approve/reject inline actions
  - Duty stack card: layered duty breakdown table with totals
  - Exception card: severity badge, description, "Resolve" action
* **Task C-3**: Inline actions in chat: for cards that represent actionable items, show action buttons (Approve, Reject, Resolve). Clicking them triggers the write tool with a confirmation step. Actions taken via chat are logged to `AuditLog` with `source: "CHAT"`.
* **Task C-4**: Multi-part file upload in chat: user can attach documents to a chat message. Each attached file is uploaded to Vercel Blob and becomes a `ShipmentDocument` (if context is shipment-scoped) or an unattached document. The assistant can then reference and process it.
* **Task C-5**: Context persistence: the shipment/document context set in a session persists across messages. User can clear context with a command. Context shown in the session header.
* **Task C-6**: Chat session list in sidebar: recent sessions with preview of last message. Group by: Today, Yesterday, Last 7 days. Session title is auto-generated from the first user message (first 60 chars).

## Capability D — Chat as Compliance Interface

Beyond task execution, the assistant answers trade compliance questions using the account's real data.

* **Task D-1**: Advisory query: `POST /api/advisory/query` — currently returns template strings. Refactor to use Claude API with a compliance-specialist system prompt. Context injection: relevant products, shipments, classifications from the account. Returns a structured response with citations to specific rulings, HTS codes, and documents in the account.
* **Task D-2**: "Why was this HTS code chosen?" — returns the `ClassificationCase` GRI analysis in conversational prose, citing each GRI step and the ruling that informed it.
* **Task D-3**: "What are my duty exposure risks?" — computes a risk summary using real `DutyStack` data and regulatory updates. Lists the top-3 risks by dollar value.
* **Task D-4**: "Is my shipment ready to file?" — calls `filingValidator` and explains each blocker in plain English, with links to the specific issues in the UI.
* **Task D-5**: Question routing: classify the user's question before calling Claude API. Simple lookups (HTS search, ruling search) use direct tool calls. Complex multi-step questions (trade agreement qualification, valuation analysis) use a Claude reasoning chain. This prevents unnecessary AI usage for answerable-via-tool questions.
* **Task D-6**: Rate limiting: `AiUsageWindow` (already in schema) tracks token usage per account per day. `aiQuotaGate.ts` rejects at the configured limit. Chat shows "AI quota reached for today" rather than silently failing.

## Data gaps
- **Claude API key**: Required for chat and advisory query. Add `ANTHROPIC_API_KEY` to environment variables. Currently only `@google/genai` is in dependencies — add `@anthropic-ai/sdk`.
- **System prompt quality**: The assistant system prompt must be written by someone with customs broker expertise. It defines the assistant's knowledge of trade terminology, CBP procedures, and Qubere's data model. This is a content task, not a code task.
