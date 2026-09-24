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

    <el-alert
      v-if="statsError"
      class="stats-alert"
      type="error"
      :closable="false"
      show-icon
      title="统计数据加载失败，当前数字可能不是最新"
    >
      <div class="alert-actions">
        <el-button size="small" type="primary" @click="refreshAll">重试</el-button>
      </div>
    </el-alert>

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
        <el-card v-loading="generating">
          <template #header>
            <div class="range-header">
              <span>区间统计</span>
              <span class="range-hint">按区间生成新增文章、常用标签和趋势摘要文件</span>
            </div>
          </template>

          <div class="range-controls">
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="x"
              :shortcuts="dateShortcuts"
              :clearable="false"
              @change="handleRangeChange"
            />
            <el-button type="primary" :loading="generating" @click="generateReport">
              生成统计
            </el-button>
            <el-button
              type="success"
              :disabled="!report || generating || downloading"
              :loading="downloading"
              @click="downloadReport"
            >
              下载统计文件
            </el-button>
          </div>

          <el-alert
            v-if="generateError"
            class="stats-alert"
            type="error"
            :closable="false"
            show-icon
            :title="generateError"
          >
            <div class="alert-actions">
              <el-button size="small" type="primary" @click="generateReport">重试</el-button>
            </div>
          </el-alert>

          <el-alert
            v-if="downloadError"
            class="stats-alert"
            type="error"
            :closable="false"
            show-icon
            :title="downloadError"
          >
            <div class="alert-actions">
              <el-button size="small" type="primary" :loading="downloading" @click="downloadReport">
                重试下载
              </el-button>
            </div>
          </el-alert>

          <template v-if="report && !generateError">
            <el-alert
              v-if="!report.report.summary.has_data"
              class="stats-alert"
              type="info"
              :closable="false"
              show-icon
              :title="`区间 ${report.report.range.start} 至 ${report.report.range.end} 内没有文章数据，文件中会如实说明该结果，仍可下载留档。`"
            />
            <el-alert
              v-else-if="report.report.range.spans_months"
              class="stats-alert"
              type="warning"
              :closable="false"
              show-icon
              :title="`该区间跨月，已按月拆分统计：${monthlyText}`"
            />

            <div class="report-meta">
              <span>文件名：{{ report.file.name }}</span>
              <span v-if="report.report.summary.has_data">
                新增文章 {{ report.report.summary.new_article_count }} 篇 ·
                涉及标签 {{ report.report.summary.distinct_tag_count }} 个
              </span>
            </div>

            <el-descriptions title="趋势摘要" :column="1" border class="report-section">
              <el-descriptions-item
                v-for="(line, i) in report.summary_lines"
                :key="i"
                label-width="120"
              >
                {{ line }}
              </el-descriptions-item>
            </el-descriptions>

            <template v-if="report.report.summary.has_data">
              <h4 class="report-subtitle">常用标签</h4>
              <el-table :data="report.report.common_tags" size="small" class="report-section">
                <el-table-column prop="tag" label="标签" />
                <el-table-column prop="count" label="区间内文章数" width="140" />
              </el-table>

              <h4 class="report-subtitle">新增文章</h4>
              <el-table
                :data="report.report.new_articles"
                size="small"
                max-height="300"
                class="report-section"
              >
                <el-table-column prop="title" label="标题" min-width="200" />
                <el-table-column label="标签" width="220">
                  <template #default="{ row }">
                    <el-tag
                      v-for="tag in row.tags.slice(0, 3)"
                      :key="tag"
                      size="small"
                      class="tag-cell"
                    >
                      {{ tag }}
                    </el-tag>
                    <span v-if="row.tags.length > 3" class="more-tags">
                      等 {{ row.tags.length }} 个
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="创建时间" width="120">
                  <template #default="{ row }">
                    {{ row.created_at.slice(0, 10) }}
                  </template>
                </el-table-column>
              </el-table>
            </template>
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
          <el-table :data="recentArticles" v-loading="recentLoading" style="width: 100%">
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
import { ref, reactive, computed, onMounted, onActivated, onBeforeUnmount } from 'vue'
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
const recentLoading = ref(false)
const statsError = ref('')

// Range stats state. The report for the currently selected range is the only
// source used by the download button, so repeated downloads always produce
// the exact same file, and switching the range clears the stale report.
const today = new Date()
const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000)
const dateRange = ref([weekAgo, today])
const report = ref(null)
const generating = ref(false)
const downloading = ref(false)
const generateError = ref('')
const downloadError = ref('')
let requestSeq = 0

