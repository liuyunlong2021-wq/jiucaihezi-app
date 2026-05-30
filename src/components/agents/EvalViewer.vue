<script setup lang="ts">
/**
 * EvalViewer.vue — 内嵌测试评估查看器
 *
 * 对齐官方 eval-viewer：Outputs Tab（逐用例浏览 + 断言评分）+ Benchmark Tab（统计对比）
 * 从 skillTestRunner 返回的 SingleTestResult[] + BenchmarkData 渲染
 */
import { ref, computed } from 'vue'
import type { SingleTestResult, BenchmarkData } from '@/utils/skillTestRunner'

const props = defineProps<{
  results: SingleTestResult[]
  benchmark: BenchmarkData | null
  skillName: string
}>()

const activeTab = ref<'outputs' | 'benchmark'>('outputs')
const currentIdx = ref(0)

const allRuns = computed(() => {
  return props.results.flatMap(r => [
    { evalId: r.eval_id, name: r.eval_name, prompt: r.prompt, config: 'with_skill' as const, output: r.runs.find(x => x.configuration === 'with_skill')?.output || '', assertions: r.runs.find(x => x.configuration === 'with_skill')?.assertions || [] },
    { evalId: r.eval_id, name: r.eval_name, prompt: r.prompt, config: 'without_skill' as const, output: r.runs.find(x => x.configuration === 'without_skill')?.output || '', assertions: r.runs.find(x => x.configuration === 'without_skill')?.assertions || [] },
  ])
})

const currentRun = computed(() => allRuns.value[currentIdx.value])

const configLabel = (c: string) => c === 'with_skill' ? 'WITH Skill' : 'WITHOUT Skill'

function nav(delta: number) {
  currentIdx.value = Math.max(0, Math.min(allRuns.value.length - 1, currentIdx.value + delta))
}
</script>

