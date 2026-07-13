export const MAX_WINDOW_HOURS = 72;
export const WATERMARK_OVERLAP_HOURS = 6;
export const MAX_ARTICLE_CHARS = 7_000;
export const ARTICLE_FETCH_CONCURRENCY = 5;

export const SOURCE_REGISTRY = [
  { id: 'openai-news', label: 'OpenAI News', type: 'official', priority: 34, url: 'https://openai.com/news/rss.xml' },
  { id: 'anthropic-news', label: 'Anthropic News', type: 'official', priority: 33, kind: 'sitemap', includePath: '/news/', url: 'https://www.anthropic.com/sitemap.xml' },
  { id: 'google-ai-blog', label: 'Google AI Blog', type: 'official', priority: 31, url: 'https://blog.google/technology/ai/rss/' },
  { id: 'microsoft-ai', label: 'Microsoft AI Blog', type: 'official', priority: 31, url: 'https://blogs.microsoft.com/feed/' },
  { id: 'nvidia-blog', label: 'NVIDIA Blog', type: 'official', priority: 30, url: 'https://blogs.nvidia.com/feed/' },
  { id: 'aws-ml', label: 'AWS Machine Learning Blog', type: 'official', priority: 29, url: 'https://aws.amazon.com/blogs/machine-learning/feed/' },
  { id: 'meta-ai', label: 'Meta AI News', type: 'official', priority: 29, url: 'https://about.fb.com/news/tag/ai/feed/' },
  { id: 'huggingface-blog', label: 'Hugging Face Blog', type: 'official', priority: 27, url: 'https://huggingface.co/blog/feed.xml' },
  { id: 'techcrunch-ai', label: 'TechCrunch AI', type: 'news', priority: 28, url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { id: 'the-verge-ai', label: 'The Verge AI', type: 'news', priority: 27, url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { id: 'ftc-press', label: 'U.S. FTC Press Releases', type: 'government', priority: 30, url: 'https://www.ftc.gov/feeds/press-release.xml' },
  { id: 'arxiv-ai', label: 'arXiv cs.AI', type: 'research', priority: 23, url: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending' },
  { id: 'hn-ai', label: 'Hacker News AI', type: 'social', priority: 10, url: 'https://hnrss.org/newest?q=AI' },
  { id: 'devto-ai', label: 'DEV Community AI', type: 'social', priority: 6, url: 'https://dev.to/feed/tag/ai' },
];

export const DEFAULT_WATCHLIST = {
  companies: ['OpenAI', 'Anthropic', 'Google', 'DeepMind', 'Meta', 'Microsoft', 'NVIDIA', 'Apple', 'Amazon', 'xAI', 'Mistral', 'Perplexity', 'Hugging Face'],
  topics: ['agents', 'enterprise', 'coding', 'infrastructure', 'semiconductor', 'regulation', 'funding', 'safety', 'benchmark', 'pricing'],
  regions: ['Korea', 'United States', 'European Union', 'Asia'],
};

export function getWatchlist() {
  if (!process.env.INTELLIGENCE_WATCHLIST) return DEFAULT_WATCHLIST;
  try {
    const parsed = JSON.parse(process.env.INTELLIGENCE_WATCHLIST);
    return {
      companies: cleanList(parsed.companies, DEFAULT_WATCHLIST.companies),
      topics: cleanList(parsed.topics, DEFAULT_WATCHLIST.topics),
      regions: cleanList(parsed.regions, DEFAULT_WATCHLIST.regions),
    };
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

function cleanList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
  return cleaned.length ? cleaned : fallback;
}
