import { createSignal, For, Show } from 'solid-js';
import { generateRandomCharacter } from '../character/generator';
import {
  buildCharacterSpriteUrl,
  normalizeMapleSimCharacter,
} from '../character/parser';
import type { MapleSimCharacter } from '../types/maple';

interface CharacterModalProps {
  character: MapleSimCharacter;
  onSave: (character: MapleSimCharacter) => void;
  onClose: () => void;
}

export function CharacterModal(props: CharacterModalProps) {
  const [draft, setDraft] = createSignal<MapleSimCharacter>(
    structuredClone(props.character),
  );
  const [nameInput, setNameInput] = createSignal(props.character.name || 'Mapler');
  const [jsonInput, setJsonInput] = createSignal('');
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [successMsg, setSuccessMsg] = createSignal<string | null>(null);

  let fileInputRef: HTMLInputElement | undefined;

  const previewUrl = () => buildCharacterSpriteUrl(draft(), 'stand1', 0, 'default');

  const handleRandomize = () => {
    const next = generateRandomCharacter(nameInput());
    next.position = { ...draft().position };
    setDraft(next);
    setErrorMsg(null);
    setSuccessMsg('Generated a new random MapleStory character!');
  };

  const applyJsonText = (rawText: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const parsed = JSON.parse(rawText);
      const normalized = normalizeMapleSimCharacter(parsed, nameInput());
      normalized.position = { ...draft().position };
      if (normalized.name) {
        setNameInput(normalized.name);
      }
      setDraft(normalized);
      setSuccessMsg('Imported maples.im character JSON!');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to parse maples.im JSON.',
      );
    }
  };

  const handleFileUpload = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    setJsonInput(text);
    applyJsonText(text);
    input.value = '';
  };

  const handleExportJson = () => {
    const current = {
      ...draft(),
      name: nameInput().trim() || 'Mapler',
    };
    const blob = new Blob([JSON.stringify(current, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${current.name || 'character'}-maplesim.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApply = (e: Event) => {
    e.preventDefault();
    const updated: MapleSimCharacter = {
      ...draft(),
      name: nameInput().trim().slice(0, 20) || 'Mapler',
    };
    props.onSave(updated);
    props.onClose();
  };

  const equippedList = () =>
    Object.entries(draft().selectedItems || {}).map(([slot, item]) => ({
      slot,
      name: item.name || slot,
      id: item.id,
      noIcon: item.noIcon,
      region: item.region || 'GMS',
      version: item.version || '270',
    }));

  return (
    <div
      class="ms-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="ms-window ms-char-modal">
        <div class="ms-window-titlebar">
          <span>CHARACTER &amp; MAPLES.IM IMPORT</span>
          <button type="button" class="ms-close-btn" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <form class="ms-modal-body" onSubmit={handleApply}>
          <div class="ms-char-top-row">
            <div class="ms-char-preview-card">
              <div class="ms-char-stage">
                <img
                  src={previewUrl()}
                  alt="Character preview"
                  class="ms-pixelated"
                />
              </div>
              <button
                type="button"
                class="ms-btn ms-btn-gold"
                onClick={handleRandomize}
              >
                🎲 Randomize Look
              </button>
            </div>

            <div class="ms-char-details">
              <label class="ms-label">
                Character Name (IGN)
                <input
                  type="text"
                  class="ms-input"
                  maxLength={20}
                  value={nameInput()}
                  onInput={(e) => setNameInput(e.currentTarget.value)}
                  placeholder="Enter character name..."
                />
              </label>

              <div class="ms-ear-toggles">
                <label class="ms-checkbox">
                  <input
                    type="checkbox"
                    checked={draft().mercEars}
                    onChange={(e) =>
                      setDraft({
                        ...draft(),
                        mercEars: e.currentTarget.checked,
                        illiumEars: e.currentTarget.checked
                          ? false
                          : draft().illiumEars,
                      })
                    }
                  />
                  <span>Mercedes Ears</span>
                </label>
                <label class="ms-checkbox">
                  <input
                    type="checkbox"
                    checked={draft().illiumEars}
                    onChange={(e) =>
                      setDraft({
                        ...draft(),
                        illiumEars: e.currentTarget.checked,
                        mercEars: e.currentTarget.checked
                          ? false
                          : draft().mercEars,
                      })
                    }
                  />
                  <span>Illium Ears</span>
                </label>
              </div>

              <div class="ms-equipped-box">
                <div class="ms-equipped-header">
                  Equipped Items ({equippedList().length})
                </div>
                <div class="ms-equipped-items">
                  <For each={equippedList()}>
                    {(item) => (
                      <span class="ms-item-pill" title={`ID: ${item.id}`}>
                        {item.slot}: {item.name} (#{item.id})
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </div>

          <div class="ms-import-section">
            <div class="ms-import-header">
              <span>
                Import from{' '}
                <a
                  href="https://maples.im/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  maples.im
                </a>{' '}
                JSON
              </span>
              <div class="ms-import-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  class="ms-btn ms-btn-blue"
                  onClick={() => fileInputRef?.click()}
                >
                  📂 Upload .json File
                </button>
                <button
                  type="button"
                  class="ms-btn"
                  onClick={handleExportJson}
                >
                  💾 Export .json
                </button>
              </div>
            </div>

            <textarea
              class="ms-textarea"
              rows={5}
              value={jsonInput()}
              onInput={(e) => setJsonInput(e.currentTarget.value)}
              placeholder='Paste exported JSON from https://maples.im/ here (e.g. { "type": "character", "skin": 2000, "selectedItems": { ... } })'
            />

            <div class="ms-paste-bar">
              <button
                type="button"
                class="ms-btn"
                disabled={!jsonInput().trim()}
                onClick={() => applyJsonText(jsonInput())}
              >
                Apply Pasted JSON
              </button>
            </div>

            <Show when={errorMsg()}>
              <div class="ms-alert ms-alert-error">{errorMsg()}</div>
            </Show>
            <Show when={successMsg()}>
              <div class="ms-alert ms-alert-ok">{successMsg()}</div>
            </Show>
          </div>

          <div class="ms-modal-footer">
            <button type="button" class="ms-btn" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" class="ms-btn ms-btn-primary">
              Save Character
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
