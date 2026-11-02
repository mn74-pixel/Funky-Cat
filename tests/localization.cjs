const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  for (const locale of ['pl-PL','en-US','de-DE']) {
    const context = await browser.newContext({locale,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page = await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
    const lang = locale === 'pl-PL' ? 'pl' : 'en';
    assert.equal(await page.locator('html').getAttribute('lang'),lang);
    await page.locator('[data-open="settings"]').click();
    assert.equal(await page.locator('#settings h3').nth(0).textContent(),lang==='pl'?'Język':'Language');
    await page.locator('#languageSelect').selectOption(lang==='pl'?'en':'pl');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(expected => document.documentElement.lang === expected,lang==='pl'?'en':'pl');
    assert.deepEqual(errors,[]);
    await context.close();
  }
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({locale:'en-US',viewport:{width,height:width===320?680:900}});
    const page = await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__fc && window.__fc.stats().audioReady,null,{timeout:60000});
    await page.locator('#playBtn').click();
    await page.waitForFunction(()=>window.__fc.G.mode==='play',null,{timeout:30000});
    await page.locator('#pauseBtn').click();
    await page.locator('#resumeBtn').click();
    await page.waitForFunction(()=>window.__fc.G.mode==='play');
    await page.evaluate(()=>window.__fc.finish());
    await page.locator('#results').waitFor({state:'visible'});
    assert.match(await page.locator('#resStage').innerText(),/^Stage 1/i);
    assert.deepEqual(errors,[]);
    await context.close();
  }
  await browser.close();console.log('Localization and game flows passed');
})().catch(e=>{console.error(e);process.exit(1)});
