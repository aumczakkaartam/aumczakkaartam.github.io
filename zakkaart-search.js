/* ════════════════════════════════════════════════════════════════
   zakkaart-search.js  —  zoekmodule voor Zakkaart
   ----------------------------------------------------------------
   Nodig: Fuse.js. Zet 'm LOKAAL in je repo (niet via CDN), zodat
   zoeken offline blijft werken in de PWA:
       <script src="js/fuse.min.js"></script>
       <script src="js/zakkaart-search.js"></script>
   Download fuse.min.js eenmalig van:
       https://cdnjs.cloudflare.com/ajax/libs/fuse.js/7.0.0/fuse.min.js
   ════════════════════════════════════════════════════════════════ */

/* ── 1) VELD-MAPPING ───────────────────────────────────────────────
   Zet hier de veldnamen zoals ze in JOUW kaarten heten.
   Heeft een kaart sub-secties i.p.v. één 'content'-veld, zie de
   noot onderaan (flattenCard). Titel weegt het zwaarst.            */
const ZK_CONFIG = {
  keys: [
    { name: "title",    weight: 0.5 },
    { name: "aliases",  weight: 0.3 },   // merknamen/afkortingen per kaart
    { name: "category", weight: 0.15 },
    { name: "content",  weight: 0.05 },  // doorzoekbare platte tekst
  ],
  threshold: 0.38,        // lager = strenger, hoger = meer fuzzy
  ignoreLocation: true,
  minMatchCharLength: 2,
  shortQueryMax: 4,       // ≤ dit aantal tekens = prefix-zoeken
};

/* ── 2) KLINISCHE SYNONIEMEN ───────────────────────────────────────
   Typt iemand de key, dan zoeken we óók de extra termen mee.
   Vul aan met wat jullie op de OK echt intypen.                    */
const ZK_SYNONYMS = {
  // merknaam → stofnaam
  "esmeron":   ["rocuronium"],
  "diprivan":  ["propofol"],
  "ultiva":    ["remifentanil"],
  "sufenta":   ["sufentanil"],
  "dormicum":  ["midazolam"],
  "bridion":   ["sugammadex"],
  "nimbex":    ["cisatracurium"],
  "tracrium":  ["atracurium"],
  "dipidolor": ["piritramide"],
  // afkorting / concept → onderwerp
  "ponv":  ["misselijkheid", "antiemetica", "ondansetron", "dexamethason"],
  "rsi":   ["rapid sequence", "crash inductie"],
  "tiva":  ["propofol", "remifentanil", "totale intraveneuze"],
  "avr":   ["aortaklep", "klepvervanging"],
  "cabg":  ["bypass", "coronair"],
  "rotem": ["stolling", "tromboelastometrie"],
  "sbar":  ["overdracht"],
};

/* ── 3) ZOEKMACHINE ────────────────────────────────────────────────
   buildZkSearch(kaarten) → search(query) → gesorteerde resultaten
   (beste eerst). Elk resultaat: { item, score, matches }.          */
function buildZkSearch(items) {
  const fuse = new Fuse(items, {
    keys: ZK_CONFIG.keys,
    includeScore: true,
    includeMatches: true,
    threshold: ZK_CONFIG.threshold,
    ignoreLocation: ZK_CONFIG.ignoreLocation,
    minMatchCharLength: ZK_CONFIG.minMatchCharLength,
  });

  const wordsOf = it =>
    (String(it.title || "") + " " + (it.aliases || []).join(" "))
      .toLowerCase().split(/[\s\-/]+/).filter(Boolean);

  return function search(query) {
    const q = (query || "").trim();
    if (!q) return [];
    const ql = q.toLowerCase();

    // synoniemen erbij
    const terms = [q];
    const padded = " " + ql + " ";
    for (const key in ZK_SYNONYMS) {
      if (padded.includes(" " + key + " ")) terms.push(...ZK_SYNONYMS[key]);
    }

    // beste score per kaart over alle (synoniem)termen
    const best = new Map();
    for (const t of terms) {
      for (const r of fuse.search(t)) {
        const id = r.item.id ?? r.item.title;
        const prev = best.get(id);
        if (!prev || r.score < prev.score) best.set(id, r);
      }
    }

    // prefix-boost + exacte-treffer-boost → sterkste hits bovenaan
    let arr = [...best.values()];
    arr.forEach(r => {
      const words = wordsOf(r.item);
      if (words.some(w => w.startsWith(ql))) { r._prefix = true; r.score *= 0.3; }
      if (String(r.item.title || "").toLowerCase() === ql ||
          (r.item.aliases || []).some(a => String(a).toLowerCase() === ql)) r.score *= 0.1;
    });
    // korte zoekterm = prefix bedoeld → losse fuzzy-treffers weg
    if (ql.length <= ZK_CONFIG.shortQueryMax && arr.some(r => r._prefix)) {
      arr = arr.filter(r => r._prefix);
    }
    return arr.sort((a, b) => a.score - b.score);
  };
}

/* ── 4) HIGHLIGHT-HELPERS ──────────────────────────────────────────
   Zet <mark> om de gevonden letters in een veld.                   */
function zkEsc(s){ return String(s).replace(/[&<>]/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

function zkHighlight(value, indices){
  if(!indices || !indices.length) return zkEsc(value);
  const ranges = indices.filter(([s,e]) => e - s >= 1).sort((a,b)=>a[0]-b[0]);
  if(!ranges.length) return zkEsc(value);
  let html = "", last = 0;
  for(const [s,e] of ranges){
    if(s < last) continue;
    html += zkEsc(value.slice(last, s)) + "<mark>" + zkEsc(value.slice(s, e+1)) + "</mark>";
    last = e + 1;
  }
  return html + zkEsc(value.slice(last));
}
function zkMatch(r, key){ return (r.matches || []).find(m => m.key === key); }

/* ════════════════════════════════════════════════════════════════
   GEBRUIK IN ZAKKAART
   ----------------------------------------------------------------
   const search = buildZkSearch(MIJN_KAARTEN);

   inputEl.addEventListener("input", () => {
     const res = search(inputEl.value);
     listEl.innerHTML = res.map(r => `
       <article class="kaart">
         <h3>${zkHighlight(r.item.title, zkMatch(r,"title")?.indices)}</h3>
         <p>${zkHighlight(r.item.content, zkMatch(r,"content")?.indices)}</p>
       </article>`).join("");
   });

   CSS voor de highlight:
     mark{ background:rgba(62,166,255,.22); color:inherit;
           border-radius:3px; padding:0 1px; font-weight:600; }
   ----------------------------------------------------------------
   Hebben je kaarten GEEN plat 'content'-veld maar losse secties
   (bv. { dosering, aandachtspunten, lijnen })? Bouw dan vóór het
   zoeken één doorzoekbaar veld per kaart:

     const flat = MIJN_KAARTEN.map(k => ({
       ...k,
       content: [k.dosering, k.aandachtspunten, k.lijnen]
                  .filter(Boolean).join(" "),
     }));
     const search = buildZkSearch(flat);
   ════════════════════════════════════════════════════════════════ */
