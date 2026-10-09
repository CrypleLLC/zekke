import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_APP = os.path.join(HERE, '..', '..')
OUT = os.path.join(WEB_APP, 'src', 'lib', 'spreadsheets', 'function-names')
ENGINE = os.path.join(WEB_APP, 'node_modules', '@univerjs', 'engine-formula', 'lib', 'es', 'index.js')
LANGS = {'pt-br': 'pt-BR', 'pt-pt': 'pt-PT', 'es-es': 'es', 'fr-fr': 'fr', 'de-de': 'de', 'it-it': 'it'}


def implemented():
    source = open(ENGINE, encoding='utf8').read()
    names = set()
    for block in re.findall(r'const function[A-Z][A-Za-z]* = \[(.*?)\n\];', source, re.S):
        names.update(re.findall(r'\[\s*[A-Za-z0-9_$]+,\s*"([A-Z][A-Z0-9_.]+)"\s*\]', block))
    return names


def resolve(entries, english_articles, local_articles):
    names, provenance, flags = {}, {}, []
    for href, wanted in entries.items():
        english_article, local_article = english_articles.get(href), local_articles.get(href)
        if not english_article or not local_article:
            flags += [{'name': n, 'href': href, 'why': 'article missing'} for n in wanted]
            continue
        english, local = english_article['syntax'], local_article['syntax']
        english_all, local_all = english_article['article'], local_article['article']
        foreign = [t for t in local_all if t not in set(english_all)]
        for name in wanted:
            base = name[:-1] if name.endswith('B') and name[:-1] in wanted else None
            if name in english and english.index(name) < len(local) and len(english) == len(local):
                names[name], provenance[name] = local[english.index(name)], 'syntax'
            elif base is not None:
                continue
            elif english[:1] == [name] and local:
                names[name], provenance[name] = local[0], 'first name of the syntax line'
            elif name in english_all and len(english_all) == len(local_all):
                names[name], provenance[name] = local_all[english_all.index(name)], 'article order'
                flags.append({'name': name, 'href': href, 'why': 'taken from the article order', 'chosen': names[name], 'local': local_all[:8]})
                continue
            elif english_all[:1] == [name] and local_all:
                names[name], provenance[name] = local_all[0], 'first name in the article'
                flags.append({'name': name, 'href': href, 'why': 'first name in the article', 'chosen': names[name], 'local': local_all[:8]})
                continue
            else:
                flags.append({'name': name, 'href': href, 'why': 'unresolved', 'local syntax': local[:8], 'local article': local_all[:8]})
                continue
            if names[name] == name and foreign:
                flags.append({'name': name, 'href': href, 'why': 'syntax kept the English name', 'chosen': name, 'other names in the article': foreign[:8]})
    return names, provenance, flags


def elsewhere(name, english_articles, local_articles):
    found = {}
    for href, english_article in english_articles.items():
        local_article = local_articles.get(href)
        if not local_article:
            continue
        for kind in ('syntax', 'article'):
            english, local = english_article[kind], local_article[kind]
            if name in english and len(english) == len(local):
                found.setdefault(local[english.index(name)], []).append(href)
    return found


def complete_names(entries, english_articles, local_articles, names, provenance, flags):
    resolved_elsewhere = set()
    for href, wanted in entries.items():
        for name in wanted:
            if name in names or (name.endswith('B') and name[:-1] in wanted):
                continue
            found = elsewhere(name, english_articles, local_articles)
            if len(found) == 1:
                local, where = next(iter(found.items()))
                names[name], provenance[name] = local, f'named in {len(where)} other article(s)'
                resolved_elsewhere.add(name)
                flags.append({'name': name, 'href': href, 'why': 'named in other articles', 'chosen': local, 'articles': where[:4]})
    for href, wanted in entries.items():
        for name in wanted:
            base = name[:-1] if name.endswith('B') and name[:-1] in wanted else None
            if base is not None and base in names and name not in names:
                names[name], provenance[name] = names[base] + 'B', 'base name plus B'
    return [f for f in flags if not (f['why'] == 'unresolved' and f['name'] in names)]


def confirm(entries, english_articles, local_articles, names, provenance):
    flags = []
    translations = set(names.values())
    for href, wanted in entries.items():
        english_article, local_article = english_articles.get(href), local_articles.get(href)
        if not english_article or not local_article or not local_article.get('formulas'):
            continue
        english_formulas = set(english_article.get('formulas', []))
        for name in wanted:
            chosen = names.get(name)
            if chosen is None or chosen in local_article['formulas'] or name not in english_formulas:
                continue
            alternatives = [t for t in local_article['formulas'] if t not in english_formulas and t not in translations]
            if not alternatives:
                continue
            flags.append({'name': name, 'href': href, 'why': 'the examples use another name', 'chosen': chosen, 'examples': local_article['formulas'][:10], 'unexplained': alternatives[:6]})
    return flags


