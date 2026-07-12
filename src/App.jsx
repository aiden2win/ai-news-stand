import { useMemo, useState } from 'react';
import digest from './data/live-intelligence.json';
import {
  getCategoryTone,
  getImportanceTone,
  getUniqueValues,
  humanizeSourceType,
  sortStories,
  toDisplayDate,
  toRelativeTime,
} from './lib/intelligence';

const SORT_OPTIONS = [
  { value: 'importance', label: '중요도 순' },
  { value: 'latest', label: '최신 순' },
  { value: 'source', label: '출처 순' },
];

const IMPORTANCE_OPTIONS = ['All', 'Critical', 'High', 'Medium', 'Low'];

export default function App() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [topic, setTopic] = useState('All');
  const [sourceType, setSourceType] = useState('All');
  const [importance, setImportance] = useState('All');
  const [sortBy, setSortBy] = useState('importance');

  const categories = useMemo(() => ['All', ...getUniqueValues(digest.stories, 'category')], []);
  const topics = useMemo(
    () => ['All', ...new Set(digest.stories.flatMap((story) => story.topics).slice().sort())],
    []
  );

  const filteredStories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return sortStories(
      digest.stories.filter((story) => {
        const matchesQuery =
          !normalizedQuery ||
          [
            story.title,
            story.summary,
            story.publisher,
            story.category,
            story.entities.join(' '),
            story.topics.join(' '),
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedQuery);

        const matchesCategory = category === 'All' || story.category === category;
        const matchesTopic = topic === 'All' || story.topics.includes(topic);
        const matchesSourceType = sourceType === 'All' || story.sourceType === sourceType;
        const matchesImportance = importance === 'All' || story.importance === importance;

        return (
          matchesQuery &&
          matchesCategory &&
          matchesTopic &&
          matchesSourceType &&
          matchesImportance
        );
      }),
      sortBy
    );
  }, [category, importance, query, sortBy, sourceType, topic]);

  const leadStories = filteredStories.slice(0, 3);
  const feedStories = filteredStories.slice(3);

  return (
    <div className="newsstand-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">AI News Stand</p>
          <h1>매일 아침 보는 AI 뉴스 스탠드</h1>
          <p className="masthead-copy">
            인터넷 기사, 공식 블로그, 커뮤니티형 소스를 한데 모아 비즈니스 관점에서 다시
            읽기 좋게 정리한 독립형 AI 뉴스 웹사이트.
          </p>
        </div>
        <div className="masthead-meta">
          <div className="meta-pill">
            <span>업데이트</span>
            <strong>{toDisplayDate(digest.generatedAt)}</strong>
          </div>
          <div className="meta-pill">
            <span>기사 수</span>
            <strong>{digest.stats.totalStories}</strong>
          </div>
          <div className="meta-pill">
            <span>소스 수</span>
            <strong>{digest.stats.totalSources}</strong>
          </div>
          <div className="meta-pill">
            <span>LLM 요약</span>
            <strong>{digest.automation.llmApplied ? 'ON' : 'OFF'}</strong>
          </div>
        </div>
      </header>

      <main className="layout-grid">
        <section className="hero-panel">
          <div className="hero-brief">
            <div className="section-kicker">Today at a glance</div>
            <h2>{digest.brief.headline}</h2>
            <p>{digest.brief.summary}</p>
            <p className="editor-note">{digest.brief.editorNote}</p>
            <div className="brief-tags">
              {digest.brief.topThemes.map((theme) => (
                <span key={theme} className="brief-chip">
                  {theme}
                </span>
              ))}
            </div>
          </div>

          <div className="brief-sidecards">
            <article className="brief-card">
              <span className="brief-card-label">Must watch</span>
              <ul>
                {digest.brief.mustWatch.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="brief-card">
              <span className="brief-card-label">Coverage mix</span>
              <div className="metric-stack">
                <div>
                  <strong>{digest.stats.newsStories}</strong>
                  <span>Web / news</span>
                </div>
                <div>
                  <strong>{digest.stats.socialStories}</strong>
                  <span>Social / community</span>
                </div>
                <div>
                  <strong>{digest.stats.criticalCount}</strong>
                  <span>Critical items</span>
                </div>
              </div>
            </article>
          </div>
        </section>

        <aside className="control-panel">
          <div className="section-kicker">Filters</div>
          <label className="field">
            <span>검색</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="회사명, 키워드, 기사 제목"
            />
          </label>

          <div className="field">
            <span>카테고리</span>
            <div className="pill-grid">
              {categories.map((option) => (
                <FilterPill
                  key={option}
                  active={category === option}
                  onClick={() => setCategory(option)}
                  label={option}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <span>토픽</span>
            <div className="pill-grid">
              {topics.map((option) => (
                <FilterPill
                  key={option}
                  active={topic === option}
                  onClick={() => setTopic(option)}
                  label={option}
                />
              ))}
            </div>
          </div>

          <div className="select-row">
            <label className="field">
              <span>소스 유형</span>
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                <option value="All">전체</option>
                <option value="news">Web / News</option>
                <option value="social">Social / Community</option>
                <option value="official">Official / Blog</option>
              </select>
            </label>

            <label className="field">
              <span>중요도</span>
              <select value={importance} onChange={(event) => setImportance(event.target.value)}>
                {IMPORTANCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === 'All' ? '전체' : option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>정렬</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            className="reset-button"
            onClick={() => {
              setQuery('');
              setCategory('All');
              setTopic('All');
              setSourceType('All');
              setImportance('All');
              setSortBy('importance');
            }}
          >
            필터 초기화
          </button>
        </aside>

        <section className="lead-grid">
          {leadStories.map((story, index) => (
            <article
              key={story.id}
              className={`lead-story ${index === 0 ? 'lead-story--primary' : ''}`}
            >
              <StoryMeta story={story} />
              <h3>{story.title}</h3>
              <p>{story.summary}</p>
              <div className="insight-box">
                <strong>Why it matters</strong>
                <p>{story.whyItMatters}</p>
              </div>
              <div className="story-footer">
                <span>{story.publisher}</span>
                <a href={story.url} target="_blank" rel="noreferrer">
                  원문 보기
                </a>
              </div>
            </article>
          ))}
        </section>

        <section className="feed-panel">
          <div className="panel-header">
            <div>
              <div className="section-kicker">Live feed</div>
              <h2>오늘 전체 뉴스</h2>
            </div>
            <span className="result-count">{filteredStories.length} stories</span>
          </div>

          <div className="story-list">
            {feedStories.map((story) => (
              <article key={story.id} className="story-card">
                <div className="story-main">
                  <StoryMeta story={story} />
                  <h3>{story.title}</h3>
                  <p>{story.summary}</p>
                  <div className="insight-box">
                    <strong>Why it matters</strong>
                    <p>{story.whyItMatters}</p>
                  </div>
                  <div className="watchlist-box">
                    <strong>Watch next</strong>
                    <p>{story.watchlist}</p>
                  </div>
                  <div className="topic-row">
                    {story.topics.map((item) => (
                      <span key={item} className="topic-chip">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="story-side">
                  <dl>
                    <div>
                      <dt>출처</dt>
                      <dd>{story.publisher}</dd>
                    </div>
                    <div>
                      <dt>게시</dt>
                      <dd>{toRelativeTime(story.publishedAt)}</dd>
                    </div>
                    <div>
                      <dt>유형</dt>
                      <dd>{humanizeSourceType(story.sourceType)}</dd>
                    </div>
                    <div>
                      <dt>중요도</dt>
                      <dd>{story.importance}</dd>
                    </div>
                  </dl>
                  <a href={story.url} target="_blank" rel="noreferrer" className="source-link">
                    원문 + 출처
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="rail">
          <section className="rail-card">
            <div className="section-kicker">Automation</div>
            <div className="source-list">
              <div className="source-item">
                <div>
                  <strong>Refresh cadence</strong>
                  <span>{digest.automation.refreshCadence}</span>
                </div>
                <span>Daily</span>
              </div>
              <div className="source-item">
                <div>
                  <strong>Build</strong>
                  <span>{digest.automation.buildCommand}</span>
                </div>
                <span>{digest.automation.llmApplied ? 'LLM' : 'Heuristic'}</span>
              </div>
            </div>
          </section>

          <section className="rail-card">
            <div className="section-kicker">Top categories</div>
            <div className="bar-list">
              {digest.facets.categories.map((item) => (
                <div key={item.value} className="bar-row">
                  <span>{item.value}</span>
                  <div className="bar-track">
                    <div style={{ width: `${item.share}%` }} />
                  </div>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rail-card">
            <div className="section-kicker">Entity radar</div>
            <div className="entity-list">
              {digest.facets.entities.map((entity) => (
                <div key={entity.value} className="entity-item">
                  <span>{entity.value}</span>
                  <strong>{entity.count}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rail-card">
            <div className="section-kicker">Source coverage</div>
            <div className="source-list">
              {digest.sources.map((source) => (
                <div key={source.id} className="source-item">
                  <div>
                    <strong>{source.label}</strong>
                    <span>{humanizeSourceType(source.type)}</span>
                  </div>
                  <span>{source.storyCount}건</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function FilterPill({ active, label, onClick }) {
  return (
    <button className={active ? 'filter-pill is-active' : 'filter-pill'} onClick={onClick}>
      {label}
    </button>
  );
}

function StoryMeta({ story }) {
  const categoryTone = getCategoryTone(story.category);
  const importanceTone = getImportanceTone(story.importance);

  return (
    <div className="story-meta">
      <span className={`tone-pill ${importanceTone}`}>{story.importance}</span>
      <span className={`tone-pill ${categoryTone}`}>{story.category}</span>
      <span className="story-date">{toDisplayDate(story.publishedAt)}</span>
    </div>
  );
}
