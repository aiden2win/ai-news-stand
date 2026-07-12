export function getUniqueValues(items, key) {
  return [...new Set(items.map((item) => item[key]).filter(Boolean))].sort();
}

export function sortStories(stories, sortBy) {
  const list = [...stories];

  if (sortBy === 'latest') {
    return list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }

  if (sortBy === 'source') {
    return list.sort((a, b) => a.publisher.localeCompare(b.publisher));
  }

  return list.sort((a, b) => {
    if (b.importanceScore !== a.importanceScore) {
      return b.importanceScore - a.importanceScore;
    }
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });
}

export function toDisplayDate(value) {
  return new Date(value).toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toRelativeTime(value) {
  const diffMs = new Date(value).getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));

  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour');
  }

  return formatter.format(Math.round(diffHours / 24), 'day');
}

export function humanizeSourceType(sourceType) {
  if (sourceType === 'official') return 'Official / Blog';
  if (sourceType === 'social') return 'Social / Community';
  return 'Web / News';
}

export function getImportanceTone(importance) {
  if (importance === 'Critical') return 'tone-critical';
  if (importance === 'High') return 'tone-high';
  if (importance === 'Medium') return 'tone-medium';
  return 'tone-low';
}

export function getCategoryTone(category) {
  if (category === 'Model Release' || category === 'Product Update') return 'tone-blue';
  if (category === 'Funding & M&A') return 'tone-orange';
  if (category === 'Regulation & Policy') return 'tone-slate';
  if (category === 'Research & Safety') return 'tone-green';
  return 'tone-neutral';
}
