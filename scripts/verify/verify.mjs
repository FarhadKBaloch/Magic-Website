// Checks the Farhad Baloch site in a browser. Never submits a form.
//
// SITE_URL       Which copy to open. Defaults to https://farhadbaloch.com/
//                Pull requests set this to a local server of the repo.
// EVIDENCE_DIR   Where screenshots and results.json are written.
// CHROME         Optional path to a Chrome or Chromium binary.
//
// There are 41 checks. A missing check fails the run, so none can be dropped quietly.
// On a computer with Google Chrome installed, that Chrome is used.
// In GitHub Actions (CI=true) the Chromium installed by the workflow is used.
import { chromium } from 'playwright';
import fs from 'fs';

const EXPECTED_CHECKS = 41;
const BASE = process.env.SITE_URL || 'https://farhadbaloch.com/';
const EV = process.env.EVIDENCE_DIR || './evidence';
const LIVE_HOSTS = new Set(['farhadbaloch.com', 'www.farhadbaloch.com']);

fs.mkdirSync(EV, { recursive: true });
const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

// Labels, headings, paragraphs, and links in the sections that were centered on desktop.
// Hidden thanks and error copy stay centered, so they are not part of the section alignment.
const TEXT_SECTIONS = [
  '.intro', '.intro .section-label', '.intro .section-heading', '.intro p',
  '.performances', '.performances .section-label', '.performances .section-heading', '.performances p',
  '.reel', '.reel .section-label', '.reel .section-heading', '.reel-note', '.reel-link',
  '.newsletter', '.newsletter .section-heading', '.newsletter p',
];
const PHONE_BUTTONS = [
  '.btn-primary', '.btn-outline', '.nav-mobile-contact',
  '.contact-form button', '.newsletter-form button',
];

async function alignmentReport(page, expected) {
  return page.evaluate(({ sels, expected }) => {
    const skip = (el) => el.matches('.form-error, .form-thanks')
      || !!el.closest('.form-error, .form-thanks')
      || el.hasAttribute('hidden')
      || getComputedStyle(el).display === 'none';
    return sels.map((sel) => {
      const els = [...document.querySelectorAll(sel)].filter((el) => !skip(el));
      if (!els.length) return { sel, ok: false, detail: 'missing' };
      const bad = els
        .map((el, i) => ({ i, align: getComputedStyle(el).textAlign }))
        .filter((row) => row.align !== expected);
      return {
        sel,
        ok: bad.length === 0,
        detail: bad.length ? bad.map((row) => `${row.i}:${row.align}`).join(',') : `${els.length} ${expected}`,
      };
    });
  }, { sels: TEXT_SECTIONS, expected });
}

// Always read the body. Leaving a response unread makes Node 22 on GitHub
// Actions crash in its HTTP parser (assert(!this.paused)) and skip the checks.
async function request(url) {
  const response = await fetch(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    text: new TextDecoder().decode(bytes),
  };
}

function resolveExecutable() {
  if (process.env.CHROME) {
    if (!fs.existsSync(process.env.CHROME)) {
      throw new Error(`CHROME=${process.env.CHROME} does not exist`);
    }
    return process.env.CHROME;
  }
  // The workflow installs Playwright's Chromium. Prefer it whenever CI is set,
  // so a distro Chrome on the runner cannot skip that browser.
  if (process.env.CI === 'true') return undefined;
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  return candidates.find((p) => fs.existsSync(p));
}

