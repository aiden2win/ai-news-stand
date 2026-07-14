import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { analyzeStories, synthesizeBrief } from './news-agent-llm.mjs';
import {
  applyStoryAnalysis,
  cleanText,
  clusterEvents,
  decodeHtmlEntities,
  evaluateDigest,
  normalizeSnapshot,
} from './news-agent-quality.mjs';
import {
  ARTICLE_FETCH_CONCURRENCY,
  getWatchlist,
  MAX_ARTICLE_CHARS,
  MAX_WINDOW_HOURS,
  SOURCE_REGISTRY,
  WATERMARK_OVERLAP_HOURS,
} from './news-agent-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, parseTagValue: true });
const USER_AGENT = 'Mozilla/5.0 (compatible; AvaMarketIntelligence/2.0; +https://ai-signal-intelligence-beta.vercel.app)';

export { SOURCE_REGISTRY, normalizeSnapshot, clusterEvents, evaluateDigest };

export const paths = {
  rawSnapshot: path.resolve(repoRoot, 'data/raw/raw-sources.json'),
  normalizedStories: path.resolve(repoRoot, 'data/processed/normalized-stories.json'),
  rejectedDigest: path.resolve(repoRoot, 'data/processed/rejected-digest.json'),
  state: path.resolve(repoRoot, 'data/state/news-agent-state.json'),
  finalDigest: path.resolve(repoRoot, 'src/data/live-intelligence.json'),
  agentLogDir: path.resolve(repoRoot, 'logs/agent'),
};

export async function runNewsAgent(options = {}) {
  const now = new Date(options.now || Date.now());
  const watchlist = options.watchlist || getWatchlist();
  const state = options.state || await readJson(paths.state, null);
  const windowStartedAt = options.windowStartedAt || determineWindowStart(state, now);
  const rawPath = options.rawPath || paths.rawSnapshot;
  const normalizedPath = options.normalizedPath || paths.normalizedStories;
  const outputPath = options.outputPath || paths.finalDigest;

  const collections = options.snapshot || await fetchSourceSnapshot({ now, fetchImpl: options.fetchImpl });
  await writeJsonAtomic(rawPath, { ...collections, windowStartedAt });

  const normalized = normalizeSnapshot(collections, { now, windowStartedAt, watchlist });
  const enriched = await enrichStoriesWithArticleText(normalized.stories, { fetchImpl: options.fetchImpl });
  const clustered = clusterEvents(enriched).slice(0, 30);
  const normalizedOutput = { ...normalized, stories: clustered, storyCount: clustered.length };
  await writeJsonAtomic(normalizedPath, normalizedOutput);

  if (!clustered.length) throw new Error('Quality gate stopped publication: no publishable stories in the active collection window');

  const storyAnalyzer = options.storyAnalyzer || analyzeStories;
  const briefSynthesizer = options.briefSynthesizer || synthesizeBrief;
  const analysis = await storyAnalyzer(clustered, { watchlist, invoke: options.invokeLlm });
  const analysisById = new Map(analysis.stories.map((item) => [item.id, item]));
  const analyzedStories = clustered.map((story) => {
    const item = analysisById.get(story.id);
    if (!item) throw new Error(`LLM analysis omitted story ${story.id}`);
    return applyStoryAnalysis(story, item);
  }).sort((a, b) => b.importanceScore - a.importanceScore || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const synthesis = await briefSynthesizer(analyzedStories, { invoke: options.invokeLlm });
  const calls = [...analysis.calls, synthesis.call];
  const digest = buildDigest({
    now,
    windowStartedAt,
    stories: analyzedStories,
    collections,
    normalized,
    watchlist,
    brief: synthesis.brief,
    calls,
  });
  const quality = evaluateDigest(digest, {
    requireLlm: options.requireLlm ?? true,
    minStories: options.minStories ?? Number(process.env.INTELLIGENCE_MIN_STORIES || 5),
  });
  digest.automation.qualityGate = quality;

  if (!quality.passed) {
    await writeJsonAtomic(options.rejectedPath || paths.rejectedDigest, digest);
    throw new Error(`Quality gate stopped publication: ${quality.failures.join('; ')}`);
  }

  await writeJsonAtomic(outputPath, digest);
  if (options.persistState !== false) {
    await writeJsonAtomic(options.statePath || paths.state, {
      version: 2,
      lastSuccessfulRunAt: now.toISOString(),
      editionDate: formatKstDate(now),
      windowStartedAt,
      storyIds: analyzedStories.map((story) => story.id),
      sourceSuccess: collections.sources.filter((source) => source.status === 'ok').map((source) => source.id),
    });
  }

  return {
    rawPath,
    normalizedPath,
    outputPath,
    sourceCount: collections.sources.filter((source) => source.status === 'ok').length,
    sourceTotal: collections.sources.length,
    storyCount: analyzedStories.length,
    discoveryCount: normalized.discoveries.length,
    rejectedCount: normalized.rejected.length,
    llmModel: digest.automation.llmModel,
    llmTransport: digest.automation.llmTransport,
    qualityGate: quality,
  };
}

export async function fetchSourceSnapshot(options = {}) {
  const now = new Date(options.now || Date.now());
  const fetchImpl = options.fetchImpl || fetch;
  const sources = await Promise.all(SOURCE_REGISTRY.map(async (source) => {
    try {
      const entries = await fetchFeedWithRetry(source, fetchImpl);
      return {
        ...source,
        status: 'ok',
        error: null,
        fetchedAt: now.toISOString(),
        items: entries
          .map((entry) => ({
            title: decodeHtmlEntities(textOf(entry.title)),
            description: decodeHtmlEntities(cleanText(textOf(entry.description || entry.summary || entry.content || entry['content:encoded']))),
            url: getUrl(entry),
            publishedAt: normalizeDate(entry.pubDate || entry.published || entry.updated || entry.date),
          }))
          .filter((item) => item.title && item.url && item.publishedAt)
          .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
          .slice(0, source.type === 'social' ? 10 : 20),
      };
    } catch (error) {
      return {
        ...source,
        status: 'failed',
        error: sanitizeError(error),
        fetchedAt: now.toISOString(),
        items: [],
      };
    }
  }));

  return { generatedAt: now.toISOString(), sources };
}

export async function enrichStoriesWithArticleText(stories, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const output = new Array(stories.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(ARTICLE_FETCH_CONCURRENCY, stories.length) }, async () => {
    while (cursor < stories.length) {
      const index = cursor;
      cursor += 1;
      const story = stories[index];
      try {
        const article = await fetchArticle(story.url, fetchImpl);
        output[index] = {
          ...story,
          fullText: article.text,
          contentStatus: article.status,
          contentType: article.contentType,
        };
      } catch (error) {
        output[index] = {
          ...story,
          fullText: story.feedSummary,
          contentStatus: 'feed-fallback',
          contentError: sanitizeError(error),
        };
      }
    }
  });
  await Promise.all(workers);
  return output;
}

