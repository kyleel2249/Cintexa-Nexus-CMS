# Competitor intelligence

Competitors are discovered from the audited site, kept with their evidence, reviewed by a person, and measured with the existing passive benchmark audit.

## Flow
1. A primary audit finishes. If a search API is configured and `autoDiscoverCompetitors` is on, discovery starts in the background. It can also be started from the Competitors tab at any time.
2. The audited pages' titles and descriptions become a site profile (brand words removed). Up to four search queries are derived from it. With too little text, discovery stops and says why.
3. Search hits are reduced to registrable domains. The site itself is dropped, and so are social networks, search engines, video platforms, code hosts and hosting platforms. Marketplaces, directories and publishers are kept only as *search competitors*.
4. For each candidate the home page is fetched through the SSRF-guarded transport after checking robots.txt. Only the title, description, H1 and language are read, as text.
5. Confidence = weighted search overlap (40%), content similarity (35%), geography (10%) and evidence quality (15%). Components that could not be measured are left out and listed; caps apply (unverified AI suggestion 0.40, unfetched page 0.55, no content similarity 0.60).
6. Classification: direct, indirect, search, aspirational (person only), reference. The reason is stored with the record.
7. A rerun merges by canonical domain. Anything a person set (status, classification, name, industry) is kept, and rejected candidates stay rejected.
8. The default comparison set is approved competitors first, then up to ten best-supported pending direct/indirect candidates (`maxDiscover` 20 and `maxCompare` 10 are defaults, adjustable per run).

## Benchmarks
`buildBenchmarkReport` compares your category scores with the median of *comparable* benchmark audits only: same scoring version, a real score, at least 50% test coverage. Excluded sites are listed with the reason. A difference under 3 points is "level". Fewer than three comparable sites gives low confidence and an explicit "not an industry average" caveat. The 80-point "Very good" target is shown separately from the competitor difference.

## Security
SSRF protection and DNS pinning come from the existing transport; discovery adds no new network path. Crawled text is never executed or interpreted as instructions, and is rendered as text. Every route is owner-scoped (404 for others, admins may read). Starting discovery is single-flight per site; manual adds are capped at 100 per site.
