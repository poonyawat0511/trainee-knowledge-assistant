# shadcn/ui App-Shell Overhaul — Design

## Goal

Rebuild the frontend presentation layer on shadcn/ui: a fixed app-shell layout (sidebar + header that never cause page-level scrollbars, with a mobile drawer), a minimal pastel (non-gradient) theme in light and dark, and a return to Part 1's file-upload flow — a dedicated `/upload` page reached by navigation, replacing the inline chat-attach button entirely. No changes to `domain/`, `application/`, or `infrastructure/` — this is presentation-layer only; API contracts are unchanged.

## Setup

- `npx shadcn@latest init` — creates `components.json` and `src/components/ui/`, targeting the existing Tailwind v4 setup.
- Components installed: `button`, `input`, `textarea`, `card`, `dialog`, `select`, `scroll-area`, `sheet`, `separator`, `avatar`, `dropdown-menu`, `sonner`, `skeleton`.
- `lucide-react` added for icons, replacing emoji (📎 → `Paperclip`, hamburger → `Menu`, etc.).
- Scope: the whole app (login, chat, upload, sidebar, header) is rewritten with shadcn components — every raw `<button>`/`<input>`/ad-hoc-Tailwind-class element in `src/app/` is in scope.

## App Shell Layout

New route group `src/app/(app)/layout.tsx` wraps `/chat` and `/upload` (both already behind the `proxy.ts` auth guard). Structure:

```
<div className="h-dvh flex overflow-hidden">
  <Sidebar />                                   {/* fixed width, own internal scroll for the conversation list */}
  <div className="flex flex-1 flex-col overflow-hidden">
    <Header />                                  {/* fixed height, never scrolls */}
    <main className="flex-1 overflow-y-auto">{children}</main>
  </div>
</div>
```

`h-dvh` + `overflow-hidden` at the root prevents any page-level scrollbar; only `<main>` scrolls internally. This is the fix for the current layout's scrollbar/responsive breakage.

**Shared state:** conversation list + `activeConversationId`, currently local state inside `chat/page.tsx`, move to an `AppShellProvider` React Context established in `(app)/layout.tsx` — the Sidebar (now in the layout, outside `/chat`'s own tree) needs to read and set the active conversation without prop-drilling across the route boundary. `/upload` does not consume this context.

**Mobile (`< md` breakpoint):** Sidebar is hidden; a hamburger button in the Header opens a shadcn `Sheet` (slide-in drawer) containing the same sidebar content.

**Header contents:** app name/logo, hamburger (mobile only), an "Upload" button (`Paperclip` icon, navigates to `/upload` — this replaces the old inline-attach button), the Document-context `Select` (visible only on `/chat`), and a user menu (`DropdownMenu`, Log out) on the right.

## Chat Page Changes

`chat-window.tsx` loses everything related to inline attachment: the 📎 button, `handleAttach`, the `attachments` state and its chip UI, and the attach-side race-condition handling in `conversationCreationRef` (the corresponding fix from the earlier feature branch). What remains: the compose box (shadcn `Input` + `Button`) and the existing lazy-conversation-creation-on-first-send behavior (a conversation is still created automatically the first time the user sends a message in a fresh, unsaved chat — this part of the earlier design is unchanged).

The Document-context `Select` (moved to the Header) is unaffected in behavior — it still lets the user pick any of their previously-uploaded documents as explicit chat context, via the existing `documentId` request field and `BuildContextUseCase` combination logic.

## Upload Page

`/upload` lives inside the `(app)` shell (same sidebar/header as `/chat`). Its content is a centered shadcn `Card`, styled to read visually like a modal (shadow, constrained max-width, vertically centered) but is a real page, not a dialog overlay. Contents: heading, a styled file picker (shadcn `Input type="file"` or a button with the `Paperclip` icon), upload status communicated via `sonner` toasts (replacing the current inline status paragraph), and a link back to `/chat`.

This is the only user-facing entry point for uploading a document now that inline attach is removed; the underlying `POST /api/documents` call and its lazy-conversation-creation behavior are unchanged (a document uploaded here without a `conversationId` still gets its own new conversation server-side, exactly as today — this page doesn't pass one).

## Theme

`globals.css` is replaced with the full shadcn CSS-variable convention (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`), defined in OKLCH, for both light and dark:

- **Light:** near-white background with a faint lavender tint; primary is a dusty/muted blue; accent is a soft mint or peach; muted is a pale purple-gray; borders are very light.
- **Dark:** deep muted navy/charcoal background (not pure black); the same primary/accent hues desaturated to stay readable without harsh contrast.
- **Hard rule:** no `bg-gradient-to-*` or any gradient anywhere in the app — every surface (buttons, cards, header, sidebar) is a flat color.

Every rewritten shadcn component picks this up automatically since shadcn components reference these variables by convention.

## Error Handling / Edge Cases

- Toast (`sonner`) replaces inline error `<p>` text for upload success/failure on `/upload`; chat's existing inline error text (AI provider failures, rate limiting) is unchanged — only the upload flow's feedback mechanism changes.
- Mobile drawer (`Sheet`) closes on conversation selection (tap a conversation → drawer closes, `/chat` shows it) — standard drawer-nav behavior, no new state needed beyond the Sheet's own open/close.
- No change to auth, rate limiting, or any API route — purely a presentation-layer rewrite.

## Testing

No new automated tests — this project's test coverage is scoped to `application/` and `shared/` (per `vitest.config.ts`); no `.tsx` test infrastructure exists today, matching the precedent set by the earlier inline-chat-upload feature's UI tasks. Verification is manual: run `pnpm dev`, confirm no page-level scrollbar appears at any viewport width, confirm the mobile drawer opens/closes correctly, confirm `/upload` is reachable only via the Header button (no more inline attach), and confirm light/dark theme both render without gradients.
