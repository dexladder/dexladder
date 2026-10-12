"""Resolve extracted English literals for source assertions, never for shipped code."""
import ast, json, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parents[1]
CALL = r'window\.DLI18N\.t\("(?:[^"\\]|\\.)*"\)'
STRING = r'''(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')'''
TOKEN = '(?:' + CALL + '|' + STRING + ')'
EXPRESSION = re.compile(r'\((' + TOKEN + r'(?: \+ ' + TOKEN + r')+)\)')
TOKENS = re.compile(TOKEN)

def english_source(path):
    source = pathlib.Path(path).read_text(encoding='utf-8')
    catalogue_file = ROOT / 'buildlib/i18n/en.json'
    if not catalogue_file.exists():
        return source
    catalogue = json.loads(catalogue_file.read_text())
    def value(token):
        if token.startswith('window.DLI18N.t('):
            return catalogue[json.loads(token[len('window.DLI18N.t('):-1])]
        return ast.literal_eval(token)
    def literal(match):
        text = ''.join(value(token.group()) for token in TOKENS.finditer(match.group(1)))
        return "'" + text.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '\\r') + "'"
    source = EXPRESSION.sub(literal, source)
    return re.sub(CALL, lambda match: json.dumps(value(match.group()), ensure_ascii=False), source)
