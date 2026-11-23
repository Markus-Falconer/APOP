# APOP analysis pages

Static pages published with GitHub Pages. The site root (`index.html`) redirects to Cycle Analysis V2.

## How the header works

Every page's title, subtitle and navigation come from one list, `SITE`, at the top of `site.js`. Pages don't contain their own header; each has this placeholder instead:

```html
<header id="site-header" data-page="aft-turbine-v2"></header>
<script src="site.js"></script>
```

`site.js` finds the entry whose `id` matches `data-page`, draws the heading and subtitle, and builds the menus. The menu the page belongs to is underlined, and the page itself is marked inside its menu. Shared colours, fonts, page width and header styles live in `site.css`.

## Adding a page

1. Copy `_template.html` to a new file, e.g. `rotor-test.html`. (Files starting with `_` aren't published.)
2. In `site.js`, add an entry to the group it belongs in:
   ```js
   { id: "rotor-test", href: "rotor-test.html", menu: "Rotor spin test",
     title: "Rotor Spin Test", sub: "Shop-air spin test of the spare turbine wheel" }
   ```
   - `menu`: text in the dropdown
   - `title` and `sub`: heading and subtitle at the top of the page
3. In the new page, set `data-page="rotor-test"` and the `<title>` tag.

To add a new menu, add a group to `SITE`: `{ label: "Testing", pages: [ ... ] }`. Give it an `href` if clicking the menu name should open a default page, as Cycle analysis does with V2. Without `href`, the name just opens the menu.

To move or rename a page in the menus, change only `site.js`. Any page can still override shared styles in its own `<style>` block.

## 3D views

`viewer3d.js` is a small shared WebGL viewer (orbit, preset views, cutaway, exploded view, clipping) plus mesh helpers for tubes, bends, cones, lofts and plates. Load it before a page's own geometry script and build parts as described at the top of the file; `aft-turbine-v3-3d.js` is a compact example.

## Equations on Cycle Analysis V2

The "Key equations" panel on `cycle-v2.html` typesets the model's equations with KaTeX (vendored in `vendor/katex/`, no network needed) and substitutes the current operating point's numbers. Each equation has a tag such as (3.6), and the model code carries the same tag in an `Eq. (3.6)` comment, so a reviewer can check the code against the panel line by line. The equations are listed in `EQS` in the page script; when you change a relation in the model, update its entry there too.
