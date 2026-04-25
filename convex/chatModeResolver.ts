/**
 * ChatModeResolver — pure resolver mapping (hasAttachedRepo, sandboxStatus)
 * to (availableModes, defaultMode, disabledReasons).
 *
 * Single source of truth for chat-mode availability used by both the UI mode
 * selector and the `chat.sendMessage` / `chat.createThread` validators on the
 * backend. The same `ChatMode` literals are persisted on `threads.mode` and
 * `messages.mode`, so log-line `mode: 'docs'` matches the UI label "Docs"
 * exactly — no legacy quick/deep aliasing.
 *
 * Mode semantics (PRD #19, Architectural reversal):
 *   - `discuss`  — LLM training only; no repo, no sandbox. Pre-design talk.
 *   - `docs`     — RAG over user-produced artifacts (ADRs, diagrams, analyses)
 *                  for the attached repository.
 *   - `sandbox`  — live filesystem + execution in a Daytona sandbox; the
 *                  canonical source of truth for current code state.
 *
 * Design choices:
 *   - `defaultMode` never auto-selects `'sandbox'` even when a sandbox is
 *     ready. Sandbox mode is the most expensive (sandbox compute + slower
 *     end-to-end) so it is opt-in; defaulting to it would auto-spend sandbox
 *     quota on every new thread.
 *   - When the repository is not attached, `disabledReasons` still carries an
 *     unlock hint for `docs` and `sandbox` so the UI can render the tooltip
 *     promised by US 14 ("disabled modes show a tooltip explaining how to
 *     unlock them"). A mode that is in `disabledReasons` is, by construction,
 *     not in `availableModes`.
 */

export type ChatMode = 'discuss' | 'docs' | 'sandbox';

export type ChatModeSandboxStatus =
  | 'none'
  | 'provisioning'
  | 'ready'
  | 'expired'
  | 'failed';

export interface ChatModeResolution {
  availableModes: ChatMode[];
  defaultMode: ChatMode;
  disabledReasons: Partial<Record<ChatMode, string>>;
}

const DISABLED_REASON_DOCS_NO_REPO =
  'Attach a repository to use Docs mode.';
const DISABLED_REASON_SANDBOX_NO_REPO =
  'Attach a repository and provision a sandbox to use Sandbox mode.';
const DISABLED_REASON_SANDBOX_NO_SANDBOX =
  'Provision a sandbox to use Sandbox mode.';
const DISABLED_REASON_SANDBOX_PROVISIONING =
  'Sandbox is provisioning — Sandbox mode will be available once it is ready.';
const DISABLED_REASON_SANDBOX_EXPIRED =
  'Sandbox expired — provision a new sandbox to use Sandbox mode.';
const DISABLED_REASON_SANDBOX_FAILED =
  'Sandbox provisioning failed — provision a new sandbox to use Sandbox mode.';

export function getDefaultThreadMode(hasAttachedRepo: boolean): ChatMode {
  return hasAttachedRepo ? 'docs' : 'discuss';
}

export function resolveChatModes(
  hasAttachedRepo: boolean,
  sandboxStatus: ChatModeSandboxStatus,
): ChatModeResolution {
  if (!hasAttachedRepo) {
    return {
      availableModes: ['discuss'],
      defaultMode: getDefaultThreadMode(false),
      disabledReasons: {
        docs: DISABLED_REASON_DOCS_NO_REPO,
        sandbox: DISABLED_REASON_SANDBOX_NO_REPO,
      },
    };
  }

  switch (sandboxStatus) {
    case 'ready':
      return {
        availableModes: ['discuss', 'docs', 'sandbox'],
        defaultMode: getDefaultThreadMode(true),
        disabledReasons: {},
      };
    case 'provisioning':
      return {
        availableModes: ['discuss', 'docs'],
        defaultMode: getDefaultThreadMode(true),
        disabledReasons: { sandbox: DISABLED_REASON_SANDBOX_PROVISIONING },
      };
    case 'expired':
      return {
        availableModes: ['discuss', 'docs'],
        defaultMode: getDefaultThreadMode(true),
        disabledReasons: { sandbox: DISABLED_REASON_SANDBOX_EXPIRED },
      };
    case 'failed':
      return {
        availableModes: ['discuss', 'docs'],
        defaultMode: getDefaultThreadMode(true),
        disabledReasons: { sandbox: DISABLED_REASON_SANDBOX_FAILED },
      };
    case 'none':
      return {
        availableModes: ['discuss', 'docs'],
        defaultMode: getDefaultThreadMode(true),
        disabledReasons: { sandbox: DISABLED_REASON_SANDBOX_NO_SANDBOX },
      };
  }
}
