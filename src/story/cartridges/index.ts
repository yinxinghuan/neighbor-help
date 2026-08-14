import { neighborHelp, neighborHelpEn } from './neighborHelp'
import type { Locale, StoryCartridge } from '../types'

export const DEFAULT_CARTRIDGE_ID = 'neighbor-help'
export const CARTRIDGES: Record<string, StoryCartridge> = { 'neighbor-help': neighborHelp }
export const CARTRIDGES_EN: Record<string, StoryCartridge> = { 'neighbor-help': neighborHelpEn }
export function listCartridges(locale: Locale): StoryCartridge[] { return [locale === 'en' ? neighborHelpEn : neighborHelp] }
export function resolveCartridge(_id: string | null | undefined, locale: Locale = 'zh'): StoryCartridge { return locale === 'en' ? neighborHelpEn : neighborHelp }
