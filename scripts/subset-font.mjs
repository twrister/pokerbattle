#!/usr/bin/env node
/**
 * 生成中文标题字体子集：站酷快乐体全量 TTF 约 1.5MB，直接上线太重。
 * 子集 = GB2312 一级常用字（3755 个）∪ 客户端源码里实际出现的汉字 ∪ ASCII 与常用中文标点，
 * 文案新增了生僻字时重跑本脚本即可。
 *
 * 依赖：Python 3 + fonttools + brotli（pip install fonttools brotli）。
 * 用法：node scripts/subset-font.mjs   （可用环境变量 PYTHON 指定解释器，默认 Windows 用 py -3）
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_FONT = join(root, 'packages/client/assets/fonts/ZCOOLKuaiLe-Regular.ttf');
const OUTPUT_FONT = join(root, 'packages/client/public/fonts/zcool-kuaile-subset.woff2');
const SCAN_ROOTS = [
  join(root, 'packages/client/index.html'),
  join(root, 'packages/client/src'),
  join(root, 'packages/sim/src'),
];
const SCAN_EXT = /\.(ts|html|json)$/;
const EXTRA_CHARS = '，。！？、：；“”‘’（）《》【】…—·～￥％＋－×÷';

/** 递归收集待扫描的源码文件路径。 */
function collectFiles(path, out = []) {
  const stat = statSync(path);
  if (stat.isFile()) {
    if (SCAN_EXT.test(path)) out.push(path);
    return out;
  }
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    collectFiles(join(path, name), out);
  }
  return out;
}

/** GB2312 一级字库：区位 B0A1–D7F9，按 GBK 解码得到 3755 个常用汉字。 */
function gb2312Level1() {
  const decoder = new TextDecoder('gbk');
  let text = '';
  for (let hi = 0xb0; hi <= 0xd7; hi++) {
    const lastLo = hi === 0xd7 ? 0xf9 : 0xfe;
    for (let lo = 0xa1; lo <= lastLo; lo++) text += decoder.decode(Uint8Array.from([hi, lo]));
  }
  return text;
}

/** 从源码中提取全部 CJK 字符。 */
function sourceChars() {
  let text = '';
  for (const file of SCAN_ROOTS.flatMap((p) => collectFiles(p))) {
    const matches = readFileSync(file, 'utf8').match(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/g);
    if (matches) text += matches.join('');
  }
  return text;
}

/** 调用 fonttools 生成 woff2 子集。 */
function runSubset(chars) {
  const temp = mkdtempSync(join(tmpdir(), 'pb-font-'));
  const textFile = join(temp, 'chars.txt');
  writeFileSync(textFile, chars, 'utf8');
  const [cmd, ...prefix] = (process.env.PYTHON ?? (process.platform === 'win32' ? 'py -3' : 'python3')).split(' ');
  try {
    execFileSync(
      cmd,
      [
        ...prefix,
        '-m',
        'fontTools.subset',
        SOURCE_FONT,
        `--text-file=${textFile}`,
        `--output-file=${OUTPUT_FONT}`,
        '--flavor=woff2',
        '--layout-features=*',
        '--no-hinting',
      ],
      { stdio: 'inherit' },
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

let ascii = '';
for (let c = 0x20; c < 0x7f; c++) ascii += String.fromCharCode(c);
const chars = [...new Set(ascii + EXTRA_CHARS + gb2312Level1() + sourceChars())].join('');
runSubset(chars);
console.log(`子集字符 ${chars.length} 个 → ${OUTPUT_FONT}（${(statSync(OUTPUT_FONT).size / 1024).toFixed(0)} KB）`);
