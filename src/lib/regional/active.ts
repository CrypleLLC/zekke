import {
  browserCountry,
  countryDefaults,
  formatDatePattern,
  formatPlainNumber,
  formatTimePattern,
  type RegionalPreferences,
} from './index';

let active: RegionalPreferences | undefined;

export function activeRegional(): RegionalPreferences {
  active ??= countryDefaults(browserCountry());
  return active;
}

export function setActiveRegional(preferences: RegionalPreferences): void {
  active = preferences;
}

function calendarDay(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

export function regionalDate(date: Date, preferences: RegionalPreferences = activeRegional()): string {
  return formatDatePattern(calendarDay(date), preferences.date);
}

export function regionalShortDate(date: Date, preferences: RegionalPreferences = activeRegional()): string {
  const full = regionalDate(date, preferences);
  const year = String(date.getFullYear());
  return preferences.date.startsWith('yyyy') ? full.slice(year.length + 1) : full.slice(0, full.length - year.length - 1);
}

export function regionalTime(date: Date, preferences: RegionalPreferences = activeRegional()): string {
  return formatTimePattern(date.getHours(), date.getMinutes(), preferences.time);
}

export function regionalDateTime(date: Date, preferences: RegionalPreferences = activeRegional()): string {
  return `${regionalDate(date, preferences)} ${regionalTime(date, preferences)}`;
}

export function regionalCount(value: number, preferences: RegionalPreferences = activeRegional()): string {
  return Number.isFinite(value) ? formatPlainNumber(Math.round(value), preferences.number, 0) : String(value);
}
