import { createHash } from 'node:crypto';
import { MAX_WINDOW_HOURS } from './news-agent-config.mjs';

const CATEGORY_RULES = [
  { value: 'M&A', pattern: /\b(acqui(?:re|res|red|sition)|merger|takeover|buyout|m&a)\b/i },
  { value: 'Funding & Investment', pattern: /\b(funding|fundraise|raises?|raised|valuation|seed|series [a-f]|ipo|invest(?:s|ed|ment)?)\b|\$\s?\d/i },
  { value: 'Regulation & Policy', pattern: /regulat|policy|government|copyright|lawsuit|antitrust|executive order|legislation|compliance|national security/i },
  { value: 'Partnerships', pattern: /\b(partner(?:ship|ed)?|deal|integration|collaboration|alliance|adopts?|deploys?)\b/i },
  { value: 'Model Release', pattern: /\b(introduc(?:e|es|ing)|launch(?:es|ed)?|releas(?:e|es|ed)|unveil(?:s|ed)?)\b[^.]{0,80}\b(model|gpt|claude|gemini|llama|mistral|deepseek|sonnet|opus)\b|\b(gpt|claude|gemini|llama|mistral|deepseek|sonnet|opus)[-\s]?\d/i },
  { value: 'Infrastructure & Chips', pattern: /gpu|semiconductor|chip|data ?center|inference infrastructure|training cluster|hbm|ssd|fab\b/i },
  { value: 'Research & Safety', pattern: /research|paper|benchmark|evaluation|evals?\b|alignment|safety|jailbreak|study|dataset/i },
  { value: 'Product Update', pattern: /\b(launch|release|rollout|feature|assistant|api|workspace|application|app|browser|tool)\b/i },
];

const TOPIC_RULES = [
  { value: 'OpenAI', pattern: /\bopenai\b|\bchatgpt\b|\bgpt[-\s]?\d/i },
  { value: 'Anthropic', pattern: /\banthropic\b|\bclaude\b/i },
  { value: 'Google', pattern: /\bgoogle\b|\bgemini\b|\bdeepmind\b/i },
  { value: 'Meta', pattern: /\bmeta\b|\bllama\b/i },
  { value: 'Coding', pattern: /\bcoding\b|\bdeveloper\b|\bdevtool\b|\bcodex\b|\bgithub\b/i },
  { value: 'Agents', pattern: /\bagents?\b|agentic|workflow|automation|\bmcp\b/i },
  { value: 'Enterprise', pattern: /enterprise|\bb2b\b|workspace|customer|adoption|deployment/i },
  { value: 'Research', pattern: /research|paper|benchmark|evaluation|evals?\b|dataset/i },
  { value: 'Policy', pattern: /policy|regulation|government|lawsuit|copyright|antitrust/i },
  { value: 'Infrastructure', pattern: /gpu|semiconductor|chip|data ?center|inference|training cluster|hbm/i },
  { value: 'Funding', pattern: /funding|fundraise|valuation|seed|series [a-f]|investment|ipo/i },
];

const ENTITY_ALIASES = new Map([
  ['OpenAI', ['openai', 'chatgpt']],
  ['Anthropic', ['anthropic', 'claude']],
  ['Google', ['google', 'gemini']],
  ['DeepMind', ['deepmind']],
  ['Meta', ['meta ai', 'llama']],
  ['Microsoft', ['microsoft', 'copilot']],
  ['Apple', ['apple']],
  ['Amazon', ['amazon', 'aws', 'bedrock']],
  ['NVIDIA', ['nvidia', 'nemotron']],
  ['Perplexity', ['perplexity']],
  ['Mistral', ['mistral']],
  ['xAI', ['xai', 'grok']],
  ['Hugging Face', ['hugging face']],
  ['GitHub', ['github']],
  ['Samsung', ['samsung']],
  ['SK Hynix', ['sk hynix']],
]);

const LOW_QUALITY_PATTERNS = [
  /bypass\s+(?:hcaptcha|recaptcha|captcha)/i,
  /buying?\s+(?:telegram|facebook|instagram|x)\s+accounts?/i,
  /make\s+\$?\d+.*(?:affiliate|passive income)/i,
  /promo\s*code|coupon\s*code|cheap followers|account marketplace/i,
  /seo\s+backlinks?|guest\s+post\s+service/i,
];

