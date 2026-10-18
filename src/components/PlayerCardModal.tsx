import { createSignal, Show } from 'solid-js';
import { buildCharacterSpriteUrl } from '../character/parser';
import type { MapleSimCharacter } from '../types/maple';

export interface PlayerCardTarget {
  id: string;
  name: string;
  character: MapleSimCharacter;
  isSelf: boolean;
}

export interface PlayerFameStatus {
  fame: number;
  canFame: boolean;
  nextAt: number;
}

interface PlayerCardModalProps {
  player: PlayerCardTarget;
  /** Undefined while the server has not answered the fame query yet. */
  fame: PlayerFameStatus | undefined;
  muted: boolean;
  reported: boolean;
  onFame: (direction: 'up' | 'down') => void;
  onToggleMute: () => void;
  onReport: (reason: string) => void;
  onClose: () => void;
}

/** "in 3 days" / "again tomorrow" / "" for a fame cooldown timestamp. */
function formatFameCooldown(nextAt: number): string {
  if (!nextAt) return '';
  const days = Math.ceil((nextAt - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return '';
  return days === 1 ? 'again tomorrow' : `again in ${days} days`;
}

export function PlayerCardModal(props: PlayerCardModalProps) {
  const [reason, setReason] = createSignal('');

  const spriteUrl = () =>
    buildCharacterSpriteUrl(props.player.character, 'stand1', 0, 'default', 'Full');

  const fameDisabled = () =>
    props.player.isSelf || !props.fame || !props.fame.canFame;

  const fameHint = () => {
    if (props.player.isSelf) return "You can't fame yourself.";
    if (!props.fame) return 'Checking your weekly fame...';
    if (props.fame.canFame) return 'Fame up or down — once a week.';
    const when = formatFameCooldown(props.fame.nextAt);
    return when ? `You can fame ${when}.` : 'You already famed this week.';
  };

  const fameTone = () => {
    const value = props.fame?.fame ?? 0;
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return 'zero';
  };

  return (
    <div
      class="ms-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="ms-window ms-playercard">
        <div class="ms-window-titlebar">
          <span>CHARACTER</span>
          <button type="button" class="ms-close-btn" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <div class="ms-playercard-body">
          <div class="ms-playercard-left">
            <div class="ms-playercard-stage">
              <img
                src={spriteUrl()}
                alt={`${props.player.name} character`}
                class="ms-pixelated"
              />
            </div>
            <div class="ms-playercard-nametag" title={props.player.name}>
              {props.player.name}
            </div>
          </div>

          <div class="ms-playercard-right">
            <div class="ms-playercard-row">
              <span class="ms-playercard-label">FAME</span>
              <span class={`ms-playercard-value ${fameTone()}`}>
                <Show when={props.fame} fallback="…">
                  {props.fame!.fame}
                </Show>
              </span>
              <div class="ms-fame-buttons">
                <button
                  type="button"
                  class="ms-fame-btn"
                  disabled={fameDisabled()}
                  onClick={() => props.onFame('up')}
                  title={
                    props.player.isSelf ? "You can't fame yourself" : 'Fame Up'
                  }
                >
                  ▲
                </button>
                <button
                  type="button"
                  class="ms-fame-btn"
                  disabled={fameDisabled()}
                  onClick={() => props.onFame('down')}
                  title={
                    props.player.isSelf ? "You can't fame yourself" : 'Fame Down'
                  }
                >
                  ▼
                </button>
              </div>
            </div>
            <div class="ms-playercard-fame-hint">{fameHint()}</div>

            <button
              type="button"
              class="ms-btn ms-playercard-mute"
              disabled={props.player.isSelf}
              onClick={props.onToggleMute}
              title={
                props.player.isSelf
                  ? "You can't mute yourself"
                  : props.muted
                    ? 'Show their chat again'
                    : 'Hide their chat messages'
              }
            >
              {props.muted ? '🔊 Unmute' : '🔇 Mute'}
            </button>
          </div>

          <div class="ms-playercard-report">
            <input
              type="text"
              class="ms-input"
              maxLength={200}
              value={reason()}
              onInput={(e) => setReason(e.currentTarget.value)}
              placeholder="Report reason (optional)"
            />
            <button
              type="button"
              class="ms-btn"
              disabled={props.reported || props.player.isSelf}
              onClick={() => props.onReport(reason())}
            >
              {props.reported ? '✅ Reported' : '🚩 Report'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
