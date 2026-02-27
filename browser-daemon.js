#!/usr/bin/env node
/**
 * Persistent browser daemon
 * - Keeps one browser window open
 * - Executes JS snippets sent to it
 * - Collects and returns console logs
 */

const { firefox, chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COMMAND_FILE = path.join(__dirname, '.browser-command');
const RESULT_FILE = path.join(__dirname, '.browser-result');
const READY_FILE = path.join(__dirname, '.browser-ready');

let browser, context, page;
let browserPid = null;

// Helper: in persistent mode browser=context which lacks isConnected()
function isBrowserConnected() {
  if (!browser) return false;
  if (typeof browser.isConnected === 'function') return browser.isConnected();
  // Persistent context - check if pages exist
  try { return browser.pages().length > 0; } catch { return false; }
}
let consoleLogs = [];
let isRestarting = false;
let startTime = Date.now();

// Parse command line args
const args = process.argv.slice(2);
const sizeArg = args.find(arg => arg.startsWith('--size='))?.split('=')[1] || 'dev';
const persistArg = args.includes('--persist');
const browserArg = args.find(arg => arg.startsWith('--browser='))?.split('=')[1] || 'firefox';
const browserEngine = browserArg === 'chrome' ? chromium : firefox;
const chromeOptions = browserArg === 'chrome' ? { channel: 'chrome' } : {};
const USER_DATA_DIR = path.join(__dirname, '.browser-data');

async function startBrowser() {
  console.log(`Starting ${browserArg} browser...` + (persistArg ? ' (persistent mode)' : ''));

  if (persistArg) {
    // Persistent context - preserves IndexedDB, cookies, localStorage
    context = await browserEngine.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: null,
      ...chromeOptions
    });
    browser = context; // In persistent mode, context acts as browser
    browserPid = browser.process?.()?.pid || null;
    page = context.pages()[0] || await context.newPage();
  } else {
    // Fresh context - no persistence
    browser = await browserEngine.launch({
      headless: false,
      ...chromeOptions
    });
    browserPid = browser.process?.()?.pid || null;
    context = await browser.newContext({
      viewport: null
    });
    page = await context.newPage();
  }

  // Get actual screen dimensions via JavaScript
  const screenSize = await page.evaluate(() => ({
    width: window.screen.availWidth,
    height: window.screen.availHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight
  }));

  console.log('Screen available:', screenSize.width, 'x', screenSize.height);
  console.log('Window inner:', screenSize.innerWidth, 'x', screenSize.innerHeight);

  // Calculate viewport based on preset
  let viewportWidth, viewportHeight;

  switch(sizeArg) {
    case 'quarter':
      viewportWidth = Math.floor(screenSize.width / 2);
      viewportHeight = Math.floor(screenSize.height / 2);
      break;
    case 'dev':
      viewportWidth = 900;
      viewportHeight = 860;
      break;
    case 'full':
      viewportWidth = screenSize.width;
      viewportHeight = screenSize.height;
      break;
    default:
      // Parse custom size like "1024x768"
      const match = sizeArg.match(/^(\d+)x(\d+)$/);
      if (match) {
        viewportWidth = parseInt(match[1]);
        viewportHeight = parseInt(match[2]);
      } else {
        // Fallback to full
        viewportWidth = screenSize.width;
        viewportHeight = screenSize.height;
      }
  }

  await page.setViewportSize({
    width: viewportWidth,
    height: viewportHeight
  });

  console.log(`Viewport set to ${viewportWidth}×${viewportHeight} (${sizeArg})`);
  console.log('');

  setupPageListeners();
}


function setupPageListeners() {
  // Collect console logs (silently - client will display them)
  page.on('console', msg => {
    const log = {
      type: msg.type(),
      text: msg.text(),
      location: msg.location()
    };
    consoleLogs.push(log);
  });

  page.on('pageerror', error => {
    console.log('[PAGE ERROR]', error.message);
    consoleLogs.push({ type: 'pageerror', text: error.message, stack: error.stack });
  });

  // Any close (window, quit, crash) = shutdown daemon
  page.on('close', async () => {
    if (isRestarting) return;
    console.log('Browser closed, shutting down...');
    if (isBrowserConnected()) {
      await browser.close().catch(() => {});
    }
    cleanup();
    process.exit(0);
  });

  context.on('close', async () => {
    if (isRestarting) return;
    console.log('Browser context closed, shutting down...');
    cleanup();
    process.exit(0);
  });
}

async function startDaemon() {
  await startBrowser();

  // Signal ready
  fs.writeFileSync(READY_FILE, 'ready');

  // Watch for commands
  console.log('Listening for commands...');
  console.log('');

  watchForCommands();

  // Cleanup on exit
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    if (browser && isBrowserConnected()) {
      await browser.close();
    }
    cleanup();
    process.exit(0);
  });
}

function watchForCommands() {
  setInterval(async () => {
    if (fs.existsSync(COMMAND_FILE)) {
      const commandData = fs.readFileSync(COMMAND_FILE, 'utf8');
      fs.unlinkSync(COMMAND_FILE);

      try {
        const command = JSON.parse(commandData);
        await executeCommand(command);
      } catch (err) {
        // Only catch JSON parse errors here, executeCommand handles its own errors
        console.error('Command processing error:', err.message);
        writeResult({ error: err.message });
      }
    }
  }, 100); // Check every 100ms
}

async function executeCommand(command) {
  try {
    await executeCommandInner(command);
  } catch (err) {
    writeResult({ error: err.message });
  }
}

