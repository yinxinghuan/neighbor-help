export type CartridgeId = string
export type DrawerId = 'party' | 'map' | 'inventory' | 'log'
export type StoryMode = 'demo' | 'aigram' | 'remote'
export type Locale = 'zh' | 'en'
export type StoryFactValue = string | number | boolean

export interface ThemeTokens {
  outer: string; surface: string; paper: string; ink: string; muted: string; accent: string; danger: string; gold: string
  material: 'harbor' | 'apartment' | 'wayfarer'
}

export interface StoryAudioTheme {
  material: 'harbor' | 'apartment' | 'wayfarer'
  bpm: number
  rootHz: number
  scale: number[]
  levels: { music: number; ambient: number; sfx: number; master: number }
  tension: Array<{ statId: string; direction: 'high' | 'low'; weight: number }>
  recorded?: StoryRecordedAudio
}

export type StoryAudioCueName =
  | 'open' | 'action' | 'success' | 'failure' | 'change' | 'discovery' | 'treasure' | 'image' | 'summary' | 'error'
  | 'coinGain' | 'coinSpend' | 'energy' | 'standing' | 'relationship' | 'travel' | 'item'

export interface StoryRecordedTrack { src: string; gain: number }
export interface StoryRecordedAudio {
  music?: StoryRecordedTrack
  ambience?: StoryRecordedTrack
  ambienceByLocationId?: Record<string, StoryRecordedTrack>
  cues?: Partial<Record<StoryAudioCueName, StoryRecordedTrack>>
}

export interface StatDefinition {
  id: string
  label: string
  min: number
  max: number
  initial: number
  inverse?: boolean
  display?: 'bar' | 'number'
  warningAt?: number
  dangerAt?: number
  maxDelta?: number
}
export interface SkillDefinition { id: string; label: string; value: number }
export type CharacterStatus = 'known' | 'companion' | 'departed'
export interface CharacterDefinition { id: string; name: string; role: string; vitality: number; stress: number; skills: SkillDefinition[]; detail?: string; lore?: string; initialStatus?: CharacterStatus; hiddenUntilIntroduced?: boolean }
export interface StoryCharacter extends CharacterDefinition {
  status: CharacterStatus
  origin: 'cartridge' | 'generated'
  lastKnownLocation?: string
  updatedAtScene: number
  joinedAtScene?: number
  leftAtScene?: number
}
export interface Choice { id: string; label: string }
export type ImageBlockStatus = 'idle' | 'queued' | 'generating' | 'ready' | 'failed'
export const ITEM_IMAGE_STYLE_VERSION = 2
export const SCENE_IMAGE_PROMPT_VERSION = 5
export type SceneImageSubject = 'player' | 'environment' | 'others'
export interface StoryBlock { id: string; kind: 'narration' | 'dialogue' | 'check' | 'change' | 'event' | 'summary' | 'image' | 'choices'; text: string; speaker?: string; tone?: string; data?: Record<string, string | number> }
export interface EntityMetric { id?: string; label: string; value: string }
export interface MapNode { id: string; label: string; connectedTo?: string; current?: boolean; visited?: boolean; detail?: string; lore?: string; facts?: string[] }
export interface InventoryItem {
  id: string
  label: string
  count: number
  rarity?: 'common' | 'rare' | 'legendary'
  detail?: string
  effect?: string
  lore?: string
  metrics?: EntityMetric[]
  imagePrompt?: string
  imageStatus?: ImageBlockStatus
  imageUrl?: string
  imageStyleVersion?: number
}
export interface RelationshipEvent { id: string; actor: string; characterId?: string; axis: string; delta: number; source: string }

export interface StoryDirector {
  mode: 'guided' | 'open-world'
  fixedWorldRules: string[]
  generationRules: string[]
  choiceIntents: [string, string, string]
  maxActiveThreads: number
}

export type DangerPhase = 'calm' | 'warning' | 'confrontation'
export type DangerOutcome = 'none' | 'critical-success' | 'success' | 'costly-success' | 'failure' | 'critical-failure'

export interface DangerCost {
  statId: string
  operation: 'add' | 'remove'
  amount: number
}

