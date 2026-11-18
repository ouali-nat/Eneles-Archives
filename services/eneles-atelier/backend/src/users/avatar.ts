import { randomInt } from 'crypto';
import type { StorageService } from '../storage/storage.service';

/**
 * What `User.avatarUrl` holds. Either the storage key of a photo the person uploaded (`4/avatar/avatar.png`), or a generated picture they chose, written as a preset `<style>:<seed>:<hue>` (`dither:1234:blue`, `gradient:88:teal`, `pixel:5:grey`). A preset is drawn by the browser from its seed and one of the interface's ten hues, so it is returned exactly as stored and never signed. A storage key is private and is turned into a short-lived link before it leaves the API.
 */

/** The interface's ten categorical hues, in the order the frontend lists them. */
export const AVATAR_HUES = ['grey', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'] as const;

/** The generated styles. `dither` is also what every value written before styles existed uses. */
export const AVATAR_STYLES = ['dither', 'gradient', 'pixel'] as const;

/** Seeds are whole numbers below this, so a preset stays short and the browser draws it the same everywhere. */
export const AVATAR_SEED_LIMIT = 1_000_000;

export const AVATAR_PRESET = new RegExp(`^(${AVATAR_STYLES.join('|')}):(\\d{1,6}):(${AVATAR_HUES.join('|')})$`);

export function isAvatarPreset(value: unknown): value is string {
  return typeof value === 'string' && AVATAR_PRESET.test(value);
}

/** A fresh preset for a new account. Grey is left out so a first picture always has a color. */
export function randomAvatarPreset(): string {
  const hues = AVATAR_HUES.filter((hue) => hue !== 'grey');
  return `dither:${randomInt(AVATAR_SEED_LIMIT)}:${hues[randomInt(hues.length)]}`;
}

/** A link that has scheme and host already (a signed link, a link from another service). */
const isLink = (value: string) => /^https?:\/\//i.test(value);

/**
 * The value to send to a browser: a preset or a full link as it is, a storage key as a signed link valid for a day, and nothing for nothing. A key that cannot be signed (storage down) is dropped, so the browser falls back to the person's generated picture rather than a broken image.
 */
export async function publicAvatarUrl(value: string | null | undefined, storage: Pick<StorageService, 'getSignedUrl'>): Promise<string | null> {
  if (!value) return null;
  if (isAvatarPreset(value) || isLink(value)) return value;
  try {
    return await storage.getSignedUrl(value, 86400);
  } catch {
    return null;
  }
}

/** True when the stored value is an uploaded photo's storage key (as opposed to a preset, a link, or nothing). */
export function isStoredPhoto(value: string | null | undefined): value is string {
  return !!value && !isAvatarPreset(value) && !isLink(value);
}
