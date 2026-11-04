#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从用户的科研绘图 PPTX 中提取全部配色，生成 py/scifig/palettes.json。

来源（多路合并）：
  1. 主题 clrScheme（dk/lt/accent1-6/hlink/folHlink）
  2. 幻灯片/形状/GradFill 的 solidFill 颜色统计
  3. 原生图表（ppt/charts）系列配色顺序
  4. **PPT 内嵌图片（ppt/media）的配色聚类** —— 这份 PPT 的图基本是粘贴的图片，
     所以这一路才是"全部配色"的主体：每张图量化出主色，跨图去重合并，按出现频次排序。

用法：
    python scripts/extract_palettes.py "reference-deck.pptx" \
        --out py/scifig/palettes.json --preview out/_selftest/palettes_preview.png
"""
import argparse
import colorsys
import io
import json
import os
import re
import sys
import zipfile
from collections import Counter, OrderedDict
from xml.etree import ElementTree as ET

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'c': 'http://schemas.openxmlformats.org/drawingml/2006/chart',
}

THEME_SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']

# ---------- 颜色工具 ----------


def hex2rgb(h):
    h = h.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb2hex(rgb):
    return '#%02X%02X%02X' % tuple(max(0, min(255, int(round(c)))) for c in rgb)


def rgb2hls(rgb):
    return colorsys.rgb_to_hls(*[c / 255.0 for c in rgb])


def hls2rgb(h, l, s):
    r, g, b = colorsys.hls_to_rgb(h, max(0.0, min(1.0, l)), max(0.0, min(1.0, s)))
    return (r * 255, g * 255, b * 255)


def apply_lum(rgb, lum_mod=None, lum_off=None, tint=None, shade=None):
    h, l, s = rgb2hls(rgb)
    if lum_mod is not None:
        l = max(0.0, min(1.0, l * lum_mod))
    if lum_off is not None:
        l = max(0.0, min(1.0, l + lum_off))
    if tint is not None:
        l = l + (1 - l) * tint
    if shade is not None:
        l = l * shade
    return hls2rgb(h, l, s)


def lum(hex_color):
    r, g, b = [v / 255.0 for v in hex2rgb(hex_color)]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def sat(hex_color):
    h, l, s = rgb2hls(hex2rgb(hex_color))
    return s, l


def is_vivid(hex_color, min_sat=0.16):
    s, l = sat(hex_color)
    return s >= min_sat and 0.10 < l < 0.94


def dist(c1, c2):
    a = hex2rgb(c1)
    b = hex2rgb(c2)
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def dedupe_keep_order(colors):
    seen, out = set(), []
    for c in colors:
        u = c.upper()
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def palette_distance(p1, p2):
    """平均最小色距（对称），用于跨图去重。"""
    a = p1 if len(p1) <= len(p2) else p2
    b = p2 if len(p1) <= len(p2) else p1
    total = 0.0
    for c in a:
        total += min(dist(c, d) for d in b)
    return total / max(1, len(a))


# ---------- PPT XML 解析 ----------


def parse_color_el(el, theme_cur):
    tag = el.tag.split('}')[-1]
    if tag == 'srgbClr':
        base = el.get('val', '')
        if not re.fullmatch(r'[0-9A-Fa-f]{6}', base or ''):
            return None
        rgb = hex2rgb(base)
    elif tag == 'schemeClr':
        key = el.get('val', '')
        if key not in theme_cur:
            return None
        rgb = hex2rgb(theme_cur[key])
    else:
        return None
    lum_mod = lum_off = tint = shade = None
    for child in el:
        ctag = child.tag.split('}')[-1]
        try:
            val = float(child.get('val', '0')) / 100000.0
        except (TypeError, ValueError):
            continue
        if ctag == 'lumMod':
            lum_mod = val
        elif ctag == 'lumOff':
            lum_off = val
        elif ctag == 'tint':
            tint = val
        elif ctag == 'shade':
            shade = val
    return rgb2hex(apply_lum(rgb, lum_mod, lum_off, tint, shade))


def parse_theme(xml_bytes):
    root = ET.fromstring(xml_bytes)
    scheme = root.find('.//a:clrScheme', NS)
    out = OrderedDict()
    if scheme is None:
        return out
    for slot in THEME_SLOTS:
        node = scheme.find('a:%s' % slot, NS)
        if node is None:
            continue
        children = list(node)
        if not children:
            continue
        color = parse_color_el(children[0], {})
        if color:
            out[slot] = color
    return out


def collect_fills(xml_bytes, theme_cur, counter):
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return
    for tag_name in ('solidFill', 'gradFill'):
        for fill in root.iter('{%s}%s' % (NS['a'], tag_name)):
            for color_el in fill:
                if color_el.tag.split('}')[-1] not in ('srgbClr', 'schemeClr'):
                    continue
                color = parse_color_el(color_el, theme_cur)
                if color:
                    counter[color] += 1


def collect_chart_series(xml_bytes, theme_cur):
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []
    series_colors = []
    for ser in root.iter('{%s}ser' % NS['c']):
        color = None
        for sp in ser.iter('{%s}spPr' % NS['c']):
            for fill_tag in ('solidFill', 'gradFill'):
                for fill in sp.findall('{%s}%s' % (NS['a'], fill_tag)):
                    for color_el in fill:
                        if color_el.tag.split('}')[-1] in ('srgbClr', 'schemeClr'):
                            color = parse_color_el(color_el, theme_cur)
                            if color:
                                break
                    if color:
                        break
                if color:
                    break
            if color:
                break
        if color:
            series_colors.append(color)
    return series_colors


# ---------- 图片配色 ----------


def image_palette(data, max_colors=6, max_side=300):
    """从一张图里提取"系列色"：去掉白/黑/灰与占据面积过大的底色，按面积取鲜艳主色。"""
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    im = im.convert('RGB')
    im.thumbnail((max_side, max_side))
    q = im.quantize(colors=32, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette() or []
    counts = q.getcolors() or []
    total = sum(c for c, _ in counts) or 1

    entries = []
    for cnt, idx in counts:
        r, g, b = pal[idx * 3:idx * 3 + 3]
        hexc = rgb2hex((r, g, b))
        share = cnt / total
        s, l = sat(hexc)
        if l > 0.95 or l < 0.07:
            continue
        if s < 0.08:
            continue
        entries.append((share, hexc, s, l))

    # 第一轮：明确鲜艳、且不是大面积底色（地图底色/幻灯片背景）
    vivid = [(sh, c) for sh, c, s, l in entries if s >= 0.22 and 0.10 <= sh <= 0.70]
    if len(vivid) < 3:
        vivid = [(sh, c) for sh, c, s, l in entries if s >= 0.12 and 0.02 <= sh <= 0.85]
    if len(vivid) < 3:
        vivid = [(sh, c) for sh, c, s, l in entries if s >= 0.06]
    vivid.sort(key=lambda e: -e[0])
    colors = dedupe_keep_order([c for _, c in vivid])
    return colors[:max_colors]


# ---------- 派生渐变 ----------


def make_sequential(hex_color, n=7):
    h, l, s = rgb2hls(hex2rgb(hex_color))
    s = max(s, 0.25)
    return [rgb2hex(hls2rgb(h, 0.94 - 0.80 * (i / (n - 1)), s)) for i in range(n)]


def make_diverging(hex_color, n=9):
    h, l, s = rgb2hls(hex2rgb(hex_color))
    s = max(s, 0.25)
    cool_h = (h + 0.5) % 1.0
    steps = []
    for i in range(n):
        t = (i / (n - 1)) * 2 - 1
        if abs(t) < 0.06:
            rgb = hls2rgb(h, 0.96, 0.06)
        elif t < 0:
            rgb = hls2rgb(h, 0.34 + 0.56 * (1 + t), s * 0.85)
        else:
            rgb = hls2rgb(cool_h, 0.34 + 0.56 * (1 - t), s * 0.6)
        steps.append(rgb2hex(rgb))
    return steps


# ---------- 主流程 ----------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pptx')
    ap.add_argument('--out', default=os.path.join('py', 'scifig', 'palettes.json'))
    ap.add_argument('--preview', default=None)
    ap.add_argument('--max-palettes', type=int, default=42)
    ap.add_argument('--max-images', type=int, default=0, help='0=全部')
    ap.add_argument('--image-palettes', type=int, default=24)
    args = ap.parse_args()

    path = os.path.abspath(args.pptx)
    if not os.path.exists(path):
        print(json.dumps({'ok': False, 'error': 'pptx 不存在：%s' % path}, ensure_ascii=False))
        return 2

    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()

        # 1) 主题
        themes = []
        for tn in sorted(n for n in names if re.match(r'ppt/theme/theme\d*\.xml$', n)):
            theme = parse_theme(zf.read(tn))
            if theme:
                themes.append((tn, theme))
        default_theme = themes[0][1] if themes else {}

        # 2) 幻灯片填充色
        slide_counter = Counter()
        for sn in sorted(n for n in names if re.match(r'ppt/slides/slide\d+\.xml$', n)):
            collect_fills(zf.read(sn), default_theme, slide_counter)
        slide_total = sum(slide_counter.values())

        # 3) 原生图表
        chart_palettes = []
        for cn in sorted(n for n in names if re.match(r'ppt/charts/chart\d*\.xml$', n)):
            series = collect_chart_series(zf.read(cn), default_theme)
            if len(series) >= 2:
                chart_palettes.append({'part': cn.split('/')[-1], 'colors': dedupe_keep_order(series)[:10]})

        # 4) 内嵌图片配色（主力）
        media = [n for n in names if re.match(r'ppt/media/.+\.(png|jpe?g)$', n, re.I)]
        media.sort(key=lambda n: -zf.getinfo(n).file_size)  # 大图（真正的图）优先
        if args.max_images and args.max_images > 0:
            media = media[:args.max_images]
        image_palettes = []
        for mn in media:
            try:
                colors = image_palette(zf.read(mn))
            except Exception:
                continue
            if len(colors) >= 2:
                image_palettes.append({'part': mn.split('/')[-1], 'colors': colors})

    # 跨图合并相似配色，并统计出现次数
    merged = []
    for item in image_palettes:
        best = None
        best_d = 1e9
        for group in merged:
            d = palette_distance(item['colors'], group['colors'])
            if d < best_d:
                best, best_d = group, d
        if best is not None and best_d < 52:
            best['count'] += 1
            best['parts'].append(item['part'])
            # 用更长/更丰富的一次更新颜色顺序
            if len(item['colors']) > len(best['colors']):
                best['colors'] = item['colors']
        else:
            merged.append({'colors': item['colors'], 'count': 1, 'parts': [item['part']]})
    merged.sort(key=lambda g: (-g['count'], -len(g['colors'])))

    palettes = []
    used = set()

    def add(name, kind, colors, source):
        colors = dedupe_keep_order([c.upper() for c in colors if c])
        if len(colors) < 2:
            return False
        key = tuple(colors)
        if key in used:
            return False
        if len(palettes) >= args.max_palettes:
            return False
        used.add(key)
        palettes.append({
            'id': 'ppt-%02d' % (len(palettes) + 1),
            'name': name,
            'kind': kind,
            'colors': colors,
            'source': source,
        })
        return True

    # 4a) 图片配色（按出现频次）
    for i, group in enumerate(merged[:args.image_palettes]):
        if add('%s 配色' % '·'.join(group['colors'][:2]), 'categorical', group['colors'],
               '内嵌图片 %s' % '、'.join(group['parts'][:4])):
            palettes[-1]['usage'] = {
                'figures': group['count'],
                'note': '参考 PPT 中有 %d 张图使用这套配色' % group['count'],
            }

    # 3a) 原生图表系列
    for i, cp in enumerate(sorted(chart_palettes, key=lambda c: -len(c['colors']))):
        add('PPT 图表系列 %02d' % (i + 1), 'categorical', cp['colors'], '图表 %s 系列顺序' % cp['part'])

    # 1a) 主题强调色
    for ti, (tn, theme) in enumerate(themes):
        accents = [theme.get('accent%d' % k) for k in range(1, 7)]
        accents = [a for a in accents if a]
        if len(accents) >= 3:
            add('PPT 主题强调色 %02d' % (ti + 1), 'categorical', accents, tn)

    # 2a) 全篇形状填充高频色
    vivid_shape = [c for c, _ in slide_counter.most_common() if is_vivid(c)]
    if len(vivid_shape) >= 4:
        add('PPT 形状/色块高频配色', 'categorical', vivid_shape[:10],
            '全篇 solidFill 统计（共 %d 次）' % slide_total)

    # 5) 由主色派生顺序 / 发散配色
    anchors = []
    for pal in list(palettes):
        if pal['kind'] != 'categorical':
            continue
        for color in pal['colors']:
            s, l = sat(color)
            if s >= 0.3:
                anchors.append(color)
    seen_hue = set()
    for color in anchors:
        h, l, s = rgb2hls(hex2rgb(color))
        family = int(((rgb2hls(hex2rgb(color))[0] * 360.0) % 360) // 30)
        if family in seen_hue:
            continue
        seen_hue.add(family)
        add('派生顺序色带 %s' % color.upper(), 'sequential', make_sequential(color),
            '由 %s 派生（单色渐深，可用于连续填色/热力图）' % color.upper())
        add('派生发散色带 %s' % color.upper(), 'diverging', make_diverging(color),
            '由 %s 派生（冷暖发散，可用于距平/正负值）' % color.upper())

    # 6) 名称改为「颜色描述」，不再出现 PPT 编号（用户要求：名字里要能看出颜色）
    HUE_WORDS = [(12, '红'), (35, '橙'), (55, '金'), (75, '黄绿'), (105, '绿'), (140, '青绿'),
                 (170, '青'), (200, '天蓝'), (225, '蓝'), (255, '蓝紫'), (285, '紫'),
                 (315, '品红'), (345, '玫红'), (361, '红')]

    def color_word(hex_color):
        r, g, b = [v / 255.0 for v in hex2rgb(hex_color)]
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        if s < 0.16:
            return '灰'
        deg = h * 360.0
        base = '红'
        for limit, name in HUE_WORDS:
            if deg < limit:
                base = name
                break
        if l >= 0.80:
            return '浅' + base
        if l <= 0.30:
            return '深' + base
        return base

    def base_word(hex_color):
        word = color_word(hex_color)
        return word[1:] if word[:1] in ('浅', '深') else word

    def describe(pal):
        colors = pal['colors']
        kind = pal['kind']
        if kind == 'sequential':
            mid = colors[len(colors) // 2]
            return '%s渐变（%d 级）' % (base_word(mid), len(colors))
        if kind == 'diverging':
            return '%s与%s发散（%d 级）' % (base_word(colors[0]), base_word(colors[-1]), len(colors))
        # 分类色：按鲜艳度排序取前 3 个色系，去重；灰系放最后
        scored = []
        for order, color in enumerate(colors):
            s, l = sat(color)
            word = base_word(color)
            scored.append((word, s, order))
        scored.sort(key=lambda t: (-(t[1]), t[2]))
        words = []
        for word, s, order in scored:
            if word not in words:
                words.append(word)
        words = words[:3]
        return ' · '.join(words) + '（%d 色）' % len(colors)

    used_names = {}
    for pal in palettes:
        base = describe(pal)
        n = used_names.get(base, 0) + 1
        used_names[base] = n
        pal['_base'] = base
        pal['name'] = base if n == 1 else '%s %s' % (base, '②③④⑤⑥⑦⑧⑨'[min(n - 2, 7)])
        pal['colorsText'] = ' '.join(pal['colors'])
        pal.pop('kindLabel', None)

    # 顺序/发散渐变若有同名（同一色系重复派生），只保留第一套；并重新编号，保证 id 稳定连续
    filtered = []
    seen_ramp = set()
    for pal in palettes:
        base = pal.get('_base') or pal['name']
        if pal['kind'] in ('sequential', 'diverging'):
            if base in seen_ramp:
                continue
            seen_ramp.add(base)
        filtered.append(pal)
    palettes = filtered
    for i, pal in enumerate(palettes):
        pal['id'] = 'ppt-%02d' % (i + 1)

    data = {
        'version': 1,
        'source': os.path.basename(path),
        'sourcePath': path,
        'generatedBy': 'scripts/extract_palettes.py',
        'counts': {
            'themes': len(themes),
            'slides': len([n for n in names if re.match(r'ppt/slides/slide\d+\.xml$', n)]),
            'charts': len(chart_palettes),
            'media': len(media),
            'image_palettes': len(image_palettes),
            'merged_groups': len(merged),
            'palettes': len(palettes),
        },
        'palettes': palettes,
    }

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)

    if args.preview:
        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            from matplotlib.patches import Rectangle
            plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'DejaVu Sans']
            plt.rcParams['axes.unicode_minus'] = False
            rows = len(palettes)
            max_cols = max(len(p['colors']) for p in palettes)
            fig, ax = plt.subplots(figsize=(min(18, 4.6 + max_cols * 0.3), min(30, 0.34 * rows + 1.1)), dpi=160)
            ax.set_xlim(0, 1)
            ax.set_ylim(0, rows)
            ax.axis('off')
            for idx, pal in enumerate(palettes):
                y = rows - idx - 1
                tag = {'categorical': '分类', 'sequential': '顺序', 'diverging': '发散'}.get(pal['kind'], '')
                ax.text(0.004, y + 0.62, '%s [%s] %s' % (pal['id'], tag, pal['name']), fontsize=6.2, va='center')
                for j, color in enumerate(pal['colors']):
                    ax.add_patch(Rectangle((0.34 + j * 0.048, y + 0.18), 0.045, 0.62,
                                           facecolor=color, edgecolor='white', linewidth=0.5))
                ax.text(0.34, y + 0.05, ' '.join(c.upper() for c in pal['colors']), fontsize=4.4, color='#555')
            os.makedirs(os.path.dirname(os.path.abspath(args.preview)), exist_ok=True)
            fig.savefig(args.preview, bbox_inches='tight', facecolor='white')
            plt.close(fig)
        except Exception as exc:
            print('preview failed: %s' % exc, file=sys.stderr)

    print(json.dumps({'ok': True, 'out': out_path, **data['counts']}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
