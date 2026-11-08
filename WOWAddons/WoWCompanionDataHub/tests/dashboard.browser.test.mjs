// Uses an existing Playwright installation; no browser-test dependency is added to the server.
// Example: DASHBOARD_PLAYWRIGHT_MODULES=/path/to/airi/node_modules node --test tests/dashboard.browser.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await (process.env.DASHBOARD_PLAYWRIGHT_MODULES
  ? import(pathToFileURL(path.join(process.env.DASHBOARD_PLAYWRIGHT_MODULES, 'playwright', 'index.mjs')).href)
  : import('playwright'));

test('real WSGI dashboard: session, aggregates, languages, CSV, responsive layout and expired sessions', { timeout: 60000 }, async () => {
  const child = spawn(process.env.PYTHON || 'python', ['-u', 'tests/dashboard_fixture.py'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let browser;
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  try {
    const port = await new Promise((resolve, reject) => {
      const lines = createInterface({ input: child.stdout });
      const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 10000);
      lines.once('line', line => {
        clearTimeout(timer);
        lines.close();
        if (/^\d+$/.test(line)) resolve(Number(line));
        else reject(new Error('Fixture returned an invalid port'));
      });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Fixture failed: ${stderr}`)); });
    });
    const origin = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    const page = await context.newPage();
    await page.clock.install();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('401')) errors.push(message.text()); });
    const response = await page.goto(origin);
    assert.match(response.headers()['content-security-policy'], /script-src 'self'/);
    await page.locator('#login-button:enabled').waitFor();
    assert.equal(await page.locator('#dashboard').isVisible(), false);
    assert.equal(await page.locator('#language').inputValue(), 'zhHans');

    async function login() {
      await page.locator('#admin-key').fill('dashboard-test-only-admin-' + 'x'.repeat(48));
      await page.locator('#login-button').click();
      await page.locator('#dashboard').waitFor({ state: 'visible' });
      await page.locator('#refresh:enabled').waitFor();
    }
    await login();
    assert.equal(await page.locator('#admin-key').inputValue(), '');
    assert.equal(await page.locator('[data-value=totalInstallations]').textContent(), '4');
    assert.equal(await page.locator('[data-value=totalTokens]').textContent(), '676,536');
    assert.equal(await page.locator('#token-chart .chart-bar').count(), 7);
    assert.equal(await page.locator('#versions img').count(), 0);
    assert.match(await page.locator('#versions').textContent(), /<img src=x/);
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
    const cookies = await context.cookies();
    assert.ok(cookies.some(cookie => cookie.name === 'datahub_session' && cookie.httpOnly && cookie.sameSite === 'Strict'));

    const headings = { zhHans: '运行概览', zhHant: '運作概覽', en: 'Overview', es: 'Resumen', fr: 'Vue d’ensemble', it: 'Panoramica', pt: 'Visão geral', ja: '稼働状況', ko: '운영 개요', ru: 'Обзор', th: 'ภาพรวมการทำงาน', vi: 'Tổng quan hoạt động' };
    for (const [language, heading] of Object.entries(headings)) {
      await page.locator('#language').selectOption(language);
      assert.equal(await page.locator('#overview-title').textContent(), heading);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')].some(element => !element.textContent || element.textContent === 'undefined')), false);
    }
    await page.locator('#language').selectOption('en');
    assert.equal(await page.evaluate(() => Object.values(translations).some(dictionary => Object.keys(translations.zhHans).some(key => typeof dictionary[key] !== 'string' || !dictionary[key]))), false);
    for (const days of [30, 90, 7]) {
      await page.locator(`[data-days="${days}"]`).click();
      await page.locator('#refresh:enabled').waitFor();
      assert.equal(await page.locator('#token-chart .chart-bar').count(), days);
      assert.equal(await page.locator(`[data-days="${days}"]`).getAttribute('aria-pressed'), 'true');
    }
    const refreshResponse = page.waitForResponse(result => result.url().includes('/api/v1/admin/stats?days=7') && result.status() === 200);
    await page.clock.fastForward(61000);
    await refreshResponse;
    await page.locator('#refresh:enabled').waitFor();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await downloadPromise;
    const csv = await readFile(await download.path(), 'utf8');
    assert.match(csv, /"'=1\+1"/);
    assert.ok(!csv.includes('dashboard-test-only-admin-'));
    assert.ok(!csv.includes(cookies[0].value));
    assert.equal(await page.evaluate(() => csvCell('  +SUM(1,2)')), '"\'  +SUM(1,2)"');

    await page.locator('#language').selectOption('zhHans');
    const screenshot = path.join(tmpdir(), 'wow-datahub-dashboard-desktop.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const language of Object.keys(headings)) {
      await page.locator('#language').selectOption(language);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow: ${language}`);
    }
    await page.locator('#language').selectOption('zhHans');
    await page.screenshot({ path: path.join(tmpdir(), 'wow-datahub-dashboard-mobile.png'), fullPage: true });

    // Revoke the real server session behind the page, then exercise the visible 401 path.
    assert.equal((await context.request.post(`${origin}/api/v1/admin/logout`, { data: {}, headers: { Origin: origin } })).status(), 200);
    await page.locator('#refresh').click();
    await page.locator('#login-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#dashboard').isVisible(), false);
    assert.equal(await page.locator('#versions').textContent(), '');
    assert.equal(await page.locator('[data-value=totalTokens]').textContent(), '');
    assert.equal(await page.locator('#token-chart').textContent(), '');
    assert.equal(await page.locator('#export').isDisabled(), true);
    await login();
    const logoutResponse = page.waitForResponse(result => result.url().endsWith('/api/v1/admin/logout') && result.status() === 200);
    await page.locator('#logout').click();
    await page.locator('#login-panel').waitFor({ state: 'visible' });
    await logoutResponse;
    assert.equal(await page.locator('#versions').textContent(), '');
    assert.equal((await context.request.get(`${origin}/api/v1/admin/stats?days=7`)).status(), 401);
    assert.deepEqual(errors, []);
    console.log(`Synthetic dashboard screenshots: ${screenshot}`);
  } finally {
    await browser?.close();
    child.stdin.end('\n');
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
});
