const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/init');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

// All interval statistics require admin authentication
router.use(authenticateToken);

function parseDateInput(value) {
  if (!DATE_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Resolve the requested interval into concrete UTC day boundaries.
// Presets: 7d (default), 30d, month; or explicit start/end (YYYY-MM-DD, end inclusive).
function resolveRange(query) {
  const today = startOfTodayUtc();
  let start;
  let end = today;
  let label;

  if (query.start || query.end) {
    if (!query.start || !query.end) {
      throw httpError(400, '自定义区间必须同时提供 start 和 end（YYYY-MM-DD）');
    }
    start = parseDateInput(query.start);
    end = parseDateInput(query.end);
    if (!start || !end) {
      throw httpError(400, '区间日期格式无效，应为 YYYY-MM-DD');
    }
    label = '自定义区间';
  } else {
    const preset = query.preset || '7d';
    if (preset === '30d') {
      start = new Date(today.getTime() - 29 * DAY_MS);
      label = '最近30天';
    } else if (preset === 'month') {
      start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      label = '本月';
    } else if (preset === '7d') {
      start = new Date(today.getTime() - 6 * DAY_MS);
      label = '最近7天';
    } else {
      throw httpError(400, '不支持的统计区间预设，可选 7d、30d、month');
    }
  }

  if (start.getTime() > end.getTime()) {
    throw httpError(400, '区间开始日期不能晚于结束日期');
  }

  const dayCount = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (dayCount > MAX_RANGE_DAYS) {
    throw httpError(400, `统计区间不能超过 ${MAX_RANGE_DAYS} 天`);
  }

  return { start, end, label, dayCount };
}

function httpError(status, error) {
  const err = new Error(error);
  err.status = status;
  return err;
}

function parseTags(tags) {
  return tags
    ? tags.split(',').map(t => t.trim()).filter(Boolean)
    : [];
}

// SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS"; normalize it to ISO
// so V8 never interprets it as local time.
function parseDbDate(value) {
  if (value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
    return new Date(value.replace(' ', 'T') + 'Z');
  }
  return new Date(value);
}

// Pure computation shared by the JSON endpoint and the file export, so the
// dashboard numbers and the downloaded report can never disagree.
function computeStats(range) {
  const db = getDb();
  const rows = db.prepare('SELECT id, title, tags, created_at, updated_at FROM articles').all();

  const articles = rows.map(row => ({
    id: row.id,
    title: row.title,
    tags: parseTags(row.tags),
    createdAt: parseDbDate(row.created_at),
    updatedAt: row.updated_at ? parseDbDate(row.updated_at) : null
  }));

  const rangeEndExclusive = new Date(range.end.getTime() + DAY_MS);
  const inRange = articles
    .filter(a => a.createdAt >= range.start && a.createdAt < rangeEndExclusive)
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);

  // New articles
  const newArticles = inRange.map(a => ({
    id: a.id,
    title: a.title,
    createdAt: a.createdAt.toISOString(),
    tags: a.tags
  }));

  // Most-used tags within the interval (one count per article per tag)
  const tagCounts = new Map();
  inRange.forEach(a => {
    new Set(a.tags).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  });
  const topTags = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  // Daily breakdown, every day in the interval included (zero-filled)
  const dailyCounts = new Map();
  for (let t = range.start.getTime(); t < rangeEndExclusive.getTime(); t += DAY_MS) {
    dailyCounts.set(formatDate(new Date(t)), 0);
  }
  inRange.forEach(a => {
    const key = formatDate(a.createdAt);
    dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
  });
  const dailyBreakdown = Array.from(dailyCounts.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, count]) => ({ date, count }));

  let busiestDay = null;
  dailyBreakdown.forEach(day => {
    if (day.count > 0 && (!busiestDay || day.count >= busiestDay.count)) {
      busiestDay = { ...day };
    }
  });

  // Previous interval of equal length immediately before the requested one
  const prevStart = new Date(range.start.getTime() - range.dayCount * DAY_MS);
  const previousCount = articles.filter(
    a => a.createdAt >= prevStart && a.createdAt < range.start
  ).length;

  let changePercent = null;
  if (previousCount > 0) {
    changePercent = Math.round(((inRange.length - previousCount) / previousCount) * 1000) / 10;
  }

  // Crossed months (UTC calendar months)
  const months = new Set();
  for (let t = range.start.getTime(); t < rangeEndExclusive.getTime(); t += DAY_MS) {
    months.add(formatDate(new Date(t)).slice(0, 7));
  }
  const monthList = Array.from(months).sort();
  const spansMultipleMonths = monthList.length > 1;

  // Deterministic "data as of" timestamp derived from the data itself
  let dataAsOf = new Date(rangeEndExclusive.getTime() - 1000);
  inRange.forEach(a => {
    const candidates = [a.createdAt, a.updatedAt].filter(Boolean);
    candidates.forEach(d => {
      if (d > dataAsOf) dataAsOf = d;
    });
  });

  const trendText = buildTrendText({
    currentCount: inRange.length,
    previousCount,
    changePercent,
    topTags,
    busiestDay,
    spansMultipleMonths
  });

  const payload = {
    range: {
      start: formatDate(range.start),
      end: formatDate(range.end),
      label: range.label,
      dayCount: range.dayCount,
      spansMultipleMonths,
      months: monthList
    },
    generatedAt: dataAsOf.toISOString(),
    totalArticles: articles.length,
    newArticles: {
      count: newArticles.length,
      articles: newArticles
    },
    topTags,
    trend: {
      text: trendText,
      previousRange: {
        start: formatDate(prevStart),
        end: formatDate(new Date(range.start.getTime() - DAY_MS)),
        count: previousCount
      },
      changePercent,
      busiestDay,
      dailyBreakdown
    }
  };

  payload.fingerprint = fingerprintOf(JSON.stringify(payload));
  return payload;
}

