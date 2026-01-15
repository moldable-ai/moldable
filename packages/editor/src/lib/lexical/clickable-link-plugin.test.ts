import { isUrlSafe } from './clickable-link-plugin'
import { describe, expect, it } from 'vitest'

describe('ClickableLinkPlugin', () => {
  describe('isUrlSafe function', () => {
    const safeUrls = [
      'https://example.com',
      'http://test.org',
      'mailto:user@example.com',
      'https://medical-center.org/patient-portal',
      'http://localhost:3000',
      'https://pubmed.ncbi.nlm.nih.gov/12345678/',
      'mailto:doctor@medical-center.org',
      'http://www.cdc.gov/guidelines',
      'https://telemedicine.provider.net/room/123',
    ]

    const unsafeUrls = [
      'file:///etc/passwd',
      'javascript:alert("xss")',
      'data:text/html,<script>alert("xss")</script>',
      'vbscript:msgbox("xss")',
      'ftp://example.com/file.txt',
      'custom-protocol://malicious-action',
      'invalid-url',
      '',
      'about:blank',
      'chrome://settings',
    ]

    safeUrls.forEach((url) => {
      it(`should allow safe URL: ${url}`, () => {
        expect(isUrlSafe(url)).toBe(true)
      })
    })

    unsafeUrls.forEach((url) => {
      it(`should block unsafe URL: ${url}`, () => {
        expect(isUrlSafe(url)).toBe(false)
      })
    })
  })

  describe('URL Protocol Security', () => {
    it('should only allow http, https, and mailto protocols', () => {
      const testCases = [
        { url: 'https://example.com', expected: true, protocol: 'https:' },
        { url: 'http://example.com', expected: true, protocol: 'http:' },
        { url: 'mailto:test@example.com', expected: true, protocol: 'mailto:' },
        { url: 'file://path/to/file', expected: false, protocol: 'file:' },
        { url: 'javascript:void(0)', expected: false, protocol: 'javascript:' },
        { url: 'data:text/plain,hello', expected: false, protocol: 'data:' },
        { url: 'ftp://server.com', expected: false, protocol: 'ftp:' },
      ]

      testCases.forEach(({ url, expected, protocol }) => {
        expect(isUrlSafe(url)).toBe(expected)

        if (expected) {
          expect(['http:', 'https:', 'mailto:']).toContain(protocol)
        }
      })
    })

    it('should handle malformed URLs gracefully', () => {
      // These should be false
      expect(isUrlSafe('not-a-url')).toBe(false)
      expect(isUrlSafe('://missing-protocol')).toBe(false)

      // This URL is actually valid according to URL constructor
      // 'http:///missing-host' gets parsed as 'http://missing-host/'
      expect(isUrlSafe('http:///missing-host')).toBe(true)

      // These are invalid according to URL constructor
      expect(isUrlSafe('http://')).toBe(false)
      expect(isUrlSafe('https://')).toBe(false)

      // This is actually valid according to URL constructor and has mailto: protocol
      expect(isUrlSafe('mailto:')).toBe(true)
    })
  })

  describe('URL Validation', () => {
    it('should allow common URLs', () => {
      const commonUrls = [
        'https://pubmed.ncbi.nlm.nih.gov/articles/PMC123456/',
        'https://www.cdc.gov/coronavirus/2019-ncov/',
        'https://www.who.int/health-topics/',
        'https://clinicaltrials.gov/study/NCT12345678',
        'mailto:patient.portal@hospital.org',
      ]

      commonUrls.forEach((url) => {
        expect(isUrlSafe(url)).toBe(true)
      })
    })

    it('should block dangerous URLs', () => {
      const dangerousUrls = [
        'javascript:alert("fake")',
        'file:///Users/patient/records.pdf',
        'data:text/html,<h1>Fake Portal</h1>',
        'ftp://server.com/data/',
      ]

      dangerousUrls.forEach((url) => {
        expect(isUrlSafe(url)).toBe(false)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle URLs with various TLDs', () => {
      const urlsWithTlds = [
        'https://example.com',
        'https://example.org',
        'https://example.co.uk',
        'https://example.gov',
        'https://example.edu',
        'http://localhost:3000',
        'https://subdomain.example.museum',
      ]

      urlsWithTlds.forEach((url) => {
        expect(isUrlSafe(url)).toBe(true)
      })
    })

    it('should handle URLs with query parameters and fragments', () => {
      const complexUrls = [
        'https://example.com/search?q=research&type=article',
        'https://portal.example.org/login?redirect=/dashboard#overview',
        'mailto:user@example.org?subject=Follow-up',
        'https://api.service.com/v1/items?id=123&include=notes',
      ]

      complexUrls.forEach((url) => {
        expect(isUrlSafe(url)).toBe(true)
      })
    })

    it('should handle international domains', () => {
      const internationalUrls = [
        'https://例え.テスト', // Japanese
        'https://пример.рф', // Russian
        'https://مثال.إختبار', // Arabic
        'https://xn--e1afmkfd.xn--p1ai', // Punycode
      ]

      internationalUrls.forEach((url) => {
        expect(isUrlSafe(url)).toBe(true)
      })
    })
  })

  describe('Performance', () => {
    it('should validate URLs quickly for large batches', () => {
      const urls: string[] = []
      for (let i = 0; i < 1000; i++) {
        urls.push(`https://example${i}.com`)
        urls.push(`mailto:user${i}@example.com`)
        urls.push(`javascript:alert(${i})`) // Should be blocked
      }

      const startTime = Date.now()

      const results = urls.map((url) => isUrlSafe(url))

      const duration = Date.now() - startTime

      // Should process 3000 URLs in less than 500ms
      expect(duration).toBeLessThan(500)

      // Verify correct validation
      const validCount = results.filter(Boolean).length
      expect(validCount).toBe(2000) // Only https and mailto URLs should be valid
    })
  })
})
