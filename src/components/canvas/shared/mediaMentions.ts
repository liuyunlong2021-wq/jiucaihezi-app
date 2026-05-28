import type { Material } from '@/canvas/composables/useUpstreamMaterials';

export type MediaMentionKind = 'image' | 'video' | 'audio';

export interface MediaMention {
  id: string;
  kind: MediaMentionKind;
  materialKey: string;
  url: string;
  label?: string;
  token: string;
  start: number;
  end: number;
}

const TOKEN_PREFIX: Record<MediaMentionKind, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
};

export function isMentionableMaterial(material: Material): material is Material & { kind: MediaMentionKind } {
  return material.kind === 'image' || material.kind === 'video' || material.kind === 'audio';
}

export function materialMentionKey(material: Pick<Material, 'kind' | 'url'>): string {
  return `${material.kind}:${material.url}`;
}

export function tokenForMaterial(material: Material, materials: Material[]): string {
  if (!isMentionableMaterial(material)) return '@material';
  let index = 0;
  for (const candidate of materials) {
    if (!isMentionableMaterial(candidate) || candidate.kind !== material.kind) continue;
    index += 1;
    if (materialMentionKey(candidate) === materialMentionKey(material)) {
      return `@${TOKEN_PREFIX[material.kind]}${index}`;
    }
  }
  return `@${TOKEN_PREFIX[material.kind]}?`;
}

export function updateMentionRanges(prevText: string, nextText: string, mentions: MediaMention[]): MediaMention[] {
  if (!mentions.length) return [];
  if (prevText === nextText) return mentions.filter((m) => nextText.slice(m.start, m.end) === m.token);

  let start = 0;
  const maxPrefix = Math.min(prevText.length, nextText.length);
  while (start < maxPrefix && prevText[start] === nextText[start]) start += 1;

  let prevEnd = prevText.length;
  let nextEnd = nextText.length;
  while (prevEnd > start && nextEnd > start && prevText[prevEnd - 1] === nextText[nextEnd - 1]) {
    prevEnd -= 1;
    nextEnd -= 1;
  }

  const delta = nextText.length - prevText.length;
  const nextMentions: MediaMention[] = [];
  for (const mention of mentions) {
    let nextStart = mention.start;
    let nextMentionEnd = mention.end;

    if (mention.end <= start) {
      // Edit is after this token.
    } else if (mention.start >= prevEnd) {
      nextStart += delta;
      nextMentionEnd += delta;
    } else {
      // User edited through a selected @ token; drop the binding so typed text stays literal.
      continue;
    }

    if (nextText.slice(nextStart, nextMentionEnd) !== mention.token) continue;
    nextMentions.push({ ...mention, start: nextStart, end: nextMentionEnd });
  }
  return nextMentions;
}

export function insertMediaMention(
  text: string,
  mentions: MediaMention[],
  material: Material,
  materials: Material[],
  start: number,
  end: number,
): { text: string; mentions: MediaMention[]; caret: number } {
  if (!isMentionableMaterial(material)) return { text, mentions, caret: end };
  const token = tokenForMaterial(material, materials);
  const before = text.slice(0, start);
  const after = text.slice(end);
  const needsSpace = !/^\s/.test(after);
  const insertText = `${token}${needsSpace ? ' ' : ''}`;
  const nextText = `${before}${insertText}${after}`;
  const caret = before.length + insertText.length;
  const shifted = updateMentionRanges(text, nextText, mentions);
  const mention: MediaMention = {
    id: `${materialMentionKey(material)}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    kind: material.kind,
    materialKey: materialMentionKey(material),
    url: material.url,
    label: material.label,
    token,
    start: before.length,
    end: before.length + token.length,
  };
  return {
    text: nextText,
    mentions: [...shifted, mention].sort((a, b) => a.start - b.start),
    caret,
  };
}

export function resolveMediaMentions(text: string, mentions: MediaMention[], materials: Material[]): string {
  if (!mentions.length) return text;
  const byKey = new Map<string, Material>();
  for (const material of materials) {
    if (isMentionableMaterial(material)) byKey.set(materialMentionKey(material), material);
  }

  let next = text;
  const validMentions = mentions
    .filter((mention) => text.slice(mention.start, mention.end) === mention.token)
    .sort((a, b) => b.start - a.start);
  for (const mention of validMentions) {
    const material = byKey.get(mention.materialKey);
    if (!material) continue;
    const currentToken = tokenForMaterial(material, materials);
    next = `${next.slice(0, mention.start)}${currentToken}${next.slice(mention.end)}`;
  }
  return next;
}

export function getUnresolvedMentionCount(mentions: MediaMention[], materials: Material[]): number {
  if (!mentions.length) return 0;
  const keys = new Set(
    materials
      .filter(isMentionableMaterial)
      .map((material) => materialMentionKey(material)),
  );
  return mentions.filter((mention) => !keys.has(mention.materialKey)).length;
}