function buildTrendText({ currentCount, previousCount, changePercent, topTags, busiestDay, spansMultipleMonths }) {
  const parts = [];

  if (currentCount === 0) {
    parts.push(`本区间无新增文章（上一区间新增 ${previousCount} 篇）`);
  } else {
    parts.push(`本区间新增 ${currentCount} 篇文章`);
    if (previousCount === 0) {
      parts.push('上一区间无新增，无法计算环比百分比');
    } else if (changePercent === 0) {
      parts.push(`与上一区间持平（均为 ${previousCount} 篇）`);
    } else {
      const direction = changePercent > 0 ? '增加' : '减少';
      const diff = Math.abs(currentCount - previousCount);
      parts.push(
        `与上一区间（${previousCount} 篇）相比${direction} ${diff} 篇（${changePercent > 0 ? '+' : ''}${changePercent}%）`
      );
    }

    if (topTags.length > 0) {
      parts.push(`最常用标签为「${topTags[0].tag}」（${topTags[0].count} 篇）`);
    }
    if (busiestDay) {
      parts.push(`发文最多的一天是 ${busiestDay.date}（${busiestDay.count} 篇）`);
    }
  }

  if (spansMultipleMonths) {
    parts.push('区间跨月，统计按实际起止日期计算，未按月拆分');
  }

  return parts.join('；') + '。';
}

function fingerprintOf(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// GET /api/stats?preset=7d|30d|month or &start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/', (req, res, next) => {
  try {
    const range = resolveRange(req.query);
    res.json(computeStats(range));
  } catch (err) {
    next(err);
  }
});

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells) {
  return cells.map(csvEscape).join(',') + '\r\n';
}

// Serializers append the fingerprint last; it is calculated over everything
// before it, making the whole file self-verifying and deterministic.
function renderCsv(stats) {
  let body = '';
  body += '\uFEFF'; // UTF-8 BOM so Excel detects the encoding
  body += csvRow(['文章统计报告']);
  body += csvRow(['统计区间', `${stats.range.start} 至 ${stats.range.end}`]);
  body += csvRow(['区间类型', stats.range.label]);
  body += csvRow(['区间天数', stats.range.dayCount]);
  body += csvRow(['数据截止时间(UTC)', stats.generatedAt]);
  body += csvRow(['区间内新增文章数', stats.newArticles.count]);
  body += csvRow(['全站文章总数', stats.totalArticles]);
  body += csvRow(['是否跨月', stats.range.spansMultipleMonths ? '是' : '否']);
  if (stats.range.spansMultipleMonths) {
    body += csvRow(['覆盖月份', stats.range.months.join(' ')]);
  }
  body += csvRow(['趋势摘要', stats.trend.text]);
  body += '\r\n';

  body += csvRow(['新增文章']);
  body += csvRow(['ID', '标题', '创建时间(UTC)', '标签']);
  if (stats.newArticles.articles.length === 0) {
    body += csvRow(['-', '该区间内暂无新增文章', '', '']);
  } else {
    stats.newArticles.articles.forEach(a => {
      body += csvRow([a.id, a.title, a.createdAt, a.tags.join('|')]);
    });
  }
  body += '\r\n';

  body += csvRow(['常用标签（区间内）']);
  body += csvRow(['排名', '标签', '文章数']);
  if (stats.topTags.length === 0) {
    body += csvRow(['-', '该区间内暂无标签数据', 0]);
  } else {
    stats.topTags.forEach((t, i) => {
      body += csvRow([i + 1, t.tag, t.count]);
    });
  }
  body += '\r\n';

  body += csvRow(['每日发文趋势']);
  body += csvRow(['日期', '文章数']);
  stats.trend.dailyBreakdown.forEach(d => {
    body += csvRow([d.date, d.count]);
  });

  body += '\r\n';
  body += csvRow(['数据指纹(sha256)', stats.fingerprint]);
  body += csvRow(['文件校验(sha256)', fingerprintOf(body)]);
  return body;
}