async function executeCommandInner(command) {
  const { action, data } = command;

  switch (action) {
    case 'navigate':
      // Clear console logs on navigation (mimics browser behavior)
      consoleLogs = [];
      await page.goto(data.url, { waitUntil: 'networkidle', timeout: 30000 });
      writeResult({
        success: true,
        url: page.url(),
        title: await page.title()
      });
      break;

    case 'reload':
      // Clear console logs and reload current page (mimics browser F5/Cmd-R)
      consoleLogs = [];
      await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
      writeResult({
        success: true,
        url: page.url(),
        title: await page.title()
      });
      break;

    case 'exec':
      const result = await page.evaluate(data.code);
      writeResult({
        success: true,
        result: result
      });
      break;

    case 'console':
      writeResult({
        success: true,
        logs: consoleLogs
      });
      break;

    case 'console-clear':
      consoleLogs = [];
      writeResult({ success: true });
      break;

    case 'status':
      writeResult({
        success: true,
        url: page.url(),
        title: await page.title(),
        consoleLogsCount: consoleLogs.length
      });
      break;

    case 'screenshot':
      const screenshotPath = data.path || path.join(__dirname, 'screenshot.png');
      if (data.selector) {
        // Element screenshot via page.screenshot + clip (avoids stability timeout on animated pages)
        const element = page.locator(data.selector);
        const box = await element.boundingBox();
        if (!box) throw new Error(`Element not found: ${data.selector}`);
        await page.screenshot({ path: screenshotPath, clip: box });
      } else {
        await page.screenshot({
          path: screenshotPath,
          fullPage: data.fullPage || false
        });
      }
      writeResult({
        success: true,
        path: screenshotPath,
        selector: data.selector || null
      });
      break;

    case 'screenshot-clean':
      // Screenshot canvas without UI overlay
      const cleanPath = data.path || path.join(__dirname, 'screenshot-clean.png');
      const canvasSel = data.selector || '.scene-canvas';
      const hideSel = data.hide || '#app';

      // Hide UI
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.style.display = 'none';
      }, hideSel);

      // Screenshot element
      const element = page.locator(canvasSel);
      await element.screenshot({ path: cleanPath });

      // Show UI
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.style.display = '';
      }, hideSel);

      writeResult({
        success: true,
        path: cleanPath,
        selector: canvasSel,
        hidden: hideSel
      });
      break;

    case 'capture-canvas':
      // Capture canvas element directly (no UI) via toDataURL
      const canvasSelector = data.selector || 'canvas';
      const canvasPath = data.path || path.join(__dirname, 'canvas-capture.png');

      const dataUrl = await page.evaluate((sel) => {
        const canvas = document.querySelector(sel);
        if (!canvas) return { error: `Canvas not found: ${sel}` };
        if (!canvas.toDataURL) return { error: 'Element is not a canvas' };
        return { data: canvas.toDataURL('image/png') };
      }, canvasSelector);

      if (dataUrl.error) {
        writeResult({ success: false, error: dataUrl.error });
      } else {
        // Extract base64 and save
        const base64Data = dataUrl.data.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(canvasPath, Buffer.from(base64Data, 'base64'));
        writeResult({
          success: true,
          path: canvasPath,
          selector: canvasSelector
        });
      }
      break;

    case 'resize':
      await page.setViewportSize({
        width: data.width,
        height: data.height
      });
      writeResult({
        success: true,
        width: data.width,
        height: data.height
      });
      break;

    case 'inspect':
      const viewport = page.viewportSize();
      const browserVersion = browser.version();
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const memoryUsage = process.memoryUsage();

      writeResult({
        success: true,
        process: {
          pid: process.pid,
          uptime: uptime,
          memory: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
          sizePreset: sizeArg
        },
        browser: {
          connected: isBrowserConnected(),
          browserType: browserArg,
          version: browserVersion
        },
        page: {
          url: page.url(),
          title: await page.title(),
          viewport: viewport
        },
        consoleLogs: consoleLogs.length
      });
      break;

    case 'shutdown':
      console.log('Shutdown command received');
      writeResult({ success: true, message: 'Shutting down...' });
      // Give time for result to be written
      setTimeout(async () => {
        if (browser && isBrowserConnected()) {
          await browser.close().catch(() => {});
        }
        cleanup();
        process.exit(0);
      }, 100);
      break;

    case 'restart':
      console.log('Restart command received');
      writeResult({ success: true, message: 'Restarting browser...' });
      // Close current browser and start fresh
      isRestarting = true;
      setTimeout(async () => {
        try {
          if (browser) {
            await browser.close().catch(() => {});
          }
          consoleLogs = [];
          await startBrowser();
          console.log('Browser restarted successfully');
        } catch (err) {
          console.error('Failed to restart browser:', err.message);
        } finally {
          isRestarting = false;
        }
      }, 100);
      break;

    default:
      writeResult({ error: 'Unknown command: ' + action });
  }
}

function writeResult(data) {
  fs.writeFileSync(RESULT_FILE, JSON.stringify(data, null, 2));
}

function killBrowserProcess() {
  if (!browserPid) return;
  try {
    process.kill(browserPid, 'SIGKILL');
  } catch {
    // already dead
  }
  browserPid = null;
}

function cleanup() {
  killBrowserProcess();
  [COMMAND_FILE, RESULT_FILE, READY_FILE].forEach(file => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  });
}

// Clean up old files on start
cleanup();

// Start the daemon
startDaemon().catch(err => {
  console.error('Fatal error:', err);
  cleanup();
  process.exit(1);
});
