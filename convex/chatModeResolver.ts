/**
 * ChatModeResolver — pure resolver mapping (hasAttachedRepo, sandboxStatus)
 * to (availableModes, defaultMode, disabledReasons).
 *
 * Single source of truth for chat-mode availability used by both the UI mode
 * selector and any backend gating that needs the same answer.
 *
 * Design choices:
 *   - `defaultMode` never auto-selects `'deep'` even when a sandbox is ready.
 *     Deep mode is sandbox-backed and therefore opt-in; defaulting to it would
 *     auto-spend sandbox quota on every new thread.
 *   - When the repository is not attached, `disabledReasons` still carries an
 *     unlock hint for `grounded` and `deep` so the UI can render the tooltip
 *     promised by US 14 ("disabled modes show a tooltip explaining how to
 *     unlock them"). A mode that is in `disabledReasons` is, by construction,
 *     not in `availableModes`.
 */

export type ChatMode = 'general' | 'grounded' | 'deep';

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

const DISABLED_REASON_GROUNDED_NO_REPO =
  'Attach a repository to use grounded mode.';
const DISABLED_REASON_DEEP_NO_REPO =
  'Attach a repository with a ready sandbox to use deep mode.';
const DISABLED_REASON_DEEP_NO_SANDBOX =
  'Provision a sandbox to use deep mode.';
const DISABLED_REASON_DEEP_PROVISIONING =
  'Sandbox is provisioning — deep mode will be available once it is ready.';
const DISABLED_REASON_DEEP_EXPIRED =
  'Sandbox expired — provision a new sandbox to use deep mode.';
const DISABLED_REASON_DEEP_FAILED =
  'Sandbox failed — provision a new sandbox to use deep mode.';

export function resolveChatModes(
  hasAttachedRepo: boolean,
  sandboxStatus: ChatModeSandboxStatus,
): ChatModeResolution {
  if (!hasAttachedRepo) {
    return {
      availableModes: ['general'],
      defaultMode: 'general',
      disabledReasons: {
        grounded: DISABLED_REASON_GROUNDED_NO_REPO,
        deep: DISABLED_REASON_DEEP_NO_REPO,
      },
    };
  }

  switch (sandboxStatus) {
    case 'ready':
      return {
        availableModes: ['general', 'grounded', 'deep'],
        defaultMode: 'grounded',
        disabledReasons: {},
      };
    case 'provisioning':
      return {
        availableModes: ['general', 'grounded'],
        defaultMode: 'grounded',
        disabledReasons: { deep: DISABLED_REASON_DEEP_PROVISIONING },
      };
    case 'expired':
      return {
        availableModes: ['general', 'grounded'],
        defaultMode: 'grounded',
        disabledReasons: { deep: DISABLED_REASON_DEEP_EXPIRED },
      };
    case 'failed':
      return {
        availableModes: ['general', 'grounded'],
        defaultMode: 'grounded',
        disabledReasons: { deep: DISABLED_REASON_DEEP_FAILED },
      };
    case 'none':
      return {
        availableModes: ['general', 'grounded'],
        defaultMode: 'grounded',
        disabledReasons: { deep: DISABLED_REASON_DEEP_NO_SANDBOX },
      };
  }
}
