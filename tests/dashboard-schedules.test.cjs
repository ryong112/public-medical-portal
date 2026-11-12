/* eslint-disable @typescript-eslint/no-require-imports -- Run TypeScript helpers and React rendering with the built-in Node test runner. */
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const modules = new Map();
function load(relativePath) {
  if (modules.has(relativePath)) return modules.get(relativePath);
  const source = readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(compiled, { exports: compiledModule.exports, module: compiledModule, require: (name) => {
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name.startsWith('@/') || name.startsWith('.')) {
      const relative = name.startsWith('@/') ? name.slice(2) : path.join(path.dirname(relativePath), name);
      const candidate = [relative, `${relative}.ts`, `${relative}.tsx`].find((file) => existsSync(path.join(__dirname, '..', file)));
      if (!candidate) throw new Error(`Missing local module ${relative}`);
      return load(candidate);
    }
    return require(name);
  } });
  modules.set(relativePath, compiledModule.exports);
  return compiledModule.exports;
}

const helpers = load('lib/dashboard-schedules.ts');
const { WeeklySchedulePrintSheet } = load('app/components/weekly-schedule-print.tsx');
const SharedDashboard = load('app/components/shared-dashboard.tsx').default;
const item = (id, date, extra = {}) => ({ id, date, title: `일정 ${id}`, start_time: null, end_time: null, ...extra });

test('overdue unfinished TODO survives while future and old completed TODO do not inflate current work', () => {
  const schedules = [
    item(1, '2026-11-10', { is_todo: true }), item(2, '2026-11-12', { is_todo: true }),
    item(3, '2026-11-12', { is_todo: true, is_completed: true }), item(4, '2026-11-13', { is_todo: true }),
    item(5, '2026-11-10', { is_todo: true, is_completed: true }), item(6, '2026-11-11'),
    item(7, '2026-11-10', { end_date: '2026-11-14', is_todo: true }),
  ];
  const visible = helpers.getDashboardTodos(schedules, '2026-11-12');
  assert.deepEqual(Array.from(visible, (schedule) => schedule.id), [1, 2, 7, 3]);
  assert.equal(helpers.getTodoStatus(schedules[0], '2026-11-12'), '기한 지남');
  assert.equal(helpers.getTodoStatus(schedules[1], '2026-11-12'), '오늘');
  assert.equal(helpers.getTodoStatus(schedules[2], '2026-11-12'), '완료');
  assert.equal(helpers.getTodoStatus(schedules[3], '2026-11-12'), '예정');
  assert.equal(helpers.getTodoStatus(schedules[6], '2026-11-12'), '오늘');
});

test('seven-day ranges cross month and year boundaries without omitting the final day', () => {
  assert.deepEqual(Array.from(helpers.getSevenDayKeys('2026-12-29')), ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04']);
  assert.equal(helpers.getSevenDayKeys('2026-02-30').length, 0);
  assert.equal(helpers.getSevenDayKeys('').length, 0);
  assert.equal(helpers.shiftDateKey('2028-02-28', 1), '2028-02-29');
  assert.equal(helpers.scheduleOverlaps(item(1, '2026-11-10', { end_date: '2026-11-12' }), '2026-11-12', '2026-11-18'), true);
  assert.equal(helpers.scheduleOverlaps(item(1, '2026-11-19'), '2026-11-12', '2026-11-18'), false);
});

test('print output preserves metadata, absences, all seven days and escapes user text', () => {
  const schedules = [
    item(1, '2026-11-12', { title: '<script>alert("title")</script>', schedule_type: 'meeting', owner_name: '김담당', attendee_names: ['이참석', '박참석'], location: '<img src=x onerror=alert(1)>' }),
    item(2, '2026-11-11', { title: '휴가) 최직원', schedule_type: 'leave', absence_type: 'early_am', end_date: '2026-11-13' }),
    item(3, '2026-11-18', { title: '마지막 날 일정' }), item(4, '2026-11-19', { title: '범위 밖 일정' }),
  ];
  const html = renderToStaticMarkup(React.createElement(WeeklySchedulePrintSheet, { schedules, startDate: '2026-11-12', scopeLabel: '내 일정' }));
  assert.match(html, /김담당/);
  assert.match(html, /이참석, 박참석/);
  assert.match(html, /오전 조퇴/);
  assert.match(html, /내 일정/);
  assert.match(html, /마지막 날 일정/);
  assert.doesNotMatch(html, /범위 밖 일정/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.equal((html.match(/class="weekly-print-day"/g) ?? []).length, 7);
  assert.equal((html.match(/휴가\) 최직원/g) ?? []).length, 2);
});

test('print output does not cap many events or truncate long titles', () => {
  const longTitle = '매우 긴 업무 제목과 세부사항 '.repeat(80);
  const schedules = Array.from({ length: 120 }, (_, index) => item(index, '2026-11-12', { title: index === 119 ? longTitle : `다량일정-${index}` }));
  const html = renderToStaticMarkup(React.createElement(WeeklySchedulePrintSheet, { schedules, startDate: '2026-11-12' }));
  assert.match(html, /다량일정-118/);
  assert.ok(html.includes(longTitle));
  assert.equal((html.match(/class="event-title"/g) ?? []).length, 120);
  const source = readFileSync(path.join(__dirname, '..', 'app/components/weekly-schedule-print.tsx'), 'utf8');
  assert.match(source, /@media print/);
  assert.match(source, /table-header-group/);
  assert.match(source, /height: auto !important/);
  assert.doesNotMatch(source, /line-clamp|text-overflow:\s*ellipsis|scale\(/);
});

test('compact dashboard has one shared category control and one fixed pair of day panels', () => {
  const today = helpers.toLocalDateKey(new Date());
  const schedules = [item(1, today, { schedule_type: 'meeting' }), item(2, today, { schedule_type: 'leave', title: '휴가) 김직원' }), item(3, helpers.shiftDateKey(today, -1), { is_todo: true })];
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(SharedDashboard, { schedules, onChangeView: noop, onOpenChat: noop, onOpenSchedule: noop, onToggleScheduleComplete: noop, onPrintWeek: noop }));
  assert.equal((html.match(/aria-label="일정 유형"/g) ?? []).length, 1);
  assert.equal((html.match(/data-dashboard-summary=/g) ?? []).length, 4);
  assert.equal((html.match(/data-dashboard-day=/g) ?? []).length, 2);
  assert.match(html, /주간 일정/);
  assert.match(html, /이번 달 휴가/);
  assert.match(html, /할 일/);
  assert.match(html, /data-dashboard-count[^>]*>2</, 'all counts include both work and leave');
  assert.match(html, /주간 인쇄/);
  assert.doesNotMatch(html, /앞으로 7일|유형 선택 · 목록 필터|미완료 유형별 건수|유형 간 인원 중복 가능|업무 전체는 휴가/);
});
