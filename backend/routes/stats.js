const express = require('express');
const { getDb } = require('../db/init');

const router = express.Router();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Parse a YYYY-MM-DD string into an ISO timestamp at UTC midnight.
function parseDay(value, name) {
  if (!value) {
    return { error: `缺少${name}` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: `${name}格式无效，应为 YYYY-MM-DD` };
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return { error: `${name}不是有效日期` };
  }
  return { date, iso: date.toISOString() };
}

function splitTags(tagsStr) {
  if (!tagsStr) return [];
  return tagsStr
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
}

// Collect every article created within [start, start + days * MS_PER_DAY).
// datetimes are normalized with SQLite datetime() so both
// "YYYY-MM-DD HH:MM:SS" and ISO strings compare correctly.
function collectArticles(start, days) {
  const db = getDb();
  const endIso = new Date(start.getTime() + days * MS_PER_DAY).toISOString();
  return db
    .prepare(`
      SELECT id, title, tags, created_at
      FROM articles
      WHERE datetime(created_at) >= datetime(?)
        AND datetime(created_at) < datetime(?)
      ORDER BY datetime(created_at) DESC, id DESC
    `)
    .all(start.toISOString(), endIso);
}

function buildReportData(start, days, articles) {
  const end = new Date(start.getTime() + days * MS_PER_DAY);
  const label = { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };

  // New articles (deterministic order: newest first, id breaks ties)
  const newArticles = articles.map(a => ({
    id: a.id,
    title: a.title,
    tags: splitTags(a.tags),
    created_at: a.created_at
  }));

  // Common tags (count desc, then name asc for stable ties)
  const tagCounts = new Map();
  articles.forEach(a => {
    splitTags(a.tags).forEach(tag => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });
  const commonTags = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'));

  // Articles grouped by UTC month, for ranges that span month boundaries
  const byMonth = new Map();
  const byDay = new Map();
  articles.forEach(a => {
    const day = a.created_at.slice(0, 10);
    const month = day.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + 1);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  });
  const monthly = Array.from(byMonth.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, count]) => ({ month, count }));

  let busiestDay = null;
  if (articles.length > 0) {
    const [day, count] = Array.from(byDay.entries())
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    busiestDay = { date: day, count };
  }

  const spansMonths = byMonth.size > 1;
  const hasData = articles.length > 0;

  return {
    range: {
      start: label.start,
      end: label.end,
      days,
      spans_months: spansMonths
    },
    summary: {
      new_article_count: articles.length,
      distinct_tag_count: commonTags.length,
      busiest_day: busiestDay,
      has_data: hasData
    },
    new_articles: newArticles,
    common_tags: commonTags,
    monthly
  };
}

// Deterministic, human-readable trend summary lines (no "now" timestamps).
function buildSummaryLines(data) {
  const { range, summary } = data;
  const lines = [];
  lines.push(`统计区间：${range.start} 至 ${range.end}（UTC，共 ${range.days} 天）`);
  lines.push(`区间内新增文章：${summary.new_article_count} 篇`);

  if (!summary.has_data) {
    lines.push('该区间内没有文章数据，无趋势可统计。');
    return lines;
  }

  lines.push(`涉及标签：${summary.distinct_tag_count} 个`);
  if (summary.busiest_day) {
    lines.push(`发文最多的日期：${summary.busiest_day.date}（${summary.busiest_day.count} 篇）`);
  }

  const topTags = data.common_tags.slice(0, 5);
  if (topTags.length > 0) {
    lines.push(`常用标签 TOP${topTags.length}：${topTags.map(t => `${t.tag}(${t.count})`).join('、')}`);
  }

  if (range.spans_months) {
    lines.push(
      `该区间跨月，按月分布：${data.monthly.map(m => `${m.month} ${m.count} 篇`).join('，')}`
    );
  } else {
    lines.push('该区间未跨月。');
  }

  return lines;
}