let browser;
try {
  const executablePath = resolveExecutable();
  console.log(`Checking ${BASE}`);
  console.log(executablePath ? `Browser: ${executablePath}` : 'Browser: Playwright Chromium');
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // 1. Pages and assets up
  const urls = [BASE, new URL('favicon.svg', BASE).href, new URL('images/farhad-baloch.jpg', BASE).href];
  let fav = '';
  for (const u of urls) {
    const r = await request(u);
    if (u === urls[1]) fav = r.text;
    rec(`HTTP 200: ${u}`, r.status === 200, `status ${r.status}`);
  }
  rec('Favicon is the FB card mark (SVG with red #9b3535 dot)', /<svg/i.test(fav) && /#9b3535/i.test(fav));

  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      javaScriptEnabled: false,
    });
    const njs = await context.newPage();
    await njs.goto(BASE, { waitUntil: 'load' });
    const report = await njs.evaluate(() => {
      const rows = [...document.querySelectorAll('.reveal')].map((el) => {
        const style = getComputedStyle(el);
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return { opacity: style.opacity, visible };
      });
      return { htmlClass: document.documentElement.className, rows };
    });
    const hidden = report.rows.filter((row) => row.opacity !== '1' || !row.visible);
    rec(
      'Sections below the hero are visible with JavaScript off',
      report.rows.length >= 10 && hidden.length === 0,
      `${report.rows.length} reveal blocks, ${hidden.length} not fully visible, html class="${report.htmlClass}"`,
    );
    await njs.screenshot({ path: `${EV}/nojs-desktop-full.png`, fullPage: true });
    await context.close();
  }

  // Desktop
  const d = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await d.goto(BASE, { waitUntil: 'networkidle' });
  rec('Favicon link in <head>', await d.locator('link[rel="icon"][href*="favicon.svg"]').count() > 0);
  const mark = d.locator('nav .nav-mark svg');
  rec('Tilted FB card logo visible top left', await mark.isVisible() && await mark.locator('circle[fill="#9b3535"]').count() > 0);
  await d.screenshot({ path: `${EV}/desktop-top.png` });
  const pos = await d.$eval('#nav', e => getComputedStyle(e).position);
  await d.mouse.wheel(0, 1500);
  await d.waitForTimeout(800);
  const navBottom = await d.$eval('#nav', e => e.getBoundingClientRect().bottom);
  rec('Header scrolls away (not sticky/fixed)', !['fixed', 'sticky'].includes(pos) && navBottom <= 0, `position=${pos}, nav bottom after scroll=${Math.round(navBottom)}`);
  await d.screenshot({ path: `${EV}/desktop-scrolled.png` });

  const contactText = await d.locator('#contact').innerText();
  rec('Contact shows 832-302-1130', contactText.includes('832-302-1130'));
  rec('Contact shows farhadkbaloch@gmail.com', contactText.includes('farhadkbaloch@gmail.com'));
  const act = await d.$eval('#contact form.contact-form', f => [f.getAttribute('action'), f.method]);
  rec('Contact form posts to FormSubmit for farhadkbaloch@gmail.com (not submitted)', act[0] === 'https://formsubmit.co/farhadkbaloch@gmail.com' && act[1] === 'post', act.join(' '));
  {
    const ref = await d.$eval('input[name="Referral"]', (el) => ({
      name: el.getAttribute('name'),
      placeholder: el.getAttribute('placeholder'),
      aria: el.getAttribute('aria-label'),
    }));
    const oldWording = await d.evaluate(() => document.documentElement.innerHTML.includes('How did you hear about Farhad'));
    rec(
      'Referral field asks "How did you hear about me?"',
      ref.name === 'Referral' && ref.placeholder === 'How did you hear about me?' && ref.aria === 'How did you hear about me?' && !oldWording,
      `placeholder=${ref.placeholder}; aria=${ref.aria}; old wording present=${oldWording}`,
    );
  }
  {
    const heroBits = await d.evaluate(() => ({
      scrollLine: document.querySelectorAll('.scroll-line, .scroll-hint, .hero-scroll, .hero-scroll-line, .scroll-indicator').length,
      specks: !!document.querySelector('#hero canvas.mg-field, .hero canvas.mg-field'),
    }));
    rec(
      'Bouncing hero scroll line is absent; drifting specks canvas is present',
      heroBits.scrollLine === 0 && heroBits.specks,
      `scroll-line nodes=${heroBits.scrollLine}, mg-field=${heroBits.specks}`,
    );
  }
  for (const [label, sel] of [['YouTube', 'iframe[src*="youtube"]'], ['Facebook', 'iframe[src*="facebook.com/plugins/video"]']]) {
    if (await d.locator(sel).count() > 0) {
      rec(`${label} embed present`, true, 'iframe already loaded');
      continue;
    }
    const pv = d.locator(label === 'YouTube' ? '[data-embed*="youtube"]' : '[data-embed*="facebook.com/plugins/video"]').first();
    if (!(await pv.count())) {
      rec(`${label} embed present`, false, 'no iframe and no data-embed preview');
      continue;
    }
    await pv.scrollIntoViewIfNeeded();
    await pv.click();
    let ok = false;
    try {
      await d.locator(sel).first().waitFor({ state: 'attached', timeout: 8000 });
      ok = true;
    } catch {}
    rec(`${label} embed present (click-to-play loads iframe)`, ok);
  }
  await d.screenshot({ path: `${EV}/desktop-videos-clicked.png` });
  {
    const u = new URL('404.html', BASE).href;
    const r = await request(u);
    const p4 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p4.goto(u, { waitUntil: 'networkidle' });
    const t = await p4.evaluate(() => document.body.innerText);
    const branded = /Farhad Baloch/i.test(t + ' ' + await p4.title()) || await p4.locator('svg circle[fill="#9b3535"]').count() > 0;
    const home = await p4.$$eval('a[href]', as => as.some(a => {
      const h = a.getAttribute('href');
      return h === '/' || h === './' || h === 'index.html' || /^https:\/\/farhadbaloch\.com\/?$/.test(h);
    }));
    rec('404.html loads, is branded, links home', r.status === 200 && branded && home, `status ${r.status}, branded=${branded}, homeLink=${home}`);
    await p4.screenshot({ path: `${EV}/404.png` });
    await p4.close();
  }

  const ph = await d.$$eval('.is-placeholder', els => els.map(e => ({ t: e.tagName, c: e.className, vis: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) })));
  const shown = ph.filter(p => p.vis);
  {
    const txt = await d.evaluate(() => document.body.innerText);
    const bad = ['Client Logo', 'Client Name', 'Corporate Clients'].filter(s => txt.includes(s));
    rec('Placeholders not published', shown.length === 0 && bad.length === 0, `${ph.length} live placeholder elements, ${shown.length} visible, leftover text: ${bad.join(',') || 'none'}`);
  }
  const brand = await d.locator('.nav-logo').isVisible();
  rec('Old "Farhad Baloch" text brand stays hidden', !brand);

  const vis = await d.evaluate(() => document.body.innerText);
  const title = await d.title();
  const dashes = [...(vis + ' ' + title).matchAll(/.{0,30}\u2014.{0,30}/g)].map(m => m[0]);
  rec('No em dashes in visible text', dashes.length === 0, dashes.slice(0, 3).join(' | '));

  const links = await d.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));
  const bad = [];
  for (const h of new Set(links)) {
    if (h === '#') continue;
    if (h.startsWith('#')) {
      if (!(await d.locator(`[id="${h.slice(1)}"]`).count())) bad.push(h);
      continue;
    }
    if (/^(mailto|tel):/.test(h)) continue;
    const u = new URL(h, BASE);
    if (u.host === new URL(BASE).host) {
      const r = await request(u);
      if (r.status !== 200) bad.push(`${h} -> ${r.status}`);
    }
  }
  rec('Internal links not broken', bad.length === 0, bad.join(', '));

  {
    const rows = await alignmentReport(d, 'center');
    const failed = rows.filter((row) => !row.ok);
    rec(
      'Desktop intro, performances, video, and newsletter stay centered',
      rows.every((row) => row.ok),
      failed.length ? failed.map((row) => `${row.sel} (${row.detail})`).join('; ') : `${rows.length} selectors`,
    );
  }

  // SEO checks
  const warn = (name, ok, detail = '') => console.log(`${ok ? 'OK  ' : 'WARN'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  const meta = async (sel) => d.$$eval(sel, els => els.map(e => e.getAttribute('content')));
  const can = await d.$$eval('link[rel="canonical"]', els => els.map(e => e.getAttribute('href')));
  rec('SEO: exactly one canonical -> https://farhadbaloch.com/', can.length === 1 && can[0] === 'https://farhadbaloch.com/', `found ${JSON.stringify(can)}`);
  const og = {};
  for (const k of ['title', 'description', 'url', 'type', 'image']) og[k] = (await meta(`meta[property="og:${k}"]`))[0];
  const missing = Object.entries(og).filter(([, v]) => !v).map(([k]) => 'og:' + k);
  rec('SEO: og:title/description/url/type/image present', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : '');
  // The tag must stay an absolute URL (that is what crawlers read).
  // When that URL points at farhadbaloch.com, download the file from the server
  // under test. A pull request is then judged by its own image, and a live run
  // still downloads from the live site.
  const imgOk = async (u) => {
    try {
      if (!/^https?:\/\//.test(u || '')) return [false, 'not absolute'];
      const published = new URL(u);
      let fetchUrl = published;
      if (LIVE_HOSTS.has(published.hostname)) {
        fetchUrl = new URL(published.pathname + published.search, BASE);
      }
      const r = await request(fetchUrl);
      const where = fetchUrl.href === published.href ? '' : `; fetched ${fetchUrl.href}`;
      return [r.status === 200 && /^image\//.test(r.contentType), `${r.status} ${r.contentType}${where}`];
    } catch (e) {
      return [false, String(e)];
    }
  };
  const [ogi, ogid] = og.image ? await imgOk(og.image) : [false, 'missing'];
  rec('SEO: og:image is absolute and returns an image (200)', ogi, ogid);
  const tc = (await meta('meta[name="twitter:card"]'))[0];
  rec('SEO: twitter:card is summary_large_image', tc === 'summary_large_image', `found ${tc}`);
  const ti = (await meta('meta[name="twitter:image"]'))[0];
  const [tio, tiod] = ti ? await imgOk(ti) : [false, 'missing'];
  rec('SEO: twitter:image returns 200', tio, tiod);
  const lds = await d.$$eval('script[type="application/ld+json"]', els => els.map(e => e.textContent));
  let ld = null, ldErr = '';
  if (lds.length === 1) {
    try { ld = JSON.parse(lds[0]); } catch (e) { ldErr = 'invalid JSON: ' + e.message; }
  } else ldErr = `found ${lds.length} blocks`;
  rec('SEO: exactly one JSON-LD block that parses', !!ld, ldErr);
  if (ld) {
    const cities = (ld.areaServed || []).map(c => typeof c === 'string' ? c : c.name).join(' | ');
    const ok = ld['@type'] === 'Person' && ld.name === 'Farhad Baloch' && ld.telephone === '+1-832-302-1130' && ld.email === 'farhadkbaloch@gmail.com' && ['Columbus', 'Cincinnati', 'Cleveland'].every(c => cities.includes(c));
    rec('SEO: JSON-LD has Person, name, phone, email, 3 cities', ok, `@type=${ld['@type']}, cities=${cities}`);
    const txt = JSON.stringify(ld);
    const banned = ['sameAs', 'aggregateRating', 'review'].filter(k => new RegExp(`"${k}"`).test(txt));
    rec('SEO: JSON-LD has no sameAs/aggregateRating/review (honesty rule)', banned.length === 0, banned.length ? `found ${banned.join(', ')}` : '');
  } else {
    rec('SEO: JSON-LD has Person, name, phone, email, 3 cities', false, 'no JSON-LD');
    rec('SEO: JSON-LD has no sameAs/aggregateRating/review (honesty rule)', false, 'no JSON-LD');
  }
  const rb = await request(new URL('robots.txt', BASE));
  const rbt = rb.status === 200 ? rb.text : '';
  rec('SEO: robots.txt 200, allows all, lists sitemap', rb.status === 200 && /User-agent:\s*\*/i.test(rbt) && !/^Disallow:\s*\/\s*$/mi.test(rbt) && /Sitemap:\s*https:\/\/farhadbaloch\.com\/sitemap\.xml/i.test(rbt), `status ${rb.status}`);
  const sm = await request(new URL('sitemap.xml', BASE));
  const smt = sm.status === 200 ? sm.text : '';
  let smOk = false;
  if (smt) {
    const pg = await browser.newPage();
    smOk = await pg.evaluate(t => {
      const x = new DOMParser().parseFromString(t, 'application/xml');
      return !x.querySelector('parsererror') && [...x.getElementsByTagName('loc')].some(l => l.textContent.trim() === 'https://farhadbaloch.com/');
    }, smt);
    await pg.close();
  }
  rec('SEO: sitemap.xml 200, valid XML, lists https://farhadbaloch.com/', sm.status === 200 && smOk, `status ${sm.status}`);
  const allMeta = (await d.$$eval('meta[content]', els => els.map(e => e.getAttribute('content')))).join(' ') + ' ' + lds.join(' ');
  rec('SEO: no em dash in meta content or JSON-LD', !allMeta.includes('\u2014'));
  const desc = (await meta('meta[name="description"]'))[0] || '';
  warn('SEO: title is 60 characters or less', title.length <= 60, `${title.length} chars`);
  warn('SEO: meta description is 160 characters or less', desc.length > 0 && desc.length <= 160, `${desc.length} chars`);
  await d.locator('#contact').scrollIntoViewIfNeeded();
  await d.screenshot({ path: `${EV}/desktop-contact.png` });
  await d.screenshot({ path: `${EV}/desktop-full.png`, fullPage: true });

  // Mobile
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.goto(BASE, { waitUntil: 'networkidle' });
  const btn = m.locator('a.nav-mobile-contact');
  const bg = await btn.evaluate(e => getComputedStyle(e).backgroundColor);
  const href = await btn.getAttribute('href');
  const targetHasForm = await m.locator(`${href} form.contact-form`).count() > 0;
  rec('Mobile red Contact button visible, #9b3535, links to form', await btn.isVisible() && bg === 'rgb(155, 53, 53)' && targetHasForm, `bg=${bg}, href=${href}`);
  rec('Mobile logo visible', await m.locator('nav .nav-mark svg').isVisible());
  await m.screenshot({ path: `${EV}/mobile-top.png` });

  {
    const hero = await m.evaluate(() => {
      const mid = (el) => {
        if (!el) return null;
        const range = document.createRange();
        range.selectNodeContents(el);
        const box = range.getBoundingClientRect();
        return (box.left + box.right) / 2;
      };
      const vw = window.innerWidth;
      const buttons = [...document.querySelectorAll('.hero-buttons a')].map((a) => a.getBoundingClientRect());
      const buttonMid = buttons.length
        ? (Math.min(...buttons.map((box) => box.left)) + Math.max(...buttons.map((box) => box.right))) / 2
        : null;
      const heroEl = document.querySelector('.hero');
      const btnRow = document.querySelector('.hero-buttons');
      return {
        vw,
        eyebrow: mid(document.querySelector('.hero-eyebrow')),
        name: mid(document.querySelector('.hero h1')),
        city: mid(document.querySelector('.hero-sub')),
        buttons: buttonMid,
        textAlign: heroEl ? getComputedStyle(heroEl).textAlign : null,
        justify: heroEl ? getComputedStyle(heroEl).justifyContent : null,
        btnJustify: btnRow ? getComputedStyle(btnRow).justifyContent : null,
      };
    });
    const center = hero.vw / 2;
    const near = (x) => x != null && Math.abs(x - center) <= 8;
    rec(
      'Phone hero label, name, city, and buttons are centered',
      near(hero.eyebrow) && near(hero.name) && near(hero.city) && near(hero.buttons) && hero.textAlign === 'center' && hero.justify === 'center' && hero.btnJustify === 'center',
      `vw=${hero.vw}, mid eyebrow/name/city/buttons=${[hero.eyebrow, hero.name, hero.city, hero.buttons].map((n) => n == null ? 'missing' : n.toFixed(1)).join('/')}, text-align=${hero.textAlign}, justify=${hero.justify}, buttons=${hero.btnJustify}`,
    );
  }

  {
    const sizes = await m.evaluate((btnSels) => {
      const labels = [...document.querySelectorAll('.section-label')].map((el) => ({
        t: el.textContent.trim(),
        fs: getComputedStyle(el).fontSize,
      }));
      const buttons = btnSels.flatMap((sel) => [...document.querySelectorAll(sel)].map((el) => ({
        sel,
        fs: getComputedStyle(el).fontSize,
      })));
      return { labels, buttons };
    }, PHONE_BUTTONS);
    rec(
      'Phone section labels are 13px',
      sizes.labels.length > 0 && sizes.labels.every((label) => label.fs === '13px'),
      sizes.labels.map((label) => `${label.t}=${label.fs}`).join(', '),
    );
    rec(
      'Phone buttons are 14px',
      sizes.buttons.length > 0 && sizes.buttons.every((button) => button.fs === '14px'),
      sizes.buttons.map((button) => `${button.sel}=${button.fs}`).join(', '),
    );
  }

  {
    const rows = await alignmentReport(m, 'left');
    const failed = rows.filter((row) => !row.ok);
    rec(
      'Phone intro, performances, video, and newsletter text is left-aligned',
      rows.every((row) => row.ok),
      failed.length ? failed.map((row) => `${row.sel} (${row.detail})`).join('; ') : `${rows.length} selectors`,
    );
  }

  {
    const layout = await m.evaluate(() => {
      const footer = document.querySelector('footer');
      const form = document.querySelector('.newsletter-form');
      const sub = form && form.querySelector('button');
      const formBox = form && form.getBoundingClientRect();
      const buttonBox = sub && sub.getBoundingClientRect();
      return {
        footerAlign: footer ? getComputedStyle(footer).textAlign : null,
        formW: formBox ? formBox.width : null,
        btnW: buttonBox ? buttonBox.width : null,
      };
    });
    rec(
      'Phone Subscribe button is full width',
      layout.formW != null && layout.btnW != null && Math.abs(layout.btnW - layout.formW) <= 1,
      `button=${layout.btnW} form=${layout.formW}`,
    );
    rec('Phone footer stays centered', layout.footerAlign === 'center', `text-align=${layout.footerAlign}`);
  }

  await btn.click();
  await m.waitForTimeout(1200);
  const formTop = await m.$eval('#contact', e => e.getBoundingClientRect().top);
  rec('Mobile Contact tap scrolls to contact section', Math.abs(formTop) < 200, `contact top=${Math.round(formTop)}`);
  await m.screenshot({ path: `${EV}/mobile-after-contact-tap.png` });
  await m.screenshot({ path: `${EV}/mobile-full.png`, fullPage: true });
} catch (e) {
  rec('Script error', false, String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
}

fs.writeFileSync(`${EV}/results.json`, JSON.stringify({ site: BASE, at: new Date().toString(), results }, null, 2));
const fails = results.filter(r => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (results.filter(r => r.name !== 'Script error').length !== EXPECTED_CHECKS) {
  console.error(`Expected ${EXPECTED_CHECKS} checks, recorded ${results.filter(r => r.name !== 'Script error').length}.`);
  process.exit(1);
}
process.exit(fails ? 1 : 0);
