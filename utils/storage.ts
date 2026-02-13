
import { AppSettings } from '../types';

const SETTINGS_KEY = 'kidsledger_settings';

export const storageManager = {
  getSettings: (): AppSettings => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : { googleSheetId: '' };
  },
  saveSettings: (settings: AppSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  },
  clearSettings: () => {
    localStorage.removeItem(SETTINGS_KEY);
  }
};
