import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 布局度量回归：整套页面尺寸只允许走 `--hu`（9:16 舞台宽 / 720）一条轴。
 *
 * 为什么需要它：只要有人往样式里写一个固定 `px` 尺寸、一个视口单位，
 * 或者给字号单独加下限，同宽高比的不同分辨率就会在这些点位上分叉，
 * 表现为换行位置、面板高度、分栏比例不一致。这类问题肉眼很难逐页发现，
 * 所以用静态扫描把规则钉死。
 */

const INDEX_HTML = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');

/** 允许出现视口单位的变量声明：它们就是定义舞台尺寸本身的地方。 */
const STAGE_VAR_WHITELIST = ['--stage-w', '--stage-h', '--stage-left', '--page-h'];

/** 允许保留 px 的写法：胶囊圆角与零值，与缩放无关。 */
const PILL_RADIUS = /border-radius:\s*999px/g;

/**
 * 去掉与缩放无关的 px 片段，避免它们把同一行里真正的固定尺寸「掩护」过去。
 * 例如 `width: 20px; inset: 0px` 里的 0px 不该让 20px 蒙混过关。
 */
function stripHarmlessPx(line: string): string {
  return line.replace(/\b0px\b/g, '0').replace(PILL_RADIUS, 'border-radius: pill');
}

/**
 * 读取 `<style>` 内容，并把块注释替换成等量换行。
 * 这样报错行号仍然对应 index.html 的真实行号，定位时不必再换算。
 */
function readStyleSheet(): { lines: string[]; firstLine: number } {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const htmlLines = html.split(/\r?\n/);
  const startIndex = htmlLines.findIndex((line) => line.includes('<style>'));
  const endIndex = htmlLines.findIndex((line, index) => index > startIndex && line.includes('</style>'));
  if (startIndex < 0 || endIndex < 0) throw new Error('index.html 里找不到 <style> 块');

  const styleText = htmlLines.slice(startIndex + 1, endIndex).join('\n');
  // 用同样多的换行替换注释，保证行数不变
  const stripped = styleText.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, ''),
  );
  return { lines: stripped.split('\n'), firstLine: startIndex + 2 };
}

/** 标记每一行是否位于 @media 块内部（用于区分「窄屏档专用」与「全局」）。 */
function markMediaScope(lines: readonly string[]): boolean[] {
  const inside: boolean[] = [];
  const stack: Array<'media' | 'other'> = [];
  for (const line of lines) {
    inside.push(stack.includes('media'));
    const isMediaAtRule = /^\s*@media\b/.test(line);
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    for (let index = 0; index < opens; index += 1) {
      stack.push(isMediaAtRule && index === 0 ? 'media' : 'other');
    }
    for (let index = 0; index < closes; index += 1) stack.pop();
  }
  return inside;
}

/** 把命中的行整理成「index.html 行号: 原文」，断言失败时可直接定位。 */
function report(
  lines: readonly string[],
  firstLine: number,
  predicate: (line: string, index: number) => boolean,
): string[] {
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => predicate(line, index))
    .map(({ line, index }) => `${firstLine + index}: ${line.trim()}`);
}

describe('跨分辨率布局度量', () => {
  const { lines, firstLine } = readStyleSheet();
  const inMedia = markMediaScope(lines);

  it('字号只走 --fsu，不出现固定 px 字号', () => {
    const offenders = report(lines, firstLine, (line) => /font-size\s*:[^;]*\dpx/.test(line));
    expect(offenders).toEqual([]);
  });

  it('除舞台尺寸变量外不出现视口单位', () => {
    const offenders = report(lines, firstLine, (line, index) => {
      if (!/\d(?:\.\d+)?(?:vw|vh|dvh|svh|dvw|svh|vmin|vmax)\b/.test(line)) return false;
      if (inMedia[index]) return false;
      return !STAGE_VAR_WHITELIST.some((name) => line.includes(`${name}:`));
    });
    expect(offenders).toEqual([]);
  });

  it('尺寸/间距/定位不使用固定 px（断点与胶囊圆角除外）', () => {
    const sizingProperty =
      /^\s*(?:padding|margin|gap|row-gap|column-gap|width|height|min-width|max-width|min-height|max-height|top|bottom|left|right|inset|border|border-width|border-radius|padding-left|padding-right|padding-top|padding-bottom|perspective|outline|outline-offset|translate|transform)\b[^;]*\d+(?:\.\d+)?px/;
    const offenders = report(lines, firstLine, (line) => {
      // 视口断点本身就该用 px，与舞台缩放无关
      if (/^\s*@media\b/.test(line)) return false;
      if (!sizingProperty.test(stripHarmlessPx(line))) return false;
      // 窄屏档给字号兜底的 0.85px 下限是唯一的像素字号来源
      return !/--fsu\s*:/.test(line);
    });
    expect(offenders).toEqual([]);
  });

  it('全局 --fsu 与 --hu 完全同步，字号下限只出现在窄屏 @media 内', () => {
    const declarations = lines
      .map((line, index) => ({ line: line.trim(), index }))
      .filter(({ line }) => line.startsWith('--fsu:'));

    expect(declarations.length).toBeGreaterThan(0);

    const globalDeclarations = declarations.filter(({ index }) => !inMedia[index]);
    expect(globalDeclarations.map(({ line }) => line)).toEqual(['--fsu: var(--hu);']);

    // 带下限的写法必须落在 @media 内，否则所有分辨率都会提前「停止缩放」
    const floored = declarations.filter(({ line }) => line.includes('max('));
    expect(floored.length).toBeGreaterThan(0);
    expect(floored.every(({ index }) => inMedia[index])).toBe(true);
  });
});