export interface StoryDangerDirector {
  minSafeTurns: number
  maxSafeTurns: number
  cooldownTurns: number
  /** Calm scenes before scheduled danger may begin. Immediate visible threats
   * still bypass this grace period through encounter validation. */
  graceScenes?: number
  escalationStats: string[]
  threatPalette: string[]
  /** Optional map-node allowlist per exact threat label. */
  threatLocations?: Record<string, string[]>
  methods: [string, string, string]
  /** Old saved button labels retained only for idempotent migration. */
  legacyMethods?: Array<[string, string, string]>
  physicalCombat: 'none' | 'rare' | 'occasional'
  resolution: {
    skill: string
    modifier: number
    dcBySeverity: [number, number, number, number, number]
    criticalDcBonus?: number
    fallbackCosts: [DangerCost, ...DangerCost[]]
  }
}

export interface StoryDangerState {
  phase: DangerPhase
  safeTurns: number
  cycle: number
  cooldownTurns: number
  severity: number
  currentThreat?: string
  lastOutcome: DangerOutcome
  lastResolvedScene?: number
}

export type DomainRequirement =
  | { type: 'map'; nodeId: string; reason: string }
  | { type: 'fact'; id: string; equals?: StoryFactValue; notEquals?: StoryFactValue; min?: number; max?: number; reason: string }
  | { type: 'item'; id: string; minCount: number; reason: string }
  | { type: 'character'; id: string; status: CharacterStatus; reason: string }
  | { type: 'danger'; phases: DangerPhase[]; reason: string }
export type DomainEffect =
  | { type: 'stat'; id: string; delta: number }
  | { type: 'fact'; id: string; value: StoryFactValue }
  | { type: 'fact-add'; id: string; delta: number }
  | { type: 'inventory'; action: 'add' | 'remove'; itemId: string; count: number; item?: InventoryItem }
  | { type: 'party'; change: 'add' | 'remove'; characterId: string }
  | { type: 'map'; nodeId: string }
  | { type: 'danger'; outcome: Exclude<DangerOutcome, 'none'> }
  | { type: 'objective'; value: string }
  | { type: 'clock'; value: string }
  | { type: 'session'; ended: boolean; reason?: string }
export interface DomainActionRule { id: string; intent: string; match: string[]; requirements: DomainRequirement[]; effects: DomainEffect[]; successText: string; successChoices: [string, string, string]; rejectionChoices?: [string, string, string] }
export interface DomainDerivedItemMetric { itemId: string; metricId: string; label: string; factId: string; maximum: number; mode: 'remaining-from-used' }
export type DomainDerivedFact =
  | { factId: string; mode: 'owned-item-count'; itemIds: string[] }
  | { factId: string; mode: 'owned-item-threshold'; itemIds: string[]; threshold: number }
export interface StoryDomainRules { rules: DomainActionRule[]; derivedItemMetrics?: DomainDerivedItemMetric[]; derivedFacts?: DomainDerivedFact[] }
export interface DomainActionResolution { status: 'accepted' | 'rejected'; ruleId: string; intent: string; effects: DomainEffect[]; reasons: string[]; successText: string; successChoices: [string, string, string] }

export interface JobContract {
  id: string
  label: string
  employer?: string
  wage: number
  status: 'offered' | 'accepted' | 'settled' | 'cancelled'
  offeredAtScene: number
  settledAtScene?: number
}

export interface DangerCheck {
  skill: string
  dc: number
  roll: number
  modifier: number
  total: number
  outcome: Exclude<DangerOutcome, 'none'>
}

export interface DangerDirective {
  phase: 'warning' | 'confrontation' | 'resolution'
  severity: number
  threat: string
  methods: [string, string, string]
  physicalCombat: StoryDangerDirector['physicalCombat']
  check?: DangerCheck
}

export type SceneImageTrigger =
  | 'new-location'
  | 'rare-item'
  | 'party-change'
  | 'chapter-checkpoint'
  | 'relationship-change'
  | 'objective-change'
  | 'skill-outcome'
  | 'character-expression'

export interface StoryImageDirector {
  maxQuietTurns: number
  softCooldownTurns: number
  guaranteedTriggers: SceneImageTrigger[]
  softTriggers: SceneImageTrigger[]
}

