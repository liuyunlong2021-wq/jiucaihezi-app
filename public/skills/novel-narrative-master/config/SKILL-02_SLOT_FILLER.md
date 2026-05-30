# SKILL-02: SLOT_FILLER 插槽填充 (Slot Filler)

> 🎨 "为骨架注入灵魂。识别插槽类型，调用专项能力进行填充。"
> **Source**: Adapted from `NovelGenerator/SpecialistAgents`

---

## 核心指令

读取带有 `[SLOT]` 的骨架文本，识别每一个插槽，并生成对应的高质量内容。

---

## 插槽处理逻辑 (Slot Logic)

### 1. [DIALOGUE_...] 对话插槽

- **要求**: 必须包含**潜台词** (Subtext)。
- **Prompt**: "Write dialogue that reveals character personality and hidden agenda. Avoid on-the-nose speech."
- **Example**:
  - *Slot*: `[DIALOGUE_REFUSAL]`
  - *Fill*: "这事儿吧，它不是钱的问题。"他点了根烟，眼神却一直往马小玲的口袋上瞟，"主要是...规矩不能坏。"

### 2. [DESCRIPTION_...] 描写插槽

- **要求**: 调用**五感** (Sensory details)。
- **Prompt**: "Show, don't tell. Use specific nouns and verbs."
- **Example**:
  - *Slot*: `[DESCRIPTION_COLD]`
  - *Fill*: 鼻毛在吸气的一瞬间冻得发硬，每呼出一口白气，眉毛上就多了一层霜。

### 3. [INTERNAL_...] 心理插槽

- **要求**: **意识流** (Stream of Consciousness)。
- **Prompt**: "Show internal conflict/fear/doubt directly."
- **Example**:
  - *Slot*: `[INTERNAL_PANIC]`
  - *Fill*: 完了。这下全完了。去南方的票白买了，隔壁二大爷变异了，这日子没法过了。

### 4. [ACTION_...] 动作插槽

- **要求**: **动词精确** (Precise Verbs)。
- **Prompt**: "Focus on physics, impact, and sequence."
- **Example**:
  - *Slot*: `[ACTION_SLAP]`
  - *Fill*: 湿透的拖布带着风声，"啪"地一声脆响，结结实实糊在了二大爷脸上，水渍溅了一地。

---

## 输出格式

输出一份完整的、没有插槽标记的最终文本。
