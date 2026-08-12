# Inline Chat Upload + Lazy New Chat — Design

## Goal

Replace the standalone `/upload` page with inline file attachment in the chat compose box (Claude/ChatGPT style). Every visit to `/chat` starts as a fresh, unsaved "new chat" state until the user sends a message, attaches a file, or picks an existing conversation from the sidebar. Each conversation remembers only the files attached to it — no cross-conversation mixing.

## Data Model

- Add `conversation_id TEXT REFERENCES conversations(id)` to the `documents` table via an idempotent `ALTER TABLE` migration (same pattern as the earlier `embedding_status` migration), run at `getDb()` init time.
- `DocumentRepository` gains `listByConversation(conversationId: string, userId: string): Promise<Document[]>`, filtered by `userId` (same ownership-check pattern used everywhere else in the codebase — no new IDOR surface).

## Backend API

- **`POST /api/documents`**: accepts an optional `conversationId` in the request body.
  - If absent, a new conversation is created server-side first (lazy creation).
  - The uploaded document is linked to that conversation via `conversation_id`.
  - Response becomes `{ documentId, filename, charCount, conversationId }` — the client always learns the conversation id, even if it didn't send one.
- **`/api/chat` and `/api/chat/stream`**: stop accepting `documentId` from the client entirely.
  - Server calls `DocumentRepository.listByConversation(conversationId, userId)` and concatenates the text of **all** documents linked to that conversation (regardless of when each was attached relative to the message being sent — attaching a file makes it available to every subsequent message in the session, not just messages sent after a particular point).
  - `BuildContextUseCase` changes from a single `documentId?: string` parameter to a list of document texts, concatenated and truncated at the existing ~12,000-char combined budget (same budget as today, just now shared across multiple files instead of one).
- **`/upload` page and its route handler are deleted entirely.** No parallel upload path is kept.
- No new rate limiting is added for `/api/documents` — attach-on-send could theoretically be spammed, but this matches the existing scope (rate limiting today only covers chat endpoints) and isn't part of this feature's ask.
- Removing a file from a conversation (unattaching / deleting) is **out of scope** — once attached, a document stays attached to its conversation for the conversation's lifetime. No delete endpoint, no UI affordance for it.

## Frontend

- **`chat/page.tsx`**: `activeId` starts as `null` on every load. No sidebar item is highlighted. The compose box is immediately usable — no "New chat" button click required to start typing or attaching. Switching to an existing conversation in the sidebar loads that conversation's messages **and** its attached-file chips together. The old single-select "Document context" `<select>` dropdown is removed.
- **`chat-window.tsx`**: gains a 📎 attach button next to the compose box.
  - Attaching a file uploads it immediately (upload-on-attach, not upload-on-send) — shows a chip with a spinner while in flight, an error chip if the upload fails (with the underlying error message), and a plain filename chip once done.
  - Multiple files can be attached to the same conversation; chips accumulate, they don't replace each other.
  - If no conversation exists yet (`activeId === null`) when the first file is attached, the upload response's `conversationId` is used to initialize `activeId` client-side, same as the lazy-creation behavior on first sent message.
- Sending the first message when `activeId === null` behaves as it does today (server creates the conversation), except now the client must also merge in the `conversationId` it may have already picked up from a prior attach in the same "new chat" state — if a file was attached before the first message, the conversation already exists and the first message should be posted to that same conversation, not create a second one.

## Error Handling

- Upload failure (bad mime type, size limit, extraction failure): chip shows an inline error state with the server's error message; does not block sending a text-only message in the same conversation.
- Chat request failure (existing retry/rate-limit/timeout handling): unchanged: multi-document context building only changes *what* is fetched before the prompt is assembled, not how failures downstream are handled.
- If `listByConversation` returns zero documents (no files attached), context building behaves exactly as it does today when no `documentId` was provided — no context, plain chat.

## Testing

- Unit tests for `BuildContextUseCase`: update from single-document mocked port to multi-document, covering zero, one, and multiple documents, and the combined truncation budget.
- Unit tests for `DocumentRepository.listByConversation`: ownership filtering (returns nothing for a different user's conversation).
- Existing `/upload`-specific tests are removed along with the page/route.
