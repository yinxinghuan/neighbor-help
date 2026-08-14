import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = String(process.env.BASE_URL || '').replace(/\/+$/, '')
if (!/^https:\/\//.test(base)) throw new Error('BASE_URL must be the deployed HTTPS game URL')
const out = new URL('./ui/', import.meta.url)
await mkdir(out, { recursive: true })

const browser = await chromium.launch({ headless: true })

const external = await browser.newPage({ viewport: { width: 390, height: 844 } })
await external.goto(`${base}/?lang=en`, { waitUntil: 'networkidle' })
await external.locator('.st-entry').waitFor()
await external.locator('#alteru-guest-banner').waitFor({ state: 'visible', timeout: 15_000 })
await external.screenshot({ path: new URL('neighbor-help-external-guest-390x844.png', out).pathname, fullPage: true })
if (!(await external.locator('.st-primary').isVisible())) throw new Error('external guest banner made the entry action unusable')

const reducedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
const reduced = await reducedContext.newPage()
await reduced.route('https://game.aiwaves.tech/alteru-media/api/v1/images/generations', async (route) => {
  const body = route.request().postDataJSON()
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      task_id: `reduced-${body.request_id}`, request_id: body.request_id, type: 'image', status: 'succeeded',
      created_at: Date.now(), updated_at: Date.now(),
      media: { type: 'image', url: `${base}/poster.png`, width: body.size.width, height: body.size.height, format: 'png' },
    }),
  })
})
await reduced.goto(`${base}/?local=1&story_mode=demo&lang=en`, { waitUntil: 'networkidle' })
await reduced.addStyleTag({ content: '#alteru-guest-banner{display:none!important}' })
await reduced.locator('.st-primary').focus()
await reduced.keyboard.press('Enter')
await reduced.locator('.st-shell').waitFor()
const motion = await reduced.evaluate(() => {
  const image = document.querySelector('.st-message-image img')
  const style = image ? getComputedStyle(image) : null
  return {
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    animationDuration: style?.animationDuration || '',
    transitionDuration: style?.transitionDuration || '',
  }
})
if (!motion.reduced) throw new Error('reduced-motion media query is not active')
const durationMs = (value) => value.split(',').map((part) => part.trim()).reduce((max, part) => {
  const number = Number.parseFloat(part) || 0
  return Math.max(max, part.endsWith('ms') ? number : number * 1000)
}, 0)
if (durationMs(motion.animationDuration) > 1 || durationMs(motion.transitionDuration) > 1) throw new Error(`motion not reduced ${JSON.stringify(motion)}`)

const input = reduced.locator('.st-composer form input').first()
if (await input.count()) {
  await input.fill('Wait by the lobby window')
  const send = reduced.getByRole('button', { name: /send|提交|发送/i }).last()
  await send.focus()
  await reduced.keyboard.press('Enter')
  await reduced.getByText(/Wait by the lobby window/).waitFor()
}

await reduced.screenshot({ path: new URL('neighbor-help-reduced-motion-platform-layout-390x844.png', out).pathname, fullPage: true })
await reducedContext.close()
await browser.close()
console.log('neighbor-help external guest, keyboard, and reduced motion: ok')
