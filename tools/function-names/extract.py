import html, json, os, re, sys

CACHE, OUT = sys.argv[1], sys.argv[2]
LANGS = ['en-us', 'pt-br', 'pt-pt', 'es-es', 'fr-fr', 'de-de', 'it-it']
TOKEN = re.compile(r"(?<![A-Za-zÀ-ÿ0-9._])([A-ZÀ-ÞŒ][A-ZÀ-ÞŒ0-9_]*(?:\.[A-ZÀ-ÞŒ0-9_]+)*)\s?\(")
TYPOS = {'BETA.INVn': 'BETA.INV'}


def key(href):
    return re.sub(r'[^a-z0-9-]+', '_', href.lower()).strip('_')


def file_for(lang, href):
    if href.startswith('functions/'):
        return os.path.join(CACHE, f'{lang}__{href[len("functions/"):]}.html')
    return os.path.join(CACHE, f'{lang}__x_{key(href)}.html')


def text(fragment):
    body = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', fragment, flags=re.S)
    return html.unescape(re.sub(r'<[^>]+>', ' ', body)).replace('⁠', '')


def ordered(tokens):
    seen = []
    for token in tokens:
        if token not in seen:
            seen.append(token)
    return seen


def syntax_tokens(source):
    found = []
    for match in re.finditer(r'<h[23] id="syntax[^"]*"[^>]*>(.*?)(?=<h2[ >])', source, re.S):
        found += TOKEN.findall(text(match.group(1)))
    return ordered(found)


def formula_tokens(source):
    found = []
    for chunk in re.split(r'<[^>]+>', re.sub(r'<script.*?</script>|<style.*?</style>', ' ', source, flags=re.S)):
        chunk = html.unescape(chunk).replace('\u2060', '')
        if '=' in chunk:
            found += TOKEN.findall(chunk[chunk.index('='):])
    return ordered(found)


def entries(index):
    out = {}
    for href, label in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', index, re.S):
        if href.startswith('#') or href.startswith('http'):
            continue
        names = [TYPOS.get(n.strip(), n.strip()) for n in re.split(r'\s*,\s*|\s+and\s+', html.unescape(re.sub('<[^>]+>', '', label)).strip()) if n.strip()]
        if not names or not all(re.fullmatch(r'[A-Z][A-Z0-9.]*', n) for n in names):
            continue
        href = href.split('#')[0]
        out.setdefault(href, [])
        out[href] += [n for n in names if n not in out[href]]
    return out


def main():
    index = open(os.path.join(CACHE, '..', 'en.html'), encoding='utf8').read()
    table = entries(index)
    articles = {}
    for lang in LANGS:
        counts, pages = {}, {}
        for href in table:
            path = file_for(lang, href)
            source = open(path, encoding='utf8').read() if os.path.exists(path) else ''
            if not source:
                continue
            occurrences = TOKEN.findall(text(source))
            everything = ordered(occurrences)
            frequency = {token: occurrences.count(token) for token in everything}
            pages[href] = (syntax_tokens(source), everything, formula_tokens(source), frequency)
            for token in set(everything):
                counts[token] = counts.get(token, 0) + 1
        noise = {token for token, count in counts.items() if count > len(pages) * 0.3}
        articles[lang] = {
            href: {
                'syntax': [t for t in syntax if t not in noise],
                'article': [t for t in everything if t not in noise],
                'formulas': [t for t in formulas if t not in noise],
                'counts': {t: c for t, c in frequency.items() if t not in noise},
            }
            for href, (syntax, everything, formulas, frequency) in pages.items()
        }
    indexes = {}
    for lang in LANGS[1:]:
        path = os.path.join(CACHE, f'index-{lang}.html')
        if not os.path.exists(path):
            continue
        source = open(path, encoding='utf8').read()
        indexes[lang] = {
            href.split('#')[0]: html.unescape(re.sub(r'\s+', ' ', re.sub('<[^>]+>', '', label))).strip()
            for href, label in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', source, re.S)
            if href.split('#')[0] in table
        }
    json.dump({'entries': table, 'articles': articles, 'indexes': indexes}, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=0, sort_keys=True)
    print(len(table), 'entries;', {lang: len(v) for lang, v in articles.items()})


main()
