import { listCartridges } from '../src/story/cartridges/index'
import { canonicalizePaymentMetadata, exactCoinAmount, validatePaymentConsistency } from '../src/story/engine/paymentConsistency'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyParsedScene, createInitialSave } from '../src/story/engine/reducer'
import type { StoryCartridge } from '../src/story/types'

function ok(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function equal(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`) }

const source = listCartridges('zh')[0]
const cartridge = {
  ...source,
  statDefinitions: [
    { ...source.statDefinitions[0], id: 'coin', label: '钱币', min: 0, max: 999, initial: 6, display: 'number', maxDelta: 30 },
    source.statDefinitions[1], source.statDefinitions[2],
  ],
} as StoryCartridge
const initial = createInitialSave(cartridge)
const offer = parseStoryProtocol('她说：“再帮我把木箱送上车，我付你八枚钱币。”\n[job: action="offer" id="crate-job" label="送木箱上车" employer="雇主" wage="8"]', 'zh')
equal(validatePaymentConsistency(initial, offer, cartridge).length, 0, 'valid offer contract')
const offered = applyParsedScene(initial, offer, cartridge, 'ask')
equal(offered.stats.coin, 6, 'offer is not payment')
const rewrite = parseStoryProtocol('她改口说付九枚钱币。\n[job: action="offer" id="crate-job" label="changed job" employer="employer" wage="9"]', 'zh')
ok(validatePaymentConsistency(offered, rewrite, cartridge).includes('job.offer_cannot_rewrite_contract'), 'persisted contract cannot be rewritten')
equal(applyParsedScene(offered, rewrite, cartridge, 'rewrite').jobs[0]?.wage, 8, 'reducer keeps original wage')
const settle = parseStoryProtocol('你完成工作，她把八枚钱币递给你。\n[job: action="settle" id="crate-job"]', 'zh')
equal(validatePaymentConsistency(offered, settle, cartridge).length, 0, 'valid settlement')
const settled = applyParsedScene(offered, settle, cartridge, 'finish')
equal(settled.stats.coin, 14, 'reducer credits recorded wage')
ok(validatePaymentConsistency(settled, settle, cartridge).includes('job.settlement_cannot_repeat'), 'repeat is rejected')
const vague = parseStoryProtocol('你完成装箱，她掏出几枚铜板递给你。', 'zh')
ok(validatePaymentConsistency(initial, vague, cartridge).includes('payment.completed_payment_requires_exact_amount'), 'vague settlement is rejected')

equal(exactCoinAmount('她递给你八枚铜币。', 'zh'), 8, '铜币 is recognized as a localized coin unit')
const implicitWorkPayment = canonicalizePaymentMetadata(initial, parseStoryProtocol('整理工作完成后，她从布袋里数出八枚铜币递给你。', 'zh'), cartridge, '整理药草箱')
equal(validatePaymentConsistency(initial, implicitWorkPayment, cartridge).length, 0, 'exact visible work payment receives deterministic metadata')
const paidWork = applyParsedScene(initial, implicitWorkPayment, cartridge, '整理药草箱')
equal(paidWork.stats.coin, 14, 'exact visible work payment is credited once')
equal(paidWork.jobs.filter((job) => job.status === 'settled').length, 1, 'implicit paid work persists a settled contract')

const implicitGift = canonicalizePaymentMetadata(initial, parseStoryProtocol('她感谢你的提醒，给了你四枚铜币。', 'zh'), cartridge, '提醒她检查账本')
equal(validatePaymentConsistency(initial, implicitGift, cartridge).length, 0, 'exact non-work receipt receives matching widget metadata')
equal(applyParsedScene(initial, implicitGift, cartridge, '提醒').stats.coin, 10, 'exact non-work receipt credits coin')

const implicitPurchase = canonicalizePaymentMetadata(initial, parseStoryProtocol('你当场支付了两枚铜币，收下船票。', 'zh'), cartridge, '购买船票')
equal(applyParsedScene(initial, implicitPurchase, cartridge, '购买船票').stats.coin, 4, 'exact purchase removes coin')

const promiseOnly = canonicalizePaymentMetadata(initial, parseStoryProtocol('等你搬完箱子后，我会付你八枚铜币。', 'zh'), cartridge, '询问短工')
equal(promiseOnly.commands.filter((command) => command.type === 'widget' && command.id === 'coin').length, 0, 'promise never credits coin')
ok(promiseOnly.commands.some((command) => command.type === 'job' && command.action === 'offer'), 'exact promise creates a persisted offer')

console.log('payment consistency ok · 铜币 recognized · exact receipts canonicalized · promises never credit · settlement atomic')
