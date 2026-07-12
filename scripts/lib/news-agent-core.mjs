import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

export const paths = {
  rawSnapshot: path.resolve(repoRoot, 'data/raw/raw-sources.json'),
  normalizedStories: path.resolve(repoRoot, 'data/processed/normalized-stories.json'),
  finalDigest: path.resolve(repoRoot, 'src/data/live-intelligence.json'),
  agentLogDir: path.resolve(repoRoot, 'logs/agent'),
};

const llmEnabled = Boolean(process.env.OPENAI_API_KEY) && process.env.INTELLIGENCE_ENABLE_LLM !== 'false';
const openaiModel = process.env.OPENAI_MODEL || 'gpt-5-mini';

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: true,
});

export const SOURCE_REGISTRY = [
  { id: 'techcrunch-ai', label: 'TechCrunch AI', type: 'news', priority: 30, url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { id: 'the-verge-ai', label: 'The Verge AI', type: 'news', priority: 28, url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { id: 'openai-news', label: 'OpenAI News', type: 'official', priority: 32, url: 'https://openai.com/news/rss.xml' },
  { id: 'google-ai-blog', label: 'Google AI Blog', type: 'official', priority: 28, url: 'https://blog.google/technology/ai/rss/' },
  { id: 'hn-ai', label: 'Hacker News AI', type: 'social', priority: 12, url: 'https://hnrss.org/newest?q=AI' },
  { id: 'devto-ai', label: 'DEV Community AI', type: 'social', priority: 8, url: 'https://dev.to/feed/tag/ai' },
];

const CATEGORY_RULES = [
  { value: 'Funding & M&A', pattern: /(\bfunding\b|\braises\b|\braised\b|\bacquires?\b|\bacquired\b|\bmerger\b|\bvaluation\b|\bseed\b|\bseries [abcde]\b|\bm&a\b)/i },
  { value: 'Regulation & Policy', pattern: /(regulat|policy|\beu\b|senate|white house|government|copyright|lawsuit|antitrust)/i },
  { value: 'Research & Safety', pattern: /(research|paper|benchmark|safety|alignment|eval|evaluation|study|reasoning)/i },
  { value: 'Product Update', pattern: /(launch|released|release|rollout|agent|assistant|api|feature|tool|workspace|app)/i },
  { value: 'Model Release', pattern: /(model|gpt|claude|gemini|llama|mistral|deepseek|sonnet|opus|reasoning)/i },
  { value: 'Partnerships', pattern: /(partner|deal|integration|collaboration|alliance)/i },
];

const TOPIC_RULES = [
  { value: 'OpenAI', pattern: /\bopenai\b|\bgpt\b|\bo3\b/i },
  { value: 'Anthropic', pattern: /\banthropic\b|\bclaude\b/i },
  { value: 'Google', pattern: /\bgoogle\b|\bgemini\b|\bdeepmind\b/i },
  { value: 'Meta', pattern: /\bmeta\b|\bllama\b/i },
  { value: 'Coding', pattern: /\bcoding\b|\bdeveloper\b|\bdevtool\b|\bapi\b/i },
  { value: 'Agents', pattern: /\bagent\b|\bworkflow\b|\bautomation\b/i },
  { value: 'Enterprise', pattern: /\benterprise\b|\bb2b\b|\bworkspace\b|\bsales\b/i },
  { value: 'Research', pattern: /\bresearch\b|\bpaper\b|\bbenchmark\b|\beval/i },
  { value: 'Policy', pattern: /\bpolicy\b|\bregulation\b|\bgovernment\b|\blawsuit\b/i },
];

const ENTITY_RULES = [
  'OpenAI', 'Anthropic', 'Google', 'DeepMind', 'Meta', 'Microsoft', 'Apple', 'Amazon',
  'Perplexity', 'Mistral', 'xAI', 'Midjourney', 'Cursor', 'GitHub', 'Nvidia',
];

const categoryPriority = {
  'Model Release': 20,
  'Product Update': 14,
  'Funding & M&A': 16,
  'Research & Safety': 12,
  'Regulation & Policy': 18,
  Partnerships: 10,
};

const entityPriority = {
  OpenAI: 10, Anthropic: 8, Google: 7, DeepMind: 7, Meta: 6, Microsoft: 6,
  Nvidia: 6, Perplexity: 5, xAI: 5, Cursor: 5,
};

const USER_AGENT = 'Mozilla/5.0 (compatible; AvaNewsAgent/1.0; +https://aidenfolio.vercel.app)';

export async function runNewsAgent(options = {}) {
  const rawPath = options.rawPath || paths.rawSnapshot;
  const normalizedPath = options.normalizedPath || paths.normalizedStories;
  const outputPath = options.outputPath || paths.finalDigest;

  const collections = await fetchSourceSnapshot();
  await writeJson(rawPath, collections);

  const normalized = normalizeSnapshot(collections);
  await writeJson(normalizedPath, normalized);

  const digest = buildDigest(normalized.stories, collections);
  const enrichedDigest = llmEnabled ? await enrichDigestWithLlm(digest) : applyFallbackEnrichment(digest);
  await writeJson(outputPath, enrichedDigest);

  return {
    rawPath,
    normalizedPath,
    outputPath,
    sourceCount: collections.sources.length,
    storyCount: enrichedDigest.stories.length,
  };
}

export async function fetchSourceSnapshot() {
  const sources = await Promise.all(
    SOURCE_REGISTRY.map(async (source) => {
      const entries = await fetchFeed(source);
      return {
        ...source,
        fetchedAt: new Date().toISOString(),
        items: entries
          .map((entry) => ({
            title: textOf(entry.title),
            description: cleanText(textOf(entry.description || entry.summary || entry.content)),
            url: getUrl(entry),
            publishedAt: normalizeDate(entry.pubDate || entry.published || entry.updated),
          }))
          .filter((item) => item.title && item.url && item.publishedAt)
          .slice(0, source.type === 'social' ? 8 : 12),
      };
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    sources,
  };
}

export function normalizeSnapshot(snapshot) {
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 21;

  const stories = applySourceMix(
    dedupeStories(
      snapshot.sources.flatMap((source) =>
        source.items.map((item, index) => {
          const category = inferCategory(item.title, item.description);
          const topics = inferTopics(item.title, item.description);
          const entities = inferEntities(item.title, item.description);
          const importanceScore = scoreStory({
            source,
            title: item.title,
            description: item.description,
            category,
            topics,
            entities,
            publishedAt: item.publishedAt,
          });

          return {
            id: `${source.id}-${index + 1}`,
            title: item.title,
            summary: trimSummary(item.description || item.title),
            url: item.url,
            publisher: source.label,
            sourceType: source.type,
            sourceUrl: source.url,
            publishedAt: item.publishedAt,
            category,
            topics,
            entities,
            importanceScore,
            importance: toImportanceLabel(importanceScore),
          };
        })
      )
    )
      .filter((story) => new Date(story.publishedAt).getTime() >= cutoff)
      .sort((a, b) => b.importanceScore - a.importanceScore || new Date(b.publishedAt) - new Date(a.publishedAt))
  ).slice(0, 36);

  return {
    generatedAt: new Date().toISOString(),
    storyCount: stories.length,
    stories,
  };
}

export function buildDigest(stories, collections) {
  const critical = stories.filter((story) => story.importance === 'Critical').length;
  const newsStories = stories.filter((story) => story.sourceType === 'news').length;
  const socialStories = stories.filter((story) => story.sourceType === 'social').length;
  const topThemes = tally(stories.flatMap((story) => story.topics), 4);
  const topEntities = tally(stories.flatMap((story) => story.entities), 5);
  const categories = tally(stories.map((story) => story.category), 6, stories.length);
  const mustWatch = stories.slice(0, 4).map((story) => `${story.publisher}: ${story.title}`);

  return {
    generatedAt: new Date().toISOString(),
    automation: {
      llmEnabled,
      llmModel: llmEnabled ? openaiModel : null,
      llmApplied: false,
      llmError: null,
      mode: 'local-agent',
      refreshCadence: 'Daily at 07:00 KST via local agent runner',
      buildCommand: 'npm run agent:run && npm run build',
    },
    brief: {
      headline: `${critical}개의 Critical 신호와 ${topThemes[0]?.value || '핵심 테마'}가 오늘의 흐름을 주도`,
      summary: buildSummary(stories, critical, topThemes, topEntities),
      topThemes: topThemes.map((item) => item.value),
      mustWatch,
      editorNote: buildEditorNote({ facets: { categories, entities: topEntities } }),
    },
    stats: {
      totalStories: stories.length,
      totalSources: collections.sources.length,
      criticalCount: critical,
      newsStories,
      socialStories,
    },
    facets: {
      categories,
      entities: topEntities,
    },
    sources: collections.sources.map((source) => ({
      id: source.id,
      label: source.label,
      type: source.type,
      url: source.url,
      storyCount: source.items.length,
    })),
    stories: stories.map((story) => ({
      ...story,
      whyItMatters: defaultWhyItMatters(story),
      watchlist: defaultWatchlist(story),
    })),
  };
}

async function fetchFeed(source) {
  const response = await fetch(source.url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/xml,text/xml,application/rss+xml,application/atom+xml' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${source.label}: ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);

  if (parsed?.rss?.channel?.item) return asArray(parsed.rss.channel.item);
  if (parsed?.feed?.entry) return asArray(parsed.feed.entry);
  return [];
}

async function enrichDigestWithLlm(digest) {
  try {
    const topStories = digest.stories.slice(0, 8).map((story) => ({
      id: story.id,
      title: story.title,
      summary: story.summary,
      publisher: story.publisher,
      category: story.category,
      importance: story.importance,
      topics: story.topics,
      entities: story.entities,
      publishedAt: story.publishedAt,
    }));

    const prompt = [
      'You are preparing a concise business intelligence morning briefing in Korean.',
      'Return valid JSON only with this shape:',
      '{"headline":"string","summary":"string","mustWatch":["string"],"editorNote":"string","storyInsights":[{"id":"string","whyItMatters":"string","watchlist":"string"}]}',
      'Constraints:',
      '- headline: one sentence, under 90 Korean characters.',
      '- summary: 3-4 short Korean sentences for business readers.',
      '- mustWatch: exactly 4 bullets, each under 90 characters.',
      '- editorNote: one sentence explaining the main market pattern.',
      '- storyInsights: one item for each story id provided.',
      '- whyItMatters and watchlist: each 1 sentence in Korean, concrete and non-hype.',
      `Stories: ${JSON.stringify(topStories)}`,
    ].join('\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: openaiModel, input: prompt, max_output_tokens: 1800 }),
    });

    if (!response.ok) throw new Error(`OpenAI API failed: ${response.status}`);

    const data = await response.json();
    const text = extractResponseText(data);
    const parsed = JSON.parse(text);
    return mergeLlmEnrichment(digest, parsed);
  } catch (error) {
    console.warn(`LLM enrichment failed, falling back to deterministic summaries: ${error.message}`);
    return applyFallbackEnrichment(digest, error.message);
  }
}

function extractResponseText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) return content.text.trim();
    }
  }
  throw new Error('No output_text found in OpenAI response');
}

