export interface OfficialPublisher {
  name: string
  slug: string
  totalSkills: number
  repos: OfficialRepo[]
}

export interface OfficialRepo {
  fullName: string
  url: string
  skillCount: number
  description?: string
}

export type SkillTag =
  | 'frontend'
  | 'backend'
  | 'ecommerce'
  | 'app'
  | 'devops'
  | 'ai-ml'
  | 'database'
  | 'security'
  | 'testing'
  | 'docs'

export interface RecommendedSkill {
  name: string
  description: string
  publisher: string
  repoFullName: string
  tags: SkillTag[]
  downloadUrl: string
}

export const TAG_LABELS: Record<SkillTag, { zh: string; en: string }> = {
  frontend: { zh: '前端开发', en: 'Frontend' },
  backend: { zh: '后端开发', en: 'Backend' },
  ecommerce: { zh: '电商', en: 'E-commerce' },
  app: { zh: 'App 开发', en: 'App Dev' },
  devops: { zh: 'DevOps', en: 'DevOps' },
  'ai-ml': { zh: 'AI/ML', en: 'AI/ML' },
  database: { zh: '数据库', en: 'Database' },
  security: { zh: '安全', en: 'Security' },
  testing: { zh: '测试/监控', en: 'Testing' },
  docs: { zh: '文档/设计', en: 'Docs/Design' },
}

export const ALL_TAGS: SkillTag[] = [
  'frontend',
  'backend',
  'ecommerce',
  'app',
  'devops',
  'ai-ml',
  'database',
  'security',
  'testing',
  'docs',
]

export const OFFICIAL_PUBLISHERS: OfficialPublisher[] = [
  {
    name: 'Microsoft',
    slug: 'microsoft',
    totalSkills: 404,
    repos: [{ fullName: 'microsoft/azure-skills', url: 'https://github.com/microsoft/azure-skills', skillCount: 404 }],
  },
  {
    name: 'GitHub',
    slug: 'github',
    totalSkills: 331,
    repos: [{ fullName: 'github/awesome-copilot', url: 'https://github.com/github/awesome-copilot', skillCount: 331 }],
  },
  {
    name: 'Anthropic',
    slug: 'anthropics',
    totalSkills: 289,
    repos: [
      { fullName: 'anthropics/knowledge-work-plugins', url: 'https://github.com/anthropics/knowledge-work-plugins', skillCount: 176 },
      { fullName: 'anthropics/claude-plugins-official', url: 'https://github.com/anthropics/claude-plugins-official', skillCount: 31 },
      { fullName: 'anthropics/financial-services-plugins', url: 'https://github.com/anthropics/financial-services-plugins', skillCount: 30 },
      { fullName: 'anthropics/skills', url: 'https://github.com/anthropics/skills', skillCount: 18 },
    ],
  },
  {
    name: 'OpenAI',
    slug: 'openai',
    totalSkills: 118,
    repos: [{ fullName: 'openai/skills', url: 'https://github.com/openai/skills', skillCount: 118 }],
  },
  {
    name: 'Cloudflare',
    slug: 'cloudflare',
    totalSkills: 59,
    repos: [{ fullName: 'cloudflare/skills', url: 'https://github.com/cloudflare/skills', skillCount: 59 }],
  },
  {
    name: 'Flutter',
    slug: 'flutter',
    totalSkills: 58,
    repos: [{ fullName: 'flutter/skills', url: 'https://github.com/flutter/skills', skillCount: 58 }],
  },
  {
    name: 'Supabase',
    slug: 'supabase',
    totalSkills: 24,
    repos: [{ fullName: 'supabase/agent-skills', url: 'https://github.com/supabase/agent-skills', skillCount: 24 }],
  },
]

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  {
    name: 'web-artifacts-builder',
    description: 'Suite of tools for creating elaborate, multi-component HTML artifacts using React, Tailwind CSS, shadcn/ui',
    publisher: 'Anthropic',
    repoFullName: 'anthropics/skills',
    tags: ['frontend'],
    downloadUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/web-artifacts-builder/SKILL.md',
  },
  {
    name: 'frontend-design',
    description: 'Create distinctive, production-grade frontend interfaces with high design quality',
    publisher: 'Anthropic',
    repoFullName: 'anthropics/skills',
    tags: ['frontend'],
    downloadUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/frontend-design/SKILL.md',
  },
  {
    name: 'cloudflare-workers',
    description: 'Build and deploy Cloudflare Workers, Pages, D1, R2, and KV with best practices',
    publisher: 'Cloudflare',
    repoFullName: 'cloudflare/skills',
    tags: ['backend'],
    downloadUrl: 'https://raw.githubusercontent.com/cloudflare/skills/main/cloudflare-workers/SKILL.md',
  },
  {
    name: 'supabase-development',
    description: 'Build with Supabase: Postgres, Auth, Edge Functions, Realtime, and Storage',
    publisher: 'Supabase',
    repoFullName: 'supabase/agent-skills',
    tags: ['backend', 'database'],
    downloadUrl: 'https://raw.githubusercontent.com/supabase/agent-skills/main/supabase-development/SKILL.md',
  },
  {
    name: 'stripe-integration',
    description: 'Stripe payment integration: checkout, subscriptions, webhooks, and PCI compliance',
    publisher: 'Stripe',
    repoFullName: 'stripe/ai',
    tags: ['ecommerce'],
    downloadUrl: 'https://raw.githubusercontent.com/stripe/ai/main/stripe-integration/SKILL.md',
  },
  {
    name: 'terraform-skills',
    description: 'Infrastructure as Code with HashiCorp Terraform: providers, modules, state management',
    publisher: 'HashiCorp',
    repoFullName: 'hashicorp/agent-skills',
    tags: ['devops'],
    downloadUrl: 'https://raw.githubusercontent.com/hashicorp/agent-skills/main/terraform-skills/SKILL.md',
  },
  {
    name: 'prisma-orm',
    description: 'Database development with Prisma ORM: schema, migrations, queries, and relations',
    publisher: 'Prisma',
    repoFullName: 'prisma/skills',
    tags: ['database'],
    downloadUrl: 'https://raw.githubusercontent.com/prisma/skills/main/prisma-orm/SKILL.md',
  },
  {
    name: 'sentry-monitoring',
    description: 'Error tracking and performance monitoring with Sentry',
    publisher: 'Sentry',
    repoFullName: 'getsentry/skills',
    tags: ['testing'],
    downloadUrl: 'https://raw.githubusercontent.com/getsentry/skills/main/sentry-monitoring/SKILL.md',
  },
  {
    name: 'notion-integration',
    description: 'Notion API integration: databases, pages, blocks, and search',
    publisher: 'Notion',
    repoFullName: 'makenotion/claude-code-notion-plugin',
    tags: ['docs'],
    downloadUrl: 'https://raw.githubusercontent.com/makenotion/claude-code-notion-plugin/main/notion-integration/SKILL.md',
  },
]