function buildDigest({ now, windowStartedAt, stories, collections, normalized, watchlist, brief, calls }) {
  const sourceErrors = collections.sources.filter((source) => source.status === 'failed').map((source) => ({ source: source.label, error: source.error }));
  const topThemes = tally(stories.flatMap((story) => story.technologies || story.topics), 6);
  const topEntities = tally(stories.flatMap((story) => story.companies || story.entities), 8);
  const categories = tally(stories.map((story) => story.category), 8, stories.length);
  const llmModels = [...new Set(calls.map((call) => call.model))];
  const llmTransports = [...new Set(calls.map((call) => call.transport))];
  return {
    generatedAt: now.toISOString(),
    collectionWindow: { startedAt: windowStartedAt, cutoffAt: now.toISOString(), maxHours: MAX_WINDOW_HOURS },
    automation: {
      version: 'news-signal-v3',
      llmEnabled: true,
      llmApplied: true,
      llmModel: llmModels.join(', '),
      llmTransport: llmTransports.join(', '),
      llmCalls: calls,
      mode: 'evidence-framed-news-briefing',
      refreshCadence: 'Daily at 07:00 KST via OpenClaw',
      buildCommand: 'npm run agent:run && npm run agent:eval && npm run build',
      qualityGate: null,
    },
    brief: {
      headline: brief.headline,
      summary: brief.summary,
      executiveSummary: brief.summary,
      marketShift: brief.marketShift,
      topThemes: brief.topThemes,
      companyMoves: brief.companyMoves,
      mustWatch: brief.mustWatch,
      editorNote: brief.editorNote,
    },
    stats: {
      totalStories: stories.length,
      totalSources: collections.sources.length,
      successfulSources: collections.sources.length - sourceErrors.length,
      failedSources: sourceErrors.length,
      criticalCount: stories.filter((story) => story.importance === 'Critical').length,
      officialStories: stories.filter((story) => story.sourceType === 'official').length,
      newsStories: stories.filter((story) => story.sourceType === 'news').length,
      governmentStories: stories.filter((story) => story.sourceType === 'government').length,
      researchStories: stories.filter((story) => story.sourceType === 'research').length,
      discoveryStories: normalized.discoveries.length,
      rejectedStories: normalized.rejected.length,
      corroboratedStories: stories.filter((story) => story.crossCheckCount >= 2).length,
      fullTextStories: stories.filter((story) => story.contentStatus === 'full').length,
    },
    facets: { categories, entities: topEntities, topics: topThemes },
    watchlist,
    sources: collections.sources.map((source) => ({
      id: source.id,
      label: source.label,
      type: source.type,
      url: source.url,
      status: source.status,
      error: source.error,
      storyCount: source.items.length,
    })),
    sourceStatuses: collections.sources.map((source) => ({ source: source.label, status: source.status, message: source.error })),
    errors: sourceErrors,
    discoveries: normalized.discoveries,
    rejected: normalized.rejected.map((story) => ({ id: story.id, title: story.title, source: story.publisher, reason: story.rejectionReason })),
    stories,
  };
}

