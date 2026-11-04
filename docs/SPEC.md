# SciFigure Studio · SPEC（渲染器字段表与支持范围）

> 本文件由 `py/tools/gen_spec_doc.py` 从 `py/scifig/controls.json`、`py/scifig/presets.json`、`py/scifig/defaults.py` 自动生成（2026-11-03），与渲染器实现同源；手工修改请改生成器。

## 1. 定位与入口

`scifig` 是 SciFigure Studio 的 Python 制图引擎（纯 matplotlib + cartopy，Agg 后端，只输出 PNG）。所有渲染走同一条代码路径：

```bash
python -m scifig.cli render --spec <spec.json> --out <figure.png> [--workdir <dir>] [--thumb <thumb.png>] [--code-out <component.py>]
python -m scifig.cli codegen --spec <spec.json> --out <component.py> [--workdir <dir>]
python -m scifig.cli validate --spec <spec.json>
python -m scifig.cli controls --out <controls.json>
```

stdout 只输出一行 JSON：成功 `{"ok":true,"png":"…","warnings":[],"autoAdjust":[{"key":"centralLongitude","message":"中央经线已对齐研究区中心（85.0°E）"}],"metrics":{…}}`；失败 `{"ok":false,"error":"…"}` 且退出码 2。日志一律 stderr。

- `warnings`：**真风险**（数据缺失、字体缺字、文字溢出/重叠未解决、customPatch 失败、非法控件值回退等），UI 需提示用户。
- `autoAdjust`：**引擎自动优化**（中央经线/纬度对齐、标准纬线自动取值、比例尺缩短/精简、类目标签旋转/缩小、刻度减少、四角底色、经纬网自动间隔、子图标题缩字号等），UI 用灰色 ⓘ 展示即可，不应当成警告。

公共 API（codegen 产物与 CLI 都调用它）：

```python
from scifig.engine import render_spec
render_spec(spec, out_png, *, thumb=None, code_out=None, workdir=None)
```

## 2. spec 结构

- 普通嵌套 JSON 对象；可调参数一律**叶子路径**（点号分隔，不允许数组下标）。
- 契约固定路径：`kind`、`title`、`figure.widthMm`、`figure.heightMm`、`figure.dpi`、`style.preset`、`data.source`、`output.png`。
- `output.png` 非空时优先于 `--out`；相对路径按 `--workdir` 解析。
- `kind`：`map`（地图）、`line`（折线图）、`bar`（柱状图）、`scatter`（散点图）、`heatmap`（热力图）、`box`（箱线图）、`compose`（多子图合成）。
- `customPatch`：字符串 Python 代码，面板绘制完成后执行；globals 提供 `fig`、`axes`、`ax`、`np`、`plt`、`mpl`、`spec`；异常只进 warnings，不影响出图。
- `kind="compose"`：`compose.panels`（或顶层 `panels`）为面板 spec 数组，每个面板只含 `kind/data/map/axes/legend/text/title/customPatch`，样式由合成图统一。

## 3. 可调参数总表（124 项 / 25 组）

★ 表示 UI 默认展开的 basic 参数。`类型` 与 `默认值` 与实现严格一致；`影响` 列说明该参数改动的视觉对象。

### 画幅输出（`figure`，3 项，工具区 `all`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `figure.widthMm` | 数字★ | `180 mm` | 40–400，步长 1 | 单栏期刊常用 89mm，双栏 180mm | 数值/尺寸/间距 |
| `figure.heightMm` | 数字★ | `120 mm` | 30–400，步长 1 | Figure height | 数值/尺寸/间距 |
| `figure.dpi` | 数字★ | `300 dpi` | 72–1200，步长 1 | SCI 印前一般 300 或 600 dpi | 数值/尺寸/间距 |

### 标题与标注（`text`，2 项，工具区 `all`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `title` | 文本★ | `` |  | 总标题；合成图会居中显示 | 文本内容（支持中文与上下标） |
| `text.note` | 文本 | `` |  | Data note | 文本内容（支持中文与上下标） |

### 期刊风格（`style`，1 项，工具区 `all`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `style.preset` | 枚举★ | `sci`（通用 SCI） | sci=通用 SCI, nature=Nature, science=Science, elsevier=Elsevier, ieee=IEEE, geography-cn=地理学报, remote-sensing-cn=遥感学报 | 切换风格统一字体/字号/线宽（用户改过的项不会被覆盖） | 切换 期刊风格 的表现方式 |

### 字体字号（`font`，7 项，工具区 `all`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `style.font.family` | 枚举★ | `Arial`（Arial（无衬线）） | Arial=Arial（无衬线）, Times New Roman=Times New Roman（衬线）, Helvetica=Helvetica, SimSun=宋体, SimHei=黑体, Microsoft YaHei=微软雅黑 | 中文会自动回退到下面的中文字体 | 切换 西文字体 的表现方式 |
| `style.font.cjkFallback` | 枚举 | `SimSun`（宋体） | auto=自动选择, SimSun=宋体, SimHei=黑体, Microsoft YaHei=微软雅黑, KaiTi=楷体, none=不回退 | CJK fallback | 切换 中文字体回退 的表现方式 |
| `style.font.sizeBase` | 数字★ | `8 pt` | 5–16，步长 0.5 | SCI 正文图一般 6–9pt | 数值/尺寸/间距 |
| `style.font.sizeTitle` | 数字★ | `10 pt` | 5–20，步长 0.5 | Title size | 数值/尺寸/间距 |
| `style.font.sizeAxis` | 数字 | `8 pt` | 5–16，步长 0.5 | Axis label size | 数值/尺寸/间距 |
| `style.font.sizeTick` | 数字 | `7 pt` | 4–14，步长 0.5 | Tick label size | 数值/尺寸/间距 |
| `style.font.sizeLegend` | 数字 | `7 pt` | 4–14，步长 0.5 | Legend size | 数值/尺寸/间距 |

