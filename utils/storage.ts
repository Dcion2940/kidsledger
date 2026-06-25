
import { AppSettings } from '../types';

const SETTINGS_KEY = 'kidsledger_settings';
const ADULT_MANAGER_ENABLED_KEY = 'kidsledger_adult_manager_enabled';
const DEVICE_APP_LOCK_PREFERENCES_KEY = 'kidsledger_device_app_lock_preferences_v1';

interface DeviceAppLockPreference {
  requireAppUnlock: boolean;
  trustedAt?: number;
}

type DeviceAppLockPreferenceMap = Record<string, DeviceAppLockPreference>;
const DEFAULT_SETTINGS: AppSettings = {
  aiMentorEnabled: true,
  aiApiLink: '',
  idleLockMinutes: 10,
  telegramChatId: '',
  telegramNotifyOnCreate: false,
  telegramNotifyOnStart: false,
  telegramBotTokenConfigured: false,
  usdTwdReferenceRate: 0,
  usdTwdReferenceUpdatedAt: '',
  usdTwdReferenceSource: ''
};

export const storageManager = {
  getSettings: (): AppSettings => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return DEFAULT_SETTINGS;

    try {
      const parsed = JSON.parse(saved) as Partial<AppSettings>;
      return {
        aiMentorEnabled: parsed.aiMentorEnabled ?? true,
        aiApiLink: parsed.aiApiLink || '',
        idleLockMinutes:
          Number.isFinite(parsed.idleLockMinutes) && Number(parsed.idleLockMinutes) > 0
            ? Number(parsed.idleLockMinutes)
            : 10,
        telegramChatId: parsed.telegramChatId || '',
        telegramNotifyOnCreate: parsed.telegramNotifyOnCreate === true,
        telegramNotifyOnStart: parsed.telegramNotifyOnStart === true,
        telegramBotTokenConfigured: parsed.telegramBotTokenConfigured === true,
        usdTwdReferenceRate:
          Number.isFinite(parsed.usdTwdReferenceRate) && Number(parsed.usdTwdReferenceRate) > 0
            ? Number(parsed.usdTwdReferenceRate)
            : 0,
        usdTwdReferenceUpdatedAt: parsed.usdTwdReferenceUpdatedAt || '',
        usdTwdReferenceSource: parsed.usdTwdReferenceSource || ''
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },
  saveSettings: (settings: AppSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  },
  clearSettings: () => {
    localStorage.removeItem(SETTINGS_KEY);
  },
  getAdultManagerEnabled: (): boolean => {
    const saved = localStorage.getItem(ADULT_MANAGER_ENABLED_KEY);
    return saved === 'true';
  },
  saveAdultManagerEnabled: (enabled: boolean) => {
    localStorage.setItem(ADULT_MANAGER_ENABLED_KEY, enabled ? 'true' : 'false');
  },
  clearAdultManagerEnabled: () => {
    localStorage.removeItem(ADULT_MANAGER_ENABLED_KEY);
  },
  getCurrentDeviceAppLockPreference: (userEmail?: string | null): DeviceAppLockPreference => {
    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    if (!normalizedEmail) {
      return { requireAppUnlock: true };
    }

    try {
      const raw = localStorage.getItem(DEVICE_APP_LOCK_PREFERENCES_KEY);
      if (!raw) return { requireAppUnlock: true };
      const parsed = JSON.parse(raw) as DeviceAppLockPreferenceMap;
      const saved = parsed?.[normalizedEmail];
      if (!saved || typeof saved !== 'object') return { requireAppUnlock: true };
      return {
        requireAppUnlock: saved.requireAppUnlock !== false,
        trustedAt: typeof saved.trustedAt === 'number' ? saved.trustedAt : undefined
      };
    } catch {
      return { requireAppUnlock: true };
    }
  },
  saveCurrentDeviceAppLockPreference: (userEmail: string, requireAppUnlock: boolean) => {
    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    if (!normalizedEmail) return { requireAppUnlock: true } as DeviceAppLockPreference;

    let parsed: DeviceAppLockPreferenceMap = {};
    try {
      parsed = JSON.parse(localStorage.getItem(DEVICE_APP_LOCK_PREFERENCES_KEY) || '{}') as DeviceAppLockPreferenceMap;
    } catch {
      parsed = {};
    }

    const nextPreference: DeviceAppLockPreference = requireAppUnlock
      ? { requireAppUnlock: true }
      : {
          requireAppUnlock: false,
          trustedAt: parsed?.[normalizedEmail]?.trustedAt || Date.now()
        };

    parsed[normalizedEmail] = nextPreference;
    localStorage.setItem(DEVICE_APP_LOCK_PREFERENCES_KEY, JSON.stringify(parsed));
    return nextPreference;
  },
  ensureTrustedCurrentDevice: (userEmail?: string | null) => {
    const existing = storageManager.getCurrentDeviceAppLockPreference(userEmail);
    if (!userEmail || existing.requireAppUnlock === false) {
      return existing;
    }
    return storageManager.saveCurrentDeviceAppLockPreference(userEmail, false);
  }
};
