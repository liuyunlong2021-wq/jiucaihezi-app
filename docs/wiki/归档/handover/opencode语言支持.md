全局语言切换机制源码定位
/Users/by3/Documents/jiucaihezi-opencode

以下是 OpenCode 全局语言切换的完整源码分析。

---

## 1. LanguageProvider — context 定义

**language.tsx** (L1–L231，完整文件)

### useLanguage 返回的对象

```ts
// L199-231
export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  gate: false,
  init: (props: { locale?: Locale }) => {
    const initial = props.locale ?? readStoredLocale() ?? detectLocale()
    const [store, setStore, _, ready] = persisted(
      Persist.global("language", ["language.v1"]),
      createStore({ locale: initial }),
    )
    const locale = createMemo<Locale>(() => normalizeLocale(store.locale))
    const intl = createMemo(() => INTL[locale()])
    const [dict] = createResource(locale, loadDict, {
      initialValue: dicts.get(initial) ?? base,
    })
    const t = i18n.translator(() => dict() ?? base, i18n.resolveTemplate)
    const label = (value: Locale) => t(LABEL_KEY[value])

    return {
      ready,         // Accessor<boolean> — 持久化就绪
      locale,        // Accessor<Locale>
      intl,          // Accessor<string> — "zh-Hans"
      locales,       // readonly Locale[] — 18 种语言
      label,         // (value: Locale) => string
      t,             // (key, params?) => string
      setLocale(next: Locale) { setStore("locale", normalizeLocale(next)) },
    }
  },
})
```

### 支持的 18 种语言

```ts
// L25-45
export type Locale = "en" | "zh" | "zht" | "ko" | "de" | "es" | "fr" | "da"
  | "ja" | "pl" | "ru" | "uk" | "ar" | "no" | "br" | "th" | "bs" | "tr"

const LOCALES: readonly Locale[] = [
  "en", "zh", "zht", "ko", "de", "es", "fr", "da", "ja",
  "pl", "ru", "uk", "bs", "ar", "no", "br", "th", "tr",
]

const INTL: Record<Locale, string> = {
  en: "en", zh: "zh-Hans", zht: "zh-Hant", ko: "ko",
  // ...
  no: "nb-NO", br: "pt-BR",
}
```

---

## 2. 语言持久化

### 存储目标

**persist.ts** (L471–L473)

```ts
global(key: string, legacy?: string[]): PersistTarget {
  return { storage: GLOBAL_STORAGE, key, legacy }
}
```

`GLOBAL_STORAGE = "opencode.global.dat"`

### 桌面端 → electron-store

**store.ts** (L1–L18)

```ts
const cache = new Map<string, Store>()
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = new Store({
    name,  // "opencode.global.dat"
    cwd: electron.app.getPath("userData"),  // ~/Library/Application Support/ai.opencode.desktop.dev/
    fileExtension: "",
    accessPropertiesByDotNotation: false,
  })
  cache.set(name, next)
  return next
}
```

最终文件：`~/Library/Application Support/ai.opencode.desktop.dev/opencode.global.dat`

### 浏览器端 → localStorage

key 为 `"opencode.global.dat:language"`，value 为 JSON `{"locale":"zh"}`

### 底层持久化机制

**persist.ts** — 函数 `persisted` (L553起)，使用 `@solid-primitives/storage` 的 `makePersisted` 包装 Solid store。

---

## 3. 初始语言检测

### 检测链

**language.tsx** (L155–L191)

```ts
// 1. localStorage 读取
function readStoredLocale() {
  const raw = localStorage.getItem("opencode.global.dat:language")
  if (!raw) return
  const next = JSON.parse(raw) as { locale?: string }
  if (typeof next?.locale !== "string") return
  return normalizeLocale(next.locale)
}

// 2. 浏览器 navigator.languages 检测
function detectLocale(): Locale {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    const normalized = language.toLowerCase()
    const match = localeMatchers.find((entry) => entry.match(normalized))
    if (match) return match.locale
  }
  return "en"
}

// 3. 非英文时预加载字典
const warm = readStoredLocale() ?? detectLocale()
if (warm !== "en") void loadDict(warm)
```

