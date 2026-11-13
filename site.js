/* Site header and navigation for every page.
 *
 * To add a page: add one entry to the right group in SITE below, then give the
 * page this header (see _template.html):
 *   <header id="site-header" data-page="your-page-id"></header>
 *   <script src="site.js"></script>
 * The page title, subtitle and menu entry all come from that one entry.
 */
const SITE = [
  {
    label: "Cycle analysis",
    href: "cycle-v2.html", // clicking the group name opens this page
    pages: [
      { id: "cycle-v2", href: "cycle-v2.html", menu: "Cycle analysis V2",
        title: "Cycle Analysis V2", sub: "JetCat P100-RX · calibrated to engine test data · fixed-geometry matching" },
      { id: "cycle-v1", href: "cycle-v1.html", menu: "Cycle analysis V1",
        title: "P100 Cycle Analysis", sub: "JetCat P100-RX · single-spool turbojet with shaft power extraction" }
    ]
  },
  {
    label: "Proposed designs",
    pages: [
      { id: "generator", href: "generator.html", menu: "Front-shaft generator",
        title: "P100 Generator Physics", sub: "Permanent magnet generator on the JetCat P100-RX front shaft" },
      { id: "aft-turbine", href: "aft-turbine.html", menu: "Aft turbine",
        title: "Aft Turbine", sub: "JetCat P100-RX · a free power turbine in the exhaust, geared to a generator outside the hot flow" },
      { id: "aft-turbine-v2", href: "aft-turbine-v2.html", menu: "Aft turbine V2",
        title: "Aft Turbine V2", sub: "JetCat P100-RX · spare turbine wheel in a cone shroud, direct-coupled motor, exhaust split into two round pipes" }
    ]
  },
  {
    label: "Misc",
    pages: [
      { id: "nozzle", href: "nozzle.html", menu: "Nozzle modification",
        title: "Nozzle Modification", sub: "JetCat P100-RX · sizing the exhaust nozzle for the 90% corrected speed condition" },
      { id: "load-bank", href: "load-bank.html", menu: "Load bank shopping",
        title: "Load Bank Shopping", sub: "Test equipment for the power-generation side: what the ICD requires and what to buy" }
    ]
  }
];

(function () {
  const header = document.getElementById("site-header");
  if (!header) return;
  const id = header.dataset.page;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let page = null;
  for (const g of SITE) for (const p of g.pages) if (p.id === id) page = p;
  if (!page) console.warn(`site.js: no entry with id "${id}" in SITE`);

  const groups = SITE.map((g, i) => {
    const here = g.pages.some(p => p.id === id);
    const items = g.pages.map(p =>
      `<a href="${p.href}"${p.id === id ? ' aria-current="page"' : ""}>${esc(p.menu)}</a>`).join("");
    const top = g.href
      ? `<a class="dd-top" href="${g.href}"${here ? ' aria-current="true"' : ""}>${esc(g.label)}</a>` +
        `<button type="button" class="dd-btn" aria-expanded="false" aria-controls="dd-${i}" aria-label="${esc(g.label)} pages">▾</button>`
      : `<button type="button" class="dd-top dd-btn" aria-expanded="false" aria-controls="dd-${i}"${here ? ' aria-current="true"' : ""}>${esc(g.label)} <span aria-hidden="true">▾</span></button>`;
    return `<div class="dd">${top}<div class="dd-menu" id="dd-${i}">${items}</div></div>`;
  }).join("");

  header.innerHTML = `<div class="wrap">` +
    (page ? `<h1>${esc(page.title)}</h1><p>${esc(page.sub)}</p>` : "") +
    `<nav aria-label="Site">${groups}</nav></div>`;

  const close = except => header.querySelectorAll(".dd.open").forEach(d => {
    if (d !== except) { d.classList.remove("open"); d.querySelector(".dd-btn").setAttribute("aria-expanded", "false"); }
  });
  header.querySelectorAll(".dd-btn").forEach(b => b.addEventListener("click", e => {
    const d = b.closest(".dd"), open = !d.classList.contains("open");
    close(d); d.classList.toggle("open", open); b.setAttribute("aria-expanded", open);
    e.stopPropagation();
  }));
  document.addEventListener("click", e => { if (!header.contains(e.target)) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
})();