const TOKEN_ALIASES = new Map([
  ['sues', 'lawsuit'], ['sued', 'lawsuit'], ['lawsuit', 'lawsuit'],
  ['allegedly', 'allege'], ['alleged', 'allege'], ['alleges', 'allege'],
  ['stealing', 'steal'], ['stole', 'steal'], ['theft', 'steal'],
  ['secrets', 'secret'], ['models', 'model'], ['launches', 'launch'], ['launched', 'launch'],
  ['releases', 'release'], ['released', 'release'], ['introducing', 'introduce'],
]);

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'from', 'is', 'are', 'its', 'new', 'ai', 'says', 'over', 'amid', 'how', 'why', 'now', 'this', 'that']);

const SOURCE_BASE = { official: 92, government: 94, research: 86, news: 76, social: 40 };
const SCORE_WEIGHTS = {
  sourceReliability: 0.14,
  marketImpact: 0.15,
  companyInfluence: 0.10,
  novelty: 0.10,
  audienceBreadth: 0.08,
  decisionRelevance: 0.13,
  competitiveImpact: 0.11,
  recency: 0.07,
  crossCheck: 0.06,
  followUpPotential: 0.06,
};

export function normalizeSnapshot(snapshot, options = {}) {
  const now = new Date(options.now || snapshot.generatedAt || Date.now());
  const windowStartedAt = new Date(options.windowStartedAt || now.getTime() - MAX_WINDOW_HOURS * 3_600_000);
  const watchlist = options.watchlist || { companies: [], topics: [], regions: [] };
  const rejected = [];
  const discoveries = [];
  const candidates = [];

  for (const source of snapshot.sources || []) {
    if (source.status === 'failed') continue;
    for (const item of source.items || []) {
      const publishedAt = new Date(item.publishedAt);
      if (Number.isNaN(publishedAt.getTime()) || publishedAt < windowStartedAt || publishedAt > new Date(now.getTime() + 3_600_000)) continue;
      const title = decodeHtmlEntities(cleanText(item.title));
      const description = decodeHtmlEntities(cleanText(item.description || title));
      const quality = assessLowQuality({ title, description, url: item.url });
      const base = buildStory({ source, item: { ...item, title, description }, now, watchlist });

      if (!quality.accepted) {
        rejected.push({ ...base, processingStatus: 'rejected', rejectionReason: quality.reason });
      } else if (source.type === 'social') {
        discoveries.push({ ...base, processingStatus: 'needs_review', discoveryReason: 'single-source social/community discovery' });
      } else {
        candidates.push(base);
      }
    }
  }

  const sorted = candidates.sort((a, b) => b.importanceScore - a.importanceScore || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const mixed = applySourceMix(sorted);
  return {
    generatedAt: now.toISOString(),
    windowStartedAt: windowStartedAt.toISOString(),
    storyCount: mixed.length,
    stories: mixed,
    discoveries: discoveries.sort((a, b) => b.importanceScore - a.importanceScore).slice(0, 12),
    rejected,
  };
}

function buildStory({ source, item, now, watchlist }) {
  const canonicalUrl = canonicalizeUrl(item.url);
  const haystack = `${item.title} ${item.description}`;
  const category = inferCategory(item.title, item.description);
  const topics = inferTopics(item.title, item.description);
  const entities = inferEntities(item.title, item.description);
  const region = inferRegion(haystack);
  const scoreBreakdown = buildScoreBreakdown({ source, haystack, category, topics, entities, publishedAt: item.publishedAt, now, watchlist, region });
  const importanceScore = calculateImportance(scoreBreakdown);
  return {
    id: `${source.id}-${createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 12)}`,
    title: item.title,
    titleKo: item.title,
    summary: trimText(item.description, 500),
    feedSummary: trimText(item.description, 500),
    fullText: '',
    contentStatus: 'feed',
    url: item.url,
    canonicalUrl,
    publisher: source.label,
    sourceType: source.type,
    sourceUrl: source.url,
    publishedAt: new Date(item.publishedAt).toISOString(),
    category,
    topics,
    entities,
    companies: entities,
    technologies: topics,
    region,
    importanceScore,
    importance: toImportanceLabel(importanceScore),
    scoreBreakdown,
    sourceReliability: scoreBreakdown.sourceReliability,
    summaryConfidence: 0,
    confidenceLevel: 'reported',
    processingStatus: 'pending_analysis',
    relatedSources: [],
    keyFacts: [],
    affectedMarkets: [],
    evidence: [],
  };
}

export function clusterEvents(stories) {
  const groups = [];
  for (const story of stories) {
    const matched = groups.find((group) => isSameEvent(story, group[0]));
    if (matched) matched.push(story);
    else groups.push([story]);
  }

  return groups.map((group) => {
    const sorted = [...group].sort((a, b) => representativeScore(b) - representativeScore(a));
    const winner = sorted[0];
    const sourceNames = [...new Set(sorted.map((item) => item.publisher))];
    const primaryPresent = sorted.some((item) => ['official', 'government', 'research'].includes(item.sourceType));
    const crossCheckCount = sourceNames.length;
    const crossCheck = crossCheckCount >= 3 ? 100 : crossCheckCount === 2 ? 82 : primaryPresent ? 62 : 35;
    const scoreBreakdown = { ...winner.scoreBreakdown, crossCheck };
    const importanceScore = calculateImportance(scoreBreakdown);
    const eventGroupId = `event-${createHash('sha256').update(eventSignature(winner.title)).digest('hex').slice(0, 12)}`;
    return {
      ...winner,
      eventGroupId,
      duplicateGroupId: eventGroupId,
      crossCheckCount,
      verificationLevel: crossCheckCount >= 2 ? 'corroborated' : storyVerificationLevel(winner.sourceType),
      confidenceLevel: crossCheckCount >= 2 ? 'confirmed' : 'reported',
      scoreBreakdown,
      importanceScore,
      importance: toImportanceLabel(importanceScore),
      relatedSources: sorted.slice(1).map((item) => ({ name: item.publisher, url: item.url, type: item.sourceType })),
    };
  }).sort((a, b) => b.importanceScore - a.importanceScore || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function applyStoryAnalysis(story, analysis) {
  const scoreBreakdown = {
    ...story.scoreBreakdown,
    novelty: clamp(analysis.novelty),
    decisionRelevance: clamp(analysis.decisionRelevance),
    competitiveImpact: clamp(analysis.competitiveImpact),
    marketImpact: clamp(analysis.marketImpact),
    followUpPotential: clamp(analysis.followUpPotential),
  };
  const importanceScore = calculateImportance(scoreBreakdown);
  return {
    ...story,
    titleKo: analysis.titleKo,
    summary: analysis.summaryKo,
    category: analysis.category,
    entities: uniqueStrings(analysis.companies),
    companies: uniqueStrings(analysis.companies),
    technologies: uniqueStrings(analysis.technologies),
    topics: uniqueStrings(analysis.technologies),
    keyFacts: uniqueStrings(analysis.keyFacts).slice(0, 5),
    evidence: uniqueStrings(analysis.evidence).slice(0, 4),
    whyItMatters: analysis.whyItMatters,
    watchlist: analysis.watchlist,
    affectedMarkets: uniqueStrings(analysis.affectedMarkets).slice(0, 5),
    summaryConfidence: clamp(analysis.confidence),
    processingStatus: 'validated',
    analysisStatus: 'llm-validated',
    scoreBreakdown,
    importanceScore,
    importance: toImportanceLabel(importanceScore),
  };
}

export function validateStoryAnalysis(input, expectedIds) {
  if (!input || !Array.isArray(input.stories) || input.stories.length !== expectedIds.length) return false;
  const ids = new Set(input.stories.map((item) => item?.id));
  if (expectedIds.some((id) => !ids.has(id))) return false;
  return input.stories.every((item) =>
    isString(item.id) && isString(item.titleKo, 3) && isString(item.summaryKo, 40) && containsHangul(item.summaryKo) &&
    isString(item.category, 3) && stringArray(item.companies) && stringArray(item.technologies) &&
    stringArray(item.keyFacts, 1) && stringArray(item.evidence, 1) && isString(item.whyItMatters, 30) &&
    isString(item.watchlist, 20) && stringArray(item.affectedMarkets) &&
    ['confidence', 'novelty', 'decisionRelevance', 'competitiveImpact', 'marketImpact', 'followUpPotential'].every((key) => Number.isFinite(item[key]) && item[key] >= 0 && item[key] <= 100)
  );
}

export function validateBriefAnalysis(input) {
  return Boolean(input && isString(input.headline, 5) && isString(input.summary, 80) && containsHangul(input.summary) &&
    isString(input.marketShift, 30) && stringArray(input.topThemes, 1) && stringArray(input.mustWatch, 2) &&
    stringArray(input.companyMoves, 1) && isString(input.editorNote, 20));
}

export function evaluateDigest(digest, options = {}) {
  const stories = digest.stories || [];
  const sources = digest.sources || [];
  const now = new Date(digest.generatedAt || Date.now());
  const successfulSources = sources.filter((source) => source.status === 'ok').length;
  const metrics = {
    storyCount: stories.length,
    sourceSuccessRatio: sources.length ? successfulSources / sources.length : 0,
    socialPublishedCount: stories.filter((story) => story.sourceType === 'social').length,
    rejectedPatternCount: stories.filter((story) => !assessLowQuality(story).accepted).length,
    staleCount: stories.filter((story) => now.getTime() - Date.parse(story.publishedAt) > MAX_WINDOW_HOURS * 3_600_000).length,
    koreanSummaryRatio: stories.length ? stories.filter((story) => containsHangul(story.summary || '')).length / stories.length : 0,
    evidenceRatio: stories.length ? stories.filter((story) => Array.isArray(story.evidence) && story.evidence.length).length / stories.length : 0,
    corroboratedRatio: stories.length ? stories.filter((story) => story.crossCheckCount >= 2 || ['official-source', 'primary-source'].includes(story.verificationLevel)).length / stories.length : 0,
    llmApplied: digest.automation?.llmApplied === true,
  };
  const failures = [];
  const minStories = options.minStories ?? 5;
  if (metrics.storyCount < minStories) failures.push(`publishable stories ${metrics.storyCount} < ${minStories}`);
  if (metrics.sourceSuccessRatio < (options.minSourceSuccessRatio ?? 0.5)) failures.push('source success ratio below 50%');
  if (metrics.socialPublishedCount) failures.push('social/community stories reached publication');
  if (metrics.rejectedPatternCount) failures.push('low-quality pattern reached publication');
  if (metrics.staleCount) failures.push('stories older than 72 hours reached publication');
  if (metrics.koreanSummaryRatio < (options.minKoreanSummaryRatio ?? 0.9)) failures.push('Korean summary coverage below 90%');
  if (metrics.evidenceRatio < (options.minEvidenceRatio ?? 0.9)) failures.push('evidence coverage below 90%');
  if (metrics.corroboratedRatio < (options.minCorroboratedRatio ?? 0.5)) failures.push('primary-source or corroborated coverage below 50%');
  if ((options.requireLlm ?? true) && !metrics.llmApplied) failures.push('LLM analysis was not applied');
  return { passed: failures.length === 0, metrics, failures };
}

export function assessLowQuality({ title = '', description = '', url = '' }) {
  const text = `${title} ${description}`;
  const matched = LOW_QUALITY_PATTERNS.find((pattern) => pattern.test(text));
  if (matched) return { accepted: false, reason: `blocked pattern: ${matched.source}` };
  if (title.trim().length < 8) return { accepted: false, reason: 'title too short' };
  if (/\b(?:bit\.ly|tinyurl\.com)\b/i.test(url)) return { accepted: false, reason: 'opaque redirect URL' };
  return { accepted: true, reason: null };
}

export function inferCategory(title, description = '') {
  const haystack = `${title} ${description}`;
  return CATEGORY_RULES.find((rule) => rule.pattern.test(haystack))?.value || 'Market Pulse';
}

export function inferTopics(title, description = '') {
  const haystack = `${title} ${description}`;
  const values = TOPIC_RULES.filter((rule) => rule.pattern.test(haystack)).map((rule) => rule.value);
  return values.length ? values : ['General AI'];
}

export function inferEntities(title, description = '') {
  const haystack = normalizeTitle(`${title} ${description}`);
  return [...ENTITY_ALIASES.entries()]
    .filter(([, aliases]) => aliases.some((alias) => haystack.includes(normalizeTitle(alias))))
    .map(([entity]) => entity);
}

export function calculateImportance(factors) {
  return Math.round(Object.entries(SCORE_WEIGHTS).reduce((sum, [key, weight]) => sum + clamp(factors[key]) * weight, 0));
}

function buildScoreBreakdown({ source, haystack, category, topics, entities, publishedAt, now, watchlist, region }) {
  const ageHours = Math.max(0, (now.getTime() - Date.parse(publishedAt)) / 3_600_000);
  const recency = clamp(100 - (ageHours / MAX_WINDOW_HOURS) * 100);
  const companyHits = entities.filter((entity) => watchlist.companies.some((item) => normalizeTitle(item) === normalizeTitle(entity))).length;
  const topicHits = topics.filter((topic) => watchlist.topics.some((item) => normalizeTitle(topic).includes(normalizeTitle(item)) || normalizeTitle(item).includes(normalizeTitle(topic)))).length;
  const regionHit = watchlist.regions.some((item) => normalizeTitle(region).includes(normalizeTitle(item)) || normalizeTitle(item).includes(normalizeTitle(region)));
  const highImpact = /\$\s?\d|billion|million|regulat|lawsuit|antitrust|acqui|merger|launch|release|pricing|enterprise|government/i.test(haystack);
  return {
    sourceReliability: clamp((SOURCE_BASE[source.type] || 60) + Math.min(4, Math.round((source.priority || 20) / 10))),
    marketImpact: highImpact ? 78 : category === 'Market Pulse' ? 42 : 62,
    companyInfluence: clamp(42 + companyHits * 22),
    novelty: 62,
    audienceBreadth: /consumer|global|enterprise|government|developer|platform/i.test(haystack) ? 76 : 55,
    decisionRelevance: clamp(45 + topicHits * 14 + companyHits * 12 + (regionHit ? 8 : 0)),
    competitiveImpact: clamp(45 + Math.min(2, entities.length) * 16 + (/pricing|launch|release|partner|acqui|model/i.test(haystack) ? 16 : 0)),
    recency,
    crossCheck: source.type === 'official' || source.type === 'government' ? 58 : 30,
    followUpPotential: /preview|plan|will|roadmap|invest|launch|regulat|lawsuit|partnership/i.test(haystack) ? 78 : 55,
  };
}

function isSameEvent(a, b) {
  if (a.canonicalUrl === b.canonicalUrl) return true;
  const hours = Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) / 3_600_000;
  if (hours > 96) return false;
  const tokenScore = eventTokenSimilarity(a.title, b.title);
  const entityScore = overlapRatio(a.entities, b.entities);
  return tokenScore >= 0.55 || (tokenScore >= 0.34 && entityScore >= 0.5);
}

export function eventTokenSimilarity(a, b) {
  const left = new Set(eventTokens(a));
  const right = new Set(eventTokens(b));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
}

function eventSignature(title) {
  return eventTokens(title).sort().join('|') || normalizeTitle(title);
}

function eventTokens(value) {
  return normalizeTitle(value).split(' ').filter((token) => token.length > 2 && !STOPWORDS.has(token)).map((token) => TOKEN_ALIASES.get(token) || token.replace(/(?:ing|ed|es|s)$/i, '')).filter(Boolean);
}

function overlapRatio(a = [], b = []) {
  const left = new Set(a.map(normalizeTitle));
  const right = new Set(b.map(normalizeTitle));
  if (!left.size || !right.size) return 0;
  return [...left].filter((value) => right.has(value)).length / Math.min(left.size, right.size);
}

function representativeScore(story) {
  const typeBonus = { government: 30, official: 25, research: 18, news: 10, social: 0 }[story.sourceType] || 0;
  return story.importanceScore + story.sourceReliability * 0.25 + typeBonus + (story.contentStatus === 'full' ? 8 : 0);
}

function applySourceMix(stories) {
  const limits = { official: 24, news: 18, government: 8, research: 8, social: 0 };
  const used = { official: 0, news: 0, government: 0, research: 0, social: 0 };
  return stories.filter((story) => {
    if (used[story.sourceType] >= limits[story.sourceType]) return false;
    used[story.sourceType] += 1;
    return true;
  }).slice(0, 44);
}

export function canonicalizeUrl(input) {
  const url = new URL(input);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|gclid|fbclid|mc_cid|mc_eid|ref$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  url.searchParams.sort();
  return url.toString();
}

export function normalizeTitle(value) {
  return decodeHtmlEntities(String(value || '')).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function cleanText(value) {
  return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

export function containsHangul(value) {
  return /[가-힣]/.test(value || '');
}

function inferRegion(text) {
  if (/korea|korean|seoul|한국|서울/i.test(text)) return 'Korea';
  if (/europe|\beu\b|european|유럽/i.test(text)) return 'European Union';
  if (/japan|china|india|singapore|asia|일본|중국|인도|아시아/i.test(text)) return 'Asia';
  if (/united states|\bu\.s\.\b|america|미국/i.test(text)) return 'United States';
  return 'Global';
}

function storyVerificationLevel(sourceType) {
  if (sourceType === 'research') return 'primary-source';
  if (sourceType === 'official' || sourceType === 'government') return 'official-source';
  return 'single-source';
}

function toImportanceLabel(score) {
  if (score >= 86) return 'Critical';
  if (score >= 72) return 'High';
  if (score >= 55) return 'Medium';
  return 'Low';
}

function trimText(value, max) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function clamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function isString(value, min = 1) {
  return typeof value === 'string' && value.trim().length >= min;
}

function stringArray(value, min = 0) {
  return Array.isArray(value) && value.length >= min && value.every((item) => typeof item === 'string');
}