### 配色（`palette`，3 项，工具区 `all`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `style.palette` | 枚举★ | `ppt-01`（蓝 · 金 · 橙（6 色）） | ppt-01=蓝 · 金 · 橙（6 色）, ppt-02=天蓝 · 橙（6 色）, ppt-03=玫红 · 蓝紫 · 灰（6 色）, ppt-04=金 · 橙 · 红（6 色）, ppt-05=金 · 橙 · 玫红（6 色）, ppt-06=红 · 青 · 紫（6 色）, ppt-07=金 · 红 · 天蓝（6… | PPT 提取的 18 套分类配色，用于折线/柱/散点/点符号/分级设色 | 切换 分类配色 的表现方式 |
| `style.paletteSequential` | 枚举★ | `ppt-17`（蓝渐变（7 级）） | ppt-17=蓝渐变（7 级）, ppt-19=金渐变（7 级）, ppt-21=橙渐变（7 级）, ppt-23=玫红渐变（7 级）, ppt-25=蓝紫渐变（7 级）, ppt-27=青渐变（7 级）, ppt-29=青绿渐变（7 级）, ppt-31=紫渐变（7 级） | 用于连续填色、热力图、分级设色与色带默认 | 切换 顺序配色 的表现方式 |
| `style.paletteDiverging` | 枚举 | `ppt-18`（蓝与橙发散（9 级）） | ppt-18=蓝与橙发散（9 级）, ppt-20=金与蓝发散（9 级）, ppt-22=橙与蓝发散（9 级）, ppt-24=玫红与青发散（9 级）, ppt-26=蓝紫与黄绿发散（9 级）, ppt-28=青与玫红发散（9 级）, ppt-30=青绿与品红发散（9 级）, ppt-32=紫与绿发散（9 级）,… | 用于正负值/距平/以 0 为中心的热力图 | 切换 发散配色 的表现方式 |

### 线宽与填充（`line`，4 项，工具区 `chart`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `style.line.width` | 数字★ | `1.2 pt` | 0.2–5，步长 0.1 | Line width | 数值/尺寸/间距 |
| `style.line.marker` | 枚举 | `none`（无） | none=无, o=圆点, s=方块, ^=上三角, D=菱形, v=下三角, P=加号, *=星号 | Marker | 切换 数据点标记 的表现方式 |
| `style.line.markerSize` | 数字 | `3.5 pt` | 1–15，步长 0.5 | Marker size | 数值/尺寸/间距 |
| `style.bar.width` | 数字 | `0.7` | 0.1–1，步长 0.05 | Bar width | 数值/尺寸/间距 |

### 轴与边框（`axisStyle`，7 项，工具区 `chart`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `style.axis.lineWidth` | 数字 | `0.8 pt` | 0.2–3，步长 0.1 | Spine width | 数值/尺寸/间距 |
| `style.axis.tickWidth` | 数字 | `0.8 pt` | 0.2–3，步长 0.1 | Tick width | 数值/尺寸/间距 |
| `style.axis.tickLength` | 数字 | `3 pt` | 1–12，步长 0.5 | Tick length | 数值/尺寸/间距 |
| `style.axis.tickDirection` | 枚举★ | `in`（朝内） | in=朝内, out=朝外, inout=双向 | SCI 制图通常朝内 | 切换 刻度朝向 的表现方式 |
| `style.axis.showTop` | 开关 | `false` |  | Show top spine | 开/关「显示上边框」 |
| `style.axis.showRight` | 开关 | `false` |  | Show right spine | 开/关「显示右边框」 |
| `style.axis.grid` | 开关★ | `false` |  | 折线/散点图可开启；地图用经纬网 | 开/关「显示网格」 |

### 地图投影（`mapProjection`，9 项，工具区 `map`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `map.projection` | 枚举★ | `lambert`（兰伯特等角圆锥） | platecarree=等经纬度, mercator=墨卡托, miller=米勒, lambert=兰伯特等角圆锥, albers=阿尔伯斯等积圆锥, robinson=罗宾逊, mollweide=摩尔威特, equalearth=等地球, orthographic=正射, azimuthal=方位等距, n… | 中国区域图推荐兰伯特或阿尔伯斯；世界图用罗宾逊/等地球 | 切换 投影方式 的表现方式 |
| `map.extentPreset` | 枚举★ | `china_neighbors`（中国及周边） | china=中国, china_neighbors=中国及周边, china_full=中国全境(含南海), xinjiang=新疆, central_asia=中亚, asia=亚洲, world=全球, custom=自定义经纬度 | 非 custom 时以预设为准，四个 extent 数值被忽略；custom 才用下面四项 | 切换 范围预设 的表现方式 |
| `map.extentLonMin` | 数字 | `72 °` | -180–360，步长 0.5 | 仅 map.extentPreset=custom 时生效（仅 custom） | 数值/尺寸/间距 |
| `map.extentLonMax` | 数字 | `137 °` | -180–360，步长 0.5 | 仅 map.extentPreset=custom 时生效（仅 custom） | 数值/尺寸/间距 |
| `map.extentLatMin` | 数字 | `16 °` | -90–90，步长 0.5 | 仅 map.extentPreset=custom 时生效（仅 custom） | 数值/尺寸/间距 |
| `map.extentLatMax` | 数字 | `55 °` | -90–90，步长 0.5 | 仅 map.extentPreset=custom 时生效（仅 custom） | 数值/尺寸/间距 |
| `map.centralLongitude` | 数字 | `105 °` | -180–360，步长 1 | 圆锥/方位投影会自动贴合研究区中心（偏差 >10° 时）；显式设置接近值则尊重用户输入 | 数值/尺寸/间距 |
| `map.centralLatitude` | 数字 | `35 °` | -90–90，步长 1 | Lambert/Albers/正射/方位投影的锥顶/球心纬度；偏离研究区 >5–10° 时自动贴合并 warning | 数值/尺寸/间距 |
| `map.standardParallels` | 文本 | `25,47` |  | Lambert/Albers 用，逗号分隔两条标准纬线（如 25,47）；留空或 auto 时按范围自动取值 | 文本内容（支持中文与上下标） |

### 地图要素（`mapLayers`，9 项，工具区 `map`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `map.layers.land` | 开关★ | `true` |  | Land | 开/关「陆地」 |
| `map.layers.ocean` | 开关★ | `true` |  | Ocean | 开/关「海洋」 |
| `map.layers.lakes` | 开关 | `true` |  | Lakes | 开/关「湖泊」 |
| `map.layers.rivers` | 开关 | `false` |  | Rivers | 开/关「河流」 |
| `map.layers.coastline` | 开关 | `true` |  | Coastline | 开/关「海岸线」 |
| `map.layers.countryBorders` | 开关 | `true` |  | Country borders | 开/关「国界线」 |
| `map.layers.chinaBorder` | 开关★ | `true` |  | China border | 开/关「中国国界」 |
| `map.layers.provinceBorders` | 开关 | `false` |  | Province borders | 开/关「省界」 |
| `map.layers.scsInset` | 开关★ | `false` |  | 仅示意，正式出版请核对标准地图 | 开/关「南海诸岛插图」 |