export interface StoryCartridge {
  schemaVersion: 1
  id: CartridgeId
  locale: Locale
  coverImage: string
  entryImage?: string
  copy: {
    title: string; subtitle: string; promise: string; enter: string; continue: string; customAction: string
    itemImagingTitle: string; itemImagingBody: string
  }
  theme: ThemeTokens
  audioTheme: StoryAudioTheme
  itemImageDirection?: string
  sceneImageDirection?: string
  sceneImageAvoid?: string
  transitionAnchor?: string
  imageDirector?: StoryImageDirector
  director?: StoryDirector
  dangerDirector?: StoryDangerDirector
  domainRules?: StoryDomainRules
  initialFacts?: Record<string, StoryFactValue>
  statDefinitions: [StatDefinition, StatDefinition, StatDefinition]
  drawerLabels: Record<DrawerId, string>
  opening: { location: string; time: string; objective: string; imagePrompt: string; blocks: StoryBlock[]; choices: Choice[] }
  characters: CharacterDefinition[]
  initialPartyMemberIds?: string[]
  initialMap: MapNode[]
  initialInventory: InventoryItem[]
  demoTurns: DemoTurn[]
}

export interface DemoTurn { match: string[]; content: string; imagePrompt?: string; imageSubject?: SceneImageSubject }

export interface StorySave {
  version: 10
  cartridgeId: CartridgeId
  locale: Locale
  remoteChatId?: string
  entered: boolean
  scene: number
  location: string
  time: string
  objective: string
  decisionContext: string
  stats: Record<string, number>
  facts: Record<string, StoryFactValue>
  blocks: StoryBlock[]
  choices: Choice[]
  map: MapNode[]
  inventory: InventoryItem[]
  characters: StoryCharacter[]
  partyMemberIds: string[]
  relationships: RelationshipEvent[]
  jobs: JobContract[]
  danger: StoryDangerState
  sessionEnded: boolean
  lastActionId?: string
  _lastActive?: number
}

export interface StoryArchive {
  version: 1
  worlds: Record<CartridgeId, StorySave>
  _lastActive?: number
}

export type ParsedCommand =
  | { type: 'choices'; choices: string[] }
  | { type: 'situation'; text: string }
  | { type: 'widget'; id: string; operation: 'value' | 'count' | 'add' | 'remove'; value: string | number }
  | { type: 'skill_check'; skill: string; dc: number; roll: number; modifier: number; total: number; result: string }
  | { type: 'state'; value: string }
  | { type: 'clock'; value: string }
  | { type: 'map_update'; location: string; connectedTo?: string; detail?: string; lore?: string; facts?: string[] }
  | { type: 'scene_location'; location: string }
  | { type: 'image_location'; location: string }
  | { type: 'dialogue_focus'; speaker: string; expression?: string }
  | { type: 'inventory'; action: 'add' | 'remove'; item: string; count: number; rarity?: 'common' | 'rare' | 'legendary'; detail?: string; effect?: string; lore?: string; metrics?: EntityMetric[]; imagePrompt?: string }
  | { type: 'job'; action: 'offer' | 'accept' | 'settle' | 'cancel'; id: string; label?: string; employer?: string; wage?: number }
  | { type: 'reputation'; npc: string; action: string }
  | { type: 'character_update'; characterId?: string; character: string; role?: string; detail?: string; lore?: string; vitality?: number; stress?: number; skills?: SkillDefinition[] }
  | { type: 'party_change'; characterId?: string; character: string; change: 'add' | 'remove'; role?: string; detail?: string; lore?: string; vitality?: number; stress?: number; skills?: SkillDefinition[] }
  | { type: 'encounter'; phase: 'warning' | 'confrontation' | 'resolution'; kind?: string; severity?: number; outcome?: DangerOutcome }
  | { type: 'session_end'; reason: string }

export interface ParsedScene { blocks: StoryBlock[]; commands: ParsedCommand[]; raw: string }

export interface AdapterContext {
  cartridge: StoryCartridge
  save: StorySave
  actionId: string
  locale: Locale
  dangerDirective?: DangerDirective
  domainResolution?: DomainActionResolution
  repair?: { draft: string; violations: string[] }
}

export interface AdapterProgress {
  label: string
  percent?: number
}

export interface AdapterResult {
  content: string
  imagePrompt?: string
  imageSubject?: SceneImageSubject
}

export interface StoryAdapter {
  id: StoryMode
  send: (action: string, context: AdapterContext, onProgress?: (progress: AdapterProgress) => void) => Promise<AdapterResult>
}
