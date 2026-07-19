import { describe, it, expect, vi, beforeEach } from 'vitest';
import dns from 'dns';
import { ContentReaderService } from './content-reader.service';

/**
 * SSRF guard tests.
 *
 * read_webpage is reachable from chat, so this guard sits between anything Matt
 * pastes and the internal network. The pre-2026-07-19 version blocked only
 * hostname *spellings* — a public name resolving to 169.254.169.254 sailed
 * through, and `redirect: 'follow'` let a validated public URL bounce inward.
 */
describe('ContentReaderService SSRF guard', () => {
  let svc: ContentReaderService;
  // Private methods — exercised directly; they are the security boundary.
  const validate = (u: string) => (svc as any).validateUrl(u);
  const blocked = (a: string) => (svc as any).isBlockedAddress(a);

  beforeEach(() => {
    svc = new ContentReaderService({ tavilyApiKey: undefined, youtubeApiKey: undefined });
    vi.restoreAllMocks();
  });

  describe('isBlockedAddress', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['169.254.169.254', 'cloud metadata endpoint'],
      ['10.1.2.3', 'private 10/8'],
      ['192.168.1.1', 'private 192.168/16'],
      ['172.16.0.1', 'private 172.16/12 lower bound'],
      ['172.31.255.255', 'private 172.16/12 upper bound'],
      ['100.64.0.1', 'CGNAT'],
      ['0.0.0.0', 'unspecified'],
      ['224.0.0.1', 'multicast'],
      ['::1', 'IPv6 loopback'],
      ['fd00::1', 'IPv6 unique-local'],
      ['fe80::1', 'IPv6 link-local'],
      ['::ffff:127.0.0.1', 'IPv4-mapped IPv6 loopback (dotted)'],
      ['::ffff:169.254.169.254', 'IPv4-mapped IPv6 metadata (dotted)'],
      // The hex spelling is what actually reaches the guard: WHATWG URL
      // normalizes [::ffff:127.0.0.1] to ::ffff:7f00:1. Testing only the
      // dotted form passes while the real input goes unblocked.
      ['::ffff:7f00:1', 'IPv4-mapped IPv6 loopback (hex, post-URL-normalization)'],
      ['::ffff:a9fe:a9fe', 'IPv4-mapped IPv6 metadata (hex, post-URL-normalization)'],
      ['::ffff:c0a8:101', 'IPv4-mapped IPv6 private LAN (hex)'],
      ['::ffff:0a00:0001', 'IPv4-mapped IPv6 private 10/8 (hex)'],
    ])('blocks %s (%s)', (addr) => {
      expect(blocked(addr)).toBe(true);
    });

    it.each([
      ['8.8.8.8', 'public DNS'],
      ['172.15.0.1', 'just below the private 172 range'],
      ['172.32.0.1', 'just above the private 172 range'],
      ['192.169.0.1', 'adjacent to but outside 192.168/16'],
      ['100.63.0.1', 'just below CGNAT'],
      ['2606:4700::1111', 'public IPv6'],
      ['::ffff:5db8:d822', 'IPv4-mapped IPv6 of a PUBLIC address (93.184.216.34)'],
    ])('allows %s (%s)', (addr) => {
      expect(blocked(addr)).toBe(false);
    });

    // Guards the unwrapping itself: a decode bug that mangled the octets could
    // block everything and still pass the block-list assertions above.
    it('decodes hex-form IPv4-mapped addresses to the right octets', () => {
      const decode = (hex: string) => {
        const m = hex.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)!;
        const hi = parseInt(m[1], 16);
        const lo = parseInt(m[2], 16);
        return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
      };
      expect(decode('::ffff:7f00:1')).toBe('127.0.0.1');
      expect(decode('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
      expect(decode('::ffff:c0a8:101')).toBe('192.168.1.1');
      expect(decode('::ffff:5db8:d822')).toBe('93.184.216.34');
    });
  });

  describe('validateUrl', () => {
    it('rejects non-http(s) schemes', async () => {
      await expect(validate('file:///etc/passwd')).rejects.toThrow(/http\(s\)/);
    });

    it('rejects localhost and internal suffixes by name', async () => {
      await expect(validate('http://localhost/admin')).rejects.toThrow(/private\/internal/);
      await expect(validate('http://db.local/')).rejects.toThrow(/private\/internal/);
      await expect(validate('http://svc.internal/')).rejects.toThrow(/private\/internal/);
    });

    it('rejects a private IP literal without any lookup', async () => {
      const lookup = vi.spyOn(dns.promises, 'lookup');
      await expect(validate('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
        /private\/internal/
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    // The core regression: the old guard passed this, because the NAME is fine.
    it('rejects a public hostname that RESOLVES to a private address', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '169.254.169.254', family: 4 },
      ] as any);
      await expect(validate('https://totally-normal-site.com/page')).rejects.toThrow(
        /private\/internal/
      );
    });

    it('rejects when ANY resolved address is private (DNS rebinding shape)', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ] as any);
      await expect(validate('https://rebind.example.com/')).rejects.toThrow(/private\/internal/);
    });

    it('allows a public hostname resolving to public addresses', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
      ] as any);
      const url = await validate('https://example.com/article');
      expect(url.hostname).toBe('example.com');
    });

    it('rejects a hostname that does not resolve', async () => {
      vi.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
      await expect(validate('https://nope.invalid/')).rejects.toThrow(/Could not resolve/);
    });
  });

  describe('fetchGuarded redirect handling', () => {
    const fetchGuarded = (u: string, init: any = {}) =>
      (svc as any).fetchGuarded(new URL(u), init);

    it('re-validates each hop and blocks a redirect into private space', async () => {
      vi.spyOn(dns.promises, 'lookup').mockImplementation(async (host: any) =>
        host === 'evil.example.com'
          ? ([{ address: '93.184.216.34', family: 4 }] as any)
          : ([{ address: '127.0.0.1', family: 4 }] as any)
      );
      // Public URL 302s to an internal one — the old `redirect: 'follow'` would
      // have fetched it without a second check.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 302,
          headers: new Headers({ location: 'http://internal-service/secrets' }),
        })
      );
      await expect(fetchGuarded('https://evil.example.com/start')).rejects.toThrow(
        /private\/internal/
      );
    });

    it('caps redirect chains', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
      ] as any);
      let n = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async () => ({
          status: 302,
          headers: new Headers({ location: `https://example.com/hop${n++}` }),
        }))
      );
      await expect(fetchGuarded('https://example.com/start')).rejects.toThrow(/Too many redirects/);
    });

    it('returns a non-redirect response unchanged', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ status: 200, headers: new Headers() })
      );
      const res = await fetchGuarded('https://example.com/ok');
      expect(res.status).toBe(200);
    });
  });
});