### 地图配色（`mapColors`，4 项，工具区 `map`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `map.colors.land` | 颜色 | `#f2efe9` |  | Land fill | 修改颜色 |
| `map.colors.ocean` | 颜色 | `#e6f0f7` |  | Ocean fill | 修改颜色 |
| `map.colors.border` | 颜色 | `#8c8c8c` |  | Border colour | 修改颜色 |
| `map.colors.chinaBorder` | 颜色 | `#333333` |  | China border colour | 修改颜色 |

### 经纬网（`mapGrid`，6 项，工具区 `map`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `map.grid.show` | 开关★ | `true` |  | Show graticule | 开/关「显示经纬网」 |
| `map.grid.intervalX` | 数字 | `0 °` | 0–60，步长 1 | 0 表示按图幅自动计算 | 数值/尺寸/间距 |
| `map.grid.intervalY` | 数字 | `0 °` | 0–60，步长 1 | 0 表示按图幅自动计算 | 数值/尺寸/间距 |
| `map.grid.labelFormat` | 枚举★ | `degree`（度（75°E）） | degree=度（75°E）, degree_minute=度分（75°30′E）, degree_only=纯数字度数, none=不标注 | Label format | 切换 标注格式 的表现方式 |
| `map.grid.labelTop` | 开关 | `false` |  | Top labels | 开/关「上方标注经度」 |
| `map.grid.labelRight` | 开关 | `false` |  | Right labels | 开/关「右侧标注纬度」 |

### 色带（`colorbar`，9 项，工具区 `map`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `map.colorbar.show` | 开关★ | `true` |  | Show colorbar | 开/关「显示色带」 |
| `map.colorbar.label` | 文本★ | `` |  | 单位上下标自动排版：dS m-1 / dS m⁻¹ / m2 都会转成上标 | 文本内容（支持中文与上下标） |
| `map.colorbar.location` | 枚举★ | `right`（右侧） | right=右侧, bottom=下方, inside=图内 | Colorbar location | 切换 色带位置 的表现方式 |
| `map.colorbar.cmap` | 枚举★ | `YlOrRd`（黄橙红） | YlOrRd=黄橙红, YlGnBu=黄绿蓝, RdYlBu=红黄蓝, RdBu_r=红蓝（反向）, Spectral=光谱, viridis=viridis, plasma=plasma, magma=magma, cividis=cividis, Greys=灰阶, Blues=蓝色系, Greens=绿色系… | Colour map | 切换 配色方案 的表现方式 |
| `map.colorbar.palette` | 枚举★ | ``（跟随配色（cmap / 顺序色）） | =跟随配色（cmap / 顺序色）, ppt-17=蓝渐变（7 级）, ppt-19=金渐变（7 级）, ppt-21=橙渐变（7 级）, ppt-23=玫红渐变（7 级）, ppt-25=蓝紫渐变（7 级）, ppt-27=青渐变（7 级）, ppt-29=青绿渐变（7 级）, ppt-31=紫渐变（7 级）,… | 优先于 cmap；空=按 style.paletteSequential → map.colorbar.cmap 回退 | 切换 色带配色（PPT） 的表现方式 |
| `map.colorbar.tickFormat` | 枚举 | `auto`（自动（按范围统一小数位）） | auto=自动（按范围统一小数位）, integer=整数, one_decimal=1 位小数, two_decimal=2 位小数, scientific=科学计数, percent=百分比 | auto 会按数值范围统一小数位，避免 0.27/0.472 混排 | 切换 刻度格式 的表现方式 |
| `map.colorbar.extend` | 枚举 | `neither`（不延伸） | neither=不延伸, min=低端延伸, max=高端延伸, both=两端延伸 | Extend | 切换 色带延伸 的表现方式 |
| `map.colorbar.vmin` | 数字 | `null`（自动） | -1e+12–1e+12 | 留空自动取数据最小值 | 数值/尺寸/间距 |
| `map.colorbar.vmax` | 数字 | `null`（自动） | -1e+12–1e+12 | 留空自动取数据最大值 | 数值/尺寸/间距 |

### 比例尺（`scaleBar`，3 项，工具区 `map`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `map.scaleBar.show` | 开关★ | `false` |  | Show scale bar | 开/关「显示比例尺」 |
| `map.scaleBar.lengthKm` | 数字★ | `500 km` | 10–5000，步长 10 | Scale bar length | 数值/尺寸/间距 |
| `map.scaleBar.position` | 枚举 | `lower left`（左下） | lower left=左下, lower right=右下, upper left=左上, upper right=右上 | Scale bar position | 切换 比例尺位置 的表现方式 |

### 指北针（`northArrow`，3 项，工具区 `map`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `map.northArrow.show` | 开关★ | `false` |  | Show north arrow | 开/关「显示指北针」 |
| `map.northArrow.position` | 枚举 | `upper right`（右上） | upper right=右上, upper left=左上, lower right=右下, lower left=左下 | North arrow position | 切换 指北针位置 的表现方式 |
| `map.northArrow.size` | 数字 | `0.045` | 0.02–0.2，步长 0.005 | North arrow size | 数值/尺寸/间距 |