const dateShortcuts = [
  {
    text: '近 7 天',
    value: () => {
      const end = new Date()
      const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000)
      return [start, end]
    }
  },
  {
    text: '近 30 天',
    value: () => {
      const end = new Date()
      const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000)
      return [start, end]
    }
  },
  {
    text: '近 90 天',
    value: () => {
      const end = new Date()
      const start = new Date(end.getTime() - 89 * 24 * 60 * 60 * 1000)
      return [start, end]
    }
  },
  {
    text: '本月',
    value: () => {
      const end = new Date()
      const start = new Date(end.getFullYear(), end.getMonth(), 1)
      return [start, end]
    }
  }
]

const monthlyText = computed(() => {
  if (!report.value) return ''
  return report.value.report.monthly.map(m => `${m.month}：${m.count} 篇`).join('，')
})

async function fetchStats() {
  statsError.value = ''
  try {
    const response = await api.get('/stats/overview')
    stats.totalArticles = response.data.totalArticles
    stats.totalTags = response.data.totalTags
    stats.recentArticles = response.data.recentArticles
  } catch (error) {
    console.error('Failed to fetch stats:', error)
    statsError.value = '统计数据加载失败'
  }
}

async function fetchRecentArticles() {
  recentLoading.value = true
  try {
    const response = await api.get('/articles', { params: { page: 1, limit: 5 } })
    recentArticles.value = response.data.articles
  } catch (error) {
    console.error('Failed to fetch recent articles:', error)
  } finally {
    recentLoading.value = false
  }
}

// Re-fetch every time the dashboard is shown (including returning from the
// article list via quick actions or browser back/forward) so the numbers
// always match the articles actually stored in the database.
function refreshAll() {
  fetchStats()
  fetchRecentArticles()
}

function handlePageShow(event) {
  if (event.persisted) refreshAll()
}

onMounted(() => {
  refreshAll()
  window.addEventListener('pageshow', handlePageShow)
})

onActivated(() => {
  refreshAll()
})

onBeforeUnmount(() => {
  window.removeEventListener('pageshow', handlePageShow)
})

function formatDay(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function handleRangeChange() {
  // A report belongs to the range it was generated for; clearing it prevents
  // downloading a file that contradicts the newly selected range.
  report.value = null
  generateError.value = ''
  downloadError.value = ''
}

async function generateReport() {
  if (!dateRange.value || dateRange.value.length !== 2) {
    generateError.value = '请选择统计区间'
    return
  }

  const seq = ++requestSeq
  const start = formatDay(new Date(dateRange.value[0]))
  const end = formatDay(new Date(dateRange.value[1]))

  generating.value = true
  generateError.value = ''
  report.value = null
  try {
    const response = await api.get('/stats/report', { params: { start, end } })
    // Ignore an out-of-date response if the user triggered another request.
    if (seq !== requestSeq) return
    report.value = response.data
    if (!response.data.report.summary.has_data) {
      ElMessage.info('该区间内没有文章数据，已生成说明性统计结果')
    }
  } catch (error) {
    if (seq !== requestSeq) return
    console.error('Failed to generate stats report:', error)
    generateError.value = error.response?.data?.error
      ? `统计文件生成失败：${error.response.data.error}`
      : '统计文件生成失败，请检查网络后重试'
  } finally {
    if (seq === requestSeq) generating.value = false
  }
}

async function downloadReport() {
  if (!report.value) return
  downloading.value = true
  downloadError.value = ''
  try {
    // The file bytes come from the report already displayed/verified; clicking
    // download repeatedly always yields the same content for the same range.
    const blob = new Blob([report.value.file.content], {
      type: report.value.file.mime
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = report.value.file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    ElMessage.success('统计文件已开始下载')
  } catch (error) {
    console.error('Failed to download report:', error)
    downloadError.value = '文件导出失败，请重试'
  } finally {
    downloading.value = false
  }
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

.stats-alert {
  margin-bottom: 20px;
}

.alert-actions {
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
  align-items: baseline;
  gap: 12px;
}

.range-hint {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}

.range-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.report-meta {
  display: flex;
  gap: 20px;
  margin: 8px 0 16px;
  color: #606266;
  font-size: 13px;
  flex-wrap: wrap;
}

.report-section {
  margin-top: 12px;
}

.report-subtitle {
  margin: 16px 0 8px;
  font-size: 15px;
  color: #303133;
}

.recent-articles {
  margin-bottom: 20px;
}

.tag-cell {
  margin-right: 4px;
}

.more-tags {
  font-size: 12px;
  color: #909399;
}
</style>