def english_kept(entries, english_articles, local_articles, names, overrides):
    flags = []
    for href, wanted in entries.items():
        for name in wanted:
            if names.get(name) != name or name in overrides:
                continue
            found = {local: where for local, where in elsewhere(name, english_articles, local_articles).items() if local != name}
            if found:
                flags.append({'name': name, 'href': href, 'why': 'kept in English, but other articles name it', 'chosen': name, 'elsewhere': {local: where[:3] for local, where in found.items()}})
    return flags


INDEX_NAME = re.compile(r'[A-ZÀ-ÞŒ][A-ZÀ-ÞŒ0-9_]*(?:\.[A-ZÀ-ÞŒ0-9_]+)*')


def index_disagreements(entries, index, table, overrides):
    flags = []
    for href, wanted in entries.items():
        label = index.get(href)
        if label is None or len(wanted) != 1:
            continue
        name = wanted[0]
        local = table.get(name)
        if local is None or name in overrides or not INDEX_NAME.fullmatch(label) or label == name or label == local:
            continue
        flags.append({'name': name, 'href': href, 'why': 'the localized index names it differently', 'chosen': local, 'index': label})
    return flags


def english_parts(name):
    parts = [part for part in name.split('.') if len(part) >= 3]
    if name.startswith('IS') and len(name) > 4:
        parts.append(name[2:].split('.')[0])
    return parts


def hybrids(table, overrides):
    found = []
    for name, local in table.items():
        if local == name or name in overrides:
            continue
        parts = [part for part in name.split('.') if len(part) >= 3]
        fragment = local in parts
        stem = name[2:].split('.')[0] if name.startswith('IS') and len(name) > 4 else None
        if fragment or (stem is not None and stem in local):
            found.append({'name': name, 'why': 'a fragment of the English name' if fragment else 'keeps the English stem', 'chosen': local})
    return found


def main():
    data = json.load(open(os.path.join(HERE, 'names.json'), encoding='utf8'))
    entries, articles = data['entries'], data['articles']
    documented = {n for names in entries.values() for n in names}
    wanted = sorted(implemented() & documented)
    report = {}
    for source, language in LANGS.items():
        names, provenance, flags = resolve(entries, articles['en-us'], articles[source])
        flags = complete_names(entries, articles['en-us'], articles[source], names, provenance, flags)
        flags += confirm(entries, articles['en-us'], articles[source], names, provenance)
        path = os.path.join(HERE, 'overrides', f'{source}.json')
        overrides = json.load(open(path, encoding='utf8')) if os.path.exists(path) else {}
        for name, decision in overrides.items():
            names[name], provenance[name] = decision['name'], 'reviewed: ' + decision['why']
        table = {name: names[name] for name in wanted if name in names}
        missing = [name for name in wanted if name not in table]
        clashes = {}
        for name, local in table.items():
            clashes.setdefault(local.upper(), []).append(name)
        clashes = {local: canon for local, canon in clashes.items() if len(canon) > 1}
        open_flags = [f for f in flags if f['name'] in set(wanted) and f['name'] not in overrides]
        open_flags += [f for f in hybrids(table, overrides) if f['name'] not in {g['name'] for g in open_flags}]
        open_flags += [f for f in english_kept(entries, articles['en-us'], articles[source], names, overrides) if f['name'] in set(wanted) and f['name'] not in {g['name'] for g in open_flags}]
        open_flags += [f for f in index_disagreements(entries, data.get('indexes', {}).get(source, {}), table, overrides) if f['name'] not in {g['name'] for g in open_flags}]
        kept = sorted(name for name, local in table.items() if local == name)
        complete = not missing and not clashes and not open_flags
        report[language] = {'kept in English': kept, 'resolved': len(table), 'wanted': len(wanted), 'missing': missing, 'clashes': clashes, 'open flags': open_flags, 'complete': complete}
        if complete:
            json.dump(table, open(os.path.join(OUT, f'{language}.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1, sort_keys=True)
            json.dump(provenance, open(os.path.join(HERE, 'provenance', f'{language}.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1, sort_keys=True)
        print(f"{language}: {len(table)}/{len(wanted)}, {len(missing)} missing, {len(clashes)} clashes, {len(open_flags)} open flags{' — written' if complete else ''}")
    json.dump(sorted(implemented() - documented), open(os.path.join(HERE, 'not-excel.json'), 'w'), indent=1)
    json.dump(report, open(os.path.join(HERE, 'report.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)


main()