### 点与标注（`mapPoint`，7 项，工具区 `map`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `map.point.mode` | 枚举★ | `auto`（自动） | auto=自动, fixed=单色散点, bubble=气泡（按数值）, choropleth=按数值着色 | Point mode | 切换 点符号模式 的表现方式 |
| `map.point.size` | 数字★ | `22 pt²` | 2–300，步长 1 | Point size | 数值/尺寸/间距 |
| `map.point.color` | 颜色 | `#d62728` |  | Point colour | 修改颜色 |
| `map.label.show` | 开关★ | `false` |  | Show point labels | 开/关「显示点标注」 |
| `map.label.size` | 数字 | `6 pt` | 4–14，步长 0.5 | Label size | 数值/尺寸/间距 |
| `map.choropleth.classes` | 数字 | `5 级` | 2–9，步长 1 | Class count | 数值/尺寸/间距 |
| `map.choropleth.palette` | 枚举 | ``（跟随顺序配色（style.paletteSequential）） | =跟随顺序配色（style.paletteSequential）, ppt-17=蓝渐变（7 级）, ppt-19=金渐变（7 级）, ppt-21=橙渐变（7 级）, ppt-23=玫红渐变（7 级）, ppt-25=蓝紫渐变（7 级）, ppt-27=青渐变（7 级）, ppt-29=青绿渐变（7 级）, p… | 优先于 style.paletteSequential；空=跟随顺序配色 | 切换 分级设色配色（PPT） 的表现方式 |

### 图例（`legend`，6 项，工具区 `all`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `legend.show` | 开关★ | `true` |  | Show legend | 开/关「显示图例」 |
| `legend.position` | 枚举★ | `auto`（自动避让） | auto=自动避让, upper right=右上, upper left=左上, lower right=右下, lower left=左下, center=居中, outside right=图外右侧, below=图下方 | auto 会按数据像素遮挡打分挑选遮挡最少的位置 | 切换 图例位置 的表现方式 |
| `legend.fontSize` | 数字★ | `null`（自动） | 4–20，步长 0.5 | 留空跟随 style.font.sizeLegend（期刊风格切换会同步） | 数值/尺寸/间距 |
| `legend.ncol` | 数字 | `1` | 1–5，步长 1 | Legend columns | 数值/尺寸/间距 |
| `legend.frame` | 开关 | `true` |  | Legend frame | 开/关「图例边框」 |
| `legend.title` | 文本 | `` |  | Legend title | 文本内容（支持中文与上下标） |

### 轴设置（`axes`，9 项，工具区 `chart`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `axes.xlabel` | 文本★ | `` |  | X label | 文本内容（支持中文与上下标） |
| `axes.ylabel` | 文本★ | `` |  | Y label | 文本内容（支持中文与上下标） |
| `axes.xScale` | 枚举 | `linear`（线性） | linear=线性, log=对数 | X scale | 切换 X 轴尺度 的表现方式 |
| `axes.yScale` | 枚举 | `linear`（线性） | linear=线性, log=对数 | Y scale | 切换 Y 轴尺度 的表现方式 |
| `axes.xMin` | 数字 | `null`（自动） | -1e+12–1e+12 | 留空自动 | 数值/尺寸/间距 |
| `axes.xMax` | 数字 | `null`（自动） | -1e+12–1e+12 | 留空自动 | 数值/尺寸/间距 |
| `axes.yMin` | 数字 | `null`（自动） | -1e+12–1e+12 | 留空自动 | 数值/尺寸/间距 |
| `axes.yMax` | 数字 | `null`（自动） | -1e+12–1e+12 | 留空自动 | 数值/尺寸/间距 |
| `axes.categoricalRotation` | 枚举 | `auto`（自动（重叠时依次旋转）） | auto=自动（重叠时依次旋转）, 0=水平, 30=30°, 45=45°, 90=垂直 | auto：相邻标签重叠时自动 30°→45°→缩字号→缩写，仍重叠则进 warnings | 切换 类目标签旋转 的表现方式 |

### 折线图（`lineChart`，3 项，工具区 `chart`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `line.cmap` | 枚举★ | `tab10`（tab10） | tab10=tab10, tab20=tab20, Set1=Set1, Set2=Set2, Set3=Set3, Paired=Paired, Dark2=Dark2, viridis=viridis, plasma=plasma, Spectral=Spectral | Series colours | 切换 多系列配色 的表现方式 |
| `line.dualAxis` | 开关 | `false` |  | Dual axis | 开/关「启用双 Y 轴」 |
| `line.y2` | 文本 | `` |  | Right axis column | 文本内容（支持中文与上下标） |

### 柱状图（`barChart`，4 项，工具区 `chart`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `bar.mode` | 枚举★ | `group`（分组） | group=分组, stack=堆叠, percent=百分比堆叠 | Bar mode | 切换 柱状模式 的表现方式 |
| `bar.orientation` | 枚举★ | `vertical`（竖直） | vertical=竖直, horizontal=水平 | Orientation | 切换 方向 的表现方式 |
| `bar.cmap` | 枚举 | `tab10`（tab10） | tab10=tab10, Set1=Set1, Set2=Set2, Set3=Set3, Paired=Paired, Dark2=Dark2, viridis=viridis, Blues=Blues | Bar colours | 切换 柱配色 的表现方式 |
| `bar.valueLabels` | 开关 | `false` |  | Value labels | 开/关「显示数值标签」 |

### 散点图（`scatterChart`，3 项，工具区 `chart`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `scatter.fit` | 枚举★ | `none`（不拟合） | none=不拟合, linear=线性拟合, poly2=二次拟合 | Fit line | 切换 拟合线 的表现方式 |
| `scatter.showEquation` | 开关 | `true` |  | Show equation | 开/关「显示拟合方程」 |
| `scatter.colorBy` | 文本 | `` |  | Colour by column | 文本内容（支持中文与上下标） |

### 热力图（`heatmapChart`，2 项，工具区 `chart`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `heatmap.cmap` | 枚举★ | `RdBu_r`（红蓝（反向）） | RdBu_r=红蓝（反向）, RdYlBu=红黄蓝, viridis=viridis, plasma=plasma, magma=magma, cividis=cividis, YlOrRd=黄橙红, Spectral=光谱, Greys=灰阶 | Heatmap cmap | 切换 热力配色 的表现方式 |
| `heatmap.annotate` | 开关 | `false` |  | Annotate cells | 开/关「显示单元格数值」 |

### 箱线图（`boxChart`，2 项，工具区 `chart`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `box.showOutliers` | 开关 | `true` |  | Show outliers | 开/关「显示离群点」 |
| `box.boxWidth` | 数字 | `0.6` | 0.1–1，步长 0.05 | Box width | 数值/尺寸/间距 |

