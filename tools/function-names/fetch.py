import html, os, re, sys, time, urllib.error, urllib.request

CACHE = sys.argv[1]
LANGS = ['en-us', 'pt-br', 'pt-pt', 'es-es', 'fr-fr', 'de-de', 'it-it']
INDEX = 'https://support.microsoft.com/en-us/office/excel-functions-alphabetical-b3944572-255d-4efb-bb96-c6d90033e188'
DELAY = 1.5


def key(href):
    return re.sub(r'[^a-z0-9-]+', '_', href.lower()).strip('_')


def get(url):
    wait = 60
    while True:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30) as response:
                return response.read().decode('utf8', 'replace')
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return ''
            print('backing off', error.code, wait, flush=True)
            time.sleep(wait)
            wait = min(wait * 2, 900)
        except Exception as error:
            print('retry', error, flush=True)
            time.sleep(10)


def location(lang, href):
    if href.startswith('functions/'):
        return f'{lang}__{href[len("functions/"):]}', f'https://support.microsoft.com/{lang}/excel/{href}'
    if href.startswith('/en-us/'):
        return f'{lang}__x_{key(href)}', 'https://support.microsoft.com/' + lang + href[len('/en-us'):]
    if href.startswith('get-started/'):
        return f'{lang}__x_{key(href)}', f'https://support.microsoft.com/{lang}/excel/{href}'
    return f'{lang}__x_{key(href)}', f'https://support.microsoft.com/{lang}/excel/functions/{href}'


os.makedirs(CACHE, exist_ok=True)
index_path = os.path.join(CACHE, '..', 'en.html')
if not os.path.exists(index_path):
    open(index_path, 'w', encoding='utf8').write(get(INDEX))
index = open(index_path, encoding='utf8').read()
hrefs = []
for href, label in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', index, re.S):
    names = [n.strip() for n in re.split(r'\s*,\s*|\s+and\s+', html.unescape(re.sub('<[^>]+>', '', label)).strip()) if n.strip()]
    if names and all(re.fullmatch(r'[A-Z][A-Z0-9.]*n?', n) for n in names) and not href.startswith(('#', 'http')):
        href = href.split('#')[0]
        if href not in hrefs:
            hrefs.append(href)
for href in hrefs:
    for lang in LANGS:
        name, url = location(lang, href)
        path = os.path.join(CACHE, name + '.html')
        if not os.path.exists(path):
            open(path, 'w', encoding='utf8').write(get(url))
            time.sleep(DELAY)
print('done', len(hrefs), 'articles')
