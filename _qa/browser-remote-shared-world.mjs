import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = String(process.env.BASE_URL || '').replace(/\/+$/, '')
if (!/^https:\/\//.test(base)) throw new Error('BASE_URL must be the deployed HTTPS game URL')
const out = new URL('./ui/', import.meta.url)
await mkdir(out, { recursive: true })

const browser = await chromium.launch({ headless: true })
const errors = []

async function makePlayer(id) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(() => { localStorage.clear(); sessionStorage.clear() })
  const page = await context.newPage()
  const metrics = { conflicts: 0 }
  page.on('response', (response) => {
    if (response.status() === 409 && response.url().includes('/api/world/action')) metrics.conflicts += 1
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (/Failed to load resource.+409/.test(message.text())) return
    errors.push(`${id} console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${id} page: ${error.message}`))
  await page.route('https://game.aiwaves.tech/alteru-media/api/v1/images/generations', async (route) => {
    const body = route.request().postDataJSON()
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        task_id: `remote-qa-${body.request_id}`, request_id: body.request_id, type: 'image', status: 'succeeded',
        created_at: Date.now(), updated_at: Date.now(),
        media: { type: 'image', url: `${base}/poster.png`, width: body.size.width, height: body.size.height, format: 'png' },
      }),
    })
  })
  await page.goto(`${base}/?story_mode=demo&lang=en&telegram_id=${encodeURIComponent(id)}`, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: '#alteru-guest-banner{display:none!important}' })
  await page.locator('.st-entry').waitFor()
  await page.locator('.st-primary').click()
  await page.locator('.st-shell').waitFor()
  return { context, page, metrics }
}

const alex = await makePlayer('remote-qa-alex')
const sam = await makePlayer('remote-qa-sam')

await Promise.all([
  alex.page.getByRole('button', { name: /Claim the delivery request and pick up the last shared umbrella/ }).click(),
  sam.page.getByRole('button', { name: /Claim the delivery request and pick up the last shared umbrella/ }).click(),
])

await Promise.all([alex.page, sam.page].map((page) => page.waitForFunction(() => {
  const text = document.body.innerText
  return text.includes('You claim the umbrella request on the shared board') || text.includes('Another resident just changed this request')
}, null, { timeout: 20_000 })))
const successA = (await alex.page.locator('body').innerText()).includes('You claim the umbrella request on the shared board')
const successB = (await sam.page.locator('body').innerText()).includes('You claim the umbrella request on the shared board')
if (Number(successA) + Number(successB) !== 1) throw new Error(`expected one winner, got alex=${successA} sam=${successB}`)
if (alex.metrics.conflicts + sam.metrics.conflicts !== 1) throw new Error('expected exactly one HTTP 409 authority conflict')
const winner = successA ? alex : sam
const loser = successA ? sam : alex
await loser.page.getByText(/Another resident just changed this request/).waitFor()
await loser.page.getByRole('button', { name: 'Shared board', exact: true }).click()
await loser.page.getByText(/In progress/).first().waitFor()
await loser.page.screenshot({ path: new URL('neighbor-help-remote-conflict-platform-layout-390x844.png', out).pathname, fullPage: true })

const state = await fetch(`${base}/api/world/state?world_key=main&after_cursor=0`).then((response) => response.json())
const umbrella = state.snapshot.items.find((entry) => entry.id === 'item-umbrella-last')
if (umbrella?.custody !== 'player') throw new Error(`unexpected umbrella custody ${umbrella?.custody}`)
if (state.snapshot.events.filter((entry) => entry.type === 'request_claimed' && entry.requestId === 'req-umbrella-bus-stop').length !== 1) {
  throw new Error('authority did not commit exactly one umbrella claim')
}

await winner.page.getByRole('button', { name: /Take the umbrella to the corner bus stop and give it to the waiting resident/ }).click()
await winner.page.getByText(/shared board then confirms that the request is complete/).waitFor({ timeout: 20_000 })
const completedText = await winner.page.locator('body').innerText()
if (/did not take effect|was not applied/i.test(completedText)) throw new Error('committed completion fell into generic failure recovery')
if (await winner.page.getByRole('button', { name: /Give the umbrella to the waiting resident and complete the request/ }).count()) throw new Error('completed request remained a live completion choice')
await winner.page.getByRole('button', { name: 'Shared board', exact: true }).click()
await winner.page.getByText(/Completed/).first().waitFor()
await winner.page.getByText('Returned', { exact: true }).waitFor()
await winner.page.screenshot({ path: new URL('neighbor-help-remote-completed-platform-layout-390x844.png', out).pathname, fullPage: true })

const finalState = await fetch(`${base}/api/world/state?world_key=main&after_cursor=0`).then((response) => response.json())
const finalRequest = finalState.snapshot.requests.find((entry) => entry.id === 'req-umbrella-bus-stop')
const finalUmbrella = finalState.snapshot.items.find((entry) => entry.id === 'item-umbrella-last')
if (finalRequest?.status !== 'completed' || finalUmbrella?.custody !== 'returned') throw new Error('authority and completed UI did not converge')
if (finalState.snapshot.events.filter((entry) => entry.type === 'request_completed' && entry.requestId === 'req-umbrella-bus-stop').length !== 1) {
  throw new Error('authority did not commit exactly one umbrella completion')
}

await winner.page.reload({ waitUntil: 'networkidle' })
await winner.page.addStyleTag({ content: '#alteru-guest-banner{display:none!important}' })
const resume = winner.page.getByRole('button', { name: /Continue from the latest scene/ })
if (await resume.count()) await resume.click()
await winner.page.getByText(/shared board then confirms that the request is complete/).waitFor()
if (await winner.page.getByRole('button', { name: /Claim the delivery request and pick up the last shared umbrella/ }).count()) throw new Error('reload restored a stale claim choice')
if (await winner.page.getByRole('button', { name: /Give the umbrella to the waiting resident and complete the request/ }).count()) throw new Error('reload restored a stale completion choice')

if (errors.length) throw new Error(errors.join('\n'))
await winner.context.close()
await loser.context.close()
await browser.close()
console.log('neighbor-help deployed two-client browser authority: ok')