### 数据列映射（`data`，6 项，工具区 `all`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `data.x` | 文本 | `auto` |  | 填列名；“auto”表示自动推断 | 文本内容（支持中文与上下标） |
| `data.y` | 文本 | `auto` |  | 填列名；“auto”表示自动推断 | 文本内容（支持中文与上下标） |
| `data.group` | 文本 | `auto` |  | 填列名；“auto”表示自动推断 | 文本内容（支持中文与上下标） |
| `data.value` | 文本 | `auto` |  | 填列名；“auto”表示自动推断 | 文本内容（支持中文与上下标） |
| `data.lat` | 文本 | `auto` |  | 地图点数据建议显式指定，或保持 auto | 文本内容（支持中文与上下标） |
| `data.lon` | 文本 | `auto` |  | 地图点数据建议显式指定，或保持 auto | 文本内容（支持中文与上下标） |

### 多子图合成（`compose`，11 项，工具区 `compose`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `compose.rows` | 数字★ | `0` | 0–6，步长 1 | 0 表示自动（接近方形） | 数值/尺寸/间距 |
| `compose.cols` | 数字★ | `0` | 0–6，步长 1 | 0 表示自动 | 数值/尺寸/间距 |
| `compose.gapXMm` | 数字★ | `4 mm` | 0–30，步长 0.5 | Horizontal gap | 数值/尺寸/间距 |
| `compose.gapYMm` | 数字★ | `4 mm` | 0–30，步长 0.5 | Vertical gap | 数值/尺寸/间距 |
| `compose.align` | 枚举 | `axes`（轴框对齐） | none=不对齐, axes=轴框对齐 | Alignment | 切换 对齐方式 的表现方式 |
| `compose.optimize` | 开关★ | `true` |  | 开启后等宽等高、轴框对齐、编号统一、总标题居中、边距最小化 | 开/关「排版优化」 |
| `compose.shareColorbar` | 开关 | `false` |  | Shared colorbar | 开/关「共享色带」 |
| `compose.legendPerPanel` | 开关 | `true` |  | Legend per panel | 开/关「每面板独立图例」 |
| `compose.panelLabel.show` | 开关★ | `true` |  | Show panel labels | 开/关「显示子图编号」 |
| `compose.panelLabel.style` | 枚举★ | `(a)`（(a) 带括号） | (a)=(a) 带括号, a=a 不带括号 | Label style | 切换 编号样式 的表现方式 |
| `compose.panelLabel.position` | 枚举★ | `upper left`（左上） | upper left=左上, upper right=右上, lower left=左下, lower right=右下 | Label position | 切换 编号位置 的表现方式 |

### 自定义代码（`code`，1 项，工具区 `all`）

| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |
|---|---|---|---|---|---|
| `customPatch` | 文本 | `` |  | 面板绘制完成后执行；可用 fig/axes/ax/np/plt/mpl/spec；异常只记 warning 不影响出图 | 文本内容（支持中文与上下标） |

## 4. 期刊风格预设（presets.json）

| id | 名称 | 栏宽 | 字体 | 基准/标题/轴/刻度/图例字号 | 线宽 | 轴框 | 适用 |
|---|---|---|---|---|---|---|---|
| `sci` | 通用 SCI | 180 mm | Arial | 8.0/10.0/8.0/7.0/7.0 pt | 1.2 pt | 0.8 pt | 通用 SCI 期刊 |
| `nature` | Nature | 89 mm | Arial | 7.0/8.0/7.0/6.0/6.0 pt | 1 pt | 0.5 pt | Nature 系列（单栏 89mm） |
| `science` | Science | 120 mm | Arial | 7.0/8.0/7.0/6.0/6.0 pt | 1 pt | 0.6 pt | Science 系列 |
| `elsevier` | Elsevier | 180 mm | Arial | 8.0/9.0/8.0/7.0/7.0 pt | 1.2 pt | 0.75 pt | Elsevier 期刊（双栏） |
| `ieee` | IEEE | 89 mm | Times New Roman | 8.0/9.0/8.0/7.0/7.0 pt | 1 pt | 0.7 pt | IEEE 会议/期刊（Times） |
| `geography-cn` | 地理学报 | 180 mm | SimSun | 8.0/9.5/8.0/7.0/7.0 pt | 1.1 pt | 0.7 pt | 地理学报等中文地理期刊（宋体） |
| `remote-sensing-cn` | 遥感学报 | 180 mm | SimSun | 8.0/9.0/8.0/7.0/7.0 pt | 1.1 pt | 0.7 pt | 遥感学报等中文遥感期刊（宋体+黑体标题） |

切换 presets 时，host 按“当前值仍等于旧 preset 默认值才覆盖”的策略合并；引擎侧渲染时按 `defaults → preset → spec` 顺序应用，因此同一 spec 在任何入口都得到同一结果。

## 4.1 配色体系（palettes.json，来自用户 PPT）

配色数据由 `scripts/extract_palettes.py` 从 `科研绘图.pptx` 提取，**只读**（不改 ids/colors），共 33 套：

- 分类色 `categorical`（18 套）：折线/柱/散点分组颜色顺序、地图点符号基色、分级设色（无顺序色时）。
- 顺序色 `sequential`（12 套）：连续填色、热力图、分级设色、色带默认。
- 发散色 `diverging`（12 套）：正负/距平、以 0 为中心的热力图、正负色带。

优先级：`map.colorbar.palette` > `style.paletteSequential` > `map.colorbar.cmap`；分类色缺少时回退旧的 `line/bar/scatter/box.cmap`。所有颜色直接取自该 palette 的 hex，不做静默换色。

