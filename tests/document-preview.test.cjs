/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the pure preview guards without mounting a browser UI. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadHelpers(filename, requireMock = () => ({})) {
  const source = readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const helpers = {};
  vm.runInNewContext(compiled, { exports: helpers, require: requireMock, URL, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://portal-test.invalid' } } });
  return helpers;
}
const access = loadHelpers('lib/document-access.ts');
const mockedImports = (name) => name === '@/lib/document-access' ? access : {};
const { getDocumentPreviewKind, formatDocumentSize } = loadHelpers('app/components/document-library.tsx', mockedImports);
const { getVerifiedDocumentMime } = loadHelpers('app/components/document-preview-modal.tsx', mockedImports);

test('inline preview accepts only portal-stored PDF and raster image names', () => {
  for (const name of ['report.pdf', 'REPORT.PDF']) assert.equal(getDocumentPreviewKind({ name, url: 'storage://files/file' }), 'pdf');
  for (const name of ['image.png', 'image.JPG', 'image.jpeg', 'image.webp', 'image.gif']) assert.equal(getDocumentPreviewKind({ name, url: 'https://portal-test.invalid/storage/v1/object/public/files/image' }), 'image');
  for (const name of ['image.svg', 'page.html', 'page.htm', 'document.hwp', 'document.hwpx', 'document.docx', 'slides.pptx', 'sheet.xlsx', 'file.txt', 'file.pdf.exe']) assert.equal(getDocumentPreviewKind({ name, url: 'storage://files/file' }), null, name);
});

test('unsafe, relative, malformed and credential-bearing URLs cannot become inline previews', () => {
  for (const url of ['javascript:alert(1)', 'data:application/pdf,abc', 'blob:https://files.example/id', 'file:///tmp/report.pdf', '/report.pdf', '//files.example/report.pdf', 'not a URL', 'https://user:password@portal-test.invalid/storage/v1/object/public/files/report.pdf', 'https://files.example/storage/v1/object/public/files/report.pdf']) assert.equal(getDocumentPreviewKind({ name: 'report.pdf', url }), null, url);
});

test('actual format signatures must agree with the allowed extension', () => {
  const bytes = (text) => Uint8Array.from(Buffer.from(text));
  assert.equal(getVerifiedDocumentMime(bytes('%PDF-1.7'), 'pdf'), 'application/pdf');
  assert.equal(getVerifiedDocumentMime(Uint8Array.from([0xff, 0xd8, 0xff]), 'jpg'), 'image/jpeg');
  assert.equal(getVerifiedDocumentMime(Uint8Array.from([0xff, 0xd8, 0xff]), 'jpeg'), 'image/jpeg');
  assert.equal(getVerifiedDocumentMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png'), 'image/png');
  assert.equal(getVerifiedDocumentMime(bytes('GIF89a'), 'gif'), 'image/gif');
  assert.equal(getVerifiedDocumentMime(bytes('GIF87a'), 'gif'), 'image/gif');
  assert.equal(getVerifiedDocumentMime(bytes('RIFFxxxxWEBP'), 'webp'), 'image/webp');
  assert.equal(getVerifiedDocumentMime(bytes('%PDF-1.7'), 'png'), null);
  assert.equal(getVerifiedDocumentMime(bytes('<html><script>'), 'pdf'), null);
  assert.equal(getVerifiedDocumentMime(bytes('<svg onload='), 'png'), null);
  assert.equal(getVerifiedDocumentMime(bytes('RIFFxxxxWAVE'), 'webp'), null);
  assert.equal(getVerifiedDocumentMime(bytes(''), 'jpg'), null);
});

test('legacy missing metadata is explicit and zero-byte files are not treated as unknown', () => {
  assert.equal(formatDocumentSize(null), '크기 정보 없음');
  assert.equal(formatDocumentSize(undefined), '크기 정보 없음');
  assert.equal(formatDocumentSize(-1), '크기 정보 없음');
  assert.equal(formatDocumentSize(NaN), '크기 정보 없음');
  assert.equal(formatDocumentSize(0), '0 B');
  assert.equal(formatDocumentSize(1024), '1.0 KB');
  assert.equal(formatDocumentSize(1024 * 1024), '1.0 MB');
});
