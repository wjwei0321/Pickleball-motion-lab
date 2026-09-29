# page.html 是頁面原始檔（Artifact 版，外殼由平台補上）
# 執行 python build.py 產生 index.html（完整 HTML 文件，給本機伺服器或 Vercel 用）
import pathlib
root = pathlib.Path(__file__).parent
body = (root / 'page.html').read_text(encoding='utf-8')
doc = ('<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
       + body.replace('<div class="wrap">', '</head>\n<body>\n<div class="wrap">', 1) + '\n</body>\n</html>\n')
(root / 'index.html').write_text(doc, encoding='utf-8')
print('index.html', len(doc))