| id | 类型 | 名称 | 色块（hex） |
|---|---|---|---|
| `ppt-01` | 分类 | 蓝 · 金 · 橙（6 色） | `#7EABCC` `#BFDBEF` `#356D9E` `#E3C99F` `#9EC8E2` `#D1AC8D` |
| `ppt-02` | 分类 | 天蓝 · 橙（6 色） | `#6791A2` `#2A3E40` `#D4E8EE` `#935343` `#94B8C7` `#B2D7E3` |
| `ppt-03` | 分类 | 玫红 · 蓝紫 · 灰（6 色） | `#71657F` `#C69FBB` `#F0EDEE` `#595E79` `#4C526E` `#966B80` |
| `ppt-04` | 分类 | 金 · 橙 · 红（6 色） | `#9A4949` `#D4D7C9` `#4E2934` `#B8917C` `#E4916B` `#F5CB8F` |
| `ppt-05` | 分类 | 金 · 橙 · 玫红（6 色） | `#CACCD7` `#F7C811` `#9CA0CC` `#D53263` `#B2B2C3` `#EC8146` |
| `ppt-06` | 分类 | 红 · 青 · 紫（6 色） | `#D65350` `#6AAD92` `#489D84` `#8175A1` `#E0786F` `#C9B9BE` |
| `ppt-07` | 分类 | 金 · 红 · 天蓝（6 色） | `#4DB1BE` `#D2D8CF` `#F5EAA8` `#CDB384` `#D03D20` `#96D4D9` |
| `ppt-08` | 分类 | 橙 · 红 · 灰（6 色） | `#FDCFB9` `#F3F1EF` `#71778A` `#F20907` `#761521` `#E7AEAA` |
| `ppt-09` | 分类 | 青绿 · 灰（6 色） | `#C3CCC1` `#E8ECEE` `#8C8378` `#32821A` `#2C8218` `#74695A` |
| `ppt-10` | 分类 | 玫红 · 紫 · 青（6 色） | `#CD7390` `#749C90` `#543470` `#F12188` `#E5E0E0` `#747E8C` |
| `ppt-11` | 分类 | 橙 · 红 · 青绿（6 色） | `#6EA442` `#EB6248` `#3E9F51` `#FBD7C1` `#D18C6D` `#BBDAC9` |
| `ppt-12` | 分类 | 金 · 青绿 · 蓝紫（6 色） | `#7E6002` `#FFF2CC` `#DCE2E1` `#FED863` `#20BE3C` `#3E3B8E` |
| `ppt-13` | 分类 | 金 · 红 · 天蓝（6 色） ② | `#F3C726` `#4676C4` `#9F896A` `#DD4F5B` `#45A8C6` `#C9D1D2` |
| `ppt-14` | 分类 | 青 · 红 · 玫红（6 色） | `#C98EB9` `#9C4C87` `#009240` `#FD938E` `#E12931` `#4EB178` |
| `ppt-15` | 分类 | 金 · 橙 · 红（6 色） ② | `#4874CB` `#EE822F` `#F2BA02` `#75BD42` `#30C0B4` `#E54C5E` |
| `ppt-16` | 分类 | 金 · 橙 · 蓝（6 色） | `#5B9BD5` `#ED7D31` `#A5A5A5` `#FFC000` `#4472C4` `#70AD47` |
| `ppt-17` | 顺序 | 蓝渐变（7 级） | `#E9F1F6` `#B8D1E3` `#88B1D0` `#5792BD` `#3B6F95` `#274A64` `#142633` |
| `ppt-18` | 发散 | 蓝与橙发散（9 级） | `#375C77` `#4D81A7` `#7AA4C2` `#ABC5D8` `#F4F5F5` `#D2BFB2` `#B79A85` `#9A765B` … |
| `ppt-19` | 顺序 | 金渐变（7 级） | `#F8F2E7` `#E9D4B3` `#D9B67E` `#CA9949` `#A1752F` `#6C4F1F` `#372810` |
| `ppt-20` | 发散 | 金与蓝发散（9 级） | `#7F602E` `#B38841` `#CBA971` `#DEC9A5` `#F5F5F4` `#AEBDD6` `#7E97BE` `#5271A3` … |
| `ppt-21` | 顺序 | 橙渐变（7 级） | `#F6EFE9` `#E3CCB9` `#CFA988` `#BC8558` `#94643C` `#634328` `#332215` |
| `ppt-22` | 发散 | 橙与蓝发散（9 级） | `#765437` `#A7764E` `#C19B7B` `#D8C0AC` `#F5F5F4` `#B2C3D1` `#85A0B7` `#5B7D9A` … |
| `ppt-23` | 顺序 | 玫红渐变（7 级） | `#F4EBEE` `#DDBEC7` `#C692A1` `#AE657B` `#88475B` `#5B303D` `#2F191F` |
| `ppt-24` | 发散 | 玫红与青发散（9 级） | `#6E404D` `#9B5A6D` `#B88494` `#D2B2BB` `#F5F4F5` `#B6CDC6` `#8CB0A5` `#649184` … |
| `ppt-25` | 顺序 | 蓝紫渐变（7 级） | `#EBECF5` `#BEC1DD` `#9195C6` `#646AAF` `#474C89` `#2F335C` `#181A2F` |
| `ppt-26` | 发散 | 蓝紫与黄绿发散（9 级） | `#3F436E` `#595F9C` `#8488B8` `#B1B4D2` `#F4F4F5` `#CECCB6` `#B1AE8B` `#928E63` … |
| `ppt-27` | 顺序 | 青渐变（7 级） | `#EAF5F2` `#BBE0D5` `#8DCBB8` `#5EB59C` `#418E78` `#2C6050` `#163129` |
| `ppt-28` | 发散 | 青与玫红发散（9 级） | `#3B7262` `#54A18A` `#80BDAB` `#AED5CA` `#F4F5F5` `#CFB4BC` `#B48995` `#965F6F` … |
| `ppt-29` | 顺序 | 青绿渐变（7 级） | `#EAFAE5` `#BCEFAD` `#8EE374` `#60D83B` `#42AD23` `#2D7417` `#173B0C` |
| `ppt-30` | 发散 | 青绿与品红发散（9 级） | `#3C8826` `#55C035` `#81D567` `#AFE49F` `#F4F5F4` `#CFA9DA` `#B377C5` `#9549AB` … |
| `ppt-31` | 顺序 | 紫渐变（7 级） | `#F0EAF5` `#CFBCE0` `#AE8DCA` `#8D5FB5` `#6A428E` `#472C5F` `#251731` |
| `ppt-32` | 发散 | 紫与绿发散（9 级） | `#583C72` `#7D54A0` `#A080BC` `#C3AFD5` `#F5F4F5` `#C1CFB4` `#9DB389` `#799560` … |
| `ppt-33` | 发散 | 玫红与青绿发散（9 级） | `#713D63` `#9F568B` `#BB81AB` `#D4AFCA` `#F5F4F5` `#B5CFBC` `#8AB395` `#60946F` … |

## 5. 数据列推断规则（dataio.py）

