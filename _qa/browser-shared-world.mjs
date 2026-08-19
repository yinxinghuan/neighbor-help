import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.BASE_URL || 'http://127.0.0.1:5173/'
const out = new URL('./ui/', import.meta.url)
await mkdir(out, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
await context.addInitScript(() => { localStorage.clear(); sessionStorage.clear() })

async function configure(page) {
  await page.addStyleTag({ content: '#alteru-guest-banner{display:none!important}' }).catch(() => {})
  await page.route('https://aigram.aiwaves.tech/note/aigram/ai/game/track/report', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('https://game.aiwaves.tech/alteru-media/api/v1/images/generations', async (route) => {
    const body = route.request().postDataJSON()
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        task_id: `qa-${body.request_id}`, request_id: body.request_id, type: 'image', status: 'succeeded',
        created_at: Date.now(), updated_at: Date.now(),
        media: { type: 'image', url: new URL('poster.png', base).href, width: body.size.width, height: body.size.height, format: 'png' },
      }),
    })
  })
}

const errors = []
const pageA = await context.newPage()
await pageA.setViewportSize({ width: 390, height: 844 })
pageA.on('console', (message) => { if (message.type() === 'error') errors.push(`A console: ${message.text()}`) })
pageA.on('pageerror', (error) => errors.push(`A page: ${error.message}`))
await configure(pageA)
await pageA.goto(`${base}?local=1&story_mode=demo&lang=en&actor=alex`, { waitUntil: 'networkidle' })
await pageA.addStyleTag({ content: '#alteru-guest-banner{display:none!important}' })
await pageA.locator('.st-entry').waitFor()
await pageA.screenshot({ path: new URL('neighbor-help-entry-platform-layout-390x844.png', out).pathname, fullPage: true })
await pageA.locator('.st-primary').click()
await pageA.locator('.st-shell').waitFor()
await pageA.screenshot({ path: new URL('neighbor-help-opening-platform-layout-390x844.png', out).pathname, fullPage: true })
await pageA.getByRole('button', { name: 'Shared board', exact: true }).click()
await pageA.locator('.nh-board').waitFor()
await pageA.screenshot({ path: new URL('neighbor-help-board-platform-layout-390x844.png', out).pathname, fullPage: true })
await pageA.getByRole('button', { name: 'Close shared board' }).last().click()

const pageB = await context.newPage()
await pageB.setViewportSize({ width: 390, height: 844 })
pageB.on('console', (message) => { if (message.type() === 'error') errors.push(`B console: ${message.text()}`) })
pageB.on('pageerror', (error) => errors.push(`B page: ${error.message}`))
await configure(pageB)
await pageB.goto(`${base}?local=1&story_mode=demo&lang=en&actor=sam`, { waitUntil: 'networkidle' })
await pageB.addStyleTag({ content: '#alteru-guest-banner{display:none!important}' })
await pageB.locator('.st-primary').click()
await pageB.locator('.st-shell').waitFor()

await pageA.getByRole('button', { name: /Claim the delivery request and pick up the last shared umbrella/ }).click()
await pageA.getByText(/You claim the umbrella request on the shared board/).waitFor()
const claimText = await pageA.locator('body').innerText()
if (/shared board (?:then )?confirms that the request is complete/i.test(claimText)) throw new Error('claim stage announced completion before delivery')
const headerMetrics = await pageA.evaluate(() => {
  const identity = document.querySelector('.st-chat-header__identity')?.getBoundingClientRect()
  const title = document.querySelector('.st-chat-header__identity span')?.getBoundingClientRect()
  return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, identityWidth: identity?.width || 0, titleWidth: title?.width || 0 }
})
if (headerMetrics.scrollWidth > headerMetrics.viewport + 1 || headerMetrics.titleWidth < 70) throw new Error(`header layout regression ${JSON.stringify(headerMetrics)}`)
await pageA.screenshot({ path: new URL('neighbor-help-claim-success-platform-layout-390x844.png', out).pathname, fullPage: true })

await pageB.getByRole('button', { name: /Claim the delivery request and pick up the last shared umbrella/ }).click()
await pageB.getByText(/Another resident just changed this request/).waitFor()
await pageB.screenshot({ path: new URL('neighbor-help-stale-choice-recovery-platform-layout-390x844.png', out).pathname, fullPage: true })
await pageB.getByRole('button', { name: 'Shared board', exact: true }).click()
await pageB.getByText(/Alex · In progress/).waitFor()
await pageB.screenshot({ path: new URL('neighbor-help-after-conflict-board-platform-layout-390x844.png', out).pathname, fullPage: true })

await pageA.getByRole('button', { name: /Take the umbrella to the corner bus stop and give it to the waiting resident/ }).click()
await pageA.getByText(/shared board then confirms that the request is complete/).waitFor()
const completionText = await pageA.locator('body').innerText()
if (/did not take effect|was not applied/i.test(completionText)) throw new Error('committed completion fell into generic failure recovery')
if (await pageA.getByRole('button', { name: /Give the umbrella to the waiting resident and complete the request/ }).count()) throw new Error('completed request remained a live completion choice')
await pageA.getByRole('button', { name: 'Shared board', exact: true }).click()
await pageA.getByText(/Alex · Completed/).waitFor()
await pageA.getByText('Returned', { exact: true }).waitFor()
await pageA.getByText('No shared item held', { exact: true }).waitFor()
await pageA.screenshot({ path: new URL('neighbor-help-completed-board-platform-layout-390x844.png', out).pathname, fullPage: true })

const compact = await browser.newPage({ viewport: { width: 320, height: 568 } })
await configure(compact)
await compact.goto(`${base}?local=1&story_mode=demo&lang=en&actor=alex`, { waitUntil: 'networkidle' })
await compact.addStyleTag({ content: '#alteru-guest-banner{display:none!important}' })
await compact.locator('.st-entry').waitFor()
await compact.screenshot({ path: new URL('neighbor-help-entry-platform-layout-320x568.png', out).pathname, fullPage: true })

if (errors.length) throw new Error(errors.join('\n'))
console.log('neighbor-help browser shared world: ok')
await browser.close()
