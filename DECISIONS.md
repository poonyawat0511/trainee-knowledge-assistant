# Architecture Decisions

## Decision 1: Chose SQLite over PostgreSQL

### Context

The project needs to persist users, uploaded document text, conversations, and chat messages. The exam's tech stack table allows any database. The deployment target is a single `docker compose up` command, ideally with as few moving parts as possible.

### Alternatives Considered

PostgreSQL was the main alternative — it's the more common choice for a "serious" backend and would demonstrate relational database skills more explicitly (foreign keys, richer query capabilities, connection pooling). MongoDB was briefly considered for the document-storage side but rejected early since the actual document data being stored (extracted text) is a simple string field, not a nested/variable-shape document that would benefit from a document store.

### Why SQLite

The data model here is small and simple: four tables, no complex joins, no need for concurrent write-heavy access patterns (this is a single-user-at-a-time demo app with one mock login). SQLite via `better-sqlite3` needs zero extra infrastructure — no separate container, no connection string, no network round-trip between the app and the DB. That directly serves the "single `docker compose up` command" requirement: with Postgres, the compose file would need a second service, a wait-for-it style startup dependency, and connection retry logic in the app. With SQLite, the "database" is a file on a mounted volume.

### Trade-offs

The obvious cost is that this doesn't scale past a single container/process, and it doesn't showcase relational-database-specific skills (migrations against a running server, connection pooling, read replicas) the way Postgres would. If this project needed multiple app instances behind a load balancer, SQLite would become a real bottleneck (file-level locking, no built-in replication). For this project's actual scope — a small assessment app with one demo user — that trade-off is the right one; the added operational complexity of Postgres would not have bought anything the exam is actually testing for.

## Decision 2: Skipping RAG in favor of full-context injection

### Context

The exam explicitly frames RAG (chunking + embedding + vector retrieval) as an optional bonus feature worth 8 points, not a required one — the required "Chat with Uploaded File Context" feature only asks that the chat "work accurately" and "handle large files," not that it use retrieval specifically.

### Alternatives Considered

The alternative was building the full RAG pipeline: chunk uploaded documents, embed each chunk (via OpenRouter or a separate embeddings API), store vectors in a vector DB (Chroma/Pinecone/Qdrant), and retrieve the top-k relevant chunks per question to inject as context. This was scoped out early during design, before any implementation started, as a conscious effort-allocation call rather than something attempted and abandoned.

### Why full-context injection

Given a fixed time budget, RAG adds a genuinely large amount of new surface area — an embedding pipeline, a vector store dependency, chunk-boundary tuning, and a retrieval-quality feedback loop — for a document-Q&A use case where most uploaded files (in a demo/assessment context) are short enough to fit entirely in a single context window. Injecting the full (truncated-if-necessary) document text as a system prompt gets correctness for the common case with a fraction of the implementation and testing cost, leaving more time for the required features and other bonus work (streaming, conversation history, rate limiting, tests) to be done well rather than everything done shallowly.

### Trade-offs

This approach degrades badly for genuinely large documents: past the truncation budget (~12,000 characters, roughly 3,000 tokens), the tail of the document is simply cut off and invisible to the model — there's no retrieval fallback to still find a relevant passage from the truncated portion. It also sends more tokens per request than a retrieval approach would once a document exceeds a few paragraphs, which costs more against any rate/usage limits. This is documented explicitly as a known limitation rather than silently accepted.

## Decision 3: Clean architecture module structure over a flat layering

### Context

The initial default plan (before user feedback) was a simpler `route → service → repository` layering, common for small Next.js projects. During design review, the explicit preference was for a stricter clean-architecture split per feature module.

### Alternatives Considered

The simpler alternative was one `services/` and one `repositories/` directory shared across the whole app, with each service function directly calling out to whichever repository or external API it needed. This is faster to write initially and is a completely reasonable choice for a project this size — many equally small apps use exactly that shape successfully.

### Why clean architecture modules

Per-feature `domain/application/infrastructure` layering makes the dependency direction explicit and enforced by folder structure, not just convention: `application` code can only ever depend on `domain` types and its own `ports.ts` interfaces, never on a concrete database or HTTP client directly. This made every use-case trivially unit-testable with hand-rolled mocks implementing the port interfaces, with zero database or network setup needed in the test suite — which is exactly how the required 40%+ coverage bar was met, entirely at the `application/` layer. It also made the one deliberate cross-module dependency (`chat` needing to read `documents`' data) a single, visible, intentional seam (`document-text-lookup.ts`) rather than an implicit coupling that could grow uncontrolled.

### Trade-offs

This is more ceremony per feature than the flatter alternative — three folders and at least three files (entity, ports, use-case) for even a small piece of logic, and more indirection to trace through when reading the code for the first time (a route handler calls a factory, which composes a use-case, which depends on an interface, which is implemented by an infrastructure class, defined in yet another file). For a project of this size, a flatter structure would likely have been faster to build and just as correct; the clean-architecture split earns its cost primarily through the testability win and the deliberate module-boundary enforcement, not through raw development speed.

## Decision 4: Rewriting the UI on shadcn/ui instead of hand-rolled Tailwind

### Context

The original UI (login form, chat window, inline file-attach) was built as plain Tailwind-styled elements — raw `<button>`/`<input>` tags with utility classes, no shared component layer. As the app grew a sidebar, a header, a mobile drawer, and a second full page (`/upload`), that approach started producing inconsistent spacing, duplicated styling logic between pages, and a layout that could scroll at the page level in a way that looked broken on short viewports. A decision was needed on whether to keep hand-rolling markup or adopt a component layer before the app grew further.

### Alternatives Considered

The main alternative was continuing hand-rolled Tailwind: no new dependency, full control over every class, and no risk of a component library's API not matching an interaction the app needed. A second alternative was a heavier, fully-styled component library (e.g. Chakra, MUI) that ships its own runtime styling engine and design opinions.

### Why shadcn/ui

shadcn/ui generates owned component source files into the repo (`src/components/ui/`) rather than installing an opaque runtime package — so it reads and edits exactly like the rest of the hand-written code, with no black-box styling engine to fight. It sits directly on the Tailwind setup already in place, so adopting it was additive, not a rewrite of the styling approach. Using it gave the app a shared `Button`/`Input`/`Card`/`Sheet`/`Select`/`DropdownMenu` vocabulary once, instead of every page reinventing focus states, disabled states, and spacing by hand — which is what made the fixed sidebar/header/mobile-drawer shell and the `/upload` page's card layout straightforward to build consistently across both.

### Trade-offs

The installed primitives turned out to be built on `@base-ui/react`, not Radix — despite shadcn/ui's own ecosystem documentation and most examples online assuming Radix's `asChild` composition prop. Every polymorphic composition (a `Button` rendering as a `Link`, a `Sheet` trigger rendering as a `Button`) needed adapting to base-ui's `render` prop instead, and one such adaptation was initially done incorrectly (a `<button>` nested inside an `<a>`, invalid HTML) before a task-scoped review caught it. This is a real ongoing cost: any future shadcn snippet copied from documentation or a blog post will need the same manual translation rather than working as pasted.