`data.*` 默认 `"auto"`，表示自动推断；host 的 draft 不写这些路径也能出图。

| 路径 | auto 推断规则 |
|---|---|
| `data.source` | 相对 `--workdir` 或绝对路径；支持 csv/tsv/txt/xlsx/json/geojson/shp/gpkg |
| `data.lon` | 列名匹配 lon/lng/longitude/经度/x（地图必需） |
| `data.lat` | 列名匹配 lat/latitude/纬度/y（地图必需） |
| `data.value` | value/val/数值/值/含量/浓度/…，否则取第一个数值列 |
| `data.x` | x/year/年份/date/日期/时间/月份/period，否则第一列 |
| `data.y` | 折线/散点：除 x 外的数值列；支持逗号分隔多列；双轴用 `line.y2` |
| `data.group` | group/category/类别/分组/类型/class/type/名称 |
| `data.label` | label/name/名称/地名/站点/station |
| `data.sheet` | 读取 xlsx 时指定 sheet（留空取第一个） |

图型与数据形状：

- `map`：点数据（lon/lat[/value/label]）→ 散点/气泡/按值着色；矢量数据（GeoJSON/SHP/GPKG，含数值属性）→ 分级设色（分位数/等间距）。
- `line`：x + 多列 y；`line.dualAxis` 时 `line.y2` 列走右轴。
- `bar`：类目列 + 数值列（宽表），或 类目/系列/数值（长表，需给 data.value）；`bar.mode` 支持 group/stack/percent。
- `scatter`：两个数值列 + 可选分组列（`scatter.colorBy` 或 data.group）。
- `heatmap`：行标签列 + 数值列（宽表），或 行/列/值 三列（长表，需显式给 `data.x/data.y/data.value`）。
- `box`：分组列 + 数值列（长表），或直接多列数值（宽表）。

## 6. 样例数据（samples/）

| 文件 | 内容 | 用到的图型 |
|---|---|---|
| `samples/map_points.csv` | 新疆 20 个站点：站点/经度/纬度/土壤盐分/类型 | map（点、气泡、按值着色） |
| `samples/map_polygons.geojson` | 新疆 8 个盐渍化分区多边形（soil_salinity 属性） | map（分级设色） |
| `samples/line_timeseries.csv` | 2000–2020 年 NDVI / 年均降水 / 年均气温 | line（多序列、双轴） |
| `samples/bar_grouped.csv` | 6 类土地利用 × 北疆/南疆/东疆面积 | bar（分组/堆叠/百分比） |
| `samples/scatter.csv` | 24 个样本：年均降水 / NDVI / 区域 | scatter（分组着色、拟合线） |
| `samples/heatmap_matrix.csv` | 12 个月 × 3 个区域月均气温 | heatmap |
| `samples/box_salinity.csv` | 5 类土地类型的土壤盐分样本 | box |

对应的 spec 示例：`spec_map.json`、`spec_map_polygon.json`、`spec_line.json`、`spec_bar.json`、`spec_scatter.json`、`spec_heatmap.json`、`spec_box.json`、`spec_compose.json`、`spec_custompatch.json`。

## 已知限制（v1.2）

1. **地图底图数据**：使用本地缓存的 Natural Earth 10m 数据（land / ocean / lakes /
   rivers / coastline / admin_0_countries / admin_0_boundary_lines_land）。省界
   （`map.layers.provinceBorders`）默认离线不可用：启用时会尝试下载（8 s 超时），
   失败则跳层并进 `warnings`，**不会整图失败**。首次使用未缓存图层同理。
2. **中国国界**：由 Natural Earth admin_0_countries 中 CHN/TWN/HKG/MAC 合成，
   仅用于示意。正式出版请按自然资源部标准地图核对；南海诸岛插图为简化示意
   （九段线为手绘简化折线 + “示意”标注），不构成标准地图。
3. **比例尺**：按图幅中心纬度用 WGS84 椭球估算，跨纬度大的图会有误差；投影
   不支持时跳过（`autoAdjust.scaleBar`）。窄面板自动降级：条长不超过轴框宽
   60%（1/2/5 级数缩到更小的整数值）、字号可降 1–2pt、空间不足时只标终点数值，
   这些改进写入 `autoAdjust`（`scaleBarLength` / `scaleBarLabel` /
   `scaleBarFontSize`）；与指北针/南海插图 bbox 冲突且未解决时进 `warnings`。
4. **经纬网标注**：非矩形投影（罗宾逊/摩尔威特/正射）下 cartopy 可能无法标注，
   此时关闭经纬网并 warning；标注默认水平不旋转（`map.grid.rotation` 控制）。
   **投影中央经线自适应**：`lambert / albers / azimuthal / orthographic /
   northpolarstereo` 下若 `|extent 中心经线 − centralLongitude| > 10°`，引擎
   自动改用 extent 中心经线（用户显式改成接近中心的值不受影响），避免区域图
   整体倾斜；该自动行为写入 `autoAdjust`（`{"key":"centralLongitude",
   "message":"中央经线已对齐研究区中心（85.0°E）"}`），**不会**进 warnings；
   圆锥投影矩形视角的四角用 ocean/land 底色填充（`autoAdjust.cornerFill`），
   不再露纯白三角楔形。
5. **类目标签自适应**：`axes.categoricalRotation="auto"` 时，相邻标签间距
   <1.5mm 依次尝试 30°→45°→90°、字号 -1/-2pt（最低 6pt）、缩写；仍重叠进
   warnings。面板宽 <55mm 且仍重叠时提示改用 2 行布局。bar 与 heatmap 同规则；
   数值轴则按标签重叠自动减少刻度数（5→4→3）。
6. **合成图自动行列**：未指定 rows/cols 时按接近方形布局（n=2→1×2、n=3→2×2
   末格留空、n=4→2×2、n=5/6→2×3、n=7–9→3×3），不会出现 1×N 的窄面板。
7. **范围预设优先级**：`map.extentPreset != "custom"` 时**以预设为准**，四个
   `map.extentLonMin/LonMax/LatMin/LatMax` 被忽略；只有 `custom` 才使用这四个数
   （控件 `visibleWhen` 已按此显隐）。若用户直接改经纬度而没改 preset，建议
   host 同步把 `map.extentPreset` 切到 `custom`。