// Single source of truth for the downloaded file: every download for the
// same range renders identical bytes from the same report data.
function renderMarkdown(data) {
  const { range } = data;
  const lines = [];
  lines.push(`# 文章统计报告`);
  lines.push('');
  lines.push(`统计区间：${range.start} 至 ${range.end}（UTC，共 ${range.days} 天）${range.spans_months ? '，区间跨月' : ''}`);
  lines.push('');
  lines.push('## 趋势摘要');
  lines.push('');
  buildSummaryLines(data).slice(1).forEach(line => {
    lines.push(`- ${line}`);
  });
  lines.push('');
  lines.push('## 新增文章');
  lines.push('');
  if (data.new_articles.length === 0) {
    lines.push('该区间内没有新增文章。');
  } else {
    data.new_articles.forEach((a, i) => {
      const tags = a.tags.length > 0 ? a.tags.join('、') : '无标签';
      lines.push(`${i + 1}. ${a.title}（${a.created_at.slice(0, 10)}，标签：${tags}）`);
    });
  }
  lines.push('');
  lines.push('## 常用标签');
  lines.push('');
  if (data.common_tags.length === 0) {
    lines.push('该区间内没有标签数据。');
  } else {
    lines.push('| 标签 | 文章数 |');
    lines.push('| --- | ---: |');
    data.common_tags.forEach(t => {
      lines.push(`| ${t.tag} | ${t.count} |`);
    });
  }
  lines.push('');
  return lines.join('\n');
}

function reportFileName(data) {
  const { start, end } = data.range;
  return `article-report_${start}_to_${end}.md`;
}

// GET /api/stats/overview - totals used by the dashboard stat cards.
// "本周新文章" keeps the existing definition: created within the last 7 days.
router.get('/overview', (req, res) => {
  const db = getDb();
  try {
    const totalArticles = db.prepare('SELECT COUNT(*) AS count FROM articles').get().count;

    const tagRows = db
      .prepare("SELECT tags FROM articles WHERE tags IS NOT NULL AND tags != ''")
      .all();
    const tagSet = new Set();
    tagRows.forEach(row => splitTags(row.tags).forEach(t => tagSet.add(t)));

    const oneWeekAgo = new Date(Date.now() - 7 * MS_PER_DAY).toISOString();
    const recentArticles = db
      .prepare('SELECT COUNT(*) AS count FROM articles WHERE datetime(created_at) > datetime(?)')
      .get(oneWeekAgo).count;

    res.json({
      totalArticles,
      totalTags: tagSet.size,
      recentArticles
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats overview' });
  }
});

// GET /api/stats/report?start=YYYY-MM-DD&end=YYYY-MM-DD[&format=markdown]
router.get('/report', (req, res) => {
  const startParsed = parseDay(req.query.start, '开始日期');
  if (startParsed.error) {
    return res.status(400).json({ error: startParsed.error });
  }
  const endParsed = parseDay(req.query.end, '结束日期');
  if (endParsed.error) {
    return res.status(400).json({ error: endParsed.error });
  }

  const start = startParsed.date;
  // The end day is inclusive; the half-open window ends at its next midnight.
  const windowEnd = new Date(endParsed.date.getTime() + MS_PER_DAY);
  const days = Math.round((windowEnd - start) / MS_PER_DAY);

  if (days <= 0) {
    return res.status(400).json({ error: '结束日期不能早于开始日期' });
  }
  if (days > 366) {
    return res.status(400).json({ error: '统计区间不能超过 366 天' });
  }

  try {
    const articles = collectArticles(start, days);
    const data = buildReportData(start, days, articles);
    const markdown = renderMarkdown(data);

    if (req.query.format === 'markdown') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(data)}"`);
      // UTF-8 BOM so spreadsheet/editor tools detect Chinese text correctly.
      return res.send('﻿' + markdown);
    }

    res.json({
      report: data,
      summary_lines: buildSummaryLines(data),
      file: {
        name: reportFileName(data),
        mime: 'text/markdown;charset=utf-8',
        content: markdown
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate stats report' });
  }
});

module.exports = router;
module.exports.renderMarkdown = renderMarkdown;
module.exports.buildReportData = buildReportData;
module.exports.collectArticles = collectArticles;