async function fetchFeedWithRetry(source, fetchImpl) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(source.url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/xml,text/xml,application/rss+xml,application/atom+xml' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      const parsed = parser.parse(xml);
      if (source.kind === 'sitemap') return parseSitemapEntries(parsed, source);
      const entries = parsed?.rss?.channel?.item || parsed?.feed?.entry || parsed?.['rdf:RDF']?.item || [];
      return asArray(entries);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw new Error(`${source.label} feed failed: ${lastError?.message || 'unknown error'}`);
}

function parseSitemapEntries(parsed, source) {
  const urls = asArray(parsed?.urlset?.url)
    .filter((entry) => typeof textOf(entry.loc) === 'string' && (!source.includePath || textOf(entry.loc).includes(source.includePath)))
    .map((entry) => {
      const url = textOf(entry.loc);
      return {
        title: titleFromUrl(url),
        description: titleFromUrl(url),
        link: url,
        updated: textOf(entry.lastmod),
      };
    })
    .filter((entry) => entry.updated)
    .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
  return urls;
}

async function fetchArticle(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`article HTTP ${response.status}`);
  const contentType = response.headers?.get?.('content-type') || 'text/html';
  if (!/html|text/i.test(contentType)) throw new Error(`unsupported article content type ${contentType}`);
  const html = await response.text();
  const jsonLdText = extractArticleBodyFromJsonLd(html);
  const articleHtml = firstMatch(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i) || firstMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const metaDescription = firstMatch(html, /<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || firstMatch(html, /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);
  const text = trimArticle(decodeHtmlEntities(cleanText(jsonLdText || articleHtml || metaDescription || '')));
  if (text.length < 160) throw new Error('article body was unavailable or too short');
  return { text, status: 'full', contentType };
}

function extractArticleBodyFromJsonLd(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]);
      const body = findArticleBody(parsed);
      if (body) return body;
    } catch {
      // Invalid JSON-LD is common; fall through to the HTML article element.
    }
  }
  return '';
}

function findArticleBody(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArticleBody(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  if (typeof value.articleBody === 'string') return value.articleBody;
  if (value['@graph']) return findArticleBody(value['@graph']);
  return '';
}

function determineWindowStart(state, now) {
  const hardFloor = new Date(now.getTime() - MAX_WINDOW_HOURS * 3_600_000);
  if (!state?.lastSuccessfulRunAt) return hardFloor.toISOString();
  if (state.editionDate === formatKstDate(now) && state.windowStartedAt) return state.windowStartedAt;
  const overlap = new Date(Date.parse(state.lastSuccessfulRunAt) - WATERMARK_OVERLAP_HOURS * 3_600_000);
  return new Date(Math.max(hardFloor.getTime(), overlap.getTime())).toISOString();
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(temporary, filePath);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function getUrl(entry) {
  if (typeof entry.link === 'string') return entry.link;
  if (entry.link?.['@_href']) return entry.link['@_href'];
  if (Array.isArray(entry.link)) return entry.link.find((item) => item?.['@_rel'] === 'alternate')?.['@_href'] || entry.link.find((item) => item?.['@_href'])?.['@_href'] || null;
  if (entry.guid && typeof entry.guid === 'string' && /^https?:/i.test(entry.guid)) return entry.guid;
  if (entry.id && /^https?:/i.test(textOf(entry.id))) return textOf(entry.id);
  return null;
}

function normalizeDate(value) {
  const date = new Date(textOf(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') return value['#text'] || value.__cdata || value['__cdata'] || '';
  return '';
}

function tally(values, limit, total = values.length) {
  const counts = values.filter(Boolean).reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, count]) => ({ value, count, share: total ? Math.round((count / total) * 100) : 0 }));
}

function firstMatch(value, pattern) {
  return value.match(pattern)?.[1] || '';
}

function trimArticle(value) {
  return value.length > MAX_ARTICLE_CHARS ? `${value.slice(0, MAX_ARTICLE_CHARS - 3).trim()}...` : value;
}

function sanitizeError(error) {
  return String(error?.message || error || 'unknown error').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
}

function asArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function titleFromUrl(value) {
  try {
    const slug = new URL(value).pathname.split('/').filter(Boolean).pop() || 'official update';
    return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return 'Official update';
  }
}

function formatKstDate(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