8. **上下标与单位文本**：纯西文文本中的 `m-1` / `m^2` / `km2` / `s-1` 以及
   Unicode 上下标会转成 mathtext（`m$^{-1}$`）；中英混排文本则转成 Unicode
   上标（`m⁻¹`），依赖 Arial → DejaVu Sans → 宋体 回退链（mathtext 会把中文
   渲染成豆腐块）。只处理**单位尾部**，`2000-2010`、`CO2`、`H2O` 不会被误改。
   字体缺字形会进 `warnings`。
9. **图例自动避让**：基于像素遮挡打分（居中度 + 遮挡比例 + 保留区碰撞），对
   10–20 个候选位置评分。极密数据（如整幅散点）仍可能压数据，此时
   `warnings` 会给出遮挡评分，建议改 `legend.position`。
10. **多元合成图**：面板只接受面板级字段（kind/data/map/axes/legend/text/title/
   customPatch），`figure/style/output` 由合成图统一；`compose.panels` 由 host
   把组件引用解析成面板 spec 数组后传入（`render-spec.json`）。单个面板失败
   时用占位面板 + warning，不影响整图。`optimize:true` 下地图面板会
   `set_aspect("auto")` 填满单元格以保证轴框对齐（会有轻微投影变形）；面板
   色带自动缩到 0.8×宽、pad +1mm；`compose.align="none"` 目前仍保持等宽等高
   布局（`optimize:false` 才是完全不参与优化的路径）。
11. **确定性**：同一 spec 连续渲染 PNG 字节一致（自检 `--mode determinism`）。
   唯一例外是系统字体缓存首次构建（只影响耗时，不影响结果）。
12. **仅 PNG**：按用户环境约定只输出 PNG（Agg），不提供 PDF/SVG 导出。
13. **controls 数量**：v1 契约目标 60–100 项；v2/v4 增补 compose、customPatch、
   类目旋转、classtool 配色与地图细分后为 124 项，全部与 spec 叶子一一对应，
   自测脚本逐个设值验证。
14. **配色（v4）**：全部颜色来自 `palettes.json`（用户 PPT 提取，**33 套**，只读；
    16 分类 / 8 顺序 / 9 发散；`optionLabels` 用其中的中文 `name`，枚举值仍是 id）。
    分类色用于折线/柱/散点/点符号/分级设色；顺序色用于连续填色/热力图/分级/
    色带；发散色用于正负与以 0 为中心的热力图。优先级
    `map.colorbar.palette` > `style.paletteSequential` > `map.colorbar.cmap`；
    palette id 不存在或类型不适用时 warning 并回退默认，不会静默换色。
15. **投影参数（v4）**：`map.centralLatitude` 与 `map.standardParallels` 参与
   Lambert/Albers（标准纬线 + 中央纬度）与 Robinson/Mollweide/EqualEarth/
   正射/方位/北极立体（中央经线/纬度）；`standardParallels` 留空或 `auto` 时
   按范围自动取值并写入 `autoAdjust`；投影切换后 extent/经线/纬线按新投影重算，
   中央经线/纬度自动贴合研究区（>10° / >5–10° 时）同样写入 `autoAdjust`。
16. **工具区分组（v4）**：controls.json 每个 group 带 `appliesTo`
   （`map`/`chart`/`compose`/`all`），UI 用它把「工具区」分四段；渲染器本身
   不依赖该字段，缺省视为 `all`。
17. **窄面板比例尺（v4）**：轴框宽 <70mm 时自动字号 ≤6.5pt、标签间距 4.5pt、
   条长 ≤55% 轴框宽、必要时只保留终点标签，避免文字压条（改进写入 `autoAdjust`）。
18. **自动优化与警告分离（v4）**：引擎自己"做得更合理"的行为（`centralLongitude`、
   `centralLatitude`、`standardParallels`、`colorbarRange`、`cornerFill`、
   `graticuleIntervalX/Y`、`scaleBar*`、`categoricalRotation/FontSize/Abbrev`、
   `numericTicks`、`panelTitle`、`legendPerPanel`、`extent`）只写入
   `autoAdjust:[{key,message}]`（中文 ≤20 字，不含解释性文案），**不占用
   warnings**；`warnings` 只保留真风险：数据缺失/下载失败、字体缺字、文字溢出
   或重叠未解决、customPatch 失败、非法控件值回退、色带/标注绘制失败等。
   自测 `--mode autoadjust` 断言两类通道的边界。

## 与契约的差异说明（需 Lead 知悉）

1. `controls.json` 条目数 **124**（契约 v1 §3.3 目标 60–100）。超出部分
   主要来自 v2 §7.2 新增的 compose 组（rows/cols/gap/align/optimize/
   shareColorbar/legendPerPanel/panelLabel×3 等）以及地图/色带细分（投影、
   经纬网、比例尺、指北针、南海插图、色带范围）。已通过生成脚本校验
   「每个 control path 都是 DEFAULT_SPEC 的真实叶子、默认值一致、preset 覆盖
   全部 style.* path」，不存在悬空 path。
2. `presets.json` 的 values 采用**点号展平 path → 值**（如
   `"style.font.sizeBase": 7.0`），这是 controls path 的直接映射，便于 host
   的「智能换风格」按 path 比较；结构上仍是合法 JSON。
3. 契约 §3.3 要求 `visibleWhen`；本文件对地图/图表/合成组均给出
   `visibleWhen: {"path":"kind","in":[...]}`；但控件组的 `visibleWhen` 同时
   写在 group 与 item 上（UI 任取其一即可）。
4. `--thumb` 使用 PIL 缩放（长边 ≤480 px，保持宽高比），`--code-out` 与
   `codegen` 输出同一套 component.py；引擎渲染与生成脚本渲染已用 SHA256
   验证**逐字节一致**（自检 `--mode codegen`）。
5. 多子图 `compose.panels` 同时接受顶层 `panels` 与 `compose.panels` 两种写法
   （host 的 render-spec.json 用后者），便于联调。

## 7. 自测

```bash
cd <BUNDLE>\py
python tools\build_assets.py --check      # controls/presets 一致性校验
python tools\selftest.py --mode all        # 样例/控件遍历/风格/合成/确定性/codegen
```

报告落在 `out/_selftest/report_*.json`，图在 `out/_selftest/`。

