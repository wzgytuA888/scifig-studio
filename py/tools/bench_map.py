import os, sys, time, socket
os.environ.setdefault("MPLBACKEND", "Agg")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.io.shapereader as shpreader

PC = ccrs.PlateCarree()
EXT = [73.0, 97.0, 34.0, 49.5]  # xinjiang
DATA = r"<CARTOPY_DATA_DIR>\shapefiles\natural_earth"


def timer(label, fn):
    t0 = time.perf_counter()
    out = fn()
    print("%-42s %7.3f s" % (label, time.perf_counter() - t0), flush=True)
    return out


def load(res, cat, name):
    p = os.path.join(DATA, cat, "ne_%s_%s.shp" % (res, name))
    return list(shpreader.Reader(p).geometries())


def main():
    land10 = timer("load land 10m", lambda: load("10m", "physical", "land"))
    ocean10 = timer("load ocean 10m", lambda: load("10m", "physical", "ocean"))
    lakes10 = timer("load lakes 10m", lambda: load("10m", "physical", "lakes"))
    coast10 = timer("load coastline 10m", lambda: load("10m", "physical", "coastline"))
    borders10 = timer("load borders 10m", lambda: load("10m", "cultural", "admin_0_boundary_lines_land"))
    land50 = timer("load land 50m", lambda: load("50m", "physical", "land"))

    def draw(with_layers, res=10):
        fig = plt.figure(figsize=(7.09, 4.72), dpi=300)
        ax = fig.add_axes([0.08, 0.09, 0.82, 0.80], projection=ccrs.LambertConformal(central_longitude=85, central_latitude=42, standard_parallels=(38, 46)))
        ax.set_extent(EXT, crs=PC)
        if with_layers:
            ax.add_geometries(ocean10, PC, facecolor="#e6f0f7", edgecolor="none", zorder=0)
            ax.add_geometries(land10, PC, facecolor="#f2efe9", edgecolor="none", zorder=1)
            ax.add_geometries(lakes10, PC, facecolor="#c9e0ee", edgecolor="none", zorder=2)
            ax.add_geometries(coast10, PC, facecolor="none", edgecolor="#4d4d4d", linewidth=0.45, zorder=3)
            ax.add_geometries(borders10, PC, facecolor="none", edgecolor="#8c8c8c", linewidth=0.45, zorder=3)
        t0 = time.perf_counter()
        fig.canvas.draw()
        print("   canvas.draw (%s) %.3f s" % ("layers" if with_layers else "empty", time.perf_counter() - t0), flush=True)
        plt.close(fig)

    timer("draw empty", lambda: draw(False))
    timer("draw all 10m", lambda: draw(True))

    # clipped version
    import shapely.geometry as sgeom
    from shapely.ops import unary_union

    box = sgeom.box(EXT[0], EXT[2], EXT[1], EXT[3])

    def clip(geoms):
        out = []
        for g in geoms:
            try:
                inter = g.intersection(box)
            except Exception:
                continue
            if inter.is_empty:
                continue
            out.append(inter)
        return out

    landc = timer("clip land 10m", lambda: clip(land10))
    oceanc = timer("clip ocean 10m", lambda: clip(ocean10))
    lakesc = timer("clip lakes 10m", lambda: clip(lakes10))
    coastc = timer("clip coast 10m", lambda: clip(coast10))
    bordersc = timer("clip borders 10m", lambda: clip(borders10))

    def draw_clipped():
        fig = plt.figure(figsize=(7.09, 4.72), dpi=300)
        ax = fig.add_axes([0.08, 0.09, 0.82, 0.80], projection=ccrs.LambertConformal(central_longitude=85, central_latitude=42, standard_parallels=(38, 46)))
        ax.set_extent(EXT, crs=PC)
        ax.add_geometries(oceanc, PC, facecolor="#e6f0f7", edgecolor="none", zorder=0)
        ax.add_geometries(landc, PC, facecolor="#f2efe9", edgecolor="none", zorder=1)
        ax.add_geometries(lakesc, PC, facecolor="#c9e0ee", edgecolor="none", zorder=2)
        ax.add_geometries(coastc, PC, facecolor="none", edgecolor="#4d4d4d", linewidth=0.45, zorder=3)
        ax.add_geometries(bordersc, PC, facecolor="none", edgecolor="#8c8c8c", linewidth=0.45, zorder=3)
        t0 = time.perf_counter()
        fig.canvas.draw()
        print("   canvas.draw (clipped) %.3f s" % (time.perf_counter() - t0), flush=True)
        plt.close(fig)

    timer("draw all clipped 10m", draw_clipped)


main()
