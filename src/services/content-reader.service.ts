import { logger } from '../logger';

/**
 * ContentReaderService
 *
 * Lets Lucid read things Matt shares in the Room:
 * - Web pages: fetched via Tavily's extract API when TAVILY_API_KEY is set
 *   (much cleaner text), with a direct-fetch + tag-strip fallback.
 * - YouTube videos: metadata + caption transcript scraped from the watch
 *   page (no YouTube API key needed). "Watching" a video means reading its
 *   transcript — good enough to genuinely discuss the content.
 *
 * No new dependencies: uses Node's global fetch.
 */

const FETCH_TIMEOUT_MS = 20000;
const MAX_PAGE_CHARS = 12000;
const MAX_TRANSCRIPT_CHARS = 14000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export class ContentReaderService {
  private tavilyApiKey: string | null;
  private youtubeApiKey: string | null;

  constructor(options?: { tavilyApiKey?: string; youtubeApiKey?: string }) {
    this.tavilyApiKey = options?.tavilyApiKey || process.env.TAVILY_API_KEY || null;
    this.youtubeApiKey = options?.youtubeApiKey || process.env.YOUTUBE_API_KEY || null;
  }

  /**
   * Fetch with a hard timeout so a hung site can't stall the chat turn.
   */
  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Basic guard: only plain http(s) URLs to public-looking hosts.
   * Blocks localhost and obvious private-range IP literals so the tool can't
   * be pointed at internal services.
   */
  private validateUrl(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(`Not a valid URL: ${rawUrl}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only http(s) URLs can be read.');
    }
    const host = url.hostname.toLowerCase();
    const isPrivateIp =
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host) ||
      host === '0.0.0.0' ||
      host === '::1';
    if (host === 'localhost' || host.endsWith('.local') || isPrivateIp) {
      throw new Error('That address points at a private/internal host and cannot be read.');
    }
    return url;
  }

  /**
   * Crude but dependency-free HTML → text conversion.
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();
  }

  private extractHtmlTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? this.htmlToText(match[1]).slice(0, 300) : null;
  }

  /**
   * Read a web page and return its text content.
   */
  async readWebpage(rawUrl: string): Promise<{
    url: string;
    title: string | null;
    content: string;
    truncated: boolean;
    source: 'tavily_extract' | 'direct_fetch';
  }> {
    const url = this.validateUrl(rawUrl);

    // Preferred path: Tavily extract returns clean article text.
    if (this.tavilyApiKey) {
      try {
        const response = await this.fetchWithTimeout('https://api.tavily.com/extract', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.tavilyApiKey}`,
          },
          body: JSON.stringify({ urls: [url.toString()] }),
        });
        if (response.ok) {
          const data: any = await response.json();
          const extracted = data?.results?.[0]?.raw_content;
          if (extracted && typeof extracted === 'string' && extracted.trim().length > 0) {
            const truncated = extracted.length > MAX_PAGE_CHARS;
            return {
              url: url.toString(),
              title: null,
              content: truncated ? extracted.slice(0, MAX_PAGE_CHARS) + '...' : extracted,
              truncated,
              source: 'tavily_extract',
            };
          }
        } else {
          logger.warn('Tavily extract returned non-OK status, falling back to direct fetch', {
            status: response.status,
          });
        }
      } catch (error: any) {
        logger.warn('Tavily extract failed, falling back to direct fetch', {
          url: url.toString(),
          error: error.message,
        });
      }
    }

    // Fallback: fetch the page directly and strip tags.
    const response = await this.fetchWithTimeout(url.toString(), {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`The site responded with HTTP ${response.status}.`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType || 'unknown'} — only web pages can be read.`);
    }
    const html = await response.text();
    const text = this.htmlToText(html);
    if (!text) {
      throw new Error('The page had no readable text content.');
    }
    const truncated = text.length > MAX_PAGE_CHARS;
    return {
      url: url.toString(),
      title: this.extractHtmlTitle(html),
      content: truncated ? text.slice(0, MAX_PAGE_CHARS) + '...' : text,
      truncated,
      source: 'direct_fetch',
    };
  }

  /**
   * Pull the 11-char video ID out of any of the usual YouTube URL shapes,
   * or accept a bare ID.
   */
  extractVideoId(input: string): string | null {
    const trimmed = input.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    try {
      const url = new URL(trimmed);
      const host = url.hostname.replace(/^www\.|^m\./, '');
      if (host === 'youtu.be') {
        const id = url.pathname.slice(1).split('/')[0];
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
      }
      if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        const v = url.searchParams.get('v');
        if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
        const pathMatch = url.pathname.match(/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
        if (pathMatch) return pathMatch[2];
      }
    } catch {
      // not a URL — fall through
    }
    return null;
  }

  /**
   * Extract the ytInitialPlayerResponse JSON object from a watch-page HTML
   * blob using brace matching (a bare regex can't balance nested braces).
   */
  private extractPlayerResponse(html: string): any | null {
    const marker = 'ytInitialPlayerResponse';
    const idx = html.indexOf(marker);
    if (idx === -1) return null;
    const braceStart = html.indexOf('{', idx);
    if (braceStart === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = braceStart; i < html.length; i++) {
      const ch = html[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(braceStart, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  /**
   * Fetch a player response from YouTube's Innertube API using the Android
   * client. This is the same approach transcript libraries use — it's far more
   * reliable than scraping the watch page, which often serves a consent/bot
   * wall (empty player data) to datacenter IPs. The API key below is the
   * public web key embedded in every YouTube page, not a secret.
   */
  private async fetchInnertubePlayerResponse(videoId: string): Promise<any | null> {
    try {
      const response = await this.fetchWithTimeout(
        'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'ANDROID',
                clientVersion: '20.10.38',
                androidSdkVersion: 30,
                hl: 'en',
              },
            },
            videoId,
          }),
        }
      );
      if (!response.ok) {
        logger.warn('Innertube player request failed', { videoId, status: response.status });
        return null;
      }
      const data: any = await response.json();
      // Only trust a response that actually carries video details.
      return data?.videoDetails?.videoId ? data : null;
    } catch (error: any) {
      logger.warn('Innertube player request errored', { videoId, error: error.message });
      return null;
    }
  }

  /**
   * Parse an ISO 8601 duration (e.g. "PT1H2M30S") into seconds.
   */
  private parseIsoDuration(iso: string): number | null {
    const match = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!match) return null;
    const [, d, h, m, s] = match;
    return (
      (parseInt(d || '0', 10) * 86400) +
      (parseInt(h || '0', 10) * 3600) +
      (parseInt(m || '0', 10) * 60) +
      parseInt(s || '0', 10)
    );
  }

  /**
   * Fetch video metadata from the official YouTube Data API v3.
   * This is the most reliable source (never bot-walled), but it can't return
   * transcripts — those still come from the caption-track scrape.
   */
  private async fetchYoutubeDataApi(videoId: string): Promise<{
    title: string;
    author: string | null;
    lengthSeconds: number | null;
    viewCount: number | null;
    description: string | null;
  } | null> {
    if (!this.youtubeApiKey) return null;
    try {
      const url =
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics` +
        `&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(this.youtubeApiKey)}`;
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        logger.warn('YouTube Data API request failed', { videoId, status: response.status });
        return null;
      }
      const data: any = await response.json();
      const item = data?.items?.[0];
      if (!item) return null;
      return {
        title: item.snippet?.title || null,
        author: item.snippet?.channelTitle || null,
        lengthSeconds: item.contentDetails?.duration
          ? this.parseIsoDuration(item.contentDetails.duration)
          : null,
        viewCount: item.statistics?.viewCount ? parseInt(item.statistics.viewCount, 10) : null,
        description: item.snippet?.description
          ? String(item.snippet.description).slice(0, 2000)
          : null,
      };
    } catch (error: any) {
      logger.warn('YouTube Data API request errored', { videoId, error: error.message });
      return null;
    }
  }

  /**
   * Fetch minimal metadata (title/channel) from YouTube's public oEmbed
   * endpoint — the one YouTube surface that is essentially never blocked.
   */
  private async fetchYoutubeOembed(videoId: string): Promise<any | null> {
    try {
      const response = await this.fetchWithTimeout(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
      );
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * "Watch" a YouTube video: fetch its metadata and caption transcript.
   */
  async watchYoutubeVideo(urlOrId: string): Promise<{
    videoId: string;
    title: string | null;
    author: string | null;
    lengthSeconds: number | null;
    viewCount: number | null;
    description: string | null;
    transcript: string | null;
    transcriptTruncated: boolean;
    note?: string;
  }> {
    const videoId = this.extractVideoId(urlOrId);
    if (!videoId) {
      throw new Error(`Couldn't find a YouTube video ID in "${urlOrId}".`);
    }

    // Metadata: the official Data API (when YOUTUBE_API_KEY is set) is the
    // most reliable source — it is never bot-walled. The transcript can only
    // come from the caption tracks in a player response (Innertube API or
    // watch-page scrape), and YouTube aggressively bot-walls datacenter IPs
    // on those paths, so the transcript is best-effort. If everything is
    // blocked, oEmbed still salvages the title and channel.
    const apiMeta = await this.fetchYoutubeDataApi(videoId);

    let player = await this.fetchInnertubePlayerResponse(videoId);
    let htmlTitle: string | null = null;
    if (!player) {
      try {
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
        const response = await this.fetchWithTimeout(watchUrl, {
          headers: {
            'User-Agent': BROWSER_UA,
            'Accept-Language': 'en-US,en;q=0.9',
            Accept: 'text/html',
          },
        });
        if (response.ok) {
          const html = await response.text();
          htmlTitle = this.extractHtmlTitle(html);
          player = this.extractPlayerResponse(html);
        }
      } catch (error: any) {
        logger.warn('YouTube watch-page fetch failed', { videoId, error: error.message });
      }
    }

    const details = player?.videoDetails || {};
    if (!apiMeta && !details.videoId && !details.title) {
      // Last resort: oEmbed gives us at least the title and channel.
      const oembed = await this.fetchYoutubeOembed(videoId);
      if (oembed) {
        return {
          videoId,
          title: oembed.title || htmlTitle,
          author: oembed.author_name || null,
          lengthSeconds: null,
          viewCount: null,
          description: null,
          transcript: null,
          transcriptTruncated: false,
          note: 'YouTube blocked automated access to the full video data, so only the title and channel are available — no transcript or description. Be upfront about this, and offer to web_search the video title if Matt wants to dig into its content.',
        };
      }
      throw new Error('YouTube returned no video details — the video may be private, removed, or access was blocked.');
    }
    const result = {
      videoId,
      title: apiMeta?.title || details.title || htmlTitle,
      author: apiMeta?.author || details.author || null,
      lengthSeconds:
        apiMeta?.lengthSeconds ??
        (details.lengthSeconds ? parseInt(details.lengthSeconds, 10) : null),
      viewCount:
        apiMeta?.viewCount ??
        (details.viewCount ? parseInt(details.viewCount, 10) : null),
      description:
        apiMeta?.description ||
        (details.shortDescription ? String(details.shortDescription).slice(0, 2000) : null),
      transcript: null as string | null,
      transcriptTruncated: false,
      note: undefined as string | undefined,
    };

    const tracks: any[] =
      player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (tracks.length === 0) {
      result.note = player
        ? 'No captions are available for this video, so there is no transcript — only the metadata and description above. Be upfront that you could not get the full content.'
        : 'YouTube blocked access to the caption data from this server, so there is no transcript — only the metadata and description above. Be upfront about that, and offer to web_search the video if Matt wants to go deeper on its content.';
      return result;
    }

    // Prefer English (manual over auto-generated), otherwise take the first track.
    const track =
      tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
      tracks.find((t) => t.languageCode?.startsWith('en')) ||
      tracks[0];

    try {
      const transcriptResponse = await this.fetchWithTimeout(`${track.baseUrl}&fmt=json3`, {
        headers: { 'User-Agent': BROWSER_UA },
      });
      if (!transcriptResponse.ok) {
        throw new Error(`transcript fetch returned HTTP ${transcriptResponse.status}`);
      }
      // Depending on the client that produced baseUrl, YouTube returns either
      // json3 (events/segs) or the legacy timedtext XML — handle both.
      const raw = await transcriptResponse.text();
      let text: string;
      try {
        const data: any = JSON.parse(raw);
        text = (data.events || [])
          .flatMap((e: any) => (e.segs || []).map((s: any) => s.utf8 || ''))
          .join('');
      } catch {
        text = Array.from(raw.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g))
          .map((m) => this.htmlToText(m[1]))
          .join(' ');
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (text) {
        result.transcriptTruncated = text.length > MAX_TRANSCRIPT_CHARS;
        result.transcript = result.transcriptTruncated
          ? text.slice(0, MAX_TRANSCRIPT_CHARS) + '...'
          : text;
        if (track.kind === 'asr') {
          result.note = 'Transcript is from auto-generated captions — expect occasional transcription errors.';
        }
      } else {
        result.note = 'The caption track was empty; only metadata is available.';
      }
    } catch (error: any) {
      logger.warn('Failed to fetch YouTube transcript', { videoId, error: error.message });
      result.note = `Captions exist but the transcript could not be fetched (${error.message}); only metadata is available.`;
    }

    return result;
  }
}
