# Vork System Design

**Date:** 2026-09-14  
**Status:** Approved for implementation planning  
**Repository:** `/Users/maple/code/repo/vork-bot`

## 1. Product definition

Vork is a self-hosted desktop application for creating persistent AI Bots that perform real work through a cloud computer. A Bot has a name, role, instructions, memory, tools, files, browser sessions, and task history. The user interacts with Bots through conversations while work continues on a Tencent Cloud Ubuntu server after the desktop client closes.

The first release is for one user. It supports any number of Bots but limits concurrent execution to three slots on one shared cloud-computer container. Browser-heavy work is limited to two simultaneous slots on the initial 4-core, 8 GB server.

Vork is a general-purpose Bot platform, not a vertical workflow product. Extensibility comes from structured tools, memories, Skills, and later routines and Bot-to-Bot delegation.

## 2. Goals

- Provide a signed macOS Electron client with a conversation-first interface.
- Create Bots conversationally instead of through a conventional setup form.
- Let Bots use a persistent Chromium browser, terminal, and filesystem on a cloud server.
- Keep work running when the desktop application is closed.
- Stream progress, tool activity, approvals, and results back to the client.
- Allow the user to inspect, pause, cancel, approve, or take over work.
- Preserve Bot identity, relevant memories, browser login state, files, and recoverable task state.
- Turn successful work into reviewable, versioned Skill drafts.
- Enforce resource, cost, time, permission, and side-effect limits outside the model.

## 3. Non-goals for the first release

- iOS, Android, Windows, or Linux clients.
- A browser-only client as the primary product.
- A full GNOME or KDE environment in the cloud container.
- Native Windows or macOS applications inside the cloud computer.
- Local model inference or GPU workloads.
- One container per Bot.
- Public multi-user SaaS, billing, team administration, or enterprise identity.
- Public plugins, connectors, or a marketplace.
- User-facing multi-Bot group chat and task delegation.
- Bot-internal hierarchies of temporary planner, worker, and reviewer agents.
- Automatically enabling generated Skills without review.
- Unlimited shell access or unrestricted task duration.

## 4. User experience

### 4.1 Application shell

The Electron client follows a compact, conversation-first layout:

- The left sidebar shows search, conversations/Bots, a new-chat `+` button, and the user identity at the bottom.
- Clicking the user avatar or name opens management destinations such as task queue, Skills, files, model credentials, and settings.
- The central pane shows the selected conversation.
- Live computer execution is hidden by default. A computer control in the conversation header opens it only when requested.
- Approvals appear in the conversation and through macOS notifications.

### 4.2 New chat and Bot creation

Vork uses the interaction verified in the installed Grok Bot application:

1. The sidebar `+` starts a new chat.
2. The main header becomes a recipient search/selection field.
3. The recipient list starts with **Create new Bot**, followed by **Create group chat** when that feature becomes available, then existing Bots.
4. Selecting **Create new Bot** immediately creates a temporary Bot and opens an empty conversation.
5. The user describes the Bot's name, role, and working style in conversation. The Bot converts that exchange into a proposed profile and asks for confirmation before saving consequential permissions.

There is no separate first-release Bot creation form.

### 4.3 Computer view and takeover

The live-execution panel is closed by default. When opened, it can show:

- Chromium video/screenshot stream.
- Current tool and step.
- Terminal output.
- Files created or changed.
- Approval requests.
- Pause, cancel, take-over, and return-control actions.

Browser control has an exclusive state machine:

```text
agent_control -> handoff_pending -> human_control -> agent_control
```

The Agent cannot click or type while the user holds control.

## 5. System architecture

```text
macOS Electron client
        |
        | HTTPS + WebSocket/SSE
        v
API and real-time gateway
        |
        +--> PostgreSQL
        +--> Redis/BullMQ
        +--> Agent workers
                  |
                  v
          Policy and approval layer
                  |
                  v
        Shared cloud-computer container
          +-- execution slot 1
          +-- execution slot 2
          +-- execution slot 3
          +-- persistent volumes
```