function mdEscape(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMarkdown(stats) {
  let body = '';
  body += '# 文章统计报告\n\n';
  body += `- 统计区间：${stats.range.start} 至 ${stats.range.end}（${stats.range.label}，共 ${stats.range.dayCount} 天）\n`;
  body += `- 数据截止时间（UTC）：${stats.generatedAt}\n`;
  body += `- 区间内新增文章：${stats.newArticles.count} 篇（全站共 ${stats.totalArticles} 篇）\n`;
  body += `- 趋势摘要：${stats.trend.text}\n`;
  if (stats.range.spansMultipleMonths) {
    body += `- 跨月说明：本区间跨越 ${stats.range.months.length} 个月份（${stats.range.months.join('、')}），统计按实际起止日期计算，未按月拆分。\n`;
  }
  body += '\n';

  body += '## 新增文章\n\n';
  if (stats.newArticles.articles.length === 0) {
    body += '该区间内暂无新增文章。\n\n';
  } else {
    body += '| ID | 标题 | 创建时间 (UTC) | 标签 |\n';
    body += '| --- | --- | --- | --- |\n';
    stats.newArticles.articles.forEach(a => {
      body += `| ${a.id} | ${mdEscape(a.title)} | ${a.createdAt} | ${mdEscape(a.tags.join('、'))} |\n`;
    });
    body += '\n';
  }

  body += '## 常用标签（区间内）\n\n';
  if (stats.topTags.length === 0) {
    body += '该区间内暂无标签数据。\n\n';
  } else {
    body += '| 排名 | 标签 | 文章数 |\n';
    body += '| --- | --- | --- |\n';
    stats.topTags.forEach((t, i) => {
      body += `| ${i + 1} | ${mdEscape(t.tag)} | ${t.count} |\n`;
    });
    body += '\n';
  }

  body += '## 每日发文趋势\n\n';
  body += '| 日期 | 文章数 |\n';
  body += '| --- | --- |\n';
  stats.trend.dailyBreakdown.forEach(d => {
    body += `| ${d.date} | ${d.count} |\n`;
  });
  body += '\n';

  body += `---\n\n数据指纹（sha256，标识本报告对应的统计数据；同区间重复下载或切换文件格式均一致）：${stats.fingerprint}\n\n`;
  // Hash covers everything above the checksum line, including the data fingerprint line
  const checksum = fingerprintOf(body);
  body += `文件校验（sha256，覆盖本行以上全部内容）：${checksum}\n`;
  return body;
}

// GET /api/stats/export?...&format=md|csv
router.get('/export', (req, res, next) => {
  try {
    const range = resolveRange(req.query);
    const stats = computeStats(range);
    const format = (req.query.format || 'md').toLowerCase();

    let content;
    let contentType;
    let extension;
    if (format === 'csv') {
      content = renderCsv(stats);
      contentType = 'text/csv; charset=utf-8';
      extension = 'csv';
    } else if (format === 'md') {
      content = renderMarkdown(stats);
      contentType = 'text/markdown; charset=utf-8';
      extension = 'md';
    } else {
      throw httpError(400, '不支持的导出格式，可选 md、csv');
    }

    const filename = `stats_${stats.range.start}_${stats.range.end}.${extension}`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Stats-Fingerprint', stats.fingerprint);
    res.setHeader('X-Stats-Filename', filename);
    res.send(content);
  } catch (err) {
    next(err);
  }
});

// Error handler scoped to this router
router.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || '统计数据生成失败' });
});

module.exports = router;