function mergeLlmEnrichment(digest, parsed) {
  const insightMap = new Map((parsed.storyInsights || []).map((item) => [item.id, item]));
  return {
    ...digest,
    automation: { ...digest.automation, llmApplied: true },
    brief: {
      ...digest.brief,
      headline: parsed.headline || digest.brief.headline,
      summary: parsed.summary || digest.brief.summary,
      mustWatch: Array.isArray(parsed.mustWatch) && parsed.mustWatch.length ? parsed.mustWatch : digest.brief.mustWatch,
      editorNote: parsed.editorNote || digest.brief.editorNote,
    },
    stories: digest.stories.map((story) => ({
      ...story,
      whyItMatters: insightMap.get(story.id)?.whyItMatters || story.whyItMatters,
      watchlist: insightMap.get(story.id)?.watchlist || story.watchlist,
    })),
  };
}

function applyFallbackEnrichment(digest, errorMessage = null) {
  return {
    ...digest,
    automation: { ...digest.automation, llmApplied: false, llmError: errorMessage },
  };
}

function inferCategory(title, description) {
  const haystack = `${title} ${description}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) return rule.value;
  }
  return 'Market Pulse';
}

function inferTopics(title, description) {
  const haystack = `${title} ${description}`;
  const topics = TOPIC_RULES.filter((rule) => rule.pattern.test(haystack)).map((rule) => rule.value);
  return topics.length ? topics : ['General AI'];
}

function inferEntities(title, description) {
  const haystack = `${title} ${description}`.toLowerCase();
  return ENTITY_RULES.filter((entity) => haystack.includes(entity.toLowerCase()));
}

function scoreStory({ source, title, description, category, topics, entities, publishedAt }) {
  const publishedMs = new Date(publishedAt).getTime();
  const ageHours = Math.max(0, Math.round((Date.now() - publishedMs) / (1000 * 60 * 60)));
  const freshness = Math.max(0, 28 - Math.min(ageHours, 72) / 2);
  const categoryBonus = categoryPriority[category] || 8;
  const topicBonus = Math.min(8, topics.reduce((sum, item) => sum + (item === 'Agents' ? 3 : item === 'Coding' ? 2 : 1), 0));
  const entityBonus = Math.min(10, entities.reduce((sum, item) => sum + (entityPriority[item] || 2), 0));
  const titleBonus = /(launch|release|raise|raises|lawsuit|agent|model|api|benchmark|deal)/i.test(`${title} ${description}`) ? 8 : 0;
  const typeAdjust = source.type === 'social' ? -16 : 6;
  return Math.min(99, Math.round(source.priority + freshness + categoryBonus + topicBonus + entityBonus + titleBonus + typeAdjust));
}

function toImportanceLabel(score) {
  if (score >= 88) return 'Critical';
  if (score >= 72) return 'High';
  if (score >= 54) return 'Medium';
  return 'Low';
}

function dedupeStories(stories) {
  const seen = new Set();
  return stories.filter((story) => {
    const key = `${story.url}|${story.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applySourceMix(stories) {
  const limits = { official: 12, news: 14, social: 8 };
  const used = { official: 0, news: 0, social: 0 };
  return stories.filter((story) => {
    if (used[story.sourceType] >= limits[story.sourceType]) return false;
    used[story.sourceType] += 1;
    return true;
  });
}

function buildSummary(stories, criticalCount, topThemes, topEntities) {
  const freshest = stories
    .slice()
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 3)
    .map((story) => story.title);

  return [
    `오늘 수집본은 ${stories.length}건이며, 이 중 ${criticalCount}건이 즉시 확인이 필요한 high-signal 이슈다.`,
    topThemes.length ? `핵심 테마는 ${topThemes.map((item) => item.value).join(', ')} 중심으로 모였다.` : null,
    topEntities.length ? `특히 ${topEntities.map((item) => item.value).join(', ')} 관련 노출이 많았다.` : null,
    freshest.length ? `가장 최근 헤드라인은 ${freshest.join(' / ')}.` : null,
  ].filter(Boolean).join(' ');
}

function buildEditorNote(digestLike) {
  const strongestCategory = digestLike.facets.categories[0]?.value || 'Market Pulse';
  const strongestEntity = digestLike.facets.entities[0]?.value || 'AI market';
  return `${strongestEntity} 관련 뉴스가 가장 많이 잡혔고, 전체 흐름은 ${strongestCategory} 중심으로 움직였다.`;
}

function defaultWhyItMatters(story) {
  if (story.category === 'Regulation & Policy') return `${story.publisher}발 규제 이슈라서 제품 출시 속도보다 법무·리스크 대응 우선순위를 바꿀 수 있다.`;
  if (story.category === 'Funding & M&A') return `${story.entities[0] || story.publisher}의 자금/딜 움직임은 향후 가격 경쟁과 시장 확장 속도에 직접 연결될 수 있다.`;
  if (story.category === 'Research & Safety') return '기술 성능 자체보다도 향후 제품 신뢰도와 엔터프라이즈 도입 명분에 영향을 줄 수 있는 신호다.';
  return `${story.topics[0] || 'AI'} 흐름을 보여주는 기사라서 경쟁사 포지셔닝과 로드맵 우선순위를 다시 보게 만든다.`;
}

function defaultWatchlist(story) {
  const leadEntity = story.entities[0] || story.topics[0] || '관련 플레이어';
  return `${leadEntity}의 후속 발표, 가격 정책, 파트너십 확장 여부를 1주일 단위로 추적하는 게 좋다.`;
}

function tally(values, limit, total = values.length) {
  const counts = values.reduce((acc, value) => {
    if (!value) return acc;
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count, share: total ? Math.round((count / total) * 100) : 0 }));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function getUrl(entry) {
  if (typeof entry.link === 'string') return entry.link;
  if (entry.link?.['@_href']) return entry.link['@_href'];
  if (Array.isArray(entry.link)) return entry.link.find((item) => item['@_href'])?.['@_href'] || null;
  if (entry.id && /^https?:/i.test(entry.id)) return entry.id;
  return null;
}

function normalizeDate(value) {
  const date = new Date(textOf(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return value['#text'] || value.__cdata || '';
  return '';
}

function cleanText(value) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function trimSummary(value) {
  return value.length > 240 ? `${value.slice(0, 237).trim()}...` : value;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, '...')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}