### 桌面端额外检测

**index.tsx** (L328–L338)

```ts
const loadLocale = async () => {
  const current = await platform.storage?.("opencode.global.dat").getItem("language")
  const legacy = current ? undefined : await platform.storage?.().getItem("language.v1")
  const raw = current ?? legacy
  if (!raw) return
  const locale = raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
  if (!locale) return
  const next = normalizeLocale(locale)
  if (next !== "en") await loadLocaleDict(next)
  return next
}
```

桌面端增加了一步：读 electron-store 确认，**预加载字典后再渲染**。

### localeMatchers 浏览器匹配规则

```ts
// L145-170
const localeMatchers = [
  { locale: "en",  match: (l) => l.startsWith("en") },
  { locale: "zht", match: (l) => l.startsWith("zh") && l.includes("hant") },
  { locale: "zh",  match: (l) => l.startsWith("zh") },
  { locale: "ko",  match: (l) => l.startsWith("ko") },
  { locale: "de",  match: (l) => l.startsWith("de") },
  // ... 每个语言对应一个 startsWith
  { locale: "no",  match: (l) => l.startsWith("no") || l.startsWith("nb") || l.startsWith("nn") },
  { locale: "br",  match: (l) => l.startsWith("pt") },  // 巴西葡萄牙语
]
```

---

## 4. 字典懒加载 & 缓存

### 懒加载器

**language.tsx** (L56–L76)

每个语言一个 `import()`：

```ts
const loaders = {
  zh:  () => merge(import("@/i18n/zh"), import("@opencode-ai/ui/i18n/zh")),
  de:  () => merge(import("@/i18n/de"), import("@opencode-ai/ui/i18n/de")),
  // ... 每个非 en 语言
}
```

`merge()` 同时加载 App 和 UI 两个包的字典，合并后 flatten：

```ts
const merge = (app: Promise<Source>, ui: Promise<Source>) =>
  Promise.all([app, ui]).then(([a, b]) =>
    ({ ...base, ...i18n.flatten({ ...a.dict, ...b.dict }) }) as Dictionary
  )
```

### 字典格式

**en.ts** — 扁平 key-value，800+ 条

```ts
export const dict = {
  "command.category.suggested": "Suggested",
  "language.en": "English",
  "language.zh": "简体中文",
  "settings.general.row.language.title": "Language",
  // ...
}
```

**en.ts** — UI 包也有独立字典

```ts
export const dict: Record<string, string> = {
  "ui.sessionReview.title": "Session changes",
  // ...
}
```

### 内存缓存

```ts
// L42 —— 基础字典（英文）在模块初始化时构建
const base = i18n.flatten({ ...en, ...uiEn })
const dicts = new Map<Locale, Dictionary>([["en", base]])

// L79-85 —— 加载后缓存
function loadDict(locale: Locale) {
  const hit = dicts.get(locale)
  if (hit) return Promise.resolve(hit)
  const load = loaders[locale]
  return load().then((next) => { dicts.set(locale, next); return next })
}
```

切换回已加载过的语言不走网络请求。

### createResource 驱动 UI

```ts
// L218 —— locale 变化时自动触发 loadDict，旧字典保留为 initialValue，不闪白
const [dict] = createResource(locale, loadDict, {
  initialValue: dicts.get(initial) ?? base,
})

// L221 —— t() 函数是响应式的
const t = i18n.translator(() => dict() ?? base, i18n.resolveTemplate)
```

---

## 5. 从 LanguageProvider 传播到 UI 组件

### 两层 context 结构

**app.tsx** (L325–L344)

```tsx
<LanguageProvider locale={props.locale}>
  <UiI18nBridge>
    {children}
  </UiI18nBridge>
</LanguageProvider>
```