<template>
  <div class="eval-viewer">
    <!-- Tab 切换 -->
    <div class="ev-tabs">
      <button
        :class="{ active: activeTab === 'outputs' }"
        @click="activeTab = 'outputs'"
      >Outputs</button>
      <button
        v-if="benchmark"
        :class="{ active: activeTab === 'benchmark' }"
        @click="activeTab = 'benchmark'"
      >Benchmark</button>
    </div>

    <!-- Outputs Tab -->
    <div v-if="activeTab === 'outputs'" class="ev-outputs">
      <div class="ev-output-header">
        <span class="ev-config-badge" :class="currentRun.config === 'with_skill' ? 'badge-with' : 'badge-without'">
          {{ configLabel(currentRun.config) }}
        </span>
        <span class="ev-output-name">{{ currentRun.name }}</span>
      </div>

      <div class="ev-prompt">{{ currentRun.prompt }}</div>

      <pre class="ev-output-text">{{ currentRun.output.slice(0, 3000) }}</pre>

      <!-- 断言评分 -->
      <div v-if="currentRun.assertions.length > 0" class="ev-assertions">
        <div class="ev-assertions-title">
          断言评分
          <span class="ev-assertions-count">
            {{ currentRun.assertions.filter(a => a.passed).length }}/{{ currentRun.assertions.length }}
          </span>
        </div>
        <div
          v-for="a in currentRun.assertions"
          :key="a.text"
          class="ev-assertion"
        >
          <span :class="a.passed ? 'ev-pass' : 'ev-fail'">{{ a.passed ? '✓' : '✗' }}</span>
          <span class="ev-assertion-text">{{ a.text }}</span>
          <div v-if="a.evidence" class="ev-evidence">{{ a.evidence }}</div>
        </div>
      </div>

      <!-- 导航 -->
      <div class="ev-nav">
        <button :disabled="currentIdx === 0" @click="nav(-1)">← 上一个</button>
        <span>{{ currentIdx + 1 }} / {{ allRuns.length }}</span>
        <button :disabled="currentIdx >= allRuns.length - 1" @click="nav(1)">下一个 →</button>
      </div>
    </div>

    <!-- Benchmark Tab -->
    <div v-if="activeTab === 'benchmark' && benchmark" class="ev-benchmark">
      <h4>Benchmark 摘要</h4>
      <table class="ev-bench-table">
        <thead>
          <tr>
            <th>指标</th>
            <th>With Skill</th>
            <th>Without Skill</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Pass Rate</strong></td>
            <td>{{ (benchmark.run_summary.with_skill.pass_rate.mean * 100).toFixed(0) }}% ±{{ (benchmark.run_summary.with_skill.pass_rate.stddev * 100).toFixed(0) }}%</td>
            <td>{{ (benchmark.run_summary.without_skill.pass_rate.mean * 100).toFixed(0) }}% ±{{ (benchmark.run_summary.without_skill.pass_rate.stddev * 100).toFixed(0) }}%</td>
            <td :class="benchmark.run_summary.delta.pass_rate.startsWith('+') ? 'ev-delta-pos' : 'ev-delta-neg'">
              {{ benchmark.run_summary.delta.pass_rate }}
            </td>
          </tr>
          <tr>
            <td><strong>Time</strong></td>
            <td>{{ benchmark.run_summary.with_skill.time_seconds.mean.toFixed(1) }}s</td>
            <td>{{ benchmark.run_summary.without_skill.time_seconds.mean.toFixed(1) }}s</td>
            <td>{{ benchmark.run_summary.delta.time_seconds }}s</td>
          </tr>
          <tr>
            <td><strong>Tokens</strong></td>
            <td>{{ benchmark.run_summary.with_skill.tokens.mean.toFixed(0) }}</td>
            <td>{{ benchmark.run_summary.without_skill.tokens.mean.toFixed(0) }}</td>
            <td>{{ benchmark.run_summary.delta.tokens }}</td>
          </tr>
        </tbody>
      </table>

      <div v-if="benchmark.notes.length > 0" class="ev-notes">
        <strong>分析笔记</strong>
        <ul>
          <li v-for="n in benchmark.notes" :key="n">{{ n }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.eval-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.ev-tabs {
  display: flex;
  border-bottom: 2px solid var(--border, #e5e5e5);
  flex-shrink: 0;
}
.ev-tabs button {
  padding: 6px 14px;
  border: none;
  background: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink2, #999);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}
.ev-tabs button.active {
  color: var(--olive, #6B8E23);
  border-bottom-color: var(--olive, #6B8E23);
}

.ev-outputs {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
}
.ev-output-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ev-config-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 8px;
  font-weight: 700;
  text-transform: uppercase;
}
.badge-with { background: rgba(33,150,243,0.12); color: #1976d2; }
.badge-without { background: rgba(255,193,7,0.15); color: #f57f17; }
.ev-output-name { font-size: 12px; color: var(--ink2, #999); }

.ev-prompt {
  font-size: 12px;
  color: var(--ink, #333);
  margin-bottom: 8px;
  padding: 8px;
  background: var(--bg, #f8f7f4);
  border-radius: 6px;
  line-height: 1.5;
}
.ev-output-text {
  font-size: 11px;
  line-height: 1.5;
  padding: 10px;
  background: var(--bg, #f8f7f4);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
  font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
  color: var(--ink, #333);
}

.ev-assertions {
  margin-top: 10px;
  border-top: 1px solid var(--border, #e5e5e5);
  padding-top: 8px;
}
.ev-assertions-title {
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ev-assertions-count {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg, #f0f0f0);
}
.ev-assertion {
  margin: 4px 0;
  font-size: 11px;
}
.ev-pass { color: #22c55e; font-weight: 700; margin-right: 4px; }
.ev-fail { color: #ef4444; font-weight: 700; margin-right: 4px; }
.ev-assertion-text { color: var(--ink, #333); }
.ev-evidence {
  font-size: 10px;
  color: var(--ink2, #999);
  margin-left: 18px;
  margin-top: 2px;
}

.ev-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid var(--border, #e5e5e5);
  margin-top: auto;
}
.ev-nav button {
  padding: 4px 12px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 6px;
  background: var(--surface, #fff);
  cursor: pointer;
  font-size: 12px;
}
.ev-nav button:hover:not(:disabled) { background: var(--bg, #f0f0f0); }
.ev-nav button:disabled { opacity: 0.4; cursor: not-allowed; }
.ev-nav span { font-size: 11px; color: var(--ink2, #999); }

.ev-benchmark {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
}
.ev-benchmark h4 {
  font-size: 13px;
  margin-bottom: 10px;
}
.ev-bench-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.ev-bench-table th {
  background: #141413;
  color: #faf9f5;
  padding: 6px 8px;
  text-align: left;
  font-weight: 500;
}
.ev-bench-table td {
  padding: 6px 8px;
  border: 1px solid var(--border, #e5e5e5);
}
.ev-delta-pos { color: #22c55e; font-weight: 700; }
.ev-delta-neg { color: #ef4444; font-weight: 700; }
.ev-notes {
  margin-top: 12px;
  padding: 10px;
  background: #fef3c7;
  border-radius: 6px;
  font-size: 11px;
}
.ev-notes ul {
  margin: 4px 0 0 16px;
}
</style>