The model never controls Docker or the host directly. It produces validated structured tool calls. A policy layer authorizes, rejects, or pauses each call for human approval before the cloud-computer service executes it.

### 5.1 Repository structure

The recommended first-release monorepo is:

```text
apps/
  desktop/       Electron + React + Vite
  api/           Fastify HTTP API and real-time gateway
  worker/        Agent runtime and task consumers
  computer/      Browser, terminal, and file control service
packages/
  contracts/     API, event, and tool schemas
  database/      PostgreSQL schema and access layer
  agent-core/    Agent loop, context, checkpoints, and budgets
  tools/         Browser, terminal, file, memory, and message tools
  policy/        Permissions, approvals, and sensitive-data rules
  shared/        Common types, error model, and logging
infra/
  docker/        Images and runtime configuration
  compose/       Local and server deployments
```

TypeScript is used end-to-end for the first release. Shared contracts use runtime-validated schemas rather than TypeScript types alone.

## 6. Electron client

The desktop application uses three security boundaries:

```text
Electron main process
  +-- window and lifecycle
  +-- automatic updates
  +-- macOS notifications
  +-- Keychain-backed credentials
  +-- native file dialogs and downloads

Preload bridge
  +-- narrow, typed, allowlisted IPC surface

React renderer
  +-- conversations and Bot list
  +-- task event stream
  +-- approvals
  +-- file previews
  +-- computer view and takeover controls
```

Required Electron settings are `contextIsolation: true` and `nodeIntegration: false`. The renderer cannot call Node.js, the filesystem, or shell commands directly. External links open in the system browser. Remote content receives no Electron privileges. API tokens are stored in macOS Keychain rather than renderer state or plaintext configuration.

## 7. Task lifecycle and Agent runtime

### 7.1 Task lifecycle

```text
User message
  -> create queued task
  -> scheduler acquires execution-slot lease
  -> Agent loads scoped context and proposes an action
  -> policy validates the action
  -> tool executes or task waits for approval
  -> observation and checkpoint are saved
  -> Agent continues, completes, fails, or reports a blocker
  -> result and memory proposals are saved
  -> execution-slot lease is released
```

Task states include:

```text
queued
running
waiting_approval
paused
completed
failed
cancelled
```

Every meaningful transition and tool result is appended to a monotonically ordered task event stream. The client reconnects with its last event cursor and receives missed events.

### 7.2 Single-layer Bot runtime

Each Bot uses one controlled model loop for a task:

```text
context -> model -> structured action -> policy -> tool -> observation -> model
```

This does not prevent multiple persistent Bots. It only avoids an internal hierarchy of temporary agents in the first release. Future Bot-to-Bot collaboration is reserved through parent/root task relationships and handoff protocols.

The model may return exactly one typed action per turn, such as:

- `browser.*`
- `terminal.*`
- `file.*`
- `memory.*`
- `message.*`
- `approval.request`
- `task.complete`
- `task.fail`

Every task enforces maximum model turns, tool calls, wall-clock duration, token/cost budget, command duration, output size, consecutive failures, and repeated-action thresholds. Cancellation and lease-heartbeat signals are checked between actions.

### 7.3 Context assembly

Each model turn receives only scoped context:

- Bot role and durable instructions.
- Current task objective and completion criteria.
- Recent conversation messages.
- A compact conversation summary.
- Relevant sourced memories.
- Current browser, terminal, and workspace state.
- A bounded set of recent tool observations.
- Available tool schemas and active policy constraints.

The full conversation and event history are not resent on every turn.

## 8. Shared cloud computer

The first release runs one persistent container for the single account:

```text
cloud-computer container
  +-- process supervisor
  +-- Chromium process/profile per active execution slot
  +-- Xvfb + lightweight window manager
  +-- Playwright control service
  +-- PTY terminal gateway
  +-- workspace file service
  +-- /workspace/bots/{bot_id}
  +-- /workspace/shared
  +-- /browser-profiles/{slot_id}
```

Xvfb and a lightweight window manager exist only to render Chromium and support takeover. The container does not include a general-purpose desktop environment.

