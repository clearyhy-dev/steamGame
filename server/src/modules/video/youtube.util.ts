/** Extract YouTube video id from common URL formats */
export function extractYoutubeVideoId(url: string): string | null {
  const u = url.trim();
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{6,})/,
    /[?&]v=([a-zA-Z0-9_-]{6,})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/,
  ];
  for (const p of patterns) {
    const m = u.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}
