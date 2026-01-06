#!/usr/bin/env node
/**
 * Client for browser daemon
 * Sends commands and waits for results
 */

const fs = require('fs');
const path = require('path');

const COMMAND_FILE = path.join(__dirname, '.browser-command');
const RESULT_FILE = path.join(__dirname, '.browser-result');
const READY_FILE = path.join(__dirname, '.browser-ready');

function checkDaemonRunning() {
  if (!fs.existsSync(READY_FILE)) {
    console.error('Browser daemon not running!');
    console.error('Start it with: node browser-daemon.js');
    process.exit(1);
  }
}

function sendCommand(command) {
  // Delete old result
  if (fs.existsSync(RESULT_FILE)) {
    fs.unlinkSync(RESULT_FILE);
  }

  // Write command
  fs.writeFileSync(COMMAND_FILE, JSON.stringify(command));

  // Wait for result (with timeout)
  const startTime = Date.now();
  const timeout = 30000; // 30 seconds

  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      if (fs.existsSync(RESULT_FILE)) {
        clearInterval(checkInterval);
        const result = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8'));
        fs.unlinkSync(RESULT_FILE);
        resolve(result);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('Command timeout'));
      }
    }, 50);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  checkDaemonRunning();

  try {
    let command, result;

    switch (action) {
      case 'navigate':
        const url = args[1];
        if (!url) {
          console.error('Usage: node browser-client.js navigate <url>');
          process.exit(1);
        }
        command = { action: 'navigate', data: { url } };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Navigated successfully!');
          console.log('URL:', result.url);
          console.log('Title:', result.title);
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'exec':
        const code = args[1];
        if (!code) {
          console.error('Usage: node browser-client.js exec "javascript code"');
          process.exit(1);
        }
        command = { action: 'exec', data: { code } };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Result:');
          if (typeof result.result === 'object') {
            console.log(JSON.stringify(result.result, null, 2));
          } else {
            console.log(result.result);
          }
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'console':
        command = { action: 'console', data: {} };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Console logs (' + result.logs.length + ' entries):');
          console.log('');
          result.logs.forEach(log => {
            const prefix = {
              'log': 'LOG',
              'info': 'INFO',
              'warn': 'WARN',
              'error': 'ERROR',
              'debug': 'DEBUG',
              'pageerror': 'PAGEERROR'
            }[log.type] || 'MSG';
            console.log(`${prefix} [${log.type.toUpperCase()}] ${log.text}`);
            if (log.location && log.location.url) {
              console.log(`   └─ ${log.location.url}:${log.location.lineNumber || 0}`);
            }
          });
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'console-clear':
        command = { action: 'console-clear', data: {} };
        result = await sendCommand(command);
        console.log('Console logs cleared');
        break;

      case 'status':
        command = { action: 'status', data: {} };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Browser daemon is running');
          console.log('Current URL:', result.url);
          console.log('Current title:', result.title);
          console.log('Console logs:', result.consoleLogsCount);
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'screenshot':
        const screenshotPath = args[1];
        // Check if second arg is selector (starts with . or #) or fullpage
        let fullPage = false;
        let selector = null;
        if (args[2]) {
          if (args[2] === 'fullpage') {
            fullPage = true;
          } else {
            selector = args[2];
          }
        }
        if (!screenshotPath) {
          console.error('Usage: node browser-client.js screenshot <path> [fullpage|selector]');
          console.error('  Example: screenshot /tmp/page.png');
          console.error('  Example: screenshot /tmp/page.png fullpage');
          console.error('  Example: screenshot /tmp/canvas.png .scene-canvas');
          process.exit(1);
        }
        command = { action: 'screenshot', data: { path: screenshotPath, fullPage, selector } };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Screenshot saved!');
          console.log('Path:', result.path);
          if (result.selector) console.log('Element:', result.selector);
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'screenshot-clean':
        // Screenshot element without UI overlay
        const cleanPath = args[1];
        const cleanSelector = args[2] || '.scene-canvas';
        const hideSelector = args[3] || '#app';
        if (!cleanPath) {
          console.error('Usage: node browser-client.js screenshot-clean <path> [canvas-selector] [hide-selector]');
          console.error('  Default canvas: .scene-canvas');
          console.error('  Default hide: #app');
          console.error('  Example: screenshot-clean /tmp/scene.png .scene-canvas #app');
          process.exit(1);
        }
        command = { action: 'screenshot-clean', data: { path: cleanPath, selector: cleanSelector, hide: hideSelector } };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Clean screenshot saved!');
          console.log('Path:', result.path);
          console.log('Element:', result.selector);
          console.log('Hidden:', result.hidden);
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'capture-canvas':
        const canvasPath = args[1];
        const canvasSelector = args[2] || 'canvas';
        if (!canvasPath) {
          console.error('Usage: node browser-client.js capture-canvas <path> [selector]');
          console.error('  Default selector: canvas');
          console.error('  Example: capture-canvas /tmp/scene.png .scene-canvas');
          process.exit(1);
        }
        command = { action: 'capture-canvas', data: { path: canvasPath, selector: canvasSelector } };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Canvas captured!');
          console.log('Path:', result.path);
          console.log('Selector:', result.selector);
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'resize':
        const width = parseInt(args[1]);
        const height = parseInt(args[2]);
        if (!width || !height) {
          console.error('Usage: node browser-client.js resize <width> <height>');
          process.exit(1);
        }
        command = { action: 'resize', data: { width, height } };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Viewport resized!');
          console.log('New size:', result.width, 'x', result.height);
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'inspect':
        command = { action: 'inspect', data: {} };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Browser Daemon Status');
          console.log('');
          console.log('Process:');
          console.log('  PID:', result.process.pid);
          console.log('  Uptime:', result.process.uptime, 'seconds');
          console.log('  Memory:', result.process.memory);
          console.log('  Size preset:', result.process.sizePreset);
          console.log('');
          console.log('Browser:');
          console.log('  Connected:', result.browser.connected);
          console.log('  Type:', result.browser.browserType);
          console.log('  Version:', result.browser.version);
          console.log('');
          console.log('Page:');
          console.log('  URL:', result.page.url);
          console.log('  Title:', result.page.title);
          console.log('  Viewport:', result.page.viewport.width, 'x', result.page.viewport.height);
          console.log('');
          console.log('Console logs:', result.consoleLogs, 'entries');
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'reload':
        command = { action: 'reload', data: {} };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Page reloaded successfully!');
          console.log('URL:', result.url);
          console.log('Title:', result.title);
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'shutdown':
        command = { action: 'shutdown', data: {} };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Shutdown command sent:', result.message);
          console.log('Daemon will exit after closing browser.');
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'restart':
        command = { action: 'restart', data: {} };
        result = await sendCommand(command);

        if (result.success) {
          console.log('Restart command sent:', result.message);
          console.log('Waiting for browser to restart...');
          // Wait for browser to restart
          await new Promise(resolve => setTimeout(resolve, 3000));
          console.log('Browser restarted.');
        } else {
          console.error('Error:', result.error);
        }
        break;

      case 'list':
        // Check for .browser-ready file to determine if daemon is running
        if (fs.existsSync(READY_FILE)) {
          console.log('Browser daemon is running');

          // Use status command to get basic info
          command = { action: 'status', data: {} };
          result = await sendCommand(command);

          if (result.success) {
            console.log('  URL:', result.url);
            console.log('  Title:', result.title);
            console.log('');
            console.log('Use "inspect" for detailed status information.');
          }
        } else {
          console.log('No browser daemon is running');
          console.log('Start it with: node browser-daemon.js [--size=quarter|dev|full|WxH]');
        }
        break;

      default:
        console.log('Browser Daemon Client');
        console.log('');
        console.log('Usage:');
        console.log('  node browser-client.js navigate <url>');
        console.log('  node browser-client.js reload');
        console.log('  node browser-client.js exec "javascript code"');
        console.log('  node browser-client.js console');
        console.log('  node browser-client.js console-clear');
        console.log('  node browser-client.js screenshot <path> [fullpage|selector]');
        console.log('  node browser-client.js screenshot-clean <path> [canvas-sel] [hide-sel]');
        console.log('  node browser-client.js capture-canvas <path> [selector]');
        console.log('  node browser-client.js resize <width> <height>');
        console.log('  node browser-client.js status');
        console.log('  node browser-client.js inspect');
        console.log('  node browser-client.js shutdown');
        console.log('  node browser-client.js restart');
        console.log('  node browser-client.js list');
        process.exit(1);
    }

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
