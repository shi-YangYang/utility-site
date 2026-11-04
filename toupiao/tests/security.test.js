import assert from 'node:assert/strict';
import test from 'node:test';
import { csvDocument, csvEscape, sanitizeNextPath } from '../server/http.js';

test('sanitizeNextPath：只允许站内路径，拒绝开放重定向', () => {
  const allowed = [
    ['/', '/'],
    ['/admin', '/admin'],
    ['/?foo=1', '/?foo=1'],
    ['/admin#top', '/admin#top'],
    ['/a/b?x=1&y=2', '/a/b?x=1&y=2'],
    ['/admin%3Ffoo%3Dbar', '/admin?foo=bar'],
    ['  /admin  ', '/admin'],
  ];
  for (const [input, expected] of allowed) {
    assert.equal(sanitizeNextPath(input), expected, `应允许 ${input}`);
  }

  const rejected = [
    'https://evil.example',
    'http://evil.example',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/%5Cevil.example',
    '/%2F%2Fevil.example',
    '/%2f%2fevil.example',
    '/admin\r\nSet-Cookie: x=1',
    '/admin\u0000',
    'javascript:alert(1)',
    'admin',
    '',
    undefined,
    null,
    123,
    {},
    `/admin${'x'.repeat(600)}`,
  ];
  for (const input of rejected) {
    assert.equal(sanitizeNextPath(input), '/', `应拒绝 ${String(input)}`);
  }

  assert.equal(sanitizeNextPath('/bad%zz'), '/', '非法百分号编码应回退');
});

test('csvEscape：RFC 4180 转义 + 公式注入防护', () => {
  const cases = [
    ['张三', '张三'],
    ['', ''],
    [null, ''],
    [undefined, ''],
    [123, '123'],
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tTAB', "'\tTAB"],
    ['\rCR', `"'\rCR"`],
    ['=SUM(A1,A2)', `"'=SUM(A1,A2)"`],
    ['a,b', '"a,b"'],
    ['a"b', '"a""b"'],
    ['a\nb', '"a\nb"'],
    ['a\r\nb', '"a\r\nb"'],
    [' name', ' name'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(csvEscape(input), expected, `csvEscape(${JSON.stringify(input)})`);
  }
});

test('csvDocument：BOM 开头、CRLF 行尾、表头固定', () => {
  const csv = csvDocument(['姓名', '图标编号', '图标名称', '投票时间'], [
    ['张三', '01', '无限连接', '2026-11-04 12:00:00'],
    ['=注入', '02', '脑机接口', '2026-11-04 12:00:01'],
  ]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(
    csv,
    '\uFEFF姓名,图标编号,图标名称,投票时间\r\n' +
      '张三,01,无限连接,2026-11-04 12:00:00\r\n' +
      "'=注入,02,脑机接口,2026-11-04 12:00:01\r\n",
  );
  assert.equal(csvDocument(['a'], []), '\uFEFFa\r\n');
});
