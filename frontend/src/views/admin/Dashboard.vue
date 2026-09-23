<template>
  <div class="dashboard">
    <h2 class="page-title">管理面板</h2>

    <el-row :gutter="20" class="stat-cards">
      <el-col :span="8">
        <el-card shadow="hover">
          <div class="stat-item">
            <div class="stat-number">{{ stats.totalArticles }}</div>
            <div class="stat-label">文章总数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <div class="stat-item">
            <div class="stat-number">{{ stats.totalTags }}</div>
            <div class="stat-label">标签数量</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <div class="stat-item">
            <div class="stat-number">{{ stats.recentArticles }}</div>
            <div class="stat-label">本周新文章</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="quick-actions">
      <el-col :span="24">
        <el-card>
          <template #header>
            <span>快捷操作</span>
          </template>
          <el-space>
            <el-button type="primary" @click="goToCreateArticle">
              写新文章
            </el-button>
            <el-button @click="goToArticleList">
              管理文章
            </el-button>
            <el-button @click="goToHome">
              查看博客
            </el-button>
          </el-space>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="range-stats">
      <el-col :span="24">
        <el-card v-loading="rangeLoading">
          <template #header>
            <div class="range-header">
              <span>区间统计与导出</span>
              <el-radio-group v-model="preset" size="small" :disabled="rangeLoading" @change="handlePresetChange">
                <el-radio-button value="7d">最近7天</el-radio-button>
                <el-radio-button value="30d">最近30天</el-radio-button>
                <el-radio-button value="month">本月</el-radio-button>
                <el-radio-button value="custom">自定义</el-radio-button>
              </el-radio-group>
            </div>
          </template>

          <div v-if="preset === 'custom'" class="custom-range">
            <el-date-picker
              v-model="customRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="YYYY-MM-DD"
              :disabled-date="disableFutureDate"
              :clearable="false"
              @change="handleCustomRangeChange"
            />
            <el-button type="primary" size="small" :loading="rangeLoading" @click="loadRangeStats(true)">
              应用区间
            </el-button>
          </div>

          <el-alert
            v-if="rangeError"
            :title="rangeError"
            type="error"
            show-icon
            :closable="false"
            class="range-alert"
          >
            <el-button type="primary" link @click="loadRangeStats(true)">重试</el-button>
          </el-alert>

          <template v-else-if="rangeStats">
            <el-alert
              v-if="rangeStats.range.spansMultipleMonths"
              :title="`该区间跨越 ${rangeStats.range.months.length} 个月份（${rangeStats.range.months.join('、')}），统计按实际起止日期整体计算，未按月拆分。`"
              type="warning"
              :closable="false"
              show-icon
              class="range-alert"
            />

            <p class="range-meta">
              统计区间：<strong>{{ rangeStats.range.start }}</strong> 至
              <strong>{{ rangeStats.range.end }}</strong>（{{ rangeStats.range.label }}，共
              {{ rangeStats.range.dayCount }} 天）
            </p>

            <el-row :gutter="16" class="range-numbers">
              <el-col :span="8">
                <div class="range-stat">
                  <div class="range-stat-number">{{ rangeStats.newArticles.count }}</div>
                  <div class="stat-label">区间新增文章</div>
                </div>
              </el-col>
              <el-col :span="8">
                <div class="range-stat">
                  <div class="range-stat-number">{{ rangeStats.topTags.length }}</div>
                  <div class="stat-label">区间使用标签数</div>
                </div>
              </el-col>
              <el-col :span="8">
                <div class="range-stat">
                  <div class="range-stat-number small">
                    <span v-if="rangeStats.trend.changePercent === null">—</span>
                    <span v-else :class="getTrendClass(rangeStats.trend.changePercent)">
                      {{ rangeStats.trend.changePercent > 0 ? '↑' : rangeStats.trend.changePercent < 0 ? '↓' : '→' }}
                      {{ Math.abs(rangeStats.trend.changePercent) }}%
                    </span>
                  </div>
                  <div class="stat-label">环比上一区间</div>
                </div>
              </el-col>
            </el-row>

            <el-alert
              :title="rangeStats.trend.text"
              type="info"
              :closable="false"
              show-icon
              class="range-alert"
            />

            <el-row :gutter="16" class="range-detail">
              <el-col :span="12">
                <div class="detail-title">常用标签（区间内）</div>
                <el-empty
                  v-if="rangeStats.topTags.length === 0"
                  description="该区间内暂无标签数据"
                  :image-size="60"
                />
                <div v-else class="tag-list">
                  <el-tag
                    v-for="(t, index) in rangeStats.topTags.slice(0, 8)"
                    :key="t.tag"
                    :type="index === 0 ? 'primary' : 'info'"
                    class="range-tag"
                  >
                    {{ t.tag }} × {{ t.count }}
                  </el-tag>
                  <span v-if="rangeStats.topTags.length > 8" class="tag-more">
                    等 {{ rangeStats.topTags.length }} 个
                  </span>
                </div>
              </el-col>
              <el-col :span="12">
                <div class="detail-title">区间新增文章</div>
                <el-empty
                  v-if="rangeStats.newArticles.articles.length === 0"
                  description="该区间内暂无新增文章，导出的报告也会如实标注为空"
                  :image-size="60"
                />
                <ul v-else class="new-article-list">
                  <li v-for="article in rangeStats.newArticles.articles.slice(0, 5)" :key="article.id">
                    <span class="new-article-title">{{ article.title }}</span>
                    <span class="new-article-date">{{ formatDateTime(article.createdAt) }}</span>
                  </li>
                  <li v-if="rangeStats.newArticles.articles.length > 5" class="new-article-more">
                    共 {{ rangeStats.newArticles.articles.length }} 篇，完整清单见导出文件
                  </li>
                </ul>
              </el-col>
            </el-row>

            <div class="export-bar">
              <el-button
                type="primary"
                :loading="exportingFormat === 'md'"
                :disabled="exportingFormat !== null"
                @click="exportReport('md')"
              >
                下载 Markdown 报告
              </el-button>
              <el-button
                :loading="exportingFormat === 'csv'"
                :disabled="exportingFormat !== null"
                @click="exportReport('csv')"
              >
                下载 CSV 报告
              </el-button>
              <span class="export-hint">
                报告含新增文章、常用标签、趋势摘要；同区间重复下载内容一致，失败可重试。
              </span>
            </div>
            <p class="fingerprint-hint">
              数据指纹：{{ rangeStats.fingerprint.slice(0, 16) }}…
            </p>
          </template>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="recent-articles">
      <el-col :span="24">
        <el-card>
          <template #header>
            <span>最近文章</span>
          </template>
          <el-table :data="recentArticles" style="width: 100%">
            <el-table-column prop="title" label="标题" />
            <el-table-column prop="tags" label="标签" width="200">
              <template #default="{ row }">
                <el-tag v-for="tag in row.tags.slice(0, 3)" :key="tag" size="small" class="tag-cell">
                  {{ tag }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="创建时间" width="150">
              <template #default="{ row }">
                {{ formatDate(row.created_at) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <el-button type="primary" link @click="editArticle(row.id)">
                  编辑
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../../api'

const router = useRouter()

const stats = reactive({
  totalArticles: 0,
  totalTags: 0,
  recentArticles: 0
})

const recentArticles = ref([])

// Interval statistics state
const preset = ref('7d')
const customRange = ref(defaultCustomRange())
const rangeStats = ref(null)
const rangeLoading = ref(false)
const rangeError = ref('')
const exportingFormat = ref(null)

// Cache of downloaded reports keyed by data fingerprint + format. Repeating a
// download reuses the same blob, so contradictory files can never be produced.
const downloadCache = new Map()

function defaultCustomRange() {
  const end = new Date()
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000)
  return [formatInputDate(start), formatInputDate(end)]
}

function formatInputDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function disableFutureDate(date) {
  return date.getTime() > Date.now()
}

// Dashboard is unmounted when navigating to the article list and remounted on
// return, so refetching here keeps every number in sync with real articles.
onMounted(() => {
  fetchStats()
  fetchRecentArticles()
  loadRangeStats()
})

async function fetchStats() {
  try {
    const [articlesRes, tagsRes] = await Promise.all([
      api.get('/articles', { params: { page: 1, limit: 1000 } }),
      api.get('/tags')
    ])

    stats.totalArticles = articlesRes.data.pagination.total
    stats.totalTags = tagsRes.data.tags.length

    // Calculate articles from this week
    const oneWeekAgo = new Date()
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
    stats.recentArticles = articlesRes.data.articles.filter(
      a => new Date(a.created_at) > oneWeekAgo
    ).length
  } catch (error) {
    console.error('Failed to fetch stats:', error)
  }
}

async function fetchRecentArticles() {
  try {
    const response = await api.get('/articles', { params: { page: 1, limit: 5 } })
    recentArticles.value = response.data.articles
  } catch (error) {
    console.error('Failed to fetch recent articles:', error)
  }
}

function buildRangeParams() {
  if (preset.value === 'custom') {
    const [start, end] = customRange.value || []
    if (!start || !end) {
      throw new Error('请先选择自定义区间的开始和结束日期')
    }
    return { start, end }
  }
  return { preset: preset.value }
}

async function loadRangeStats(showSuccess = false) {
  let params
  try {
    params = buildRangeParams()
  } catch (err) {
    rangeStats.value = null
    rangeError.value = err.message
    return
  }

  rangeLoading.value = true
  rangeError.value = ''
  try {
    const { data } = await api.get('/stats', { params })
    rangeStats.value = data
    if (showSuccess) {
      ElMessage.success('区间统计已更新')
    }
  } catch (error) {
    rangeStats.value = null
    rangeError.value = error.response?.data?.error || '区间统计加载失败，请重试'
  } finally {
    rangeLoading.value = false
  }
}

function handlePresetChange() {
  // customRange always holds a valid default (last 7 days) until the user picks one
  loadRangeStats()
}

function handleCustomRangeChange(value) {
  if (value && value[0] && value[1]) {
    loadRangeStats()
  }
}

async function exportReport(format) {
  if (!rangeStats.value || exportingFormat.value !== null) return

  let params
  try {
    params = buildRangeParams()
  } catch (err) {
    rangeError.value = err.message
    return
  }

  const displayedFingerprint = rangeStats.value.fingerprint
  const cacheKey = `${displayedFingerprint}:${format}`
  const cached = downloadCache.get(cacheKey)
  if (cached) {
    triggerBrowserDownload(cached.blob, cached.filename)
    ElMessage.success('已使用上次生成的相同报告（内容一致）')
    return
  }

  exportingFormat.value = format
  try {
    const response = await api.get('/stats/export', {
      params: { ...params, format },
      responseType: 'blob'
    })

    const serverFingerprint = response.headers['x-stats-fingerprint']
    if (serverFingerprint && serverFingerprint !== displayedFingerprint) {
      // Articles changed between viewing and exporting; refuse the stale file,
      // refresh the visible numbers and let the user retry once.
      rangeStats.value = null
      await loadRangeStats()
      ElMessage.warning('文章数据在此期间发生变化，已刷新统计，请重新下载以获取一致的报告')
      return
    }

    const filename =
      response.headers['x-stats-filename'] ||
      `stats_${rangeStats.value.range.start}_${rangeStats.value.range.end}.${format}`
    const blob = new Blob([response.data], { type: response.headers['content-type'] })

    downloadCache.set(cacheKey, { blob, filename })
    triggerBrowserDownload(blob, filename)
    ElMessage.success('统计报告已下载')
  } catch (error) {
    const message = await extractBlobError(error)
    ElMessage({
      type: 'error',
      duration: 4000,
      message: `报告导出失败：${message}。可调整区间后重试，或稍后再次点击下载。`
    })
  } finally {
    exportingFormat.value = null
  }
}

async function extractBlobError(error) {
  const data = error.response?.data
  if (data instanceof Blob) {
    try {
      const text = await data.text()
      const parsed = JSON.parse(text)
      return parsed.error || '服务器生成文件失败'
    } catch {
      return '服务器生成文件失败'
    }
  }
  return data?.error || error.message || '网络或文件写入异常'
}

function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function getTrendClass(changePercent) {
  if (changePercent > 0) return 'up'
  if (changePercent < 0) return 'down'
  return 'flat'
}

function goToCreateArticle() {
  router.push('/admin/articles/new')
}

function goToArticleList() {
  router.push('/admin/articles')
}

function goToHome() {
  router.push('/')
}

function editArticle(id) {
  router.push(`/admin/articles/${id}/edit`)
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN')
}

function formatDateTime(dateStr) {
  const date = new Date(dateStr)
  return `${formatDate(dateStr)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.dashboard {
  padding-top: 20px;
}

.page-title {
  font-size: 24px;
  color: #303133;
  margin-bottom: 20px;
}

.stat-cards {
  margin-bottom: 20px;
}

.stat-item {
  text-align: center;
  padding: 20px 0;
}

.stat-number {
  font-size: 36px;
  font-weight: bold;
  color: #409eff;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-top: 8px;
}

.quick-actions {
  margin-bottom: 20px;
}

.range-stats {
  margin-bottom: 20px;
}

.range-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.custom-range {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.range-alert {
  margin-bottom: 16px;
}

.range-meta {
  color: #606266;
  margin-bottom: 16px;
}

.range-numbers {
  margin-bottom: 16px;
}

.range-stat {
  text-align: center;
  padding: 12px 0;
  background: #f5f7fa;
  border-radius: 6px;
}

.range-stat-number {
  font-size: 30px;
  font-weight: bold;
  color: #409eff;
}

.range-stat-number.small {
  font-size: 24px;
}

.range-stat-number .up {
  color: #67c23a;
}

.range-stat-number .down {
  color: #f56c6c;
}

.range-stat-number .flat {
  color: #909399;
}

.range-detail {
  margin: 16px 0;
}

.detail-title {
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.range-tag {
  margin: 0;
}

.tag-more {
  font-size: 12px;
  color: #909399;
}

.new-article-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.new-article-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid #ebeef5;
  font-size: 14px;
}

.new-article-title {
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.new-article-date {
  color: #909399;
  white-space: nowrap;
  flex-shrink: 0;
}

.new-article-more {
  color: #909399;
  font-size: 12px;
  justify-content: center;
}

.export-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.export-hint {
  font-size: 12px;
  color: #909399;
}

.fingerprint-hint {
  font-size: 12px;
  color: #c0c4cc;
  margin-top: 8px;
}

.recent-articles {
  margin-bottom: 20px;
}

.tag-cell {
  margin-right: 4px;
}
</style>