The container runs as a non-root user without `--privileged`, the Docker socket, host-sensitive mounts, or public CDP/PTY/file-service ports. CPU, memory, disk, process-count, command-time, and output limits are enforced. The cloud-computer API is reachable only on the internal Docker network with service authentication.

Persistent storage is separated into workspace, browser-profile, and artifact volumes. PostgreSQL data lives outside the cloud-computer container.

### 8.1 Execution slots

- Any number of Bots may exist.
- Three tasks may hold execution slots concurrently.
- At most two slots may run browser-heavy work concurrently on the 4-core, 8 GB server.
- Each slot has an independent Chromium process, browser profile, PTY session, and task workspace.
- A browser crash restarts only its slot.
- New browser work stops when host memory reaches the configured high-water mark, initially 80%.

## 9. Browser observation and recovery

DOM and accessibility information is primary; screenshots and visual reasoning are fallback mechanisms. A page observation includes its ID, URL, title, load state, semantic interactive elements, recent screenshot, downloads, and concise console/network errors.

The model refers to short-lived semantic element references. References expire after navigation or material DOM change. Locator priority is:

1. Accessibility role and accessible name.
2. Stable test or application attributes.
3. Text and DOM relationships.
4. Visual candidate regions.
5. Screen coordinates as a last resort.

An action is successful only when its expected postcondition is verified. Recovery rules include re-observing stale elements, bounded reload/reopen attempts, slot-local browser restart, login-expiration handoff, and immediate user takeover for CAPTCHA or two-factor authentication.

Potentially non-idempotent calls use:

```text
prepared -> executing -> uncertain -> verified_success | safe_to_retry | failed
```

An uncertain submission is inspected before any retry.

## 10. Data model

Core relational entities are:

- `users`
- `bots`
- `conversations`
- `conversation_members`
- `messages`
- `tasks`
- `task_events`
- `tool_calls`
- `approvals`
- `artifacts`
- `memories`
- `execution_leases`
- `browser_profiles`
- `skills`
- `skill_versions`
- `skill_proposals`
- `routines`
- `task_handoffs`
- `audit_logs`

Conversations and tasks are separate: a message may start a task, and a task may emit many messages and events. Task events are append-only. Large screenshots and files are stored outside PostgreSQL with paths, hashes, sizes, and MIME types in the database. Secrets never appear in ordinary events.

Redis holds queues, locks, leases, and transient presence. PostgreSQL is the source of truth.

Future multi-Bot support is reserved through `parent_task_id`, `root_task_id`, `assigned_bot_id`, and `task_handoffs`. Internal `bot.delegate` and `bot.message` contracts may be defined but are not exposed to the model or client in the first release.

## 11. Memory

Memory types are:

- Identity memory: user-approved role, behavior, and durable rules.
- Fact memory: preferences and project context with source and confidence.
- Working memory: current-task summary and unresolved state, compressed or discarded after completion.

Each durable memory records its Bot, type, content, source task/message, confidence, sensitivity, creation time, last-use time, and supersession link. Passwords, cookies, and API keys are credentials, not memories.

The model proposes memories. The memory service performs duplicate and contradiction checks. Ordinary preferences may be saved according to policy; sensitive information requires explicit confirmation. The user can inspect, edit, supersede, or delete durable memory.

PostgreSQL full-text search and `pgvector` are sufficient for the first release; no standalone vector database is required.

## 12. Skills and routines

A Skill is a versioned, reusable procedure:

```text
skills/{skill-name}/
  SKILL.md
  manifest.json
  scripts/
  references/
```

The manifest declares version, intended tasks, inputs/outputs, required tools and domains, permission/approval requirements, limits, source, and integrity hash. Effective permissions are the intersection of the Skill, Bot, and task policies.

Vork supports automatic experience summarization, but generated experience is never enabled automatically:

```text
successful task
  -> extract trace
  -> remove mistakes, incidental waits, and secrets
  -> parameterize task-specific values
  -> infer semantic steps, recovery, permissions, and success criteria
  -> generate Skill proposal
  -> sandbox replay/validation
  -> user review
  -> publish version
```

