# Vork Agents API Runtime Implementation Plan

> **For agentic workers:** Execute inline with test-driven development. Do not commit; the user requested working-tree delivery.

**Goal:** Make OpenAI Agents API the default Vork conversation runtime with durable session reuse and streamed replies.

**Architecture:** Add a small runtime adapter in the Worker and a durable conversation-to-session mapping in PostgreSQL. Preserve Vork's queue and event protocol, translating Agents API events into the existing task lifecycle.

**Tech Stack:** TypeScript, OpenAI JavaScript SDK, PostgreSQL/Drizzle, BullMQ, Vitest

**Spec:** `docs/superpowers/specs/2026-09-30-vork-agents-api-runtime-design-zh-CN.md`

## Global Constraints

- Do not commit Git changes.
- Preserve all existing dirty-worktree changes.
- Default to Agents API; legacy runtime requires an explicit switch.
- Do not rebuild or change the Computer image in this slice.

### Task 1: Durable session mapping

**Files:** database schema, migration, repository and integration tests.

- [ ] Write a failing repository test for create/get/delete session mapping.
- [ ] Add the `agent_sessions` table and migration.
- [ ] Implement repository methods and make the focused test pass.

### Task 2: Agents API event adapter

**Files:** `apps/worker/src/agent-runtime/openai-agents-client.ts` and test.

- [ ] Write failing tests for session creation, continuation, text extraction and terminal outcomes.
- [ ] Implement a dependency-injected SDK adapter.
- [ ] Verify malformed and failed events produce stable errors.

### Task 3: Vork task integration

**Files:** Agents task runner, `run-task.ts`, Worker startup and tests.

- [ ] Write failing task tests for first message, continued message and missing credential.
- [ ] Implement task claiming, streamed deltas, durable completion and session reuse.
- [ ] Make Agents API the default and retain `legacy` as an explicit runtime.

### Task 4: Configuration and verification

**Files:** Worker package, `.env.example`, Compose configuration and Chinese README.

- [ ] Add the OpenAI SDK and documented environment variables.
- [ ] Run database, Worker and API tests plus type checks.
- [ ] Run `git diff --check` and document any live-API limitation.

