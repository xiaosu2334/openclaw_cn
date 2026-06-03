#!/usr/bin/env node
/**
 * i18n 翻译完整性检查工具
 * 对比 en.ts 与 zh-CN.ts，找出遗漏或未翻译的条目
 *
 * 用法: node scripts/check-i18n-zh.js
 */

const fs = require('fs');
const path = require('path');

const UI_DIR = path.join(__dirname, '..', 'ui', 'src', 'i18n', 'locales');

function extractMap(filepath) {
  const content = fs.readFileSync(filepath, 'utf-8');
  // 跳过类型注解如 `: TranslationMap = {`，找到实际对象字面量起始
  const start = content.indexOf('= {');
  if (start === -1) {
    console.error('无法找到对象定义:', filepath);
    process.exit(1);
  }
  // 找到 `= {` 后的 `{` 位置
  const braceStart = start + 2; // skip "= "
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const objStr = '(' + content.slice(braceStart, end) + ')';
  return eval(objStr);
}

function findUntranslated(enMap, zhMap, path) {
  const results = [];
  for (const key of Object.keys(enMap)) {
    const fullPath = path ? path + '.' + key : key;
    if (!(key in zhMap)) {
      results.push({ path: fullPath, en: enMap[key], reason: '缺失 key' });
    } else if (typeof enMap[key] === 'string' && zhMap[key] === enMap[key]) {
      // 值与英文完全相同 = 未翻译
      results.push({ path: fullPath, en: enMap[key], reason: '值未翻译' });
    } else if (typeof enMap[key] === 'object' && enMap[key] !== null && typeof zhMap[key] === 'object') {
      results.push(...findUntranslated(enMap[key], zhMap[key], fullPath));
    }
  }
  return results;
}

const TECHNICAL_TERMS = new Set([
  'MCP', 'UTC', 'CWD', 'CI/CD', 'API', 'JSON', 'HTTP', 'HTTPS', 'SSH', 'SSL', 'TLS',
  'CSS', 'HTML', 'SQL', 'NoSQL', 'REST', 'GraphQL', 'OAuth', 'JWT', 'CORS', 'URL',
  'GitHub', 'GitLab', 'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure',
  'Node.js', 'React', 'Vue', 'Angular', 'TypeScript', 'JavaScript',
  'Python', 'Go', 'Rust', 'Java', 'C++', 'Ruby', 'PHP',
  'Cron', 'WebSocket', 'Webhook', 'OpenAI', 'Claude',
]);

const TECHNICAL_PREFIXES = new Set([
  'WebSocket ', 'Webhook ', 'WebSocket\n',
]);

function isTechnicalString(str) {
  if (TECHNICAL_TERMS.has(str)) return true;
  // 纯数字/格式串/示例值
  if (/^\d+$/.test(str)) return true;
  // 纯占位符格式串: 如 "{argumentSummary}"
  if (/^\{[\w]+\}$/.test(str.trim())) return true;
  // 仅含 {param}/字母/数字/符号的格式串
  if (/^\{[\w]+\}[\s\w]*$/.test(str.trim())) return true;
  // 纯小写/数字/符号字符串（不含大写字母模式）
  if (/^[\d\s*/,.\-:a-z]+$/.test(str) && !/[A-Z].*[A-Z]/.test(str)) return true;
  // cron 表达式
  if (/^[\d\s*,\-/?LW#]+$/.test(str)) return true;
  // 配置值样式: 如 "plugins.entries.workboard.enabled = true"
  if (/^[\w.]+ = (true|false)$/.test(str)) return true;
  // 纯符号/分隔符: "—"
  if (/^[—\-\u2014]+$/.test(str.trim())) return true;
  // 产品或服务名: 如 "Tailscale serve" (首字母大写 + 空格 + 小写)
  if (/^[A-Z][a-z]+(\s[a-z]+)+$/.test(str)) return true;
  // 示例/占位符值: 如 "America/Los_Angeles"
  if (/^[\w]+\/[\w_]+$/.test(str)) return true;
  // 技术前缀开头: 如 "WebSocket URL", "Webhook POST"
  for (const prefix of TECHNICAL_PREFIXES) {
    if (str.startsWith(prefix)) return true;
  }
  return false;
}

// 主流程
const en = extractMap(path.join(UI_DIR, 'en.ts'));
const zh = extractMap(path.join(UI_DIR, 'zh-CN.ts'));

const all = findUntranslated(en, zh, '');
const genuine = all.filter(item => !isTechnicalString(item.en));
const technical = all.filter(item => isTechnicalString(item.en));

console.log('=== i18n(zh-CN) 翻译完整性报告 ===\n');
console.log(`总条目数: ${JSON.stringify(en).match(/"[^"]*"/g)?.length || 'N/A'}`);
console.log(`遗漏/未翻译: ${all.length} 处`);
console.log(`  其中真正需要翻译: ${genuine.length} 处`);
console.log(`  其中技术标识符(可豁免): ${technical.length} 处\n`);

if (genuine.length > 0) {
  console.log('⚠️  需要翻译的条目：');
  for (const item of genuine) {
    console.log(`  ${item.path}: "${item.en}" (${item.reason})`);
  }
  console.log('');
}

if (all.length === 0) {
  console.log('✅ 翻译覆盖率 100%，无需补充。');
} else if (genuine.length > 0) {
  console.log(`📝 请补充以上 ${genuine.length} 条翻译。`);
}

process.exit(genuine.length > 0 ? 1 : 0);
