/* eslint-disable @typescript-eslint/no-require-imports -- Test the real page handler without rendering the portal or contacting its services. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '../app/page.tsx'), 'utf8');
const syntax = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const findNode = (node, predicate) => predicate(node) ? node : ts.forEachChild(node, (child) => findNode(child, predicate));
const initializer = findNode(syntax, (node) => ts.isVariableDeclaration(node) && node.name.getText(syntax) === 'openKioskWindow')?.initializer;
assert.ok(initializer, 'The portal must expose a kiosk click handler');
const handlerScript = ts.transpileModule(`module.exports = ${initializer.getText(syntax)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const redirectEffect = findNode(syntax, (node) => ts.isCallExpression(node) && node.expression.getText(syntax) === 'useEffect' && ts.isArrowFunction(node.arguments[0]) && node.arguments[0].body.getText(syntax).includes('window.location.replace(kioskUrl.toString())'));
assert.ok(redirectEffect, 'Legacy kiosk links must have a redirect');
const redirectScript = ts.transpileModule(`module.exports = ${redirectEffect.arguments[0].getText(syntax)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;

function context(options = {}) {
  const calls = { open: [], focus: 0, inline: [], notices: [], fullscreen: 0, screenPermission: 0 };
  const window = {
    location: { origin: 'https://portal.example', search: options.search ?? '', replace: (url) => { calls.redirect = url; } },
    screen: { availLeft: -1920, availTop: 40, availWidth: 1920, availHeight: 1040 },
    matchMedia: () => ({ matches: options.mobile ?? false }),
    open: (...args) => {
      calls.open.push(args);
      if (options.throws) throw new Error('Browser window policy');
      return options.blocked ? null : { focus: () => { calls.focus += 1; } };
    },
    getScreenDetails: () => { calls.screenPermission += 1; throw new Error('Unexpected permission request'); },
  };
  const globals = {
    module: { exports: {} }, window, URL, URLSearchParams,
    navigator: { userAgent: options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    document: {
      fullscreenElement: options.fullscreen ?? null,
      documentElement: { requestFullscreen: () => { calls.fullscreen += 1; return Promise.resolve(); } },
      createElement: () => { throw new Error('A browser kiosk must not invoke an installed launcher'); },
    },
    setIsKioskOpen: (value) => calls.inline.push(value),
    setKioskLaunchNotice: (value) => calls.notices.push(value),
    isDedicatedKiosk: options.dedicated ?? true,
  };
  return { globals, calls };
}

test('Windows opens a reusable standalone browser window synchronously without installation or screen permission', () => {
  const { globals, calls } = context();
  vm.runInNewContext(handlerScript, globals);
  assert.equal(globals.module.exports(), undefined);
  assert.equal(calls.open.length, 1);
  assert.equal(calls.open[0][0], 'https://portal.example/kiosk');
  assert.equal(calls.open[0][1], 'dphs-dashboard-kiosk');
  assert.match(calls.open[0][2], /popup/);
  assert.match(calls.open[0][2], /left=-1920,top=40,width=1920,height=1040/);
  assert.equal(calls.focus, 1);
  assert.equal(calls.screenPermission, 0);
  assert.equal(calls.fullscreen, 0);
  assert.deepEqual(calls.inline, []);
  assert.deepEqual(calls.notices, []);
  globals.module.exports();
  assert.equal(calls.open[1][1], calls.open[0][1], 'Reuse the same named window on repeated clicks');
});

test('a blocked or rejected popup preserves the inline fullscreen fallback', () => {
  for (const options of [{ blocked: true }, { throws: true }]) {
    const { globals, calls } = context(options);
    vm.runInNewContext(handlerScript, globals);
    globals.module.exports();
    assert.deepEqual(calls.inline, [true]);
    assert.deepEqual(calls.notices, ['별도 창을 열지 못해 현재 화면에서 전광판을 열었습니다.']);
    assert.equal(calls.fullscreen, 1);
    assert.equal(calls.screenPermission, 0);
  }
});

test('mobile stays in the current window and does not request fullscreen twice', () => {
  const { globals, calls } = context({ mobile: true, fullscreen: {} });
  vm.runInNewContext(handlerScript, globals);
  globals.module.exports();
  assert.deepEqual(calls.inline, [true]);
  assert.deepEqual(calls.notices, ['']);
  assert.equal(calls.open.length, 0);
  assert.equal(calls.fullscreen, 0);
});

test('legacy kiosk links use the browser route unless the launcher was explicitly requested', () => {
  for (const [search, expected] of [['?kiosk=1', 'https://portal.example/kiosk'], ['?kiosk=1&launcher=0', 'https://portal.example/kiosk'], ['?kiosk=1&launcher=1', 'https://portal.example/kiosk?launcher=1']]) {
    const { globals, calls } = context({ search });
    vm.runInNewContext(redirectScript, globals);
    globals.module.exports();
    assert.equal(calls.redirect, expected);
  }
  const { globals, calls } = context({ dedicated: false });
  vm.runInNewContext(redirectScript, globals);
  globals.module.exports();
  assert.equal(calls.redirect, undefined);
});
