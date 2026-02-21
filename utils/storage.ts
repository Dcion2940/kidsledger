
import { AppSettings } from '../types';

const SETTINGS_KEY = 'kidsledger_settings';
const DEFAULT_SETTINGS: AppSettings = {
  googleSheetId: '',
  aiMentorEnabled: true,
  aiApiLink: ''
};

export const storageManager = {
  getSettings: (): AppSettings => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return DEFAULT_SETTINGS;

    try {
      const parsed = JSON.parse(saved) as Partial<AppSettings>;
      return {
        googleSheetId: parsed.googleSheetId || '',
        aiMentorEnabled: parsed.aiMentorEnabled ?? true,
        aiApiLink: parsed.aiApiLink || ''
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
  }
};