### UiI18nBridge — 桥接 App 的 useLanguage → UI 包的 I18nProvider

**app.tsx** (L178–L180)

```tsx
function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>
    {props.children}
  </I18nProvider>
}
```

**i18n.tsx** — UI 包用标准的 Solid `createContext`，暴露 `{ locale, t }`，子组件用 `useI18n()` 消费。

### 两种消费方式

| 组件位置 | 钩子 | 来源 |
|----------|------|------|
| App 组件（pages/context） | `useLanguage().t()` | `@/context/language` |
| UI 组件（ui 包） | `useI18n().t()` | `@opencode-ai/ui/context` |

---

## 6. 语言切换 UI

### 设置面板 — 新版 SelectV2

**general.tsx** (L163–L178)

```tsx
const languageOptions = createMemo(() =>
  language.locales.map((locale) => ({
    value: locale,
    label: language.label(locale),  // 用当前语言的翻译显示（如"中文"）
  })),
)

<SelectV2
  data-action="settings-language"
  options={languageOptions()}
  current={languageOptions().find((o) => o.value === language.locale())}
  value={(o) => o.value}
  label={(o) => o.label}
  onSelect={(option) => option && setLocale(option.value)}
/>
```

### 键盘命令循环切换

**layout.tsx** (L358–L371)

```ts
function setLocale(next: Locale) {
  if (next === language.locale()) return
  language.setLocale(next)
  showToast({
    title: language.t("toast.language.title"),
    description: language.t("toast.language.description", { language: language.label(next) }),
  })
}

function cycleLanguage(direction = 1) {
  const locales = language.locales
  const currentIndex = locales.indexOf(language.locale())
  const nextIndex = (currentIndex + direction + locales.length) % locales.length
  const next = locales[nextIndex]
  if (!next) return
  setLocale(next)
}
```

### setLocale() 的持久化路径

```
setLocale("zh")
  → setStore("locale", "zh")          // 更新 Solid store
    → makePersisted 捕获 write
      → platform.storage("opencode.global.dat").setItem("language", JSON.stringify({locale:"zh"}))
        → IPC "store-set" → electron-store → 写文件
```

---

### 架构总览

```
┌─ 启动时 ─────────────────────────────────────────────────┐
│                                                          │
│  1. LanguageProvider.init()                              │
│     → readStoredLocale()  ← localStorage                │
│     → detectLocale()      ← navigator.languages          │
│     → createResource(locale, loadDict)  ← 动态 import()  │
│       → merge(appDict, uiDict) → flatten → 缓存到 Map   │
│     → makePersisted(createStore({locale}))               │
│       → electron-store / localStorage 自动同步            │
│                                                          │
│  2. desktop init (额外)                                   │
│     → platform.storage.get("language")                   │
│     → 正则解析 JSON → normalizeLocale()                  │
│     → 非 en 时 await loadLocaleDict() 再渲染              │
│                                                          │
├─ 运行时 ─────────────────────────────────────────────────┤
│                                                          │
│  setLocale("zh")                                         │
│    → setStore("locale", "zh")                            │
│      → makePersisted → electron-store 写文件              │
│      → locale 信号变化 → createResource 重新触发          │
│        → 内存已有缓存 → 同步返回                           │
│        → 无缓存 → dynamic import() → 缓存 → 更新 dict    │
│      → i18n.translator(dict) → 所有 t() 调用重新求值       │
│      → document.documentElement.lang = "zh"              │
│      → document.cookie = "oc_locale=zh"                  │
│                                                          │
├─ 组件消费 ──────────────────────────────────────────────┤
│                                                          │
│  App 组件: useLanguage().t("key")                        │
│    → LanguageProvider context (createSimpleContext)       │
│                                                          │
│  UI 组件: useI18n().t("key")                             │
│    → UiI18nBridge 桥接层                                  │
│      → I18nProvider (Solid createContext)                │
│        → t 函数同源（同一引用）                             │
│                                                          │
└──────────────────────────────────────────────────────────┘
```