The first release supports manual **Save as Skill** and suggestions after repeated similar successes. Later versions may monitor success rate and propose revisions or suspend a repeatedly failing version.

Routines are reserved as `trigger + Bot + task template + budget + policy`. The first release defines storage and task-creation boundaries but does not expose routine scheduling in the client.

## 13. Permissions and approvals

Permission decisions occur outside the model:

- Low risk: page reading and workspace search may execute automatically.
- Medium risk: software installation or first access to a domain follows configured policy.
- High risk: sending, submitting, deleting, uploading sensitive data, or financial actions require explicit approval.
- Forbidden: host modification, Docker socket access, privilege escalation, disabling audit, or escaping workspace/network policy.

Tool schemas validate all inputs. File paths are canonicalized and restricted to approved roots. Terminal calls run as non-root processes with tracked process trees. Logs are structured and redact credentials and sensitive fields.

## 14. Error handling and observability

- Client disconnection never cancels cloud work.
- Reconnection resumes from the last acknowledged event cursor.
- Worker restart resumes from durable checkpoints and expired leases.
- Cloud-computer unavailability pauses tasks instead of allowing blind model planning.
- Model timeouts use bounded exponential retry and may use a configured fallback provider.
- User-facing errors always provide an actionable state such as retry, log in, take over, or cancel.
- Logs correlate `request_id`, `task_id`, and `tool_call_id` and are automatically redacted.

Metrics include CPU, memory, disk, queue depth, slot state, task success rate, model cost, approval waits, and browser crashes.

## 15. Testing

Four test layers are required:

1. Unit tests for task state transitions, policy decisions, budgets, memory conflict handling, and Skill proposals.
2. Contract tests for Electron IPC, HTTP/realtime APIs, events, and tool schemas.
3. Integration tests with real PostgreSQL, Redis, Docker, and controlled test websites.
4. End-to-end tests for Bot creation, browser execution, terminal work, file output, approval, takeover, cancellation, and crash recovery.

Routine automated tests use a deterministic fake model that emits known tool calls. A small separate suite performs real-model smoke tests. Browser tests use controlled local sites rather than unstable third-party pages.

The release acceptance scenarios are:

1. A research Bot visits multiple controlled sites and produces a cited Markdown report.
2. A development Bot modifies a sample workspace through the terminal and runs its tests.
3. A file Bot organizes uploaded files and requests approval before overwrite or deletion.
4. After service restart, Bots, conversations, browser profiles, files, and a recoverable task remain available.

## 16. Deployment

The initial target is Tencent Cloud Ubuntu with 4 CPU cores, 8 GB RAM, and 512 GB storage. Model inference uses external APIs; no GPU is required.

Docker Compose runs Caddy, API, worker, PostgreSQL, Redis, and the cloud-computer container. Only these host ports are public:

- `443` for HTTPS and realtime traffic.
- `22` for SSH, restricted to the user's IP or a bastion service.

PostgreSQL, Redis, Chromium CDP, remote-screen transport, PTY, file service, and the Docker API are never public. Caddy terminates TLS and proxies authenticated HTTP and realtime traffic.

Database backups run daily. Workspace and browser-profile volumes receive encrypted snapshots. Restore procedures must be tested. Before selecting a Tencent Cloud region, deployment must verify model API and target-site reachability; Hong Kong or another suitable region is preferred when mainland connectivity is unreliable.

## 17. First-release completion criteria

The first release is complete when:

- A signed macOS Electron application connects securely to the server.
- Conversational Bot creation and the approved compact UI work end to end.
- Three execution slots are scheduled safely, with no more than two heavy browser tasks.
- Browser, terminal, and file tools run through validated policies and durable task events.
- Approvals, takeover, cancellation, reconnection, and restart recovery work.
- Durable Bot identity and sourced memories survive restart.
- A successful task can produce a reviewable Skill proposal.
- The four acceptance scenarios pass in a clean deployment.
- Operational documentation covers installation, secrets, backup, restore, upgrade, and incident recovery.

