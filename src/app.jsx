    const { useState, useMemo, useRef, useEffect, useContext } = React;

// Context waarmee een zoekresultaat de juiste Collapse automatisch openklapt + erheen scrollt
const CollapseTargetCtx = React.createContext(null);
const normTitle = s => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Onzichtbaar afbreekpunt na "/" en ")" zodat lange samenstellingen netjes over twee regels vallen
const zw = t => String(t).replace(/([\/)])(?=\S)/g, "$1\u200B");

// Zoeksynoniemen voor de zoekbalk (fuzzy search via Fuse.js): merknaam <-> stofnaam
// en veelgebruikte afkortingen/concepten, zodat "esmeron" ook "rocuronium" vindt en omgekeerd.
const ZOEK_SYNONIEMEN = {
  esmeron: ["rocuronium"], rocuronium: ["esmeron"],
  diprivan: ["propofol"], propofol: ["diprivan"],
  ultiva: ["remifentanil"], remifentanil: ["ultiva"],
  sufenta: ["sufentanil"], sufentanil: ["sufenta"],
  dormicum: ["midazolam"], midazolam: ["dormicum"],
  bridion: ["sugammadex"], sugammadex: ["bridion"],
  nimbex: ["cisatracurium"], cisatracurium: ["nimbex"],
  tracrium: ["atracurium"], atracurium: ["tracrium"],
  dipidolor: ["piritramide"], piritramide: ["dipidolor"],
  ponv: ["misselijkheid", "antiemetica", "ondansetron", "dexamethason"],
  rsi: ["rapid sequence", "crash inductie"],
  tiva: ["propofol", "remifentanil", "totale intraveneuze"],
  avr: ["aortaklep", "klepvervanging"],
  cabg: ["bypass", "coronair"],
  rotem: ["stolling", "tromboelastometrie"],
  sbar: ["overdracht"],
};


// ============================================================
// COLLAPSIBLE CARD COMPONENT (top-level for state persistence)
// ============================================================

const ChevronRight = ({ className = "zk-chev" }) => (
  <svg className={className} viewBox="0 0 8 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 1.5l5 5-5 5" />
  </svg>
);

function Collapse({ title, color = "#fff", children, defaultOpen = false, icon = null }) {
  const [open, setOpen] = useState(defaultOpen);
  const target = useContext(CollapseTargetCtx);
  const elRef = useRef(null);
  useEffect(() => {
    if (target && target.title && normTitle(title) === normTitle(target.title)) {
      setOpen(true);
      const t = setTimeout(() => {
        if (elRef.current && elRef.current.scrollIntoView) {
          elRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 90);
      return () => clearTimeout(t);
    }
  }, [target]);
  const tint = !color || color === "#fff" ? "#8E8E93" : color;
  return (
    <div ref={elRef} className={"zk-collapse" + (open ? " is-open" : "")}>
      <button type="button" className="zk-collapse-head" data-collapse-head aria-expanded={open} onClick={() => setOpen(p => !p)}>
        {icon && (
          <span className="zk-ic" style={{ background: tint }}>
            {React.cloneElement(icon, { width: 17, height: 17 })}
          </span>
        )}
        <span className="zk-collapse-title">{title}</span>
        <ChevronRight />
      </button>
      {open && (
        <div className="zk-collapse-body">
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SCROLL PICKER COMPONENT (iOS-stijl trommelroller)
// ============================================================

function ScrollPicker({ items, selectedIndex, onIndexChange, label }) {
  const ref = useRef(null);
  const itemH = 34;
  // Onthoudt of de laatste selectedIndex-wijziging van de eigen scroll/tik kwam.
  // Zo niet corrigeren we de scrollpositie NIET tijdens een lopende scrollbeweging
  // van de gebruiker — alleen bij een externe wijziging (bv. de leeftijd die het
  // gewicht automatisch aanpast).
  const isInternalChange = useRef(false);

  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    if (ref.current) {
      const current = Math.round(ref.current.scrollTop / itemH);
      if (current !== selectedIndex) ref.current.scrollTop = selectedIndex * itemH;
    }
  }, [selectedIndex]);

  const handleScroll = () => {
    if (!ref.current) return;
    const idx = Math.round(ref.current.scrollTop / itemH);
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    if (clamped !== selectedIndex) {
      isInternalChange.current = true;
      onIndexChange(clamped);
    }
  };

  // Alle regels hebben dezelfde lettergrootte: tijdens het draaien verspringt er niets.
  return (
    <div className="zk-wheel">
      <div ref={ref} className="zk-wheel-scroll" onScroll={handleScroll} role="listbox" aria-label={label} tabIndex={0}>
        {items.map((item, i) => (
          <div
            key={i}
            className="zk-wheel-item"
            role="option"
            aria-selected={i === selectedIndex}
            onClick={() => {
              isInternalChange.current = true;
              onIndexChange(i);
              if (ref.current) ref.current.scrollTop = i * itemH;
            }}
          >{item.label}</div>
        ))}
      </div>
    </div>
  );
}
// Weergave van een dosis. Onder 0,1 tonen we twee significante cijfers, zodat
// 0,0075 niet wordt afgerond naar 0,01 (dat scheelt bij lichte kinderen tientallen procenten).
function fmtDose(d) {
  if (d == null || isNaN(d)) return null;
  if (d < 0.1) return String(parseFloat(d.toPrecision(2)));
  return d < 1 ? d.toFixed(2) : d < 10 ? d.toFixed(1) : d.toFixed(0);
}

// Eén rekenfunctie voor dosis/concentratie/pompstand — gebruikt door zowel
// de per-middel lijst als de Overzichtskaart, om afwijkende logica te voorkomen.
function computeMedDosis(m, calcWeight, age, hasAge) {
  let dosis = (calcWeight * m.factor);
  // Atropine: minimum 0,1 mg en maximum 0,5 mg. Het minimum is hoger dan 0,02 mg/kg
  // bij elk kind onder 5 kg; de rekenregel blijft staan, maar we melden het (minClamp).
  let minClamp = false;
  if (m.med.includes("Atropine")) {
    minClamp = dosis < 0.1;
    dosis = Math.max(0.1, Math.min(0.5, dosis));
  }
  // Paracetamol: lagere dosis bij <=10 kg (Kinderformularium/FK)
  if (m.med === "Paracetamol" && calcWeight <= 10) {
    dosis = calcWeight * 7.5;
  }
  // Cefuroxim: SWAB-richtlijn — vanaf 40 kg vaste volwassendosis (1,5 g), geen verdere opschaling
  if (m.med === "Cefuroxim" && calcWeight >= 40) {
    dosis = 1500;
  }
  // Onderhoudsvocht 4-2-1 regel (Holliday-Segar): getrapte berekening i.p.v. simpele factor x gewicht
  if (m.is421) {
    dosis = calcWeight <= 10 ? calcWeight * 4
      : calcWeight <= 20 ? 10 * 4 + (calcWeight - 10) * 2
      : 10 * 4 + 10 * 2 + (calcWeight - 20) * 1;
  }
  const dosisStr = fmtDose(dosis);
  // Heel kleine mg-doses ook in microgram tonen: minder kans op een kommafout
  // (afgeleid van de getoonde mg-waarde, zodat beide regels altijd hetzelfde zeggen)
  const altStr = m.unit.startsWith("mg") && dosis < 0.1
    ? `${fmtDose(Math.round(parseFloat(dosisStr) * 1e6) / 1e3)} µg${m.unit.slice(2)}`
    : null;
  const perKgStr = minClamp ? String(parseFloat((dosis / calcWeight).toPrecision(2))).replace(".", ",") : null;
  const medKleur = getMedKleur(m.med);
  // AUMC: <3 jaar altijd 1% (10 mg/ml). Vanaf 3 jaar: inductie 1%, onderhoud 2% (20 mg/ml).
  const isPropofol = m.med.includes("Propofol");
  const propConc = isPropofol && hasAge
    ? (age < 3 ? 10 : (m.perUur ? 20 : 10))
    : null;
  const propPct = propConc === 10 ? "1%" : propConc === 20 ? "2%" : null;
  const propLabel = !hasAge ? null : age < 3 ? "<3 jr → 1%" : (m.perUur ? "≥3 jr, onderhoud → 2%" : "≥3 jr, inductie → 1%");
  const propMl = propConc ? dosis / propConc : null;
  const propMlStr = propMl != null ? fmtDose(propMl) : null;
  // Generieke pompstand (ml/uur) voor infuusmiddelen met een vaste spuitconcentratie (m.pompConc, in dezelfde eenheid als m.unit)
  const pompMlUur = m.pompConc
    ? (m.unit.endsWith("/min") ? (dosis * 60) / m.pompConc : m.unit.endsWith("/uur") ? dosis / m.pompConc : null)
    : null;
  const pompMlUurStr = pompMlUur != null ? fmtDose(pompMlUur) : null;
  return { dosis, dosisStr, altStr, minClamp, perKgStr, medKleur, isPropofol, propConc, propPct, propLabel, propMl, propMlStr, pompMlUur, pompMlUurStr };
}

function calcStandardWeight(ageYears) {
  const m = ageYears * 12;
  if (m <= 1) return 4;
  if (m <= 3) return 5;
  if (m <= 6) return 7;
  if (m <= 9) return 9;
  if (m <= 12) return 10;
  if (ageYears <= 10) return Math.round(2.5 * ageYears + 8);
  if (ageYears <= 14) return Math.round(4 * ageYears - 2);
  return Math.round(5 * ageYears - 10);
}

// ============================================================
// DATA CONFIG — Edit hier om content toe te voegen of te wijzigen
// ============================================================


// ============================================================
// MEDICATIE KLEURCODERING (conform fysieke labelrollen op OK)
// ============================================================
const MED_KLEUREN = {
  // Inductie — geel
  "Propofol": { bg: "#F5C518", text: "#333" },
  "Propofol (inductie)": { bg: "#F5C518", text: "#333" },
  "Propofol (onderhoud)": { bg: "#F5C518", text: "#333" },
  "Thiopental": { bg: "#F5C518", text: "#333" },
  "Etomidate": { bg: "#F5C518", text: "#333" },
  "S-Ketamine": { bg: "#F5C518", text: "#333" },
  "Esketamine": { bg: "#F5C518", text: "#333" },
  "Ketanest": { bg: "#F5C518", text: "#333" },
  "Sevofluraan": { bg: "#F5C518", text: "#333" },
  // Opiaten — lichtblauw (uniform voor alle opioïden)
  "Morfine": { bg: "#5DADE2", text: "#fff" },
  "Methadon": { bg: "#5DADE2", text: "#fff" },
  "Sufentanil": { bg: "#5DADE2", text: "#fff" },
  "Sufentanyl": { bg: "#5DADE2", text: "#fff" },
  "Sufentanil (inductie)": { bg: "#5DADE2", text: "#fff" },
  "Remifentanil": { bg: "#5DADE2", text: "#fff" },
  "Fentanyl": { bg: "#5DADE2", text: "#fff" },
  // Spierverslappers — rood
  "Rocuronium": { bg: "#E74C3C", text: "#fff" },
  "Succinylcholine": { bg: "#E74C3C", text: "#fff" },
  "Atracurium": { bg: "#E74C3C", text: "#fff" },
  // Anticholinergica & sympathicolytica — paars
  "Atropine": { bg: "#8E44AD", text: "#fff" },
  "Atropinesulfaat": { bg: "#8E44AD", text: "#fff" },
  "+Atropinesulfaat": { bg: "#8E44AD", text: "#fff" },
  "Atropine (nood)": { bg: "#8E44AD", text: "#fff" },
  "Efedrine": { bg: "#8E44AD", text: "#fff" },
  "Glycopyrronium": { bg: "#8E44AD", text: "#fff" },
  "+Glycopyrronium": { bg: "#8E44AD", text: "#fff" },
  // Sedativa / hypnotica — oranje
  "Midazolam": { bg: "#E67E22", text: "#fff" },
  // Analgetica niet-opioid — oranje (lichter)
  "Metamizol": { bg: "#FFFFFF", text: "#333" },
  "Paracetamol": { bg: "#FFFFFF", text: "#333" },
  "Clonidine": { bg: "#F39C12", text: "#333" },
  // Locale anesthetica — lichtbruin
  "Lidocaïne": { bg: "#C49A6C", text: "#333" },
  "Bupivacaïne": { bg: "#C49A6C", text: "#333" },
  // Vasopressoren — zelfde paars als efedrine
  "Noradrenaline": { bg: "#8E44AD", text: "#fff" },
  "Fenylefrine": { bg: "#8E44AD", text: "#fff" },
  // Noodmedicatie — rood
  "Adrenaline": { bg: "#C0392B", text: "#fff" },
  "Adrenaline (nood)": { bg: "#C0392B", text: "#fff" },
  "Defibrillatie": { bg: "#C0392B", text: "#fff" },
  // Antagonisten — donkerrood met zwart accent
  "Sugammadex": { bg: "#7B241C", text: "#fff" },
  "Naloxone": { bg: "#7B241C", text: "#fff" },
  "Neostigmine": { bg: "#7B241C", text: "#fff" },
  "Flumazenil": { bg: "#7B241C", text: "#fff" },
  // Antiemetica — beige / bruin
  "Ondansetron": { bg: "#D2B48C", text: "#333" },
  "Dexamethason": { bg: "#7B3F00", text: "#fff" },
  "Droperidol": { bg: "#7B3F00", text: "#fff" },
  // Antibiotica — wit
  "Cefazoline": { bg: "#ECF0F1", text: "#333" },
  "Amoxicilline": { bg: "#FFFFFF", text: "#333" },
  // Antifibrinolytica — wit
  "Tranexaminezuur": { bg: "#FFFFFF", text: "#333" },
  "Metronidazol": { bg: "#ECF0F1", text: "#333" },
  // Transfusie — rood (bloed)
  "Erytrocytenconcentraat": { bg: "#C0392B", text: "#fff" },
};

function getMedKleur(naam) {
  if (!naam) return null;
  return MED_KLEUREN[naam] || MED_KLEUREN[naam.replace(/\s*\(.*\)/, "")] || null;
}

// Leeftijdsitems voor trommelroller (1 mnd t/m 18 jr)
const AGE_ITEMS = (() => {
  const items = [];
  for (let m = 1; m <= 11; m++) items.push({ label: `${m} mnd`, value: m / 12 });
  for (let y = 1; y <= 18; y++) items.push({ label: `${y} jr`, value: y });
  return items;
})();

// Gewichten voor het wiel — prematuren/neonaten 0,5 t/m 2,9 kg per 100 gram, daarna 3 t/m 80 kg per kilo
const WEIGHT_ITEMS = [
  ...Array.from({ length: 25 }, (_, i) => (5 + i) / 10).map(v => ({ label: `${String(v).replace(".", ",")} kg`, value: v })),
  ...Array.from({ length: 78 }, (_, i) => ({ label: `${i + 3} kg`, value: i + 3 })),
];
const weightIndexFor = kg => Math.max(0, WEIGHT_ITEMS.findIndex(it => it.value === kg));

// Prematuren & neonaten (< 3 kg) — gewicht-gebaseerde maten (uncuffed)
const NEONAAT_TUBES = [
  { gewicht: "< 1 kg", zwangerschap: "< 28 wk", ett: "2.5", diepte: "6–7", sonde: "5", katheter: "5" },
  { gewicht: "1–2 kg", zwangerschap: "28–34 wk", ett: "3.0", diepte: "7–8", sonde: "6", katheter: "6" },
  { gewicht: "2–3 kg", zwangerschap: "34–38 wk", ett: "3.0–3.5", diepte: "8–9", sonde: "6–8", katheter: "6" },
  { gewicht: "à terme", zwangerschap: "> 38 wk", ett: "3.5", diepte: "9–10", sonde: "8", katheter: "6–8" },
];

const NOODNUMMERS = {
  brand: "8888",
  reanimatie: "2222",
  centraleBalie: "9",
};

const TELEFOON_AMC = {
  vast: [
    { naam: "OK-balie", nummer: "63313" },
    { naam: "PACU", nummer: "69100" },
    { naam: "Koffiekamer", nummer: "77556" },
    { naam: "Koffiekamer Dagcentrum", nummer: "66704" },
    { naam: "OK-anesthesiologie", nummer: "775 + (OK-nr +30)" },
    { naam: "Bloedbank", nummer: "62526" },
    { naam: "Citolab", nummer: "62525" },
    { naam: "ICT", nummer: "63011" },
    { naam: "Perfusie kantoor", nummer: "62611" },
    { naam: "Patiëntenvervoer", nummer: "63300" },
    { naam: "Arbodienst (prikaccident, 08–16.30u)", nummer: "020-566 20 83" },
    { naam: "Technische dienst", nummer: "81-58441" },
    { naam: "René", nummer: "28711" },
  ],
  dagcentrumOK: [
    { naam: "OK 1D", nummer: "72103" },
    { naam: "OK 2D", nummer: "72102" },
    { naam: "OK 3D", nummer: "72101" },
    { naam: "OK 4D", nummer: "72104" },
    { naam: "OK 5D", nummer: "72105" },
  ],
  ic: [
    { naam: "IC bedden (als ze op zijn)", nummer: "29231" },
    { naam: "Kinder IC", nummer: "62754" },
    { naam: "Kinderintensivist (bed regelen)", nummer: "81-59319" },
    { naam: "Stip Kinder IC", nummer: "29878" },
    { naam: "Stip IC", nummer: "81-58315" },
  ],
  bloed: [
    { naam: "LS halen bloed (sein)", nummer: "81-59230" },
    { naam: "Polo halen bloed", nummer: "29230" },
    { naam: "Patiëntenvervoer bloed (in dienst)", nummer: "63300" },
  ],
  buizenpost: [
    { naam: "OK", nummer: "419" },
    { naam: "High Care", nummer: "812" },
  ],
  sein: [
    { naam: "Dagcoörd. anesthesie", nummer: "81-59571" },
    { naam: "Dagcoörd. anesthesiologen", nummer: "81-59662" },
    { naam: "Reanimatiesein", nummer: "81-59577" },
    { naam: "Acute sein", nummer: "81-59154" },
    { naam: "Dagcoörd. operatieassistenten", nummer: "81-59152" },
    { naam: "Dagcoörd. dagcentrum", nummer: "81-59126" },
    { naam: "Technische dienst", nummer: "81-58441" },
    { naam: "Logistieke dienst", nummer: "81-59230" },
    { naam: "Schoonmaak", nummer: "81-59398" },
    { naam: "Stip IC", nummer: "81-58315" },
    { naam: "Apotheek op OK", nummer: "81-59481" },
    { naam: "Perfusie", nummer: "81-57388" },
  ],
  dienstAM: [
    { naam: "MT 1", nummer: "81-595821" },
    { naam: "MT 2", nummer: "81-595822" },
    { naam: "MA", nummer: "20936 t/m 20940" },
  ],
  dienstAnes: [
    { naam: "Oudste AIOS", nummer: "81-59576" },
    { naam: "Jongste AIOS", nummer: "81-59573" },
    { naam: "Anesthesioloog", nummer: "81-59530 / 81-59533" },
  ],
};

const TELEFOON_VUMC = {
  vast: [
    { naam: "OK-balie", nummer: "44545" },
    { naam: "Koffiekamer 7A", nummer: "47092 / 47061" },
    { naam: "Koffiekamer 1D", nummer: "45170" },
    { naam: "Bloedbank", nummer: "42620" },
    { naam: "ICT", nummer: "40777 / 85810" },
    { naam: "Technische dienst", nummer: "64259 / 61239" },
  ],
  sein: [
    { naam: "Dagcoörd. anesthesie", nummer: "*986051" },
    { naam: "Dagcoörd. anesthesiologen", nummer: "61707" },
    { naam: "PACU", nummer: "*986029" },
    { naam: "Technische dienst", nummer: "64259 / 61239" },
    { naam: "Logistieke dienst 6e", nummer: "64446" },
    { naam: "Logistieke dienst 2e", nummer: "64138" },
    { naam: "Schoonmaak 6e", nummer: "61857" },
    { naam: "Schoonmaak 2e", nummer: "61206" },
    { naam: "Stip IC", nummer: "61642" },
    { naam: "Infectiepreventie", nummer: "61293" },
    { naam: "Röntgen", nummer: "61164" },
  ],
  dienstAM: [
    { naam: "Gangdienst", nummer: "*986392" },
    { naam: "Acute sein klinische OK", nummer: "*986380" },
    { naam: "Buitenlocatie sein", nummer: "61032" },
    { naam: "Sedatie MDL", nummer: "64105 / 64106 / 64107" },
    { naam: "Longsedatie", nummer: "35720" },
    { naam: "Radiologie sedatie", nummer: "35719" },
  ],
  dienstAnes: [
    { naam: "AIOS", nummer: "61151" },
    { naam: "Anesthesioloog", nummer: "*986273" },
  ],
};

const DIENSTEN_AMC = [
  { code: "MD", naam: "Dagdienst", tijd: "07:30 – 17:00" },
  { code: "MF", naam: "Dagdienst flex", tijd: "07:30 – 17:00" },
  { code: "MT", naam: "Tussendienst", tijd: "09:00 – 18:30" },
  { code: "MA", naam: "Latedienst", tijd: "13:30 – 23:00" },
  { code: "MN", naam: "Nachtdienst", tijd: "22:30 – 08:00" },
];

const DIENSTEN_VUMC = [
  { code: "BD", naam: "Dagdienst", tijd: "07:15 – 16:45" },
  { code: "BT", naam: "Tussendienst", tijd: "09:30 – 19:00" },
  { code: "BM", naam: "Middagdienst", tijd: "12:00 – 21:30" },
  { code: "BA", naam: "Avonddienst", tijd: "13:30 – 23:00" },
  { code: "BN", naam: "Nachtdienst", tijd: "22:30 – 08:00" },
];

const OK_SPECIALISMEN = [
  { ok: "1–3", spec: "Cardiothoracale chirurgie" },
  { ok: "4", spec: "Spoed Cardiothoracale chirurgie" },
  { ok: "5", spec: "Acute kamer" },
  { ok: "6", spec: "Open vaatchirurgie" },
  { ok: "7", spec: "Vaatchirurgie (Hybride)" },
  { ok: "8", spec: "Trauma / Neurochirurgie / Spoed Gynaecologie" },
  { ok: "9", spec: "Plastische chirurgie / MKA / Oogheelkunde" },
  { ok: "10", spec: "KNO / Spoed bronchoscopiekamer" },
  { ok: "11", spec: "Neurochirurgie (klein)" },
  { ok: "12", spec: "Neurochirurgie (groot)" },
  { ok: "14", spec: "Sectiokamer" },
  { ok: "15", spec: "Kinderchirurgie" },
  { ok: "16", spec: "Orthopedie / Trauma" },
  { ok: "17", spec: "Robotchirurgie" },
  { ok: "18", spec: "Gynaecologie" },
  { ok: "19", spec: "Chirurgie / Gynaecologie" },
  { ok: "20", spec: "Chirurgie / Gynaecologie / Orthopedie / Trauma" },
  { ok: "21", spec: "Orthopedie / Trauma" },
];

// Legenda Schipholbord — kleurcodes OK-planningsbord (patiëntflow)
// Buissoorten AMC — Centraal Diagnostisch Laboratorium (controledatum 06-08-2022)
const BUISSOORTEN = [
  {
    code: "CIT3",
    kenmerk: "Lichtblauwe dop",
    dopKleur: "#A8D8EA",
    dopTekst: "#333",
    anticoagulans: "Na Citraat",
    volume: "2,7 ml",
    bestelnr: "13735",
    doel: "Stollingsonderzoek (PT, APTT, fibrinogeen, D-dimeer)",
    opmerking: "Na vullen minimaal 10 sec aangekoppeld houden",
  },
  {
    code: "STX6",
    kenmerk: "Rode dop",
    dopKleur: "#C0392B",
    dopTekst: "#fff",
    anticoagulans: "Geen",
    volume: "6,0 ml",
    bestelnr: "13736",
    doel: "Serologie, immunologie, kruisbloed",
    opmerking: "",
  },
  {
    code: "STG5",
    kenmerk: "Gele dop",
    dopKleur: "#F1C40F",
    dopTekst: "#333",
    anticoagulans: "Stol Gel",
    volume: "5,0 ml",
    bestelnr: "13737",
    doel: "Klinische chemie (elektrolyten, leverfuncties, nierfuncties, glucose, hormonen)",
    opmerking: "",
  },
  {
    code: "STE6",
    kenmerk: "Donkerblauwe dop",
    dopKleur: "#1A3A5C",
    dopTekst: "#fff",
    anticoagulans: "Silica (stol act)",
    volume: "6,0 ml",
    bestelnr: "17357",
    doel: "Spoorelementen (zink, koper, selenium) — metaalvrij",
    opmerking: "Mèt rode streep op etiket!",
  },
  {
    code: "SPUI",
    kenmerk: "Spuit bloedgas",
    dopKleur: "#BDC3C7",
    dopTekst: "#333",
    anticoagulans: "—",
    volume: "—",
    bestelnr: "—",
    doel: "Arterieel bloedgas (pH, pO₂, pCO₂, HCO₃, BE, lactaat)",
    opmerking: "Spuit specifiek voor bloedgas",
  },
  {
    code: "HPX4",
    kenmerk: "Donkergroene dop",
    dopKleur: "#1E8449",
    dopTekst: "#fff",
    anticoagulans: "Li Hep",
    volume: "4,0 ml",
    bestelnr: "17421",
    doel: "Klinische chemie (spoed), ammoniakbepaling",
    opmerking: "",
  },
  {
    code: "HPX6",
    kenmerk: "Donkergroene dop",
    dopKleur: "#1E8449",
    dopTekst: "#fff",
    anticoagulans: "Li Hep",
    volume: "6,0 ml",
    bestelnr: "368886",
    doel: "Klinische chemie, medicijnspiegels (bijv. digoxine, cyclosporine)",
    opmerking: "",
  },
  {
    code: "HPX9",
    kenmerk: "Donkergroene dop, Vacuette",
    dopKleur: "#1E8449",
    dopTekst: "#fff",
    anticoagulans: "Na Hep",
    volume: "9,0 ml",
    bestelnr: "30682",
    doel: "Chromosomenonderzoek, cytogenetica",
    opmerking: "",
  },
  {
    code: "HPG3",
    kenmerk: "Lichtgroene dop",
    dopKleur: "#82E0AA",
    dopTekst: "#333",
    anticoagulans: "Hep Gel",
    volume: "3,0 ml",
    bestelnr: "63519",
    doel: "Klinische chemie (kleine volumes, pediatrie)",
    opmerking: "",
  },
  {
    code: "HPG4",
    kenmerk: "Lichtgroene dop",
    dopKleur: "#82E0AA",
    dopTekst: "#333",
    anticoagulans: "Hep Gel",
    volume: "4,5 ml",
    bestelnr: "13757",
    doel: "Klinische chemie (elektrolyten, enzymen, eiwitten)",
    opmerking: "",
  },
  {
    code: "EDT3",
    kenmerk: "Transparant paarse dop",
    dopKleur: "#D7BDE2",
    dopTekst: "#333",
    anticoagulans: "K₂ EDTA",
    volume: "3,0 ml",
    bestelnr: "13747",
    doel: "Hematologie (bloedbeeld, Hb, Ht, MCV) — kleine volumes",
    opmerking: "",
  },
  {
    code: "EDT4",
    kenmerk: "Paarse dop",
    dopKleur: "#7D3C98",
    dopTekst: "#fff",
    anticoagulans: "K₂ EDTA",
    volume: "4,0 ml",
    bestelnr: "13732",
    doel: "Hematologie (bloedbeeld, differentiatie, reticulocyten)",
    opmerking: "",
  },
  {
    code: "EDT6",
    kenmerk: "Paarse dop",
    dopKleur: "#7D3C98",
    dopTekst: "#fff",
    anticoagulans: "K₂ EDTA",
    volume: "6,0 ml",
    bestelnr: "13738",
    doel: "Hematologie, HbA1c, bloedgroep & kruisbloed",
    opmerking: "",
  },
  {
    code: "ETE6",
    kenmerk: "Donkerblauwe dop",
    dopKleur: "#1A3A5C",
    dopTekst: "#fff",
    anticoagulans: "K₂ EDTA",
    volume: "6,0 ml",
    bestelnr: "16554",
    doel: "Moleculaire diagnostiek, DNA-onderzoek",
    opmerking: "Met paarse streep op etiket",
  },
  {
    code: "EDT9",
    kenmerk: "Paarse dop, Vacuette",
    dopKleur: "#7D3C98",
    dopTekst: "#fff",
    anticoagulans: "K₃ EDTA",
    volume: "9,0 ml",
    bestelnr: "—",
    doel: "Hematologie grote volumes, beenmergonderzoek",
    opmerking: "Alleen via LAKC B1-112",
  },
  {
    code: "FLU2",
    kenmerk: "Transparant grijze dop",
    dopKleur: "#AAB7B8",
    dopTekst: "#333",
    anticoagulans: "NaF / Na₂EDTA",
    volume: "2,0 ml",
    bestelnr: "13734",
    doel: "Glucose (remt glycolyse), lactaat",
    opmerking: "",
  },
  {
    code: "QTB",
    kenmerk: "Setje van 4 buizen",
    dopKleur: "#E67E22",
    dopTekst: "#fff",
    anticoagulans: "—",
    volume: "—",
    bestelnr: "—",
    doel: "Kweken (bloed-, urine-, liquor- en wondkweek)",
    opmerking: "Vóóraf ophalen bij LMIM, G1-111 tel: 62624. Inleveren vóór 16:00 uur",
  },
];

const NIET_BUIZENPOST = [
  "Kweek flessen",
  "Dysmorfe erytrocyten in urine materiaal",
  "Bloedzakken van of voor het Transfusielaboratorium",
];

const SCHIPHOLBORD = [
  { fase: "In ziekenhuis", kleur: "#F0E68C", tekst: "#555" },
  { fase: "Gebeld", kleur: "#2E6EB5", tekst: "#fff" },
  { fase: "Pre-op", kleur: "#D4782F", tekst: "#fff" },
  { fase: "Intra-operatief", kleur: "#DAC230", tekst: "#555" },
  { fase: "Inleiding", kleur: "#7B4BA0", tekst: "#fff" },
  { fase: "Vrijgave chirurgie", kleur: "#C0392B", tekst: "#fff" },
  { fase: "Incisie", kleur: "#1B7A3D", tekst: "#fff" },
  { fase: "Eind snijder", kleur: "#F0C8A0", tekst: "#555" },
  { fase: "Uit OK", kleur: "#2E6EB5", tekst: "#fff" },
  { fase: "Post-op", kleur: "#C44569", tekst: "#fff" },
  { fase: "Stepdown", kleur: "#6BB5C9", tekst: "#fff" },
  { fase: "Compleet", kleur: "#5EAE8B", tekst: "#fff" },
];

// AMC bouwdelen — afdelingen per gebouw
const AMC_BOUWDELEN = [
  {
    bouwdeel: "A",
    kleur: "#2980B9",
    omschrijving: "Centrale as — poliklinieken & Poliplein",
    afdelingen: [
      "Poliplein (begane grond)",
      "Patiëntenregistratie",
      "Patiëntenvoorlichting & Klachtenopvang",
      "Ronald McDonaldhuis (via Hoofdingang)",
    ],
  },
  {
    bouwdeel: "B",
    kleur: "#8E44AD",
    omschrijving: "West — poliklinieken & apotheek",
    afdelingen: [
      "Apotheek (begane grond)",
      "Polikliniek Anesthesiologie (89)",
      "Polikliniek Chirurgie / Gynaecologie (54–69)",
      "SEH & Huisartsenpost (buitenom rode poort)",
    ],
  },
  {
    bouwdeel: "C",
    kleur: "#16A085",
    omschrijving: "Centraal — apotheek & poliklinieken",
    afdelingen: [
      "Apotheek",
      "Zorgwinkel",
      "Brievenbus / Geldautomaat",
      "Cardiologie / Cardiothoracale chirurgie",
      "Dagbehandelingsunit (DBU)",
      "Dermatologie / SNIP",
    ],
  },
  {
    bouwdeel: "D",
    kleur: "#D35400",
    omschrijving: "Dagcentrum & poliklinieken",
    afdelingen: [
      "Dagcentrum (OK's dagcentrum)",
      "Polikliniek Neurologie / Neurochirurgie",
      "Polikliniek Reumatologie",
      "Polikliniek Nierziekten",
    ],
  },
  {
    bouwdeel: "E",
    kleur: "#27AE60",
    omschrijving: "Oost — poliklinieken",
    afdelingen: [
      "Polikliniek Orthopedie & Sportgeneeskunde",
      "Polikliniek Revalidatiegeneeskunde",
      "Polikliniek Vaatchirurgie",
    ],
  },
  {
    bouwdeel: "F",
    kleur: "#2C3E50",
    omschrijving: "Verpleegafdelingen — lift bij F",
    afdelingen: [
      "Verpleegafdelingen (meerdere etages)",
      "Collegezaal 1 (begane grond)",
      "Annaplein (begane grond)",
    ],
  },
  {
    bouwdeel: "G",
    kleur: "#2C3E50",
    omschrijving: "Verpleegafdelingen & voorzieningen — lift bij G",
    afdelingen: [
      "Verpleegafdelingen (meerdere etages)",
      "Collegezaal 4 (begane grond)",
      "Stilteruimte & Islamitische gebedsruimte",
      "Costerzaal / Fonteynzaal / De Vrijzaal",
      "Voetenplein (Restaurant, AH to go, CoffeeCompany)",
    ],
  },
  {
    bouwdeel: "H",
    kleur: "#2C3E50",
    omschrijving: "Verpleegafdelingen & Emma KZH — lift bij H",
    afdelingen: [
      "Verpleegafdelingen (meerdere etages)",
      "Emma Kinderziekenhuis",
      "Collegezaal 5 (begane grond)",
      "Vrijwilligersplein",
      "Verschoningsruimte",
      "Ingang West / P2",
    ],
  },
  {
    bouwdeel: "J",
    kleur: "#7F8C8D",
    omschrijving: "Noord — Studieplein & Museum",
    afdelingen: [
      "Studieplein",
      "Museum Vrolik",
      "Collegezalen 2 & 3",
      "Ingang Oost (P4)",
    ],
  },
  {
    bouwdeel: "K / L",
    kleur: "#7F8C8D",
    omschrijving: "Noord — Medische Bibliotheek",
    afdelingen: [
      "Medische Bibliotheek",
      "Collegezalen",
    ],
  },
  {
    bouwdeel: "M",
    kleur: "#7F8C8D",
    omschrijving: "Noord-oost",
    afdelingen: [
      "Ingang West (P2) aan de oostzijde",
    ],
  },
  {
    bouwdeel: "Q",
    kleur: "#C0392B",
    omschrijving: "Zuid-oost — APC & Dianet",
    afdelingen: [
      "Academisch Psychiatrisch Centrum (APC)",
      "Dianet (dialyse)",
    ],
  },
];

const ABCDE = [
  {
    letter: "A",
    titel: "Airway",
    subtitel: "Luchtweg",
    kleur: "#FF453A",
    observaties: [
      "Luchtweg vrij en goed gepositioneerd na intubatie?",
      "Correcte plaatsing ETT of supraglottische luchtweg (larynxmasker)",
      "Luchtwegweerstand en eventuele lekkage bij beademing?",
    ],
    risicos: [
      "Tube dislocatie of obstructie (secreties, bronchospasme)",
      "Moeilijke intubatie of aspiratie",
    ],
    acties: [
      "Bevestiging met capnografie (EtCO₂ ≥ 30 mmHg)",
      "Auscultatie van bilateraal ademgeruis",
      "Zo nodig herpositioneren of opnieuw intuberen",
    ],
  },
  {
    letter: "B",
    titel: "Breathing",
    subtitel: "Ademhaling",
    kleur: "#0A84FF",
    observaties: [
      "SpO₂ (normaal ≥ 94%)",
      "EtCO₂ (normaal 4,5–5,5 kPa)",
      "Thoraxexcursies en beademingsdrukken",
    ],
    risicos: [
      "Hypoxie (door lage O₂, atelectase, bronchospasme)",
      "Hypercapnie of hypocapnie (foutieve ventilatie-instellingen)",
      "Pneumothorax bij hoge beademingsdrukken",
    ],
    acties: [
      "Optimaliseren van FiO₂, PEEP en beademingsmodus",
      "Auscultatie en X-thorax bij twijfel",
      "Indien nodig bronchusaspiratie of ventilatie-aanpassing",
    ],
  },
  {
    letter: "C",
    titel: "Circulation",
    subtitel: "Circulatie",
    kleur: "#FF9F0A",
    observaties: [
      "Hartfrequentie (normaal 60–100/min) en ritme (ECG)",
      "Bloeddruk (MAP ≥ 65 mmHg gewenst)",
      "Capillaire refill en urineproductie",
    ],
    risicos: [
      "Hypotensie (door anesthetica, bloedverlies, hypovolemie)",
      "Hypertensie (bij inadequate anesthesiediepte)",
      "Hartritmestoornissen door medicatie of elektrolytenstoornissen",
    ],
    acties: [
      "IV-vochttoediening",
      "Vasopressoren bij hypotensie (bijv. efedrine, noradrenaline)",
      "ECG-controle en elektrolytenmanagement",
    ],
  },
  {
    letter: "D",
    titel: "Disability",
    subtitel: "Neurologische status",
    kleur: "#BF5AF2",
    observaties: [
      "Diepte van anesthesie (bijv. BIS-monitoring, pupilreacties)",
      "Glucose (moet ≥ 4 mmol/L zijn)",
      "Postoperatief bewustzijn en pijnscore",
    ],
    risicos: [
      "Onvoldoende anesthesiediepte → awareness",
      "Oversedatie → vertraagd ontwaken",
      "Hypoglykemie bij lange operaties",
    ],
    acties: [
      "Bijsturen anesthesiediepte en analgetica",
      "Glucosemeting en toediening indien nodig",
      "Postoperatieve pijnstilling evalueren",
    ],
  },
  {
    letter: "E",
    titel: "Exposure",
    subtitel: "Expositie & Temperatuur",
    kleur: "#30D158",
    observaties: [
      "Lichaamstemperatuur (moet ≥ 36°C blijven)",
      "Inspectie op bloedingen, drukplekken of positioneringsproblemen",
    ],
    risicos: [
      "Hypothermie → verhoogd bloedverlies, langzamere metabolisering",
      "Perioperatieve huid- of zenuwbeschadiging (slechte positionering)",
    ],
    acties: [
      "Verwarmingsdekens of warm IV-vocht toedienen",
      "Regelmatige inspectie van operatieterrein en positionering",
    ],
  },
];

// LAST = Local Anesthetic Systemic Toxicity. Bron: AAGBI Guidelines for the Management
// of Severe Local Anaesthetic Toxicity (2010) + ASRA Practice Advisory — internationaal
// gestandaardiseerd noodprotocol, niet AUMC-specifiek. Vooral relevant bij volwassenen
// (lokale blokken bij kinderen worden doorgaans door de anesthesioloog zelf uitgevoerd).
const LAST_PROTOCOL = {
  stappen: [
    "Stop toediening lokaal anestheticum, roep hulp, noteer tijdstip",
    "Luchtweg vrijmaken, 100% O2, voorkom hypoxie en acidose",
    "Insulten couperen: benzodiazepine (bv. midazolam)",
    "Ritmestoornissen: standaard ALS, maar VERMIJD lidocaïne, calciumantagonisten, bètablokkers en vasopressine — kunnen therapieresistentie verergeren",
    "Bij circulatoire instabiliteit of arrest: start IV lipidemulsie (Intralipid 20%) direct, naast reanimatie",
  ],
  intralipid: [
    { stap: "Bolus", dosis: "1,5 ml/kg (20%) IV over ~1 min", opmerking: "Herhalen tot 2x bij onvoldoende effect (interval ~5 min)" },
    { stap: "Onderhoudsinfuus", dosis: "15 ml/kg/uur", opmerking: "Verdubbel naar 30 ml/kg/uur bij aanhoudende hypotensie" },
    { stap: "Maximale cumulatieve dosis", dosis: "12 ml/kg", opmerking: "Richtwaarde AAGBI" },
  ],
};

const MEDICATIE_STANDAARD = [
  { groep: "Anesthetica", med: "Propofol", concentratie: "10 mg/ml (1%) <3 jr · 20 mg/ml (2%) ≥3 jr", inductie: "1–2,5 mg/kg", onderhoud: "4–12 mg/kg/uur",
    bron: { status: "✅", tekst: "FK: inductie 1,5–2,5 mg/kg (<55 jr, tot 1 mg/kg bij ouderen/ASA III-IV); onderhoud 4–12 mg/kg/uur — consistent." } },
  { groep: "Anesthetica", med: "Thiopental", concentratie: "25 mg/ml", inductie: "3–5 mg/kg", onderhoud: "n.v.t.",
    bron: { status: "🟡", tekst: "FK-zoekresultaten wisselend (±3–4 mg/kg vs. een losstaand absoluut cijfer); app's bredere 3–5 mg/kg is de gangbare leerboekdosis en overlapt met FK. Middel wordt nog zelden gebruikt." } },
  { groep: "Anesthetica", med: "Midazolam", concentratie: "1 mg/ml", inductie: "0,05–0,1 mg/kg", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "Valt binnen het bredere FK-titratiebereik (0,03–0,3 mg/kg); als co-inductie/premedicatie is 0,05–0,1 mg/kg gangbare praktijk." } },
  { groep: "Analgetica/anesthetica", med: "Esketamine", concentratie: "5 mg/ml", inductie: "0,5–1 mg/kg", onderhoud: "0,1–0,2 mg/kg/uur",
    bron: { status: "✅", tekst: "AANGEPAST (was 0,25–0,5 mg/kg — dat is de analgetische sub-dissociatieve dosis, niet de inductiedosis). FK: 0,5–1 mg/kg IV over ~60 sec voor inductie, overeenkomend met de eerder bevestigde kinderdosis." } },
  { groep: "Opioïden", med: "Sufentanil", concentratie: "5 µg/ml", inductie: "0,2–1 µg/kg", onderhoud: "0,1–0,3 µg/kg/uur",
    bron: { status: "✅", tekst: "AANGEPAST (was 0,1–0,5 µg/kg — ondergrens niet in FK teruggevonden). FK: 0,5–1,0 µg/kg solo of 0,2–0,5 µg/kg gecombineerd met inductiemiddel (tot 1 µg/kg bij hartchirurgie)." } },
  { groep: "Opioïden", med: "Remifentanil", concentratie: "50 µg/ml", inductie: "0,5–1 µg/kg/min", onderhoud: "0,05–0,3 µg/kg/min",
    bron: { status: "✅", tekst: "FK: inductie 0,5–1 µg/kg/min ± bolus 1 µg/kg; onderhoud initieel 0,25–0,4, totaalbereik 0,05–2 µg/kg/min — consistent." } },
  { groep: "Opioïden", med: "Morfine", concentratie: "1 mg/ml", inductie: "0,05–0,2 mg/kg", onderhoud: "0,05–0,1 mg/kg/uur",
    bron: { status: "🟡", tekst: "Geen directe FK mg/kg-citaat (FK doseert volwassenen doorgaans in absolute mg); omgerekend bereik komt overeen met gangbare titratiedoses (± 2,5–10 mg per gift bij 70 kg)." } },
  { groep: "Opioïden", med: "Methadon", concentratie: "10 mg/ml", inductie: "0,1–0,2 mg/kg", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "Peroperatieve inductiedosis 0,125–0,2 mg/kg uit anesthesiologische bronnen — nagenoeg gelijk aan de app-waarde." } },
  { groep: "Opioïden", med: "Fentanyl", concentratie: "50 µg/ml", inductie: "1–3 µg/kg", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK: inductie 1,0–8,4 µg/kg; app's 1–3 µg/kg is de gangbare subset voor standaardchirurgie (hogere doses voorbehouden aan hartchirurgie)." } },
  { groep: "Relaxantia", med: "Rocuronium", concentratie: "10 mg/ml", inductie: "0,6–1,2 (RSI) mg/kg", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK: 0,6 mg/kg routine-inductie, 1,0 mg/kg spoedinductie (tot 2,0 mg/kg zonder cardiovasculaire bijwerkingen) — app's RSI-bovengrens (1,2) valt hierbinnen." } },
  { groep: "Relaxantia", med: "Succinylcholine", concentratie: "50 mg/ml", inductie: "1–1,5 mg/kg", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "Klassieke intubatiedosis 1–1,5 mg/kg; FK bevestigt dat 1 mg/kg volledige verslapping geeft, vervolgdoses 0,3–1,1 mg/kg." } },
  { groep: "Sympathicomimetica", med: "Efedrine", concentratie: "5 mg/ml", inductie: "3–9 mg per keer", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK kent twee toedieningsvormen: 3–6 mg (max 9) of 5–10 mg per gift — app's 3–9 mg valt hier middenin." } },
  { groep: "Sympathicomimetica", med: "Noradrenaline", concentratie: "20 µg/ml", inductie: "0,05–0,1 µg/kg/min", onderhoud: "0,02–1 µg/kg/min",
    bron: { status: "✅", tekst: "FK-startdosis 0,05–0,15 µg/kg/min; app's bredere bereik (0,02–1) dekt ook titratie bij refractaire shock, gangbaar in de OK/IC-praktijk." } },
  { groep: "Sympathicomimetica", med: "Fenylefrine", concentratie: "100 µg/ml", inductie: "50–100 µg per keer", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK: bolus 50–100 µg per keer — exacte match." } },
  { groep: "Sympathicomimetica", med: "Adrenaline", concentratie: "10 µg/ml (pomp) · 0,1 mg/ml (nood 1:10.000)", inductie: "10–100 µg", onderhoud: "0,05–0,5 µg/kg/min",
    bron: { status: "🟡", tekst: "Geen directe FK-tekst voor deze specifieke IV-titratiedosis; FK kent alleen 1 mg IV (reanimatie) en 0,5 mg IM (anafylaxie). App-waarde is de gangbare anesthesiologische titratiedosis voor peroperatieve anafylaxie/hypotensie (bv. AAGBI-richtlijn) — een andere context dan reanimatie." } },
  { groep: "Anticholinergica", med: "Atropine", concentratie: "0,5 mg/ml", inductie: "0,5 mg", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK: 0,5 mg IV bij bradycardie, herhalen tot max 3 mg — exacte match." } },
  { groep: "Locale anesthetica", med: "Lidocaïne", concentratie: "10 mg/ml (1%)", inductie: "1–1,5 mg/kg IV", onderhoud: "1–2 mg/kg/uur",
    bron: { status: "🟡", tekst: "FK beschrijft alleen de maximale lokale-anesthesiedosis (4,5–7 mg/kg) en de antiaritmische oplaaddosis (~1 mg/kg), geen aparte tekst voor het peroperatieve IV-lidocaïne-infuusprotocol. App-waarde komt overeen met gepubliceerde ERAS-protocollen (bolus + infuus), ruim binnen FK's veiligheidsgrens." } },
  { groep: "Antibiotica", med: "Cefazoline", concentratie: "100 mg/ml (2 g in 20 ml NaCl 0,9%)", inductie: "1–2 g (3g bij BMI >40)", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK: 2 g standaard profylaxe (1 g als de wond binnen 1 uur gesloten wordt); 3 g bij BMI>40 is een bekende WIP/SWAB-aanpassing — consistent." } },
  { groep: "Antifibrinolytica", med: "Tranexaminezuur", concentratie: "100 mg/ml", inductie: "10–15 mg/kg", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK: 15 mg/kg IV (doorgaans 1 g); app's iets ruimere bereik (10–15 mg/kg) is gangbare chirurgische praktijk." } },
  { groep: "Analgetica niet-opioïd", med: "Paracetamol", concentratie: "10 mg/ml", inductie: "1 g IV", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK: 1000 mg IV bij >50 kg — exacte match." } },
  { groep: "Analgetica niet-opioïd", med: "Metamizol", concentratie: "500 mg/ml", inductie: "0,5–1 g IV", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "AANGEPAST (was 1–2,5 g — de bovengrens van 2,5 g per gift overschreed de FK-maximale enkele dosis aanzienlijk). FK: 0,5–1 g per gift, max 4x/dag (max 4 g/dag)." } },
  { groep: "Antiemetica", med: "Ondansetron", concentratie: "2 mg/ml", inductie: "4 mg IV", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK: 4 mg IV (tot 8 mg bij ≥75 jr) — exacte match." } },
  { groep: "Antiemetica", med: "Dexamethason", concentratie: "4 mg/ml", inductie: "4–8 mg IV", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK noemt voor PONV-preventie 4–40 mg, met 8 mg als meest gebruikte dosis — dekt het app-bereik." } },
  { groep: "Antiemetica", med: "Droperidol", concentratie: "2,5 mg/ml", inductie: "0,625–1,25 mg IV", onderhoud: "n.v.t.",
    bron: { status: "✅", tekst: "FK: 0,625–1,25 mg IV — exacte match." } },
];

// Gedetailleerde geneesmiddelentabel AMC (T.M.S. van Winden, 2016)
const MEDICATIE_DETAIL = [
  {
    categorie: "Inductie",
    kleur: "#D4AC0D",
    meds: [
      { naam: "Propofol", dosis: "2–3 mg/kg", obv75: "180 mg, 18 ml", duur: "5–15 min", conc: "10 mg/ml", inhoud: "20/50 ml", opmerking: "Continue infusie: 12-9-6 mg/kg/h" },
      { naam: "S-Ketamine", dosis: "0,25–1 mg/kg", obv75: "17,5 mg, 10 ml", duur: "20 min", conc: "5 mg/ml", inhoud: "1 ml", opmerking: "0,25 mg/kg tbv analgesie" },
      { naam: "Etomidate", dosis: "0,3 mg/kg", obv75: "20 mg, 10 ml", duur: "3–15 min", conc: "2 mg/ml", inhoud: "10 ml", opmerking: "Bij hartproblemen" },
      { naam: "Thiopental", dosis: "3–5 mg/kg", obv75: "300 mg, 12 ml", duur: "5–15 min", conc: "25 mg/ml", inhoud: "500 mg poeder", opmerking: "Korte onset" },
    ],
  },
  {
    categorie: "Opiaten",
    kleur: "#5DADE2",
    meds: [
      { naam: "Sufentanil", dosis: "0,1–0,3 µg/kg", obv75: "15 µg, 3 ml", duur: "20–45 min", conc: "5 µg/ml", inhoud: "—", opmerking: "" },
      { naam: "Remifentanil", dosis: "0,5–1 µg/kg", obv75: "50 µg, 1 ml", duur: "5–6 min", conc: "50 µg/ml", inhoud: "—", opmerking: "Nauwelijks redistributie" },
      { naam: "Fentanyl", dosis: "1–3 µg/kg", obv75: "150 µg, 3,5 ml", duur: "30–60 min", conc: "50 µg/ml", inhoud: "—", opmerking: "Grote redistributie; bij kinderen" },
      { naam: "Morfine", dosis: "0,1–0,2 mg/kg", obv75: "7,5 mg, 7,5 ml", duur: "2–7 uur", conc: "1 mg/ml", inhoud: "1 ml", opmerking: "" },
    ],
  },
  {
    categorie: "Spierverslappers",
    kleur: "#E74C3C",
    meds: [
      { naam: "Succinylcholine", dosis: "1–2 mg/kg", obv75: "75 mg, 7,5 ml", duur: "—", conc: "50 mg/ml", inhoud: "10 ml", opmerking: "Depolariserend, mn obstetrie" },
      { naam: "Rocuronium", dosis: "0,6–1,2 mg/kg", obv75: "50 mg, 5 ml", duur: "—", conc: "10 mg/ml", inhoud: "5 ml", opmerking: "High dose; onset < 60 s" },
      { naam: "Atracurium", dosis: "0,5 mg/kg", obv75: "37,5 mg", duur: "—", conc: "10 mg/ml", inhoud: "—", opmerking: "In AUMC, locatie AMC evt bij nierinsufficientie" },
    ],
  },
  {
    categorie: "Antagonisten",
    kleur: "#8B5E3C",
    meds: [
      { naam: "Naloxone", dosis: "0,4 mg à 1 min", obv75: "0,4 mg, 1 ml", duur: "—", conc: "—", inhoud: "0,4 mg/ml — 1 ml", opmerking: "" },
      { naam: "Sugammadex", dosis: "2–4 / 16 mg/kg", obv75: "150, 300, 1200 mg", duur: "—", conc: "100 mg/ml", inhoud: "1, 2, 5 ml", opmerking: "Onset < 3–4 min" },
      { naam: "Neostigmine", dosis: "0,03 mg/kg", obv75: "2,5 mg, 5 ml", duur: "—", conc: "—", inhoud: "0,5 mg/ml — 1 ml", opmerking: "" },
      { naam: "+Glycopyrronium", dosis: "0,01 mg/kg", obv75: "0,8 mg, 1 ml", duur: "—", conc: "—", inhoud: "0,2 mg/ml — 1 ml", opmerking: "" },
      { naam: "+Atropinesulfaat", dosis: "0,015 mg/kg", obv75: "1,0 mg, 2 ml", duur: "—", conc: "—", inhoud: "0,5 mg/ml — 1 ml", opmerking: "" },
      { naam: "Flumazenil", dosis: "0,1 mg", obv75: "0,1 mg, 1 ml", duur: "—", conc: "—", inhoud: "0,1 mg/ml — 5 ml", opmerking: "" },
    ],
  },
  {
    categorie: "Dampvormige anesthetica",
    kleur: "#D4AC0D",
    meds: [
      { naam: "Sevofluraan", dosis: "2,0% = 1 MAC", obv75: "—", duur: "—", conc: "—", inhoud: "—", opmerking: "MAC: Min. alveolar concentration → 50% patiënten in slaap bij standaard chirurgische prikkel" },
    ],
  },
  {
    categorie: "Overige",
    kleur: "#95A5A6",
    meds: [
      { naam: "Midazolam", dosis: "0,1 mg/kg", obv75: "7,5 mg, 7,5 ml", duur: "15–80 min", conc: "1 mg/ml", inhoud: "1/5 ml", opmerking: "= Dormicum" },
      { naam: "Atropine", dosis: "0,5 mg", obv75: "0,5 mg, 1 ml", duur: "1–2 uur", conc: "0,5 mg/ml", inhoud: "1 ml", opmerking: "Max 3 mg" },
      { naam: "Efedrine", dosis: "5 mg (2,5–10)", obv75: "5 mg, 1 ml", duur: "10–60 min", conc: "5 mg/ml", inhoud: "1 ml", opmerking: "Titreren naar effect" },
      { naam: "Fenylefrine", dosis: "100 µg", obv75: "50–100 µg", duur: "—", conc: "100 µg/ml", inhoud: "10 ml", opmerking: "Titreren naar effect" },
      { naam: "Clonidine", dosis: "1–2 µg/kg", obv75: "75–150 µg, 1 ml", duur: "8 uur", conc: "150 µg/ml", inhoud: "1 ml", opmerking: "= Catapressan" },
      { naam: "Noradrenaline", dosis: "0,01–0,1 µg/kg/min", obv75: "2–20 ml/uur", duur: "—", conc: "1 mg/ml", inhoud: "—", opmerking: "Pompstand bij dosis 20 µg/ml" },
    ],
  },
];

const NOODMEDICATIE = [
  { med: "Adrenaline", dosering: "0,01 mg/kg i.v.", indicatie: "Hartstilstand en ernstige bradycardie" },
  { med: "Atropine", dosering: "0,02 mg/kg (min 0,1 – max 0,5 mg kind)", indicatie: "Symptomatische bradycardie" },
  { med: "Efedrine", dosering: "0,1–0,2 mg/kg i.v.", indicatie: "Hypotensie (titreren naar effect)" },
  { med: "Fenylefrine", dosering: "1–5 µg/kg i.v.", indicatie: "Hypotensie, m.n. bij tachycardie" },
  { med: "Defibrillatie", dosering: "4 Joule/kg", indicatie: "VF/VT" },
];

const KINDERMEDICATIE = [
  { med: "Propofol", inductie: "2–3,5 mg/kg", onderhoud: "1 mg/kg/uur" },
  { med: "Sufentanyl", inductie: "0,2 µg/kg", onderhoud: "0,1–0,2 µg/kg" },
  { med: "Rocuronium", inductie: "0,6 mg/kg", onderhoud: "n.v.t." },
  { med: "Ketanest", inductie: "0,5–1 mg/kg", onderhoud: "n.v.t." },
  { med: "Paracetamol", inductie: "15 mg/kg", onderhoud: "n.v.t." },
  { med: "Metamizol", inductie: "15 mg/kg", onderhoud: "n.v.t." },
  { med: "Cefazoline", inductie: "30 mg/kg", onderhoud: "n.v.t." },
  { med: "Metronidazol", inductie: "15 mg/kg", onderhoud: "n.v.t." },
  { med: "Dexamethason", inductie: "0,15 mg/kg", onderhoud: "n.v.t." },
];

const KINDER_VITAAL = [
  { leeftijd: "Prematuur", pols: "120–170", sbdOnder: "60 mmHg", adem: "40–70" },
  { leeftijd: "0–3 mnd", pols: "120–190", sbdOnder: "70 mmHg", adem: "35–55" },
  { leeftijd: "3–6 mnd", pols: "100–190", sbdOnder: "70 mmHg", adem: "30–45" },
  { leeftijd: "6–12 mnd", pols: "100–180", sbdOnder: "70 mmHg", adem: "25–40" },
  { leeftijd: "1–3 jr", pols: "90–150", sbdOnder: "72–76 mmHg", adem: "20–30" },
  { leeftijd: "3–6 jr", pols: "70–140", sbdOnder: "76–82 mmHg", adem: "20–25" },
  { leeftijd: "6–12 jr", pols: "60–130", sbdOnder: "82–94 mmHg", adem: "14–22" },
  { leeftijd: ">12 jr", pols: "60–120", sbdOnder: "94 mmHg", adem: "12–18" },
];

const BLOEDGAS = [
  { param: "pH", waarde: "7,35 – 7,45", uitleg: "Zuurgraad van het bloed. Lager dan 7,35 = acidose, hoger dan 7,45 = alkalose." },
  { param: "pCO₂", waarde: "4,7 – 6,4 kPa / 35–45 mmHg", uitleg: "Partiële CO₂-druk — weerspiegelt de ventilatie. Hoog bij hypoventilatie, laag bij hyperventilatie." },
  { param: "pO₂", waarde: "10,0 – 13,3 kPa / 75–100 mmHg", uitleg: "Partiële zuurstofdruk in het bloed — maat voor oxygenatie." },
  { param: "HCO₃⁻ act", waarde: "22 – 26 mmol/l", uitleg: "Bicarbonaat — de metabole (nier-)component van de zuur-base balans." },
  { param: "BE (Base Excess)", waarde: "−3 – +3 mmol/l", uitleg: "Overmaat of tekort aan buffers t.o.v. normaal — toont de metabole afwijking los van de ademhaling." },
  { param: "O₂-sat", waarde: "95–98% (streef 100%)", uitleg: "Percentage hemoglobine dat daadwerkelijk met zuurstof verzadigd is." },
  // CO-oximetrie
  { param: "tHb (Hb)", waarde: "♂ 8,5–11,0 · ♀ 7,5–10,0 mmol/l", uitleg: "Totaal hemoglobinegehalte — bepaalt de zuurstoftransportcapaciteit van het bloed." },
  { param: "FO₂Hb", waarde: "94 – 98 %", uitleg: "Fractie oxyhemoglobine — het deel van de hemoglobine dat zuurstof heeft gebonden." },
  { param: "FCOHb", waarde: "< 1,5 % (rokers tot ~5%)", uitleg: "Fractie carboxyhemoglobine — hemoglobine gebonden aan koolmonoxide (CO-intoxicatie)." },
  { param: "FMetHb", waarde: "< 1,5 %", uitleg: "Fractie methemoglobine — hemoglobine dat geen zuurstof meer kan binden (methemoglobinemie)." },
  { param: "FHHb", waarde: "< 5 % (deoxy-Hb fractie)", uitleg: "Fractie gedeoxygeneerd hemoglobine — hemoglobine zonder gebonden zuurstof." },
  // Electrolyten
  { param: "Na⁺", waarde: "135 – 145 mmol/l", uitleg: "Natrium — belangrijkste elektrolyt buiten de cel, bepaalt mede de vochtbalans." },
  { param: "K⁺", waarde: "3,5 – 5,0 mmol/l", uitleg: "Kalium — cruciaal voor hartritme en spierfunctie; afwijkingen geven snel aritmieën." },
  { param: "Ca²⁺ (geïoniseerd)", waarde: "1,15 – 1,30 mmol/l", uitleg: "Vrij, actief calcium — belangrijk voor hartcontractie, stolling en spierfunctie." },
  { param: "Cl⁻", waarde: "98 – 107 mmol/l", uitleg: "Chloride — volgt meestal natrium en speelt een rol in de zuur-base balans." },
  // Metabolieten
  { param: "Glucose", waarde: "4,0 – 7,8 mmol/l", uitleg: "Bloedsuiker — ontregeling kan duiden op stressrespons, sepsis of diabetes." },
  { param: "Lactaat", waarde: "0,5 – 1,6 mmol/l (< 2,0)", uitleg: "Maat voor weefselperfusie — verhoogd bij shock, sepsis of weefselischemie." },
];

const BEADEMING = [
  { param: "TV", waarde: "6–8 ml/kg" },
  { param: "EtCO₂", waarde: "4,5–5,5 kPa" },
  { param: "Frequentie", waarde: "12–14x/min" },
  { param: "PEEP", waarde: "5–8 cmH₂O" },
];

// ============================================================
// ROTEM — Stollingsdiagnostiek (AUMC protocol)
// ============================================================
const ROTEM_PROTOCOL = [
  {
    titel: "Fibrinogeen",
    kleur: "#FF9F0A",
    triggers: [
      { criterium: "<strong>FIBTEM A10</strong> &lt; 10 mm", actie: "Fibrinogeen 25 mg/kg" },
      { criterium: "<strong>FIBTEM A10</strong> &lt; 6 mm", actie: "Fibrinogeen 50 mg/kg" },
    ],
  },
  {
    titel: "Trombocyten",
    kleur: "#30D158",
    triggers: [
      { criterium: "<strong>EXTEM A10</strong> MIN <strong>FIBTEM A10</strong> &lt; 30 mm", actie: "1–2 EH trombocyten" },
    ],
  },
  {
    titel: "Stollingsfactoren",
    kleur: "#0A84FF",
    triggers: [
      { criterium: "<strong>FIBTEM A10</strong> &gt; 10 mm <span style='color:#FF453A;font-weight:700'>EN</span> <strong>EXTEM CT</strong> &gt; 80 sec", actie: "10 ml/kg plasma OF 10 IE/kg 4FC" },
    ],
  },
  {
    titel: "Hyperfibrinolyse",
    kleur: "#FFD60A",
    triggers: [
      { criterium: "<strong>EXTEM ML</strong> &gt; 15% <span style='color:#FF453A;font-weight:700'>OF</span> <strong>FIBTEM ML</strong> &gt; 15%", actie: "Tranexaminezuur 15 mg/kg" },
    ],
  },
];

const ROTEM_PARAMETERS = [
  {
    groep: "Stollingsactivatie & polymerisatie",
    kleur: "#0A84FF",
    params: [
      { acroniem: "CT", naam: "Coagulation Time (r)", beschrijving: "Tijd vanaf teststart tot 2 mm amplitude bereikt is.", unit: "sec" },
      { acroniem: "CFT", naam: "Clot Formation Time (k)", beschrijving: "Tijd tussen 2 mm en 20 mm amplitude.", unit: "sec" },
    ],
  },
  {
    groep: "Stolselsterkte (clot firmness)",
    kleur: "#30D158",
    params: [
      { acroniem: "MCF", naam: "Maximum Clot Firmness (MA)", beschrijving: "Maximale amplitude bereikt tijdens de test.", unit: "mm" },
      { acroniem: "A5", naam: "Firmness na 5 minuten", beschrijving: "Stolselsterkte 5 min na CT.", unit: "mm" },
      { acroniem: "A10", naam: "Firmness na 10 minuten", beschrijving: "Stolselsterkte 10 min na CT — meest gebruikt voor protocol.", unit: "mm" },
      { acroniem: "A20", naam: "Firmness na 20 minuten", beschrijving: "Stolselsterkte 20 min na CT.", unit: "mm" },
      { acroniem: "A30", naam: "Firmness na 30 minuten", beschrijving: "Stolselsterkte 30 min na CT.", unit: "mm" },
    ],
  },
  {
    groep: "Stolsel-afbraak (lysis)",
    kleur: "#FFD60A",
    params: [
      { acroniem: "ML", naam: "Maximum Lysis", beschrijving: "Max. lysis tijdens run: verschil tussen MCF en laagste amplitude na MCF, als % van MCF.", unit: "%" },
      { acroniem: "LI30", naam: "Lysis Index 30 min", beschrijving: "A/MCF × 100 op CT + 30 min.", unit: "%" },
      { acroniem: "LI45", naam: "Lysis Index 45 min", beschrijving: "A/MCF × 100 op CT + 45 min.", unit: "%" },
      { acroniem: "LI60", naam: "Lysis Index 60 min", beschrijving: "A/MCF × 100 op CT + 60 min.", unit: "%" },
      { acroniem: "LOT", naam: "Lysis Onset Time", beschrijving: "Tijd vanaf CT tot start van significante lysis (amplitude-daling ≥15% t.o.v. MCF).", unit: "sec" },
    ],
  },
];

const ROTEM_TESTS = [
  { naam: "EXTEM", kleur: "#FF453A", uitleg: "Extrinsiek (weefselfactor). Globale stolling — gevoelig voor factor II, V, VII, X, fibrinogeen & trombocyten." },
  { naam: "INTEM", kleur: "#0A84FF", uitleg: "Intrinsiek (ellaginezuur). Toont factor VIII, IX, XI, XII + fibrinogeen & trombocyten. Verlengd door heparine." },
  { naam: "FIBTEM", kleur: "#FF9F0A", uitleg: "EXTEM + cytochalasine D (trombocytenremmer). Isoleert bijdrage van fibrinogeen alleen." },
  { naam: "HEPTEM", kleur: "#BF5AF2", uitleg: "INTEM + heparinase. Vergelijk met INTEM → effect van heparine zichtbaar maken." },
  { naam: "APTEM", kleur: "#40C8E0", uitleg: "EXTEM + aprotinine. Vergelijk met EXTEM → bevestigt hyperfibrinolyse." },
  { naam: "NATEM", kleur: "#8E8E93", uitleg: "Niet-geactiveerd (alleen recalcificatie). Zelden gebruikt." },
];

const ANTISTOLLING_REVERSAL = [
  { klasse: "COX-1 remming", middelen: "Ascal (acetylsalicylzuur), Naproxen, etc.", handelen: "Reversibel — Naproxen e.d. · Irreversibel — Ascal. Nieuwe trombocyten, actief kool; afhankelijk van bloedingsrisico en halfwaardetijd van de specifieke COX-1 remmer." },
  { klasse: "ADP-receptorantagonisten (P2Y12)", middelen: "Clopidogrel, ticagrelor, prasugrel, etc.", handelen: "Nieuwe trombocyten, actief kool; afhankelijk van bloedingsrisico en halfwaardetijd van de specifieke ADP-receptorantagonist." },
  { klasse: "GPIIb/IIIa-receptorantagonisten", middelen: "Eptifibatide, tirofiban.", handelen: "Nieuwe trombocyten, actief kool; afhankelijk van bloedingsrisico en halfwaardetijd van de specifieke GPIIb/IIIa-receptorantagonist." },
  { klasse: "Vitamine K-antagonisten (verstoren II–VII–IX–X)", middelen: "Acenocoumarol, fenprocoumon.", handelen: "Vitamine K toedienen (geen direct effect). Stollingsfactoren toedienen als stollingsfactorenconcentraat (4-factor) of fresh frozen plasma." },
  { klasse: "Antitrombine", middelen: "Heparine, Fraxiparine, etc.", handelen: "Protamine." },
  { klasse: "Fibrinolytica / trombolytica / plasmineversterker", middelen: "Alteplase, urokinase.", handelen: "Geen specifiek antidotum." },
  { klasse: "Selectieve factor X- of IIa-antagonist (NOAC/DOAC)", middelen: "Factor X — apixaban, edoxaban, rivaroxaban. · Factor IIa — dabigatran.", handelen: "Actief kool. Apixaban / edoxaban / rivaroxaban — stollingsfactoren toedienen. Dabigatran — idarucizumab toedienen." },
];

const SBAR = {
  situation: [
    "Naam en geboortedatum patiënt",
    "Operatie / Probleem",
    "Vitale functies",
    "Anesthesie techniek",
    "Allergieën?",
    "Comorbiditeiten?",
    "Taal patiënt",
  ],
  background: [
    "Reden van opname en operatie",
    "Voorgeschiedenis",
    "Medicatie",
    "Behandelbeperking ja/nee",
  ],
  assessment: [
    "In welke fase van de operatie zitten we?",
    "Acute problemen",
    "Verwachte problemen",
    "Urgentie",
  ],
  recommendation: ["Welke risico's worden verwacht"],
};

// ============================================================
// ROOSTER (OWS) — codes & dienst-toeslagen
// ============================================================
const ROOSTER_GROEPEN = [
  {
    naam: "Dagdienst & varianten",
    kleur: "#FF9F0A",
    codes: [
      { naam: "Dagdienst", vu: "BD", amc: "MD", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Dagdienst Flex", vu: "Bf", amc: "Mf", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Dagdienst Flex met uitloop", vu: "Bu", amc: "Mu", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Trauma/reanimatiesein", vu: "—", amc: "MDtr", tijdVU: "—", tijdAMC: "7:30–17:00" },
      { naam: "Dagcoördinator", vu: "BDc", amc: "MDc", tijdVU: "7:00–16:30", tijdAMC: "7:30–17:00" },
      { naam: "Dagcoördinator flex", vu: "BDcf", amc: "MDcf", tijdVU: "7:00–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Dagcoördinator flex + uitloop", vu: "BDcu", amc: "MDcu", tijdVU: "7:00–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Kantoordag", vu: "Bk", amc: "Mk", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Reïntegreren", vu: "Bi", amc: "Mi", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Dagdienst Leidinggevende", vu: "BL", amc: "ML", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
    ],
  },
  {
    naam: "Tussen / Middag / Avond / Nacht",
    kleur: "#30D158",
    codes: [
      { naam: "Tussendienst", vu: "BT", amc: "MT", tijdVU: "9:30–19:00", tijdAMC: "9:00–18:30" },
      { naam: "Middagdienst", vu: "BM", amc: "—", tijdVU: "12:00–21:30", tijdAMC: "—" },
      { naam: "Avonddienst", vu: "BA", amc: "MA", tijdVU: "13:30–23:00", tijdAMC: "13:30–23:00" },
      { naam: "Nachtdienst", vu: "BN", amc: "MN", tijdVU: "22:30–8:00", tijdAMC: "22:30–8:00" },
    ],
  },
  {
    naam: "Sedatie",
    kleur: "#FFD60A",
    codes: [
      { naam: "Dagdienst Sedatie", vu: "BS", amc: "MS", tijdVU: "7:30–17:00", tijdAMC: "7:30–17:00" },
      { naam: "Sedatie Flex", vu: "BSf", amc: "MSf", tijdVU: "7:30–17:00", tijdAMC: "7:30–17:00" },
      { naam: "Sedatie Flex + uitloop", vu: "BSu", amc: "MSu", tijdVU: "7:30–17:00", tijdAMC: "7:30–17:00" },
      { naam: "Dagdienst Sed Cursist", vu: "BSc", amc: "MSc", tijdVU: "7:30–17:00", tijdAMC: "7:30–17:00" },
      { naam: "Sedatie Cursist Flex", vu: "BScf", amc: "MScf", tijdVU: "7:30–17:00", tijdAMC: "7:30–17:00" },
      { naam: "Sedatie Cursist Flex + uitloop", vu: "BScu", amc: "MScu", tijdVU: "7:30–17:00", tijdAMC: "7:30–17:00" },
      { naam: "Sedatie POS", vu: "Bp", amc: "Mp", tijdVU: "7:30–17:00", tijdAMC: "7:30–17:00" },
      { naam: "Tussendienst Sedatie", vu: "BT*", amc: "MT*", tijdVU: "9:30–19:00", tijdAMC: "9:00–18:30" },
    ],
  },
  {
    naam: "Simulatie",
    kleur: "#FF375F",
    codes: [
      { naam: "Simulatie dagdienst CRM", vu: "BSIMc", amc: "MSIMc", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Simulatie dagdienst Teamz", vu: "BSIMt", amc: "MSIMt", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Simulatie dagdienst Grens", vu: "BSIMg", amc: "MSIMg", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Operator sim", vu: "BOP", amc: "MOP", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
    ],
  },
  {
    naam: "Stage / Buitenland / Vrij",
    kleur: "#BF5AF2",
    codes: [
      { naam: "Stage student AM/MBOV etc.", vu: "Stage", amc: "Stage", tijdVU: "7:30–16:00", tijdAMC: "7:30–16:00" },
      { naam: "Vrije Dag", vu: "RV", amc: "RV", tijdVU: "—", tijdAMC: "—" },
      { naam: "Buitenland", vu: "Bui", amc: "Bui", tijdVU: "7:30–16:00", tijdAMC: "7:30–16:00" },
    ],
  },
  {
    naam: "Cursus & overig",
    kleur: "#8E8E93",
    codes: [
      { naam: "Cursus algemeen", vu: "BCU(9)", amc: "MCU(9)", tijdVU: "8:00–17:30", tijdAMC: "8:00–17:30" },
      { naam: "ALS cursus", vu: "BALS", amc: "MALS", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
      { naam: "Cardiocursus", vu: "—", amc: "MCC", tijdVU: "—", tijdAMC: "7:30–17:00" },
      { naam: "BHV 4,5 uur", vu: "BHV4,5", amc: "BHV4,5", tijdVU: "8:30–13:00", tijdAMC: "8:30–13:00" },
      { naam: "BHV", vu: "BHV", amc: "BHV", tijdVU: "8:30–17:00", tijdAMC: "8:30–17:00" },
      { naam: "PBLS (instructeur)", vu: "PBLS", amc: "PBLS", tijdVU: "7:30–17:00", tijdAMC: "7:30–17:00" },
    ],
  },
];

const ROOSTER_STUDENT = [
  { naam: "Dagdienst student", vu: "Bc", amc: "Mc", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
  { naam: "Leerling dubbel staan", vu: "Bcd", amc: "Mcd", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
  { naam: "Leerling zelfstandig", vu: "Bcz", amc: "Mcz", tijdVU: "7:15–16:45", tijdAMC: "7:30–17:00" },
  { naam: "Tussendienst student", vu: "BTc", amc: "MTc", tijdVU: "9:30–19:00", tijdAMC: "9:00–18:30" },
  { naam: "Middagdienst student", vu: "BMc", amc: "MMc", tijdVU: "12:00–21:30", tijdAMC: "12:00–21:30" },
  { naam: "Avonddienst student", vu: "BAc", amc: "MAc", tijdVU: "13:30–23:00", tijdAMC: "13:30–23:00" },
  { naam: "Nachtdienst student", vu: "BNc", amc: "MNc", tijdVU: "22:30–8:00", tijdAMC: "22:30–8:00" },
  { naam: "Simulatie dagdienst studenten", vu: "BSIMs", amc: "MSIMs", tijdVU: "7:30–17:00", tijdAMC: "7:30–17:00" },
  { naam: "Stage Periferie", vu: "Per", amc: "Per", tijdVU: "7:30–16:00", tijdAMC: "7:30–16:00" },
  { naam: "School", vu: "AA7,2", amc: "AA7,2", tijdVU: "8:00–15:42", tijdAMC: "8:00–15:42" },
  { naam: "School", vu: "AA9", amc: "AA9", tijdVU: "7:30–17:00", tijdAMC: "7:30–17:00" },
];

const DIENST_TOESLAGEN = [
  { code: "TO47", uitleg: "Onregelmatigheidsdienst — toeslag 47%" },
  { code: "TO72", uitleg: "Onregelmatigheidsdienst — toeslag 72% (zon- en feestdagen)" },
  { code: "TO00", uitleg: "Uren waarover geen ORT berekend wordt" },
  { code: "AMV", uitleg: "Aanwezigheidsdienst (slaap) — ma t/m vr" },
  { code: "AWF", uitleg: "Aanwezigheidsdienst (slaap) — weekend & feestdagen" },
  { code: "BMV", uitleg: "Bereikbaarheidsdienst — ma t/m vr" },
  { code: "BWF", uitleg: "Bereikbaarheidsdienst — weekend & feestdagen" },
  { code: "CMV", uitleg: "Consignatiedienst — ma t/m vr" },
  { code: "CWF", uitleg: "Consignatiedienst — weekend & feestdagen" },
  { code: "BA00", uitleg: "Uurtarief bij activiteit 'Werk tijdens BD/AD/CD-geld'" },
  { code: "VAKU", uitleg: "Opgenomen vakantie-uren" },
  { code: "BALV", uitleg: "Opgenomen balansverlof" },
  { code: "BVMV", uitleg: "Betaald bijzonder verlof / mantelzorgverlof" },
  { code: "CVD", uitleg: "Verschoven diensten" },
  { code: "SV", uitleg: "Werkdagen flexmedewerkers" },
];

const SALTMOVIES = [
  { letter: "S", item: "Suction", uitleg: "Zuigapparaat aanwezig en werkend? Yankauer aangesloten en bereikbaar." },
  { letter: "A", item: "Anesthetics", uitleg: "Anesthesiemiddelen klaar en gecheckt — propofol, opiaat, relaxans ingetrokken en gelabeld." },
  { letter: "L", item: "Laryngoscoop", uitleg: "Laryngoscoop functioneel, licht werkt. Juiste blad aanwezig (Mac 3/4 of Miller)." },
  { letter: "T", item: "Tube", uitleg: "ETT juiste maat klaargelegd, cuff getest, stijltje in tube. Alternatief (LM, bougie) binnen handbereik." },
  { letter: "M", item: "Monitoring", uitleg: "ECG, SpO₂, NIBP, capnografie (EtCO₂) en temperatuurmeting aangesloten en functioneel." },
  { letter: "O", item: "Oxygen", uitleg: "Zuurstoftoevoer gecontroleerd, FiO₂ instelbaar, flowmeter of beademing gereed." },
  { letter: "V", item: "Ventilation", uitleg: "Beademingsapparaat gecheckt: TV 6–8 ml/kg, frequentie 12–14/min, PEEP 5–8 cmH₂O, EtCO₂ 4,5–5,5 kPa." },
  { letter: "I", item: "IV medication", uitleg: "Intraveneuze toegang aanwezig en doorgespoeld. Infuus loopt. Medicatie klaar voor onderhoud." },
  { letter: "E", item: "Emergency medication", uitleg: "Spoedbundel aanwezig. Adrenaline, atropine, sugammadex, efedrine direct beschikbaar." },
  { letter: "S", item: "Stethoscoop", uitleg: "Auscultatie mogelijk voor bilateraal ademgeruis na intubatie en bevestiging tubepositie." },
];

const LEMON = [
  {
    letter: "L",
    tekst: "Look externally",
    uitleg: "Inspecteer uiterlijk op risicofactoren: obesitas, grote tanden of tanden los, kleine mond, grote tong (macroglossia), littekens in het gelaat of hals, baard, korte nek, stridor of dysfagie.",
  },
  {
    letter: "E",
    tekst: "Evaluate (3-3-2 regel)",
    uitleg: "3 vingers tussen tanden (mondopening ≥ 3 cm) · 3 vingers van kin tot hyoid (mentohyoïdale afstand ≥ 3 cm) · 2 vingers van hyoid tot thyroid (thyrohyoïdale afstand ≥ 2 cm). Minder dan dit voorspelt een moeilijke luchtweg.",
  },
  {
    letter: "M",
    tekst: "Mallampati score",
    uitleg: "Patiënt mond wijd open, tong uitsteken, geen fonatie. Klasse I: huig + tonsilbogen zichtbaar. Klasse II: huig deels zichtbaar. Klasse III: alleen hard palatum. Klasse IV: niets zichtbaar. Klasse III–IV voorspelt moeilijke laryngoscopie.",
  },
  {
    letter: "O",
    tekst: "Obstruction",
    uitleg: "Obstructie van luchtweg aanwezig? Denk aan: epiglottitis, Ludwig's angina, abces, tumor, trauma, vreemd voorwerp, angio-oedeem. Bij obstructie: wees extra alert, overweeg wakker intuberen of tracheotomie.",
  },
  {
    letter: "N",
    tekst: "Neck mobility",
    uitleg: "Beweeglijkheid van de hals. Kan patiënt 'sniffing position' aannemen (hoofd extensie + cervicale flexie)? Beperkingen bij: reumatoïde artritis, ankyloserende spondylitis, immobilisatiekraag (trauma), spondylose, obesitas. Beperkte extensie → slechte laryngoscoopzicht.",
  },
];

const KINDER_FORMULES = [
  { formule: "ETT maat", berekening: "leeftijd / 4 + 3,5" },
  { formule: "Maagsonde maat", berekening: "2 × ETT" },
  { formule: "ETT insertie diepte", berekening: "3 × ETT" },
  { formule: "Normaal gewicht kind (kg)", berekening: "2,5 × leeftijd + 8" },
];

// Bron: Protocol perioperatief vochtbeleid kinderen (JAW Polderman, Amsterdam UMC, v4.1, 2025)
const KINDER_VOCHT = [
  { item: "Circulerend vol. prematuur", waarde: "100 ml/kg" },
  { item: "Circulerend vol. >1 jr", waarde: "70 ml/kg" },
  { item: "Onderhoud 1e uur (<1 jaar)", waarde: "10 ml/kg/uur" },
  { item: "Onderhoud daarna (4-2-1 regel)", waarde: "zie Calculator" },
  { item: "Vochtbolus", waarde: "10 ml/kg" },
  { item: "Bloedproducten bij hemodilutie", waarde: "10 ml/kg (grote ingrepen)" },
  { item: "Glucose 10%", waarde: "zie Calculator — alleen <1jr/risicofactoren/>2u ingreep" },
];

// Checklist kinderanesthesie — AUMC, locatie AMC
const KINDER_CHECKLIST = [
  {
    sectie: "Warmte",
    kleur: "#FF9F0A",
    items: [
      { item: "OK opwarmen", tekst: "Uur van tevoren opwarmen: neonaat 27 °C, anders 24 °C. OK 7 en 8 max 25 °C (problemen met röntgenbuis-calibratie)." },
      { item: "Bairhugger", tekst: "<3 mnd neomatras · >3 mnd underbody (géén lowerbody)." },
      { item: "Warmtelamp", tekst: "Bij kinderen <1 jaar. Patiënt niet hoger dan de rode knop, sterkte max. 10 W." },
      { item: "Enflow of Fluido", tekst: "Bij mogelijk veel volume- of bloedverlies. <6 jaar: Enflow met cassette + verlengslang. >6 jaar: Fluido." },
      { item: "Kind afdekken", tekst: "Zo lang mogelijk, ook postoperatief. Gebruik kindermutsjes (magazijn bij de bairhuggers)." },
      { item: "Tempsonde", tekst: "9 Fr sonde." },
    ],
  },
  {
    sectie: "Toestel en monitor",
    kleur: "#0A84FF",
    items: [
      { item: "Ventilatieslangen", tekst: "≤10 kg: neo-slangen — controleer of slangen lang genoeg zijn om patiënt te bereiken (m.n. buitenlocaties). Filters (volwassen) direct aan expiratie- én inspiratiekant van toestel; géén filter bij patiënt, alleen HumidVent voor tube 3 en 3,5. >10 kg: volwassen slangen, evt. kleine ballon <25 kg." },
      { item: "Filter", tekst: "<4 kg: HumidVent op orale tube 3 en 3,5 = GEEN bacteriefilter, dus daarna slangen vervangen. 4–8 kg: evt. groene filter. >8 kg: kinderfilter (blauw)." },
      { item: "Spirometrie", tekst: "<25 kg (5 jaar): Pedi-lite. >25 kg (vanaf TV 150 ml): volwassen D-lite." },
      { item: "Instellingen", tekst: "Spirometrie op beademingstoestel: pediatric, of <1 jaar: neonaat. Monitor op kind of baby." },
      { item: "Zuig", tekst: "Smalle flexibele zuigslang (kinderkar) of kleine yankauer uit chirurgiekar." },
      { item: "NMT", tekst: "NMT werkt niet in baby/kind-profiel — evt. volwassen profiel voor meting." },
      { item: "Ambuballon", tekst: "Controleer of kinderambuballon (uit verpakking, in elkaar gezet) binnen handbereik ligt." },
    ],
  },
  {
    sectie: "Materialen",
    kleur: "#40C8E0",
    items: [
      { item: "Tube", tekst: "Tubemaat: leeftijd/4 + 4. Maat groter én kleiner op OK." },
      { item: "Guedel", tekst: "Meet kaakkopje → mondhoek (ook lengte laryngoscoopblad)." },
      { item: "Bloeddrukband", tekst: "Verschillende maten (rood, lichtblauw, groen) aanwezig. Voor neonaten maat #1 t/m 4 met speciale drukslang (kinderkar, 2e la)." },
      { item: "Pompen", tekst: "Twee volumetrische pompen + twee spuitpompen op OK voor Sterofundin en Glucose 10%." },
      { item: "MLK", tekst: "MLK bij verwachte moeilijke luchtweg en kinderbroncho­scoop. Scoop na afloop direct ter reiniging aanbieden — barcode in 'vuile sluis' scannen. Plastic hoes met groene smiley omgekeerd zodat rode smiley zichtbaar is. Met spoed steriliseren en retourneren. Tel. Synergy: 62910." },
      { item: "Echo", tekst: "Bij echogeleide regionale techniek, CVL of infuus/arterielijn: 'hockey-stick' probe (Turbo of Edge)." },
    ],
  },
  {
    sectie: "Medicatie",
    kleur: "#FFD60A",
    items: [
      { item: "Dosering", tekst: "Afhankelijk van gewicht (indicatie: 2,5 × leeftijd + 8) bepaal je het spuitvolume. Gebruik kleine spuiten (zo nodig mantoux), géén verdunningen van medicatie. Andere concentratie van standaardmedicatie alleen in overleg én dubbelcheck met anesthesioloog." },
      { item: "Vocht", tekst: "Gebruik volumetrische pomp of spuitpomp bij vochttoediening. Denk aan Glucose 10% bij kinderen <1 jaar (i.o. anesthesioloog). Glucose 10% in zijvakje van de kinderkar." },
    ],
  },
  {
    sectie: "Beleid",
    kleur: "#BF5AF2",
    items: [
      { item: "Pre-OK overleg", tekst: "Overleg pre-OK plan van aanpak en benodigde materialen met anesthesioloog, zodat je niet meer van de OK af hoeft." },
      { item: "Dagcentrum", tekst: "Op dagcentrum is minder materiaal beschikbaar en zijn weinig volumetrische pompen aanwezig — zorg pre-OK voor genoeg spullen." },
      { item: "Continue aanwezigheid <1 jaar", tekst: "Bij kinderen <1 jaar verlaten anesthesiemedewerker én kinderanesthesioloog de kamer zo weinig mogelijk. Tijdens kritische momenten zijn beiden verplicht aanwezig — desnoods laat de rest van het team wachten." },
      { item: "Zie ook", tekst: "Protocol neonaten en zuigelingen / Pediatric Emergency Manual (op kinderkar voor spoedsituaties)." },
    ],
  },
];

const LEIDINGGEVENDEN = [
  { rol: "Hoofd anesthesiemedewerkers AUMC (locatie AMC & VU)", naam: "Marieke Lijnsvelt", tel: "06-19548724", intern: "29021", email: "m.lijnsvelt@amsterdamumc.nl" },
  { rol: "Teamleider AUMC, locatie AMC", naam: "Hanane el Moutaouakkil", tel: "06-50075240", intern: "27167", email: "h.elmoutaouakkil@amsterdamumc.nl" },
  { rol: "Teamleider AUMC, locatie AMC", naam: "Leendert Runia", tel: "06-82713053", intern: "29820", email: "l.runia@amsterdamumc.nl" },
  { rol: "Teamleider AUMC, locatie AMC", naam: "Lisette Liewes", tel: "06-50075282", intern: "29014", email: "e.s.liewes@amsterdamumc.nl" },
  { rol: "Teamleider AUMC, locatie VU", naam: "Michael van Tongeren", tel: "06-25716129", intern: "51381", email: "m.vantongeren@amsterdamumc.nl" },
  { rol: "Teamleider AUMC, locatie VU", naam: "Esther Roubos", tel: "06-50087727", intern: "35752", email: "e.c.roubos@amsterdamumc.nl" },
  { rol: "Praktijkopleider AUMC, locatie AMC", naam: "Lenneke Muusers", tel: "06-27916715", intern: "23047", email: "l.muusers@amsterdamumc.nl" },
  { rol: "Praktijkopleider AUMC, locatie AMC", naam: "Annemiek Koree-Huiskes", tel: "06-86559944", intern: "25835", email: "a.huiskes@amsterdamumc.nl" },
  { rol: "Praktijkopleider AUMC, locatie VU", naam: "Trix Verweij", tel: "06-25337534", intern: "—", email: "b.verweij@amsterdamumc.nl" },
  { rol: "Praktijkopleider AUMC, locatie VU", naam: "Mariëlle Bor", tel: "—", intern: "36851", email: "m.bor@amsterdamumc.nl" },
];

const VEILIGHEIDSAFSPRAKEN = [
  "Aanspreekcultuur",
  "Patiënt identificatie",
  "Time-out procedure",
  "Hygiëne",
  "Dubbelcheck medicatie",
  "Registratie van onverwachte bevindingen en uitkomsten",
  "Controle van materiaal en apparatuur",
  "Persoonlijke beschermingsmaatregelen",
  "Allergie controle",
  "Gebruik spoedbundel",
  "Ken je werkplek",
  "Fit-to-fly",
];

const SUPERVISIE = [
  { niveau: 1, tekst: "De student mag observeren, maar de EPA niet uitvoeren." },
  { niveau: 2, tekst: "De student mag de EPA uitvoeren onder directe supervisie, waarbij de supervisor fysiek aanwezig is in de ruimte." },
  { niveau: 3, tekst: "De student mag de EPA uitvoeren onder indirecte supervisie, waarbij de supervisor niet fysiek aanwezig is, maar wel snel beschikbaar is als dat nodig is." },
  { niveau: 4, tekst: "De student voert een activiteit geheel zelfstandig uit. Dit is 'bekwaam verklaren'. Indien de student in deze fase van de opleiding nog niet alleen staat, dient de werkbegeleider het te beoordelen alsof hij/zij niet op de kamer aanwezig zou zijn." },
];

const CBD_VRAGEN = [
  { vraag: "Wat heb je gedaan?", doel: "Laat de student de casus (handelingen, bevindingen) en de relatie met de EPA toelichten." },
  { vraag: "Vraag naar achtergrondkennis: anatomie, pathofysiologie, techniek, klinisch redeneren etc.", doel: "Nagaan of student weet wat ze doet. Check klinisch redeneren." },
  { vraag: "Welke risico's en mogelijke complicaties spelen er?", doel: "Nagaan of de student voorbereid was op omgaan met risico's en complicaties." },
  { vraag: "Wat had je anders gedaan als de patiënt of situatie anders was geweest? (Bv. andere culturele achtergrond, medische geschiedenis, onverwachte bevindingen, mentale of fysieke afwijkingen, zelfde casus maar in nachtdienst, etc.)", doel: "Inschatten of een student ook weet hoe te handelen in situaties die je als begeleider mogelijk niet zal observeren." },
];

// Complexiteitscategorieën (kleur) van de EPA-tijdlijn
const EPA_CAT_KLEUR = { geel: "#e8b500", blauw: "#2f6fb0", groen: "#4a9d4a", roze: "#c2186f", rood: "#d23535" };
const EPA_CAT_LABEL = { geel: "Laagcomplex", blauw: "Middencomplex", groen: "Hoogcomplex", roze: "Specifiek", rood: "Functieoverstijgend" };

// start/zelf = kolommen 1-12 (twee per halfjaar); zelf = kolom waar niveau 4 hoort te staan
const EPA_TIJDSCHEMA = [
  { code: "MO-AM-1", alias: "AZ-FO-1-BAZ", bvp: true, niveau4HalfJaar: 2, cat: "geel", start: 2, zelf: 3 },
  { code: "AM-FO-1", alias: null, bvp: false, niveau4HalfJaar: 2, cat: "rood", start: 3, zelf: 4 },
  { code: "MO-AM-2", alias: "AZ-FO-2-BAZ", bvp: false, niveau4HalfJaar: 2, cat: "geel", start: 3, zelf: 4 },
  { code: "MO-AM-3", alias: null, bvp: false, niveau4HalfJaar: 2, cat: "geel", start: 3, zelf: 4 },
  { code: "MO-AM-4", alias: null, bvp: false, niveau4HalfJaar: 3, cat: "geel", start: 3, zelf: 6 },
  { code: "MO-AM-5", alias: null, bvp: false, niveau4HalfJaar: 3, cat: "geel", start: 3, zelf: 6 },
  { code: "MO-AM-6", alias: null, bvp: false, niveau4HalfJaar: 4, cat: "geel", start: 3, zelf: 8 },
  { code: "MO-AM-7", alias: null, bvp: false, niveau4HalfJaar: 4, cat: "geel", start: 3, zelf: 8 },
  { code: "MO-AM-8", alias: null, bvp: false, niveau4HalfJaar: 4, cat: "geel", start: 5, zelf: 8 },
  { code: "MO-AM-9", alias: "AZ-FO-3-BAZ", bvp: false, niveau4HalfJaar: 4, cat: "geel", start: 3, zelf: 8 },
  { code: "MO-AM-10", alias: null, bvp: false, niveau4HalfJaar: 5, cat: "blauw", start: 5, zelf: 10 },
  { code: "MO-AM-11", alias: null, bvp: false, niveau4HalfJaar: 5, cat: "blauw", start: 5, zelf: 10 },
  { code: "MO-AM-12", alias: null, bvp: false, niveau4HalfJaar: 5, cat: "blauw", start: 5, zelf: 10 },
  { code: "MO-AM-13", alias: null, bvp: false, niveau4HalfJaar: 5, cat: "blauw", start: 5, zelf: 10 },
  { code: "MO-AM-14", alias: null, bvp: false, niveau4HalfJaar: 4, cat: "blauw", start: 5, zelf: 8 },
  { code: "MO-AM-15", alias: "AZ-FO-4-BAZ", bvp: false, niveau4HalfJaar: 5, cat: "blauw", start: 5, zelf: 10 },
  { code: "MO-AM-16", alias: "AZ-REC-1", bvp: false, niveau4HalfJaar: 4, cat: "blauw", start: 5, zelf: 8 },
  { code: "MO-AM-17", alias: "AZ-REC-2", bvp: false, niveau4HalfJaar: 5, cat: "blauw", start: 7, zelf: 10 },
  { code: "MO-FO-2", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "rood", start: 9, zelf: 12 },
  { code: "MO-AM-18", alias: "AZ-FO-11", bvp: false, niveau4HalfJaar: 6, cat: "groen", start: 7, zelf: 12 },
  { code: "MO-AM-19", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "groen", start: 8, zelf: 12 },
  { code: "MO-AM-20", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "groen", start: 8, zelf: 11 },
  { code: "MO-AM-21", alias: "AZ-FO-6", bvp: false, niveau4HalfJaar: 4, cat: "groen", start: 3, zelf: 8 },
  { code: "MO-AM-22", alias: "AZ-REC-4", bvp: false, niveau4HalfJaar: 6, cat: "groen", start: 9, zelf: 12 },
  { code: "MO-AM-23", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "groen", start: 7, zelf: 12 },
  { code: "MO-AM-24", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "groen", start: 7, zelf: 12 },
  { code: "MO-AM-25", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "groen", start: 7, zelf: 12 },
  { code: "MO-AM-26", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "groen", start: 7, zelf: 12 },
  { code: "MO-AM-27", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "groen", start: 7, zelf: 12 },
  { code: "MO-AM-28", alias: "AZ-REC-3", bvp: false, niveau4HalfJaar: 5, cat: "groen", start: 7, zelf: 10 },
  { code: "MO-AM-29", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "roze", start: 11, zelf: 12 },
  { code: "MO-AM-30", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "roze", start: 11, zelf: 12 },
  { code: "MO-AM-31", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "roze", start: 11, zelf: 12 },
  { code: "MO-AM-32", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "roze", start: 11, zelf: 12 },
  { code: "MO-AM-33", alias: null, bvp: false, niveau4HalfJaar: 6, cat: "roze", start: 11, zelf: 12 },
];

const NOODKNOP_INFO = [
  {
    locatie: "Klinische OK (AUMC, locatie AMC)",
    tekst: "Aan de rechterkant bij binnenkomst via wasruimte, rechts bovenaan het knoppenpaneel: rode NOODKNOP.",
  },
  {
    locatie: "Dagcentrum (AUMC, locatie AMC)",
    tekst: "Op de pendel waar je het licht kunt bedienen: NOODKNOP (oproep crashteam).",
  },
  {
    locatie: "AUMC, locatie VU",
    tekst: "Intercomsysteem op de OK voor spoedoproep. Vraag bij start werken hoe deze werkt.",
  },
];

const MLK_INFO = [
  { locatie: "AUMC, locatie AMC", tekst: "Begin van iedere gang. Bevat o.a. glidescope. Schrijf op whiteboard waar je de MLK naartoe neemt!" },
  { locatie: "AUMC, locatie VU", tekst: "Naast workshop 2e etage, 6A49 workshop 6A, apparatuurruimte 6D164." },
];

const ALS_REVERSIBEL_KORT = [
  "Hypoxie", "Hypovolemie", "Hypo-/hyperkaliëmie/metabool",
  "Hypothermie/hyperthermie", "Trombose (coronair/pulmonaal)",
  "Tensie (spannings)pneumothorax", "Tamponade (cardiaal)", "Toxinen",
];

// Gedetailleerde 4H/4T met klinische acties (bron: Amsterdam UMC protocol)
const VIER_H_VIER_T = [
  {
    titel: "Hypoxie",
    categorie: "H",
    kleur: "#0A84FF",
    acties: [
      "Beoordeel EtO₂, loop verbindingen na",
      "Luister naar ademgeruis: beiderzijds? Bijgeluiden?",
      "Overweeg echo long, tube uitzuigen",
      "Arterieel bloedgas, bronchoscopie, TTE/TEE, X-thorax",
    ],
  },
  {
    titel: "Hypovolemie",
    categorie: "H",
    kleur: "#FF453A",
    acties: [
      "Stop de bloeding",
      "Geef vochtbolus i.v. (kristalloïden/colloïden), grote i.v.-toegang",
      "Massaal bloedverlies → MTP pakket A: 4 erytrocyten, 4 plasma's (FFP), 2 trombocyten",
      "DD: distributieve shock (sepsis, neurogene shock, anafylaxie)",
    ],
  },
  {
    titel: "Hyperkaliëmie",
    categorie: "H",
    kleur: "#FF9F0A",
    acties: [
      "Geef 30 ml calciumgluconaat 10% i.v.",
      "Geef 10 IE insuline i.v. + 25 g glucose (50 ml 50% of 125 ml 20% of 250 ml 10%)",
    ],
  },
  {
    titel: "Hypokaliëmie",
    categorie: "H",
    kleur: "#FF9F0A",
    acties: [
      "Geef 20 mmol KCl i.v. in 10 min via perfusor",
      "Gevolgd door 10 mmol in 10 min (i.c.m. magnesiumsulfaat 2 g i.v.)",
    ],
  },
  {
    titel: "Hypoglycemie",
    categorie: "H",
    kleur: "#FFD60A",
    acties: [
      "Geef 100 ml glucose 20% i.v. (medicatiekast verkoever), herhaal zo nodig",
      "Monitor glucose",
    ],
  },
  {
    titel: "Hypocalciëmie",
    categorie: "H",
    kleur: "#FFD60A",
    acties: [
      "Geef 30 ml calciumgluconaat 10% i.v. in 3–5 min",
    ],
  },
  {
    titel: "Hypomagnesiëmie",
    categorie: "H",
    kleur: "#FFD60A",
    acties: [
      "Geef magnesiumsulfaat 2 g i.v.",
    ],
  },
  {
    titel: "Hypothermie",
    categorie: "H",
    kleur: "#0A84FF",
    acties: [
      "Meet temperatuur centraal",
      "Ontdoe patiënt van natte kleding/lakens",
      "Verwarm met Bair Hugger + warm laken om hoofd",
      "Warme i.v.-vloeistof, overweeg maag/blaasspoeling en peritoneale lavage",
      "Verhoog temperatuur OK",
      "Overweeg cardiopulmonale bypass",
    ],
  },
  {
    titel: "Hyperthermie",
    categorie: "H",
    kleur: "#FF453A",
    acties: [
      "Ontdoe patiënt van kleding/lakens",
      "Koelen met koude i.v.-vloeistoffen",
      "Icepacks in oksels en liezen",
      "Overweeg cardiopulmonale bypass",
      "DD: maligne hyperthermie",
    ],
  },
  {
    titel: "(Trombo)embolie — Coronairocclusie",
    categorie: "T",
    kleur: "#BF5AF2",
    acties: [
      "Overweeg TEE/TTE en hartkatheterisatie",
      "Cardiologie: sein *59570",
    ],
  },
  {
    titel: "(Trombo)embolie — Longembolie",
    categorie: "T",
    kleur: "#BF5AF2",
    acties: [
      "Overweeg 50 mg alteplase i.v. bolus",
      "Indien voldoende effect: overweeg herhalen na 15 min",
      "Overweeg TEE/TTE",
    ],
  },
  {
    titel: "Tamponade",
    categorie: "T",
    kleur: "#BF5AF2",
    acties: [
      "Verricht TEE/TTE ter uitsluiting",
      "Overweeg thoracotomie met pericardiotomie",
      "Waarschuw cardiothoracaal chirurg: 29308",
    ],
  },
  {
    titel: "Toxinen / Intoxicatie",
    categorie: "T",
    kleur: "#FF453A",
    acties: [
      "Onderzoek medicatiefout",
      "Controleer inhoud en dosering infuus, pomp, damp en gegeven ampullen",
      "Overweeg intoxicatie lokaal anesthetica",
      "Overdosis Ca-antagonisten: 60 ml Ca-gluconaat 10% tijdens reanimatie, z.n. herhalen",
    ],
  },
  {
    titel: "Tensie (spannings)pneumothorax",
    categorie: "T",
    kleur: "#FF453A",
    acties: [
      "Spoeddecompressie",
    ],
  },
];

// Bron: AUMC Infectiepreventiebeleid — "OK: Schematisch overzicht isolatiemaatregelen" (Zenya/iProva)
const ISOLATIE_BRON = "AUMC Infectiepreventiebeleid — „OK: Schematisch overzicht isolatiemaatregelen” (Zenya/iProva)";
const ISOLATIE_TABEL = [
  {
    type: "Contact — eenpersoonskamer",
    kleur: "#3498DB",
    varianten: [
      { naam: null, steriel: "Normaal steriel", nietSteriel: "Schort & handschoenen", eindeProgramma: "Nee" },
    ],
    holding: "Ja, op 1-persoonskamer. Indien niet beschikbaar: op zaal met min. 1,5 m afstand tussen bedden.",
    disposable: "Standaard",
    reusable: "Standaard",
    leegruimen: "Nee",
    schoonmaak: "Eindschoonmaak",
    voorbeelden: "MRSA/BRMO hoog risico (mits PCR-afname) of BRMO (ESBL, niet CPE/VRE)",
  },
  {
    type: "Druppel",
    kleur: "#7F8C8D",
    varianten: [
      { naam: "Druppel", steriel: "Normaal steriel", nietSteriel: "Geen", eindeProgramma: "Nee" },
      { naam: "Druppel i.c.m. aerosolvormende handeling*", steriel: "Normaal steriel + FFP2-masker & bril tot 30 min. na aerosolvorming", nietSteriel: "FFP2-masker & bril tot 30 min. na aerosolvormende handeling", eindeProgramma: "Ja" },
    ],
    holding: "Ja, op 1-persoonskamer. Indien niet beschikbaar: op zaal met minimaal 1,5 m afstand tussen bedden met gesloten bedgordijnen.",
    disposable: "Standaard",
    reusable: "Standaard",
    leegruimen: "Nee",
    schoonmaak: "Eindschoonmaak",
    voorbeelden: "Influenza, SARS-CoV-2",
  },
  {
    type: "Contact — einddesinfectie",
    kleur: "#27AE60",
    varianten: [
      { naam: null, steriel: "Normaal steriel", nietSteriel: "Schort & handschoenen", eindeProgramma: "Ja" },
    ],
    holding: "Ja, verplicht op 1-persoonskamer. Indien niet beschikbaar: op OK.",
    disposable: "Onafgedekt materiaal weggooien",
    reusable: "Standaard",
    leegruimen: "Ja",
    schoonmaak: "Eindschoonmaak & Einddesinfectie",
    voorbeelden: "BRMO-VRE/CPE, Norovirus, Clostridium",
  },
  {
    type: "Aerogeen",
    kleur: "#F1C40F",
    varianten: [
      { naam: null, steriel: "Normaal steriel + FFP2-masker** & bril tot 30 min. na vertrek patiënt", nietSteriel: "FFP2-masker** & bril tot 30 min. na vertrek patiënt", eindeProgramma: "Ja" },
    ],
    holding: "Nee; op de operatiekamer.",
    disposable: "Standaard",
    reusable: "Standaard",
    leegruimen: "Nee",
    schoonmaak: "30 minuten laten luchten. Eindschoonmaak.",
    voorbeelden: "TBC, waterpokken, mazelen en gordelroos",
  },
  {
    type: "Strikt",
    kleur: "#E74C3C",
    varianten: [
      { naam: null, steriel: "Normaal steriel", nietSteriel: "Schort & handschoenen", eindeProgramma: "Ja" },
    ],
    holding: "Nee; op de operatiekamer. PACU AMC: verkoeveren in box 3.",
    disposable: "Onafgedekt materiaal weggooien",
    reusable: "Standaard",
    leegruimen: "Ja",
    schoonmaak: "Eindschoonmaak & Einddesinfectie",
    voorbeelden: "MRSA-drager, MR-Acinetobacter",
  },
  {
    type: "Strikt bril",
    kleur: "#C2185B",
    varianten: [
      { naam: null, steriel: "Normaal steriel. FFP2-masker & bril tot 30 min. na vertrek patiënt.", nietSteriel: "FFP2-masker & bril tot 30 min. na vertrek patiënt. Schort & handschoenen.", eindeProgramma: "Ja" },
    ],
    holding: "Binnenkomst via verkeersluwe ingang. Direct naar operatiekamer.",
    disposable: "Onafgedekt materiaal weggooien",
    reusable: "Standaard",
    leegruimen: "Ja",
    schoonmaak: "30 minuten laten luchten. Eindschoonmaak & Einddesinfectie.",
    voorbeelden: "MERS",
  },
];
const ISOLATIE_VOETNOTEN = [
  "Neem bij twijfel altijd contact op met de afdeling Infectiepreventie. Afval afvoeren volgens beleid 'Afvalbeheer LDC'.",
  "* Na aerosolvormende handelingen: operatiekamer niet betreden binnen 30 minuten, ofwel met FFP2-masker en beschermende bril. Aerosolvormend zijn: scopie bovenste tractus digestivus, bronchoscopie/-alveolaire lavage, intubatie/detubatie, reanimatie, laryngoscopie, uitzuigen (diep tracheaal). NB: vernevelen (met en zonder voorzetkamer), non-invasieve beademing en High Flow Nasal Oxygen vallen NIET onder aerosolvormende handelingen.",
  "** Bij waterpokken/mazelen/gordelroos: alleen FFP2 indien de medewerker de ziekte niet heeft doorgemaakt (waterpokken) of niet gevaccineerd is (mazelen). Anders chirurgisch mondneusmasker IIR i.p.v. FFP2.",
  "Bij isolatievorm Druppel: niet detuberen op de verkoever.",
  "Voor MRSA laag risico of MRSA/BRMO laag risico gelden geen isolatiemaatregelen.",
];

// ============================================================
// INTERNE TELEFOONLIJST
// ============================================================

const PERSONEEL_GROEPEN = [
  {
    titel: "Dienstseinen (alle specialismen)",
    kleur: "#FF453A",
    items: [
      { naam: "Anesthesie, jongste", nummer: "s 59337 / s 59397" },
      { naam: "Apotheek", nummer: "s 59844 / s 63824" },
      { naam: "Audiologie", nummer: "s 29492" },
      { naam: "Bacteriologie", nummer: "s 29308" },
      { naam: "Cardiochirurgie ass. dag/nacht", nummer: "s 59034" },
      { naam: "Cardiochirurgie assistenten", nummer: "s 28683" },
      { naam: "Cardiochirurgie coördinator", nummer: "s 59762" },
      { naam: "Cardiochirurgie kinderen", nummer: "s 59570" },
      { naam: "Cardiologie", nummer: "s 62176 / s 62664" },
      { naam: "CCU", nummer: "s 59537 / s 59007" },
      { naam: "Chirurgie Co-ass.", nummer: "s 59556 / s 59559" },
      { naam: "Chirurgie, oudste co", nummer: "s 29315" },
      { naam: "Chirurgie, jongste", nummer: "s 29372" },
      { naam: "Chirurgie, 17.30–7.30 u.", nummer: "s 27624" },
      { naam: "Chirurgie, GE/oncologische", nummer: "s 59535" },
      { naam: "Chirurg, vaat", nummer: "s 28424" },
      { naam: "Consulent nucleaire", nummer: "s 59240" },
      { naam: "CT-spoedsein", nummer: "s 59179" },
      { naam: "Dialyse", nummer: "s 65700 / s 65800" },
      { naam: "EHH", nummer: "60558 / s 60559" },
      { naam: "Geriatrie afd-IC / SEH", nummer: "s 59311" },
      { naam: "Gynaecologie AIOS dag/nacht", nummer: "s 59312" },
      { naam: "Gynaecologie verloskunde", nummer: "60560 / s 60561" },
      { naam: "Hematologie ass / consulent", nummer: "s 59303" },
      { naam: "IC arts fellow", nummer: "s 61000" },
      { naam: "IC arts staflid", nummer: "s 29314 / s 28194" },
      { naam: "Interne oudste / consulent", nummer: "s 59579 / s 59178" },
      { naam: "Kinderarts", nummer: "s29372 (chi) / 29081" },
      { naam: "Kinderchirurg dag / avond-weekend", nummer: "29300 / 29093" },
      { naam: "KNO DD / Consulent", nummer: "s 28336" },
      { naam: "Longen", nummer: "s 29750" },
      { naam: "MDL-arts", nummer: "20301" },
      { naam: "MKA dag/nacht", nummer: "s 68745" },
      { naam: "Nefroloog", nummer: "s 59310" },
      { naam: "Neonatologie ass.", nummer: "s 59304" },
      { naam: "Neurochirurgie ass", nummer: "s 63742" },
      { naam: "Neurochirurgie Oudste AIOS", nummer: "s 58697" },
      { naam: "Neurocentrum (Arts-assistent H6/Brain Care Unit)", nummer: "s 58386" },
      { naam: "Neurologie ass dag/nacht", nummer: "s 59696 / s 59302" },
      { naam: "Oncologische chirurg", nummer: "s 62955" },
      { naam: "Oogheelkunde / house phys.", nummer: "s 59259 / 29543" },
      { naam: "Orthopaedie ass.", nummer: "29612" },
      { naam: "Orthopaedie kinderen", nummer: "s 59580" },
      { naam: "Pijnteam (chron. pijn)", nummer: "s 62291" },
      { naam: "Plastische chir", nummer: "28345" },
      { naam: "Polikliniek Trauma", nummer: "F 6967628 / s 62297" },
      { naam: "Prik co-assistent", nummer: "s 59216 / s 59217" },
      { naam: "Psychiatrie", nummer: "s 59011" },
      { naam: "Radiologie", nummer: "s 59389" },
      { naam: "Interventieradiologie (dd)", nummer: "06-50093057" },
      { naam: "Radiotherapie", nummer: "s 68690" },
      { naam: "Reanimatie coördinator", nummer: "s 59624" },
      { naam: "Revalidatiearts", nummer: "s 59203" },
      { naam: "Röntgenlaborant", nummer: "s 59147" },
      { naam: "SEH staf sein", nummer: "s 59232" },
      { naam: "Stolling", nummer: "s 59459" },
      { naam: "Trauma stafsein", nummer: "s 62304" },
      { naam: "Urologie volw.", nummer: "29039" },
      { naam: "Urologie kinderen", nummer: "29948" },
      { naam: "Vasculair arts", nummer: "s 57232" },
      { naam: "ZH-tandarts", nummer: "s 63499" },
      { naam: "ZH hygiëne", nummer: "s 63499 / 29199" },
    ],
  },
  {
    titel: "Anesthesiologie — diensten & coördinatie",
    kleur: "#0A84FF",
    items: [
      { naam: "Alg. OK coördinatie", nummer: "sein 59662" },
      { naam: "APS sein", nummer: "sein 59710 / tel 63040" },
      { naam: "Co-ass.", nummer: "sein 63031 / tel 62546" },
      { naam: "Coördin./Stip OK ass.", nummer: "sein 59152 / tel 62236" },
      { naam: "Coördinatie Anesth.", nummer: "sein 59663" },
      { naam: "Dag Coördinator AMW", nummer: "sein 59571" },
      { naam: "Jongste Assistent", nummer: "sein 59573 / tel 66682" },
      { naam: "Obstetrische ANS", nummer: "sein 57461 / tel 66682" },
      { naam: "Oudste Assistent", nummer: "sein 59576 / tel 66682" },
      { naam: "Consulentensein", nummer: "sein 58546" },
      { naam: "AM traumasein", nummer: "sein 59577" },
      { naam: "Skillslab/SIM sein", nummer: "tel 27396" },
      { naam: "SPS", nummer: "sein 57166" },
      { naam: "Sedatie Q4 GY", nummer: "sein 58320" },
      { naam: "Verkoever overdag", nummer: "sein 59660" },
      { naam: "Cardio-anest AMC", nummer: "sein 25034 / tel 82937412" },
      { naam: "Cardio-anest VUmc", nummer: "sein 25035 / tel 82340898" },
      { naam: "Kinderanesthesie AMC", nummer: "sein 58547" },
      { naam: "Diensttracer Consult (D.L.) VUmc", nummer: "61152" },
      { naam: "Coördinator OK VUmc", nummer: "*98 6707" },
      { naam: "Dienstdoende Anest. mw. VUmc", nummer: "*98 6380" },
      { naam: "Dienstdoende assistent VUmc", nummer: "61151" },
      { naam: "Dienstdoende assistent avond VUmc", nummer: "61152" },
      { naam: "Dienstdoende staflid VUmc", nummer: "*98 6273" },
      { naam: "IC 6N Dienst assistent VUmc", nummer: "*98 6413" },
      { naam: "IC 6N dienst staf VUmc", nummer: "*98 6275" },
      { naam: "Radioloog (dienst) VUmc", nummer: "*98 6282" },
      { naam: "Stagist cardio dag VUmc", nummer: "*98 6181 / 6261" },
      { naam: "Stagist cardio nacht VUmc", nummer: "*98 6296" },
      { naam: "Supervisor sedatie VUmc", nummer: "*98 6615" },
      { naam: "Senior Co 1", nummer: "kort 29616 / 06-50079523" },
      { naam: "Senior Co 2", nummer: "kort 29761 / 06-50079522" },
      { naam: "Esselman, Anja (Vumc)", nummer: "kort 36206 / 06-42225" },
      { naam: "Riewald, Mark (Vumc)", nummer: "06-42225" },
      { naam: "POS 1", nummer: "27156" },
      { naam: "POS 2", nummer: "22555" },
      { naam: "Zonneveld, Lyonne", nummer: "kort 27337 / 06-50079518" },
      { naam: "Secretariaat anesthesiologie", nummer: "zie mail: secretariaat-anesthesiologie@amsterdamumc.nl" },
      { naam: "Kamps, Grace (secretariaat)", nummer: "(56) 61915" },
      { naam: "Brom van den, Charissa (research)", nummer: "tel 68224" },
      { naam: "Sedatie (alleen door staf in gebruik)", nummer: "*98 6615" },
      { naam: "Bozic, Caitlin (research)", nummer: "kort 23049 / tel 27382139" },
      { naam: "Breel, Jenni (AMC, research)", nummer: "kort 29528 / tel 67697" },
      { naam: "Hauck-Weber, Nina (research)", nummer: "tel 68215" },
      { naam: "Kroon, Olaf (datamanager)", nummer: "—" },
      { naam: "Verbruggen, Vera (manager bedrijfsvoering)", nummer: "tel 62789" },
      { naam: "AMW manager anesthesiemedewerkers — Lijnsvelt, Marieke", nummer: "sein 29021 / tel 82264442" },
      { naam: "AMW — EL Moutaouakkil", nummer: "sein 27167" },
      { naam: "AMW — Liewes, Lisette", nummer: "sein 29014" },
      { naam: "AMW — Roubos, Esther", nummer: "—" },
      { naam: "AMW — Runia, Leendert", nummer: "sein 29820" },
      { naam: "AMW — Tongeren van, Michael", nummer: "sein 61381" },
      { naam: "PACU — Bakker, Chris", nummer: "06-82130298" },
      { naam: "PACU — Chouchane, Slah", nummer: "sein 23152 / tel 50075242" },
      { naam: "PACU — Kaim, Martijn", nummer: "sein 24310 / tel 50075290" },
      { naam: "PACU — Driel van, Paulette", nummer: "06-25716108" },
      { naam: "PACU — Verhaar, Romana", nummer: "sein 25111 / tel 21456548" },
      { naam: "Noodnummer anesthesiologie", nummer: "(020-56) 61692" },
      { naam: "Bellen vanaf VUmc/thuis naar AMC-kortnummer", nummer: "vanaf VUmc: 73 + nr · vanaf thuis: 020-73 + nr" },
    ],
  },
  {
    titel: "AMC — Dienstseinen SAM",
    kleur: "#BF5AF2",
    items: [
      { naam: "Dd Anesthesioloog", nummer: "58332" },
      { naam: "Dd Bacterioloog", nummer: "59530" },
      { naam: "Dd Capu Chirurg", nummer: "59492" },
      { naam: "Dd Capu Anesthesioloog", nummer: "29308 / 57352" },
      { naam: "Dd Cardioloog", nummer: "59570" },
      { naam: "Dd Chirurgie (jongste/oudste)", nummer: "59315 / 59372" },
      { naam: "Dd Geriater", nummer: "58597" },
      { naam: "Dd Gynaecoloog", nummer: "59311" },
      { naam: "Dd Hematoloog", nummer: "57172" },
      { naam: "Dd IC Fellow", nummer: "59303" },
      { naam: "Dd IC Staflid", nummer: "61000" },
      { naam: "Dd Internist / Consulten dag", nummer: "59194" },
      { naam: "Dd Internist SEH av/na/wknd", nummer: "59314" },
      { naam: "Dd Kinderarts", nummer: "59579" },
      { naam: "Dd Kinderchirurg", nummer: "29081" },
      { naam: "Dd Kinder IC arts", nummer: "59319" },
      { naam: "Dd Kinder opname", nummer: "59177" },
      { naam: "Dd Klinische chemicus", nummer: "65929" },
      { naam: "Dd KNO arts", nummer: "29093 / 29300" },
      { naam: "Dd Longarts", nummer: "59305" },
      { naam: "Dd MDL arts", nummer: "59916 / 59750" },
      { naam: "Dd MKA arts", nummer: "20301" },
      { naam: "Dd Nefroloog", nummer: "59247" },
      { naam: "Dd Neurchirurg", nummer: "59304" },
      { naam: "Dd Neuroloog", nummer: "kort 29696" },
      { naam: "Dd Nucleaire arts", nummer: "58424" },
      { naam: "Dd Obstetrie (overdag)", nummer: "59312" },
      { naam: "Dd Oogarts", nummer: "59259" },
      { naam: "Dd Orthopaed", nummer: "29612" },
      { naam: "Dd Perfusionist", nummer: "57388" },
      { naam: "Dd Plastisch Chirurg", nummer: "58345" },
      { naam: "Dd Psychiater", nummer: "59011 / 59016" },
      { naam: "Dd Radioloog", nummer: "59389" },
      { naam: "Dd Radioloog Interventie", nummer: "59834" },
      { naam: "Dd Revalidatiearts", nummer: "59203" },
      { naam: "Dd Röntgenlaborant", nummer: "59167" },
      { naam: "Dd SEH arts", nummer: "59232" },
      { naam: "Dd staf Kinderchirurgie", nummer: "58380" },
      { naam: "Dd Tandarts", nummer: "63499" },
      { naam: "Dd Uroloog", nummer: "29039" },
      { naam: "Dd Vasculaire arts", nummer: "57232" },
      { naam: "Regiesein cardiothoracale chir", nummer: "28683" },
    ],
  },
  {
    titel: "AMC — Algemeen",
    kleur: "#40C8E0",
    items: [
      { naam: "Ambulance", nummer: "088-129755" },
      { naam: "Beddencoörd. Kinderen", nummer: "29177" },
      { naam: "Brachytherapie", nummer: "59770" },
      { naam: "CAPD", nummer: "59175" },
      { naam: "Cardioversie", nummer: "57166" },
      { naam: "Diëtist", nummer: "28161" },
      { naam: "Hyperbare Geneesk.", nummer: "64500" },
      { naam: "ICT", nummer: "63011" },
      { naam: "Infectiepreventie", nummer: "29199 / 78022" },
      { naam: "Instrumenteel bedrijf", nummer: "67000" },
      { naam: "Keuken/Voeding", nummer: "58231" },
      { naam: "MICU", nummer: "66661" },
      { naam: "NEURO H6 Stip", nummer: "28664" },
      { naam: "Opname coördinator", nummer: "29987" },
      { naam: "PM Technicus", nummer: "64547" },
      { naam: "PMU Centr.receptie", nummer: "13500" },
      { naam: "POCT citolab", nummer: "59466" },
      { naam: "Portier/receptie", nummer: "64004" },
      { naam: "Psycolance", nummer: "088-0129720" },
      { naam: "Reanimatie/Trauma", nummer: "59577" },
      { naam: "Schoonmaak", nummer: "59398" },
      { naam: "Schoonmaak na 20.00 uur", nummer: "29904" },
      { naam: "Stip Cardiochirurgie", nummer: "22303" },
      { naam: "Stip F7NO", nummer: "29910" },
      { naam: "Stip H6 ortho", nummer: "22760 / 69071" },
      { naam: "Stip Neuro avond", nummer: "28664" },
      { naam: "Stip Neuro nacht (23–7.30u)", nummer: "58665" },
      { naam: "Stip SEH vpk", nummer: "63336" },
      { naam: "Storing Monitor", nummer: "58441" },
      { naam: "Superstip IC", nummer: "58315" },
      { naam: "Status archief", nummer: "62035" },
      { naam: "TD Charles", nummer: "58452" },
      { naam: "TD grote OK", nummer: "58441" },
      { naam: "Ziekenhuishygiëne", nummer: "29199" },
    ],
  },
  {
    titel: "AMC — Functie-afdelingen",
    kleur: "#40C8E0",
    items: [
      { naam: "Baclab", nummer: "sein 59144 / tel 63026" },
      { naam: "Bloedbank", nummer: "62526" },
      { naam: "CCU", nummer: "62176 / 62664" },
      { naam: "EHH", nummer: "65700 / 65800" },
      { naam: "GIOCA", nummer: "59521" },
      { naam: "Gipskamer", nummer: "62295" },
      { naam: "Longfunctie", nummer: "63104" },
      { naam: "MDL Herstelkamer", nummer: "62056" },
      { naam: "MDL balie ENDO", nummer: "24302" },
      { naam: "Microbioloog", nummer: "59492" },
      { naam: "PA", nummer: "62827" },
      { naam: "Perfusie", nummer: "sein 57388 / tel 62611" },
      { naam: "Routinelab", nummer: "63123 / 62525" },
      { naam: "Satelliet Apotheek", nummer: "62879" },
      { naam: "SEH balie", nummer: "63333 / 63232" },
    ],
  },
  {
    titel: "AMC — Verpleegafdelingen",
    kleur: "#8E8E93",
    items: [
      { naam: "Verpleegafdelingen — algemeen", nummer: "62848" },
      { naam: "ICU1 = medium care", nummer: "62865 / 62803" },
      { naam: "ICU2", nummer: "66007 / 62200" },
      { naam: "ICU3", nummer: "66337 / 66667" },
      { naam: "ICU4", nummer: "66474" },
      { naam: "ICU5", nummer: "62846 / 66324" },
      { naam: "ICU6", nummer: "62005" },
      { naam: "IC arts", nummer: "59303" },
      { naam: "IC bedden", nummer: "29231" },
      { naam: "IC bedverdeling / IC stip", nummer: "58315" },
      { naam: "D0-422 Dagcentrum", nummer: "64078 / 64458" },
      { naam: "D0-422 Kinderdagziekenhuis", nummer: "63900" },
      { naam: "F3NO CCU/ F3N CTC", nummer: "62176 / 62564" },
      { naam: "F3ZU CTCH cardio complex care/Shortstay", nummer: "22305" },
      { naam: "F3ZU CTC AOA", nummer: "25277 / 63628 / 22303 stip" },
      { naam: "F4NO CTCH", nummer: "64433" },
      { naam: "F4ZU Cardiologie", nummer: "65777" },
      { naam: "F5NO/CHI/VAA/MZK", nummer: "68906 / 68905" },
      { naam: "F5ZU/INT short stay", nummer: "64066 / 64560" },
      { naam: "F6NO INT", nummer: "62062 / 62562" },
      { naam: "F6ZU Nierziekten", nummer: "66003" },
      { naam: "F7NO INT/NEF", nummer: "67804" },
      { naam: "F8NT Emma Sport/tienerafd.", nummer: "64471 / 64392" },
      { naam: "F8ZU Emma Fauna/kinderoncologie", nummer: "63167 / 62967 / 28935 stip" },
      { naam: "G3ZU NICU", nummer: "67676 / 64370" },
      { naam: "G4ZU Acute Opname AOA", nummer: "67804 / 29910 stip" },
      { naam: "G5NO Ort/sportgeneeskunde", nummer: "63056 / 63156 / 22760 stip" },
      { naam: "G5ZU TRA", nummer: "66002 / 66061 / 26068 stip" },
      { naam: "G6ZU", nummer: "62062" },
      { naam: "G6NO Gynaecologie", nummer: "63665 / 63765" },
      { naam: "G8NZ Emma Acuut/gr.kinderen", nummer: "62051 / 65858" },
      { naam: "H3NO Haven IC Neonatologie", nummer: "62125 / 65769" },
      { naam: "Coördinator neonatologie", nummer: "53355" },
      { naam: "H8ZU IC Kinderen", nummer: "62754" },
      { naam: "IC Kinderarts", nummer: "59319" },
      { naam: "H3ZU Zwangeren", nummer: "63666 / 64466" },
      { naam: "H4ZU Kraam", nummer: "63656 / 63553" },
      { naam: "H5NO Kortverblijf", nummer: "64560 / 64066 / 69115" },
      { naam: "H5ZU Nierziekten", nummer: "66003 / 63064 / 64170" },
      { naam: "H6NO Neurocentrum", nummer: "64063 / 28664 stip" },
      { naam: "H6ZU Neuchi", nummer: "63861 / 63461" },
      { naam: "H7ZU Emma Tuin/zuigelingen", nummer: "63168 / 63368" },
      { naam: "AOSK/F8ZU Emma/kinderdagzkh", nummer: "65857" },
      { naam: "Eerste hulp pat. bestellen", nummer: "63336 / 63333" },
      { naam: "EHHU pat. bestellen", nummer: "65800 / 63333" },
      { naam: "DH6 Neuro", nummer: "63864" },
      { naam: "KHDZ", nummer: "63157" },
      { naam: "SEH Vrouwen/H3Z", nummer: "61500 / 63357" },
      { naam: "PMU (psychiatrie) PB01", nummer: "13843" },
      { naam: "HIC", nummer: "13739" },
      { naam: "PMC", nummer: "13737" },
      { naam: "PSY", nummer: "13838" },
      { naam: "Psychiatrie (STST)", nummer: "62224" },
      { naam: "Kinderpsychiatrie", nummer: "13778" },
      { naam: "VUmc algemeen", nummer: "020-444 4444" },
      { naam: "Buizenpost OK", nummer: "419" },
    ],
  },
  {
    titel: "AMC — OK's, poli & pijn",
    kleur: "#FF9F0A",
    items: [
      { naam: "OK Anesthesiologie", nummer: "775 + OK-nr + 30" },
      { naam: "OK TD", nummer: "*58441" },
      { naam: "OK Balie", nummer: "63313" },
      { naam: "OK Afdelingshulp", nummer: "*59230" },
      { naam: "OK Acuut", nummer: "*59154" },
      { naam: "Poli pre-assessment", nummer: "63496" },
      { naam: "Poli Anest Back Office", nummer: "66871 / 27156" },
      { naam: "Pijnteam (chron. pijn)", nummer: "22291" },
      { naam: "Vpk Chron. pijn", nummer: "22292 / 22293" },
      { naam: "Palliatief VPK", nummer: "25868 / 650094318" },
      { naam: "Steriel verkeer OK 1/8", nummer: "77501 / 77531" },
      { naam: "OK 1", nummer: "77502 / 77532" },
      { naam: "OK 2", nummer: "77503 / 77533" },
      { naam: "OK 3", nummer: "77504 / 77534" },
      { naam: "OK 4", nummer: "77505 / 77535" },
      { naam: "OK 5", nummer: "77506 / 77536" },
      { naam: "OK 6", nummer: "77507 / 77537" },
      { naam: "OK 7", nummer: "77508 / 77538" },
      { naam: "OK 8", nummer: "77509 / 77539" },
      { naam: "OK 9", nummer: "77510 / 77540" },
      { naam: "OK 10", nummer: "77511 / 77541" },
      { naam: "OK 11", nummer: "77512 / 77542" },
      { naam: "OK 12", nummer: "77584" },
      { naam: "OK 13", nummer: "77592" },
      { naam: "OK 14", nummer: "77514 / 77544" },
      { naam: "OK 15", nummer: "77515 / 77545" },
      { naam: "OK 16", nummer: "77516 / 77546" },
      { naam: "OK 17", nummer: "77517 / 77547" },
      { naam: "OK 18", nummer: "77518 / 77548" },
      { naam: "OK 19", nummer: "77519 / 77549" },
      { naam: "OK 20", nummer: "77520 / 77550" },
      { naam: "OK 21", nummer: "77521 / 77551" },
      { naam: "Wachtruimte Pre-operatief", nummer: "62546" },
      { naam: "Wachtruimte H1-105", nummer: "62236" },
      { naam: "Kinder Verkoever", nummer: "62740" },
      { naam: "Decentraal Lab", nummer: "66793" },
      { naam: "Koffiekamer (verkoeverkamer)", nummer: "63731" },
      { naam: "Balie High Care 1", nummer: "63040" },
      { naam: "Balie High Care 2", nummer: "62646" },
      { naam: "Balie High Care 3", nummer: "63140" },
      { naam: "Balie High Care 4", nummer: "62840" },
      { naam: "Secretariaat (verkoeverkamer)", nummer: "62448" },
      { naam: "Stip (verkoeverkamer)", nummer: "sein 59661 / tel 69100" },
      { naam: "Hartcatheterisatie secr.", nummer: "65865" },
      { naam: "Hartcath kamer 1", nummer: "64005" },
      { naam: "Hartcath kamer 2", nummer: "65744" },
      { naam: "Hartcath kamer 3", nummer: "65745" },
      { naam: "Hartcath kamer 4", nummer: "66415" },
      { naam: "Echo-Car. Balie", nummer: "68662 / 62907" },
      { naam: "VHC", nummer: "sein 51903" },
    ],
  },
  {
    titel: "AMC — Röntgen & radiodiagnostiek",
    kleur: "#0A84FF",
    items: [
      { naam: "Afsprakenbureau", nummer: "65765" },
      { naam: "Angiokamer", nummer: "62701" },
      { naam: "Archief röntgen", nummer: "63003" },
      { naam: "Balie röntgen", nummer: "63401" },
      { naam: "CT", nummer: "63831 / 64133" },
      { naam: "CT Spoedsein", nummer: "59240" },
      { naam: "Echo DD", nummer: "59389" },
      { naam: "Hot seat (uitslag X-foto's)", nummer: "62021" },
      { naam: "Interventieradioloog", nummer: "59834" },
      { naam: "Kinder MRI", nummer: "66989" },
      { naam: "MRI avond/nacht", nummer: "66860" },
      { naam: "MRI 5", nummer: "66868 / 67704" },
      { naam: "Röntgen OK", nummer: "59190" },
      { naam: "Röntgen", nummer: "59547 / 59147" },
      { naam: "Angio/VAAT interventie", nummer: "8918+62701 / sein 28192" },
      { naam: "int.kamer (angio)", nummer: "28211 / sein 28192" },
      { naam: "Verpleegbalie XA1 + XA2", nummer: "68918" },
      { naam: "XA1", nummer: "62602" },
      { naam: "XA2", nummer: "62604" },
      { naam: "CT 2 (wk6)", nummer: "63832 / 62032" },
      { naam: "CT afspraken", nummer: "65765" },
      { naam: "Afspr.bureau intern", nummer: "72071 / 72074" },
      { naam: "Afspraken Balie", nummer: "62002" },
      { naam: "MRI planning", nummer: "68801 / 68283" },
      { naam: "MR3", nummer: "66860" },
      { naam: "MRI 4 + 5 (balie)", nummer: "68383 / 67704" },
      { naam: "wk5", nummer: "68918" },
      { naam: "MRI ZO", nummer: "72011" },
      { naam: "Röntgen (2)", nummer: "28440" },
      { naam: "Röntgen (3)", nummer: "29147" },
      { naam: "Röntgen (4)", nummer: "29190" },
      { naam: "Teamleider radiodiagnostiek", nummer: "62630 / 23101" },
      { naam: "Lab. hybride OK", nummer: "28211" },
      { naam: "TD hybride OK", nummer: "28416 / 28426" },
    ],
  },
  {
    titel: "AMC — Dagcentrum",
    kleur: "#FF9F0A",
    items: [
      { naam: "Administratie DC", nummer: "tel 64078 / sein 65061" },
      { naam: "Angiokamer (DC)", nummer: "sein *58192" },
      { naam: "Boodschappensein", nummer: "sein 29228" },
      { naam: "Coördinator Acute OK", nummer: "sein *59662" },
      { naam: "Coördinator anesthesie acute OK", nummer: "sein *59663" },
      { naam: "Regiesein anesthesie medewerker", nummer: "sein *59571" },
      { naam: "Regiesein OK DC", nummer: "sein 29126" },
      { naam: "Oproepdienst verpleging", nummer: "sein *59130" },
      { naam: "Apotheek balie (DC)", nummer: "62211" },
      { naam: "Archief (status)", nummer: "62035" },
      { naam: "Behandel/interventie DC", nummer: "tel 64119 — D0-145" },
      { naam: "Behandelkamer (DC)", nummer: "tel 64119 — D0-146" },
      { naam: "Bloedbank (DC)", nummer: "62526 / 65877" },
      { naam: "Brancardier", nummer: "63300" },
      { naam: "Bureau opname", nummer: "63290" },
      { naam: "Diabetes verpleegkundige", nummer: "sein 62393" },
      { naam: "Draadloze telefoon", nummer: "tel 62031 — D0-422" },
      { naam: "ECG (DC)", nummer: "sein *59572" },
      { naam: "Euroclean/HAGO", nummer: "tel 64453 / sein *58784" },
      { naam: "Fax DC", nummer: "5669560" },
      { naam: "Gang D0-106 t.o. OK D4", nummer: "77029" },
      { naam: "Gastvrouw", nummer: "sein *59223 / 59223" },
      { naam: "Gipskamer (DC)", nummer: "62296" },
      { naam: "ICT balie", nummer: "tel 63011 / sein *58588" },
      { naam: "Instrumentele dienst", nummer: "67000" },
      { naam: "Kamer 313", nummer: "tel 72110 / sein *53003" },
      { naam: "Kamer 434", nummer: "tel 72112 / sein *53004" },
      { naam: "Kamer 435", nummer: "tel 72113 / sein *53005" },
      { naam: "Kamer 439", nummer: "tel 72114 / sein *53006" },
      { naam: "Kamer 440", nummer: "tel 72119 / sein *53007" },
      { naam: "Kamer 444", nummer: "tel 72120 / sein *53008" },
      { naam: "Kinderverkoever (DC)", nummer: "tel 62982 — D0-241" },
      { naam: "Klinische verkoever", nummer: "63040" },
      { naam: "Koffiekamer DC", nummer: "66704 / 64173 — D0-315" },
      { naam: "Linnenkamer", nummer: "63322" },
      { naam: "Mammacare verpl.chi", nummer: "sein 59360" },
      { naam: "OK D1", nummer: "tel 72103 — D0-132" },
      { naam: "OK D1 voorbereiding", nummer: "tel 72108 — D0-151" },
      { naam: "OK D2", nummer: "tel 72102 — D0-157" },
      { naam: "OK D2 voorbereiding", nummer: "tel 72107 — D0-153" },
      { naam: "OK D3", nummer: "tel 72101 — D0-156" },
      { naam: "OK D3 voorbereiding", nummer: "tel 72106 — D0-155" },
      { naam: "OK D4", nummer: "tel 72104 — D0-136" },
      { naam: "OK D4 voorbereiding", nummer: "tel 72109 — D0-133" },
      { naam: "OK D5", nummer: "tel 72105 — D0-137" },
      { naam: "OK D5 voorbereiding", nummer: "tel 72116 — D0-413" },
      { naam: "OK-balie boven", nummer: "63313" },
      { naam: "Opname DC", nummer: "tel 64117 / 67092 — D0-139" },
      { naam: "Pedagogie", nummer: "tel 58615+59504 / sein 65674" },
      { naam: "Portier (DC)", nummer: "64004" },
      { naam: "Psychiatrie (STST, DC)", nummer: "62224" },
      { naam: "Receptie balie DC", nummer: "tel 64078 / 63733 — D0-138" },
      { naam: "Receptie faxnr. DC", nummer: "5669560 / 61540" },
      { naam: "Röntgen (DC)", nummer: "tel s59409 / sein 58410" },
      { naam: "Schoonmaak Filomena", nummer: "tel s64069" },
      { naam: "Secretariaat DC", nummer: "D0-124" },
      { naam: "Spreekkamer DC", nummer: "D0-135" },
      { naam: "Steriele ruimte DC", nummer: "D0-415" },
      { naam: "Technische dienst OK (DC)", nummer: "sein *58441" },
      { naam: "Technische dienst pacemaker", nummer: "sein *58523" },
      { naam: "Vergaderruimte DC", nummer: "64050 / 64047 — D0-127" },
      { naam: "Verkleedsluis DC", nummer: "tel 72118 — D0-140" },
      { naam: "Verkoever (DC)", nummer: "tel 64133 — D0-242" },
      { naam: "Verkoever pre-ok", nummer: "sein 62546" },
      { naam: "Verpleegbalie DC", nummer: "64458 / 67105" },
      { naam: "Vrijwilliger (lectuur)", nummer: "64436" },
      { naam: "Wachtruimte bij D0-122", nummer: "72115" },
      { naam: "Allergie (poli DC)", nummer: "62678" },
      { naam: "Anaesthesie (poli DC)", nummer: "t.66890" },
      { naam: "CAP/CHI (poli DC)", nummer: "t.63990+68813+" },
      { naam: "CHP (poli DC)", nummer: "t.62297+68812+" },
      { naam: "Dermatologie (poli DC)", nummer: "68989" },
      { naam: "ENVO (poli DC)", nummer: "64297" },
      { naam: "GYN/verlos (poli DC)", nummer: "t.63400+" },
      { naam: "Hart/Vaat (poli DC)", nummer: "63794" },
      { naam: "HEMA-onco (poli DC)", nummer: "62096" },
      { naam: "Interne (poli DC)", nummer: "64333" },
      { naam: "KIN (poli DC)", nummer: "62987" },
      { naam: "KNO (poli DC)", nummer: "t.62478+" },
      { naam: "MZK (poli DC)", nummer: "t.62300+" },
      { naam: "NEC/NEU (poli DC)", nummer: "t.62500+" },
      { naam: "OOG (poli DC)", nummer: "t.63484+64183+63100" },
      { naam: "ORT (poli DC)", nummer: "t.62294+" },
      { naam: "PORT-A-CATH (poli DC)", nummer: "67497+62987" },
      { naam: "Prenatale (poli DC)", nummer: "72034" },
      { naam: "TRAU (poli DC)", nummer: "t.62297+" },
      { naam: "URO (poli DC)", nummer: "t.64199+66741" },
    ],
  },
  {
    titel: "AMC — Endoscopie",
    kleur: "#63E6E2",
    items: [
      { naam: "Endoscopie balie", nummer: "24302 / t.64302" },
      { naam: "Endoscopie uitslaapkamer", nummer: "62506" },
    ],
  },
  {
    titel: "KNO / Hoofd-halschirurgie",
    kleur: "#BF5AF2",
    items: [
      { naam: "Consulent KNO Kliniek VUmc", nummer: "61035" },
      { naam: "Dienstdoende AIOS KNO SEH (overdag) VUmc", nummer: "61364" },
      { naam: "Supervisor/huisartsensein (KNO-arts) VUmc", nummer: "61508" },
      { naam: "Consulent KNO Kliniek AMC", nummer: "(020-73) 29093" },
      { naam: "Spoedsein AIOS AMC", nummer: "(020) 73 29300" },
      { naam: "Poli KNO VUmc — Balie", nummer: "40935 — Receptie S, 2e etage" },
      { naam: "Poli KNO VUmc — Tussenbalie doktersassistentes", nummer: "40994" },
      { naam: "Poli KNO VUmc — Afsprakenlijn patiënten", nummer: "41140" },
      { naam: "Poli KNO VUmc — Verpleegkundige post", nummer: "36200" },
      { naam: "Poli KNO VUmc — e-mail", nummer: "Polikno.balie@vumc.nl" },
      { naam: "OK-planning KNO", nummer: "41409 of 46244 / okplanningkno-mka@amsterdamumc.nl" },
      { naam: "Secretaresse Afdelingshoofd KNO", nummer: "43690 — ZH 1D 116" },
      { naam: "Secretariaat KNO algemeen", nummer: "43686 / 43687 / if 43689 — kno@amsterdamumc.nl" },
      { naam: "Secretariaat Audiologie", nummer: "40969 / audiologie@amsterdamumc.nl" },
      { naam: "Audioloog van dienst VUmc", nummer: "61692" },
      { naam: "Audioloog van dienst AMC", nummer: "(020-73) 29844" },
      { naam: "Audioloog CI-controle op OK (VUmc)", nummer: "64432" },
      { naam: "VKNO — receptie 1C", nummer: "42110" },
      { naam: "Zaalarts 1C", nummer: "61144" },
      { naam: "Ziekenhuisarts KNO (1C)", nummer: "61160" },
      { naam: "Klinische logopedie", nummer: "64988 of 64230" },
    ],
  },
  {
    titel: "VUmc — Intensive Care, poli & pijn",
    kleur: "#0A84FF",
    items: [
      { naam: "Locatiegebonden tracer IC7B", nummer: "61957" },
      { naam: "Locatiegebonden tracer MC", nummer: "61276" },
      { naam: "Opnames, consulten etc.", nummer: "61275" },
      { naam: "Balie POS/pijn", nummer: "43219" },
      { naam: "Admi POS/pijn", nummer: "40290 / 49865" },
      { naam: "POS / ANIOS POS", nummer: "06-64367" },
      { naam: "Kamer POS-vpk", nummer: "31851" },
      { naam: "POS/pijn-vpk", nummer: "36164" },
      { naam: "DA-pijnpolikamer", nummer: "43392" },
      { naam: "IPT-kamer", nummer: "46760" },
      { naam: "Echokamer (pijnpoli)", nummer: "46762" },
      { naam: "Werk-/uitrustkamer", nummer: "40252" },
      { naam: "Qutenza-kamer", nummer: "43294" },
      { naam: "Pijnsupervisor", nummer: "36528" },
      { naam: "Acute Pijn Service", nummer: "61042" },
      { naam: "Palliatieve zorg", nummer: "64676" },
      { naam: "DA-telefoon: hulp waar nodig", nummer: "35647" },
      { naam: "Recovery 2 (ma-vrij 9.30–17.00u)", nummer: "*98 6887" },
      { naam: "Recovery 6 (24/7)", nummer: "*98 6889" },
      { naam: "Unitleider/praktijkopl.", nummer: "64336 / 61787" },
      { naam: "PACU Coördinator VUmc", nummer: "*98 6029" },
    ],
  },
  {
    titel: "VUmc — Operatiekamers",
    kleur: "#FF9F0A",
    items: [
      { naam: "OK 1 (6A)", nummer: "44548 / 45332" },
      { naam: "OK 2 (6A)", nummer: "44544 / 47087" },
      { naam: "OK 3 (6A)", nummer: "44543 / 47084" },
      { naam: "OK 4 (6A)", nummer: "44542 / 47081" },
      { naam: "OK 5 (6A)", nummer: "47095 / 47080" },
      { naam: "OK 6 (6A)", nummer: "44546 / 47093" },
      { naam: "OK 7 (6D)", nummer: "60001 / 02 / 03" },
      { naam: "OK 8 (6D)", nummer: "60004 / 05 / 06" },
      { naam: "OK 9 (6D)", nummer: "60009 / 10 / 11" },
      { naam: "OK 10 (6D)", nummer: "60012 / 13 / 14" },
      { naam: "OK 11 (6D)", nummer: "45458 / 43736" },
      { naam: "OK 12 (6D)", nummer: "43737 / 43371" },
      { naam: "OK 13 (6D)", nummer: "43738 / 45151" },
      { naam: "OK 14 (6D)", nummer: "45361 / 43739" },
      { naam: "OK 15 (6D)", nummer: "45148 / 43740" },
      { naam: "OK 16 (6D)", nummer: "45147 / 43741" },
      { naam: "OK 20 (6D)", nummer: "35223 / 35232" },
      { naam: "OK 21 (6D)", nummer: "35225 / 35233" },
      { naam: "OK 22 (6D)", nummer: "35236 / 35224" },
      { naam: "OK 1D koffiekamer", nummer: "45170" },
      { naam: "OK 2D Recovery", nummer: "45174" },
      { naam: "OK 6e koffiekamer", nummer: "47061" },
      { naam: "OK 6e receptie", nummer: "44545 / 44502" },
      { naam: "OK 6e patiënt bestellen", nummer: "44518" },
      { naam: "OK 6e uitslaapkamer", nummer: "43940 / 43941 / 43942" },
      { naam: "OK 6e secretariaat", nummer: "42156" },
      { naam: "Dagcoördinator", nummer: "*98 6050 / *98 6060" },
    ],
  },
  {
    titel: "VUmc — Belangrijke nummers",
    kleur: "#FF453A",
    items: [
      { naam: "Reanimatie", nummer: "44000" },
      { naam: "Meldkamer", nummer: "44661 / 44330" },
      { naam: "Achterwacht IC6 Noord", nummer: "656813211" },
      { naam: "Angio", nummer: "42846 / 42845" },
      { naam: "Angio laborant", nummer: "*98 7236 / 43530" },
      { naam: "Apotheek", nummer: "*98 6011 / 42901 / 42656 / 42577" },
      { naam: "A.Kamer (6F003/005)", nummer: "34058 / 34059 / 34060" },
      { naam: "Ass.Kamer (PC 6F013)", nummer: "42661 / 42910" },
      { naam: "Bloedbank", nummer: "*98 6073 / 42622" },
      { naam: "Cat.kamer 5e", nummer: "42451" },
      { naam: "CCU", nummer: "43955" },
      { naam: "Colloquium (6D107)", nummer: "46264" },
      { naam: "Crashcar bijvullen", nummer: "*98 6392" },
      { naam: "CT scan", nummer: "*98 7399 / 42872 / 42873" },
      { naam: "Eerste Hulp (C-dienst)", nummer: "*98 7477" },
      { naam: "Faxnr: afd. Anesthesiologie", nummer: "44385" },
      { naam: "Hartbewaking", nummer: "43280" },
      { naam: "Heelkunde, receptie G Balie", nummer: "40206" },
      { naam: "Heli dek / helikamer", nummer: "43815 / 43814 · fax 43813" },
      { naam: "Hemostaselab", nummer: "42621 / 45625" },
      { naam: "IC 7B", nummer: "*98 6947 (stip) / 43300 / 43301" },
      { naam: "IC 7C", nummer: "*98 6642 (stip) / 47613 / 47621" },
      { naam: "Kledingruimte / sluis", nummer: "43839" },
      { naam: "Kledinguitgifte", nummer: "44628" },
      { naam: "Klinische Chemie (Labbuizen)", nummer: "43875" },
      { naam: "Medische Bibliotheek", nummer: "41237" },
      { naam: "MRI (VUmc)", nummer: "40695 / 40386" },
      { naam: "Neuro consulentensein", nummer: "06-25771804" },
      { naam: "Palliatieve zorg (EPZ)", nummer: "64676" },
      { naam: "Premedicatie OK2/OK6", nummer: "43772 / 44504" },
      { naam: "SIM lab - 1D115", nummer: "44582 / 40918" },
      { naam: "Transportdienst", nummer: "*98 6320 / 43145" },
      { naam: "Huisartsen", nummer: "21100" },
    ],
  },
];

const ANESTHESIOLOGEN_TRACERS = [
  { naam: "Albers, Sophie", nummer: "AMC 20052" },
  { naam: "Albersen, Juliette", nummer: "VUmc 54546" },
  { naam: "Alberts, Tim", nummer: "AMC 27339" },
  { naam: "Alvarez-Jiménez, Ricardo", nummer: "AMC 20088 / VUmc 54543" },
  { naam: "Avis, Hans", nummer: "AMC 29254 / VUmc 51405" },
  { naam: "Baerdemaker de, Hannah-Aiman", nummer: "AMC 27375" },
  { naam: "Bauer, Wolfgang", nummer: "AMC 29709" },
  { naam: "Baumann, Holger", nummer: "AMC 20359" },
  { naam: "Berg van den, Bas", nummer: "AMC 20095 / VUmc 54368" },
  { naam: "Berg vd, Tijs", nummer: "AMC 27428 / VUmc 36676" },
  { naam: "Bergmans, Sophie", nummer: "AMC 20051 / VUmc 36523" },
  { naam: "Boer, Rohan", nummer: "AMC 20372 / VUmc 36620" },
  { naam: "Bos, Anne", nummer: "AMC 29141 / VUmc 51629" },
  { naam: "Bos, Elke", nummer: "AMC 20338 / VUmc 36593" },
  { naam: "Bossers, Bas", nummer: "AMC 28328 / VUmc 51041" },
  { naam: "Brink ten, Suzanne", nummer: "AMC 20340" },
  { naam: "Brinkman, David", nummer: "AMC 29435 / VUmc 51401" },
  { naam: "Buis, Marlous", nummer: "AMC 22423 / VUmc 36472" },
  { naam: "Bulte, Carolien", nummer: "AMC 23136 / VUmc 54363" },
  { naam: "Clercq de, Nicolien", nummer: "VUmc 36590" },
  { naam: "Colenbrander, Renske", nummer: "VUmc 54379" },
  { naam: "Corsmit, Oskar", nummer: "AMC 29739" },
  { naam: "Cuilenborg van, Vincent", nummer: "AMC 24032 / VUmc 36587" },
  { naam: "Dehn van, Frederieke", nummer: "VUmc 54376" },
  { naam: "Dijkema, Wessel", nummer: "AMC 27471" },
  { naam: "Dijkhuis, Job", nummer: "AMC 28208" },
  { naam: "Doeleman, Lotte", nummer: "AMC 20706 / VUmc 54370" },
  { naam: "Duin van, Eef", nummer: "AMC 29253" },
  { naam: "Eberl, Susanne", nummer: "AMC 28359" },
  { naam: "Eickhoff, Caroline", nummer: "VUmc 54372" },
  { naam: "Erwteman, Micha", nummer: "VUmc 51400" },
  { naam: "Evers, Veronika", nummer: "AMC 20343" },
  { naam: "Garnier, Robert", nummer: "AMC 25934 / VUmc 51155" },
  { naam: "Gutteling, Jon", nummer: "AMC 22592 / VUmc 54603" },
  { naam: "Hannivoort, Rebekka", nummer: "AMC 28451" },
  { naam: "Haperen van, Maartje", nummer: "AMC 27181 / VUmc 36868" },
  { naam: "Haude, Oscar", nummer: "AMC 27427 / VUmc 36594" },
  { naam: "Heine, Yvonne", nummer: "AMC 20361" },
  { naam: "Helfferich, Douglas", nummer: "AMC 23048 / VUmc 51264" },
  { naam: "Hennink, Simon", nummer: "AMC 27364" },
  { naam: "Hermanns, Henning", nummer: "AMC 26195" },
  { naam: "Hiemstra, Bart", nummer: "AMC 20815 / VUmc 51621" },
  { naam: "Hoedemaker-Boon, Caroline", nummer: "AMC 20347 / VUmc 51214" },
  { naam: "Hollmann, Markus", nummer: "AMC 23932 / VUmc 54709" },
  { naam: "Huisman, Bregje", nummer: "VUmc 51638" },
  { naam: "Hulsman, Niels", nummer: "AMC 29872" },
  { naam: "Hulst, Bram", nummer: "AMC 25212 / VUmc 36589" },
  { naam: "Immink, Rogier", nummer: "AMC 27182" },
  { naam: "Janssen, Liedewij", nummer: "VUmc 54365" },
  { naam: "Jonker, Yori", nummer: "AMC 22000 / VUmc 54535" },
  { naam: "Kamminga, Suzanne", nummer: "AMC 27154 / VUmc 51229" },
  { naam: "Kerstens, Martijn", nummer: "AMC 29742 / VUmc 36626" },
  { naam: "Keunen, Kristin", nummer: "AMC 27376" },
  { naam: "Kirzner, Osne", nummer: "AMC 20042 / VUmc 54362" },
  { naam: "Kooij, Fabian", nummer: "AMC 26382 / VUmc 51619" },
  { naam: "Koopman, Erik", nummer: "AMC 29375 / VUmc 54371" },
  { naam: "Lai, Yen-Mie", nummer: "VUmc 54364" },
  { naam: "Laveaux, Margot", nummer: "VUmc 51632" },
  { naam: "Liebregts, Remko", nummer: "VUmc 54381" },
  { naam: "Lubbers, Wouter", nummer: "AMC 27141 / VUmc 51403" },
  { naam: "Mansvelder, Floor", nummer: "AMC 20353 / VUmc 36520" },
  { naam: "Marks-Vieveen, Jenny", nummer: "VUmc 51004" },
  { naam: "Mechelen van, Daan", nummer: "AMC 25024 / VUmc 54373" },
  { naam: "Meijer, Peter", nummer: "AMC 28541" },
  { naam: "Meinsma, Soe", nummer: "AMC 27636" },
  { naam: "Metske, Hennie", nummer: "AMC 28219" },
  { naam: "Mokken, Fleur", nummer: "AMC 23530" },
  { naam: "Mus, Eva", nummer: "VUmc 51633" },
  { naam: "Oud, Floris", nummer: "AMC 27142 / VUmc 36618" },
  { naam: "Oort van, Pouline", nummer: "AMC 20043 / VUmc 36772" },
  { naam: "Nguyen, Thao", nummer: "AMC 29377" },
  { naam: "Pasman, Edward", nummer: "AMC 24034 / VUmc 54547" },
  { naam: "Polderman, Jorinde", nummer: "AMC 27296" },
  { naam: "Preckel, Benedikt", nummer: "AMC 28330" },
  { naam: "Romijn, Hans", nummer: "VUmc 51631" },
  { naam: "Romijn, Marie-Louise", nummer: "AMC 25759" },
  { naam: "Roozeman, Jan Paul", nummer: "AMC 25750 / VUmc 36629" },
  { naam: "Rutten, Martin", nummer: "AMC 28657" },
  { naam: "Sarton, Elise", nummer: "AMC 35828 / VUmc 36865" },
  { naam: "Sanou, Björn", nummer: "AMC 27326" },
  { naam: "Schellekens, Niels", nummer: "AMC 27462" },
  { naam: "Schober, Patrick", nummer: "AMC 20705 / VUmc *98 6637" },
  { naam: "Schober-Dettwiler, Saskia", nummer: "VUmc 54277" },
  { naam: "Schuijt, Michiel", nummer: "AMC 20707 / VUmc 36471" },
  { naam: "Schuppen van, Hans", nummer: "AMC 27359" },
  { naam: "Schwarte, Lothar", nummer: "VUmc 51406" },
  { naam: "Scot, Marc", nummer: "AMC 29456" },
  { naam: "Siegers, Arjen", nummer: "AMC 28229" },
  { naam: "Sixma, Marije", nummer: "AMC 20369 / VUmc 51141" },
  { naam: "Sonnema, Anne Josephine", nummer: "AMC 28549" },
  { naam: "Sperna Weiland, Niek", nummer: "AMC 27340" },
  { naam: "Steegers, Monique", nummer: "VUmc 51639" },
  { naam: "Stevens, Markus", nummer: "AMC 29452 / VUmc 36601" },
  { naam: "Stijn van, Mireille", nummer: "AMC 29428" },
  { naam: "Stoecklein, Katrin", nummer: "VUmc 51622" },
  { naam: "Strypet, Magnus", nummer: "AMC 27488" },
  { naam: "Szadek, Karolina", nummer: "VUmc 54380" },
  { naam: "Terwindt, Lotte", nummer: "AMC 27379" },
  { naam: "Thöne-Passchier, Deirdre", nummer: "AMC 25034 / VUmc 51620" },
  { naam: "Top, Anke", nummer: "AMC 24262" },
  { naam: "Veelo, Denise", nummer: "AMC 27421 / VUmc 36866" },
  { naam: "Viersen, Victor", nummer: "AMC 27455" },
  { naam: "Völkers, Merel", nummer: "AMC 29429 / VUmc 36469" },
  { naam: "Veth, Timo", nummer: "AMC 20032 / VUmc 20032" },
  { naam: "Waart van, Xander", nummer: "AMC 20784 / VUmc 54378" },
  { naam: "Ward, Catherine", nummer: "AMC 20366" },
  { naam: "Wartenberg, Hans", nummer: "AMC 29588" },
  { naam: "Weenink, Robert", nummer: "AMC 24035" },
  { naam: "Werf van der, Huub", nummer: "AMC 20354" },
  { naam: "Wille, Frank", nummer: "AMC 27140" },
  { naam: "Winkler, Imme", nummer: "AMC 29370 / VUmc 51005" },
  { naam: "Witsen, Nienke", nummer: "VUmc 36530" },
  { naam: "Woerlee, Justin", nummer: "AMC 27431" },
  { naam: "Wojciechowicz, Kamil", nummer: "AMC 23731 / VUmc 51345" },
  { naam: "Wynandts, Paul", nummer: "AMC 28670" },
  { naam: "Zande van der, Tim", nummer: "AMC 20334 / VUmc 36680" },
  { naam: "Zeeman, Esther", nummer: "AMC 20368" },
  { naam: "Zuylen van, Mark", nummer: "AMC 20352" },
];

const ARTS_ASSISTENTEN_TRACERS = [
  { naam: "Abbenhuis, Jeroen", nummer: "AMC 23045 / VUmc 36682" },
  { naam: "Admiraal, Manouk", nummer: "AMC 20059 / VUmc 36624" },
  { naam: "Algera, Anna Geke", nummer: "AMC 21991 / VUmc 36521" },
  { naam: "Atmowihardjo, Leila", nummer: "AMC 27700 / VUmc 36474" },
  { naam: "Bartels, Miel", nummer: "AMC 20139" },
  { naam: "Dekker den, Bianca", nummer: "AMC 28483" },
  { naam: "Douglas, Natasha", nummer: "AMC 20050 / VUmc 31634" },
  { naam: "Dubois, Bente", nummer: "AMC 25743 / VUmc 36628" },
  { naam: "Dujardin, Romein", nummer: "AMC 20060 / VUmc 36625" },
  { naam: "Eijk van, Jeroen", nummer: "AMC 20370 / VUmc 54602" },
  { naam: "Emst van, Maaike", nummer: "AMC 22561 / VUmc 36486" },
  { naam: "Eveleens, Renate", nummer: "AMC 22930 / VUmc 51123" },
  { naam: "Evers, Josje", nummer: "AMC 20002 / VUmc 36617" },
  { naam: "Feenstra, Minke", nummer: "AMC 21592 / VUmc 36470" },
  { naam: "Goossen, Robin", nummer: "AMC 69451 / VUmc 36864" },
  { naam: "Haarsma, Rianne", nummer: "AMC 23032 / VUmc 36683" },
  { naam: "Harvey, Suzanne", nummer: "AMC 22580 / VUmc 36482" },
  { naam: "Heldeweg, Micah", nummer: "VUmc 54369" },
  { naam: "Hesselink, Lillian", nummer: "AMC 20339 / VUmc 51576" },
  { naam: "Hezel, van Maike", nummer: "AMC 25152" },
  { naam: "Hol, Liselotte", nummer: "AMC 21984 / VUmc 36526" },
  { naam: "Holtrust, Yara", nummer: "AMC 27694 / VUmc 36466" },
  { naam: "Huizen, van Elise", nummer: "AMC 25153" },
  { naam: "Janszen, Almay", nummer: "AMC 69453 / VUmc 36867" },
  { naam: "Jessurun, Estaban", nummer: "AMC 25034 / VUmc 36527" },
  { naam: "Jong de, Simone", nummer: "AMC 21149 / VUmc 36871" },
  { naam: "Jorna, Kaj", nummer: "AMC 20702 / VUmc 36870" },
  { naam: "Kampman, Jasper", nummer: "AMC 29473 / VUmc 36614" },
  { naam: "Kassel van, Merel", nummer: "AMC 25744 / VUmc 54710" },
  { naam: "Kastelijns, Lotte", nummer: "AMC 22559 / VUmc 36487" },
  { naam: "Kazei, Lisa", nummer: "AMC 20033 / VUmc 36580" },
  { naam: "Kistemaker, Kay", nummer: "AMC 23817 / VUmc 36584" },
  { naam: "Klingenberg, Janice", nummer: "AMC 21533 / VUmc 36872" },
  { naam: "Klompmaker, Peter", nummer: "AMC 21537" },
  { naam: "Kok, Esther", nummer: "AMC 21988 / VUmc 36582" },
  { naam: "Koning, Gabrielle", nummer: "AMC 29140 / VUmc 51624" },
  { naam: "Kool, Boudewijn", nummer: "AMC 20062 / VUmc 36616" },
  { naam: "Knaven, Olga", nummer: "AMC 20034 / VUmc 36581" },
  { naam: "Laan van der, Kimberly", nummer: "VUmc 54366" },
  { naam: "Lilien, Thijs", nummer: "AMC 69450 / VUmc 51153" },
  { naam: "Lockyer, Emma", nummer: "AMC 20364 / VUmc 54375" },
  { naam: "Ludden, Thomas", nummer: "AMC 21985 / VUmc 36524" },
  { naam: "Meijer, Clemens", nummer: "AMC 25156 / VUmc 36684" },
  { naam: "Nass, Stefan", nummer: "AMC 20063 / VUmc 36613" },
  { naam: "Opschoor, Krijna", nummer: "AMC 21989 / VUmc 36583" },
  { naam: "Os van, Wouter", nummer: "AMC 20349 / VUmc 54545" },
  { naam: "Peters, Elma", nummer: "AMC 21151 / VUmc 36869" },
  { naam: "Raasveld, Jorinde", nummer: "AMC 20351 / VUmc 36678" },
  { naam: "Rellum, Santino", nummer: "AMC 69449 / VUmc 54374" },
  { naam: "Roerhorst, Sophie", nummer: "AMC 21986 / VUmc 36525" },
  { naam: "Roetert, Harm", nummer: "AMC 69454 / VUmc 36467" },
  { naam: "Rozemeijer, Sander", nummer: "AMC 23651 / VUmc 61690" },
  { naam: "Ruijter de, Jamy", nummer: "AMC 20364 / VUmc 51628" },
  { naam: "Schuurmans, Jaap", nummer: "AMC 22560 / VUmc 36485" },
  { naam: "Siemons, Suzanne", nummer: "AMC 20045 / VUmc 54377" },
  { naam: "Sinnige, Jante", nummer: "AMC 21536" },
  { naam: "Sierkstra, Thomas", nummer: "AMC 22327 / VUmc 36473" },
  { naam: "Smulders, Pascal", nummer: "AMC 20360 / VUmc 36529" },
  { naam: "Swenker, Rob", nummer: "AMC 20362 / VUmc 36531" },
  { naam: "Thio, Maaike", nummer: "AMC 21531" },
  { naam: "Tjikhoeri, Anisha", nummer: "AMC 20061 / VUmc 36627" },
  { naam: "Ven van der, Ward", nummer: "AMC 25158 / VUmc 36599" },
  { naam: "Vries, de, Kristin", nummer: "AMC 22819 / VUmc 51131" },
  { naam: "Wonderen van, Stefan", nummer: "AMC 37763" },
  { naam: "Wijnberge, Marije", nummer: "AMC 28329 / VUmc 36619" },
  { naam: "Zanten van, Florianne", nummer: "AMC 22562 / VUmc 36484" },
];

PERSONEEL_GROEPEN.push(
  {
    titel: "Anesthesiologen (kort/tracer)",
    kleur: "#0A84FF",
    items: ANESTHESIOLOGEN_TRACERS,
  },
  {
    titel: "Arts-assistenten Anesthesiologie (kort/tracer)",
    kleur: "#0A84FF",
    items: ARTS_ASSISTENTEN_TRACERS,
  },
  {
    titel: "AMC — Verpleegafdelingen (letter-codes)",
    kleur: "#8E8E93",
    items: [
      { naam: "A01 — Hemodialyse kinderen/volwassenen", nummer: "62066 / 66077" },
      { naam: "A01 — Dagbehandeling Huid", nummer: "64438" },
      { naam: "B2 — Hartcatheterisatie", nummer: "63208" },
      { naam: "D0 — Dagcentrum", nummer: "64078 / 64488" },
      { naam: "F3 Noord — Hartbewaking/CCU", nummer: "62176 / 62177" },
      { naam: "F3 Zuid — Cardiologie Short Stay/AOA & consult", nummer: "22305 / 25800" },
      { naam: "F4 Noord — Cardiothoracale Chirurgie", nummer: "64433" },
      { naam: "F4 Zuid — Cardiologie Algemeen", nummer: "65777" },
      { naam: "F5 Zuid — DBU en Kort verblijf", nummer: "66506 / 64044" },
      { naam: "F5N — Vaatchirurgie & MKA", nummer: "68906" },
      { naam: "F6 Noord — Infectieziekten & MPU", nummer: "62062 / 62562" },
      { naam: "F6 Zuid — Nefro/Derma/Reuma", nummer: "66003" },
      { naam: "F7 Zuid — Nefr/Derm/Reum", nummer: "66003 / 64170" },
      { naam: "F8 Noord — Kindergen./Emma Sport", nummer: "65857 / 64392 / 64471" },
      { naam: "F8 Zuid — Kinder Dagbehandeling", nummer: "63167 / 62967 / 65857" },
      { naam: "G3 Zuid — Neonatologie", nummer: "63668 / 36376" },
      { naam: "G3 Zuid — Unit 3", nummer: "63668" },
      { naam: "G3 Zuid — Unit 4", nummer: "64171" },
      { naam: "G4 Noord — Cardio Polikliniek", nummer: "63794" },
      { naam: "G4 Zuid — Acute Opname Afdeling", nummer: "67804" },
      { naam: "G5 Noord — Ortho/Sportgen./Plast.", nummer: "63056" },
      { naam: "G5 Zuid — Traumatologie", nummer: "66002 / 66061" },
      { naam: "G6N — Gyn/Int.geneesk.", nummer: "63665" },
      { naam: "G6Z — Inw/Inf/MPU-S", nummer: "62062" },
      { naam: "G7Z — Bureau nazorg", nummer: "64072" },
      { naam: "G8 Noord — Emma acuut", nummer: "65858 / 64179" },
      { naam: "H1 Noord — Holding/Verkoever", nummer: "62546" },
      { naam: "H3 Zuid — Verlos/Zwangeren/Verloskunde", nummer: "63666 / 64466" },
      { naam: "H4 Zuid — Kraamafdeling", nummer: "63553 / 63656" },
      { naam: "H5 Noord — Clinical Trial Unit Interne Geneesk.", nummer: "—" },
      { naam: "H5 Zuid — Amstelring Transfer Verpleegafd.", nummer: "61199" },
      { naam: "H6 NZ — NEU/BCU/NEC", nummer: "64063 / 63861" },
      { naam: "H7 Zuid — Emma tuin", nummer: "63168 / 63368" },
      { naam: "H8 — Dagbehandeling Kinderen", nummer: "65857" },
      { naam: "H8 Noord — Hemodialyse volwassenen", nummer: "62125 / 65857" },
      { naam: "H8 Zuid — IC Kinderen", nummer: "65769 / 62854" },
      { naam: "PB01 — MPU Psy", nummer: "13843" },
      { naam: "PA0 — Dagbehandeling Psychiatrie", nummer: "13586" },
      { naam: "Q01 — Hemodyalyse volwassenen", nummer: "77249" },
      { naam: "Q2 — DBU Dagbeh. Unit", nummer: "66506" },
    ],
  },
  {
    titel: "OK-organisatie — planning, reanimatie, perfusie & urologie",
    kleur: "#FF9F0A",
    items: [
      { naam: "Balie OK (adm. planning)", nummer: "68373" },
      { naam: "Balie OK 2", nummer: "—" },
      { naam: "REAN-coördinator", nummer: "59624" },
      { naam: "REAN anaesthesieverpl.k.", nummer: "59577" },
      { naam: "Perfusiekantoor", nummer: "62611" },
      { naam: "Perfusie opslag", nummer: "77635" },
      { naam: "Perfusie schoonmaak", nummer: "77649" },
      { naam: "Perfusie opbouw", nummer: "77650" },
      { naam: "Perfusie sein (7.30–19.00u)", nummer: "57388" },
    ],
  },
  {
    titel: "OK-organisatie — diversen OK, kleedkamer & OK-seinen",
    kleur: "#40C8E0",
    items: [
      { naam: "Hago (afdelingshulp)", nummer: "67522 / 59230" },
      { naam: "HAL ingang OK D + E", nummer: "77629 / 59398" },
      { naam: "Koffiekamer (diversen OK)", nummer: "77556 / 68804" },
      { naam: "Noodsluis", nummer: "77557" },
      { naam: "Overdrachtruimte OK-ass E", nummer: "77624" },
      { naam: "Poloproject", nummer: "77604" },
      { naam: "Steris (CSD)", nummer: "64321 / 62910 / 29153" },
      { naam: "Vergaderkamer OK", nummer: "59141 / 77593 / 77594" },
      { naam: "Kleedkamer — Dames 2 (flex)", nummer: "77614" },
      { naam: "Kleedkamer — Dames 3", nummer: "77615" },
      { naam: "Kleedkamer — Heren 4", nummer: "77623" },
      { naam: "Kleedkamer — Heren 6 (bouwdeel E)", nummer: "77536" },
      { naam: "Kleedkamer — Dames 7 (bouwdeel E)", nummer: "77609" },
      { naam: "OK coördinator", nummer: "59662" },
      { naam: "Anesthesie coördinator", nummer: "59663" },
      { naam: "Regelsein anaesth.verpl.k.", nummer: "59571" },
      { naam: "Dagregelsein Acute OK", nummer: "59151" },
      { naam: "Dagregelsein OK-ass.", nummer: "59152" },
      { naam: "Boodschappensein OK-ass", nummer: "29228" },
      { naam: "Afd.hulp CHI+ANS", nummer: "59230 / 66724" },
    ],
  },
  {
    titel: "OK-organisatie — secretariaten",
    kleur: "#FF453A",
    items: [
      { naam: "Secretariaat ANS", nummer: "62533" },
      { naam: "Secretariaat CTC", nummer: "60219 / 63633" },
      { naam: "Secretariaat CHI pat.secr. G6", nummer: "72154" },
      { naam: "Secretariaat CHI (1)", nummer: "62977" },
      { naam: "Secretariaat CHI (2)", nummer: "62166" },
      { naam: "Secretariaat CHP", nummer: "65570" },
      { naam: "Secretariaat GYN", nummer: "62572" },
      { naam: "Secretariaat KCC", nummer: "63754" },
      { naam: "Secretariaat KCH", nummer: "62950" },
      { naam: "Secretariaat KNO", nummer: "62043" },
      { naam: "Secretariaat MZK", nummer: "63789" },
      { naam: "Secretariaat NEC", nummer: "67861 / 66054" },
      { naam: "Secretariaat OOG", nummer: "63542" },
      { naam: "Secretariaat ORT", nummer: "65907" },
      { naam: "Secretariaat TRAU", nummer: "62672" },
      { naam: "Secretariaat URO", nummer: "66019" },
      { naam: "Secretariaat VAAT", nummer: "66004 / 67832" },
    ],
  },
  {
    titel: "AMC — Poliklinieken (algemeen)",
    kleur: "#FFD60A",
    items: [
      { naam: "Anaesthesie (poli)", nummer: "61898" },
      { naam: "CAP/URO (poli)", nummer: "62714" },
      { naam: "CAR (poli)", nummer: "63794" },
      { naam: "CHI/VAA (poli)", nummer: "63111" },
      { naam: "CHP (poli)", nummer: "62297 / 62178" },
      { naam: "GYN/verlos (poli)", nummer: "72040+63400+ / 64182" },
      { naam: "KCH (poli)", nummer: "6800" },
      { naam: "KNO (poli)", nummer: "62888" },
      { naam: "Longziekten (poli)", nummer: "63104" },
      { naam: "MZK (poli)", nummer: "04441150 (beide loc.)" },
      { naam: "NEC/NEU (poli)", nummer: "62500 / 63490" },
      { naam: "OOG (poli)", nummer: "63100" },
      { naam: "ORT (poli)", nummer: "62294+ / 62551" },
      { naam: "RTH (poli)", nummer: "63433" },
      { naam: "TRAU (poli)", nummer: "62297+ / 62180" },
      { naam: "URO (poli)", nummer: "4441103 (VU)" },
      { naam: "Voortplantingsgeneesk. (poli)", nummer: "64287 / 64297" },
    ],
  },
  {
    titel: "OK-organisatie — planners",
    kleur: "#BF5AF2",
    items: [
      { naam: "Planner ANGIO", nummer: "58192" },
      { naam: "Planner CAP", nummer: "64617 / 64261" },
      { naam: "Planner CAR", nummer: "64251 / 64617" },
      { naam: "Planner CHI", nummer: "63179" },
      { naam: "Planner CHP", nummer: "62496" },
      { naam: "Planner CT", nummer: "72071 / 72074 / 58198" },
      { naam: "Planner GYN", nummer: "63454 / 59068" },
      { naam: "Planner GYN benigne", nummer: "20885" },
      { naam: "Planner KCC+hartcath", nummer: "62950" },
      { naam: "Planner KCH", nummer: "65693 / 64393 / 29177" },
      { naam: "Planner KGA", nummer: "63053" },
      { naam: "Planner KIN", nummer: "63050" },
      { naam: "Planner KNE", nummer: "62268" },
      { naam: "Planner KNO", nummer: "62642" },
      { naam: "Planner KPU", nummer: "62851" },
      { naam: "Planner MDLA/S", nummer: "63502" },
      { naam: "Planner MRI", nummer: "68801" },
      { naam: "Planner MKA", nummer: "67090" },
      { naam: "Planner NEC", nummer: "63542 / 73542" },
      { naam: "Planner OOG", nummer: "23552 / 020-4441170 / 62629" },
      { naam: "Planner ORT", nummer: "62956" },
      { naam: "Planner TRA/MKA", nummer: "68789" },
      { naam: "Planner URO", nummer: "66741" },
      { naam: "Planner VHC", nummer: "65865" },
      { naam: "Planner MRI 5", nummer: "62043" },
    ],
  },
  {
    titel: "AMC — Diversen buitengebied, lab & SEH",
    kleur: "#8E8E93",
    items: [
      { naam: "Apotheek (buitengebied)", nummer: "62211 / 29481" },
      { naam: "Audiologie (buitengebied)", nummer: "59844 / 63824" },
      { naam: "Beheerder Toren", nummer: "63149" },
      { naam: "BGD", nummer: "62083" },
      { naam: "Bloedbank (buitengebied)", nummer: "65885" },
      { naam: "BMH (buitengebied)", nummer: "28672" },
      { naam: "Brachytherapie balie", nummer: "62710 / 28672" },
      { naam: "Bureau Opname (buitengebied)", nummer: "63947" },
      { naam: "Clinical assistent", nummer: "61777" },
      { naam: "Dialyse (buitengebied)", nummer: "72468" },
      { naam: "EEG", nummer: "62508" },
      { naam: "Endoscopie (buitengebied)", nummer: "63600" },
      { naam: "Fotodienst", nummer: "64301" },
      { naam: "Gipskamer (buitengebied)", nummer: "62296 / 62295" },
      { naam: "HR/Personeelsinform.centrum", nummer: "62296+ / 62295" },
      { naam: "IC-bedden (buitengebied)", nummer: "65821" },
      { naam: "Inkoop", nummer: "29231" },
      { naam: "LCD OK pakken", nummer: "66333" },
      { naam: "Linnenkamer (buitengebied)", nummer: "62418" },
      { naam: "Meldkamer (buitengebied)", nummer: "63222" },
      { naam: "Nucleaire geneesk. (buitengebied)", nummer: "62700" },
      { naam: "OBC", nummer: "58424" },
      { naam: "Pacemakertechnicus", nummer: "63502+ / 64879" },
      { naam: "Patiëntenvervoer + ophalen bedden", nummer: "64547" },
      { naam: "Pijnpoli", nummer: "63300" },
      { naam: "Portier hoofding.", nummer: "62303" },
      { naam: "Portier poli", nummer: "64004" },
      { naam: "Postkamer", nummer: "62050" },
      { naam: "Pre-ass./Poli anaesthesiologie", nummer: "63388" },
      { naam: "RTH-balie", nummer: "63496" },
      { naam: "Scoop", nummer: "62510 / 64245" },
      { naam: "Telecom/ICT", nummer: "62910" },
      { naam: "Spoedcontact ICT", nummer: "020-4446057 / 63011" },
      { naam: "Tolkentelefoon", nummer: "088-2555222" },
      { naam: "Ziekenhuishygiëniste", nummer: "29199" },
      { naam: "Transfusielab", nummer: "62526" },
      { naam: "Cito-lab", nummer: "62525+ / 62626" },
      { naam: "LAKC", nummer: "62525" },
      { naam: "Micro/bacteriologie", nummer: "63026" },
      { naam: "PA balie", nummer: "63248" },
      { naam: "PA na 16.30u (via 9 dd ass)", nummer: "—" },
      { naam: "PA secretariaat", nummer: "62827" },
      { naam: "PA vriescoupe", nummer: "63248" },
      { naam: "SEH Shockroom", nummer: "60870" },
      { naam: "SEH Eerste hulp", nummer: "63232+ / 63333 / 63336 stip" },
      { naam: "SEH EHH", nummer: "65800" },
      { naam: "SEH Traumakamer 1", nummer: "66280" },
      { naam: "SEH Traumakamer 2", nummer: "60862" },
      { naam: "Storingen — Automatisering ICT balie", nummer: "63011 / 58588" },
      { naam: "Storingen — Web 2000", nummer: "58721" },
      { naam: "Storingen — ADMF techn.dienst", nummer: "66500" },
      { naam: "Storingen — Huisvesting Service", nummer: "67000" },
      { naam: "Storingen — Techn. dienst OK", nummer: "62811 / 58441" },
          ],
  },
);



// Medicatie voor kinderdoseringscalculator (dosering per kg)
// bron.status: ✅ bevestigd door officiële bron · 🟠 belangrijk aandachtspunt · 🟡 nog niet extern geverifieerd · 🔴 risico, prioriteit voor review
const KINDER_CALC_MEDS = [
  { med: "Propofol (inductie)", factor: 3, unit: "mg", range: "2–3,5 mg/kg", categorie: "Anesthetica",
    bron: { status: "✅", tekst: "AMC-overzicht (T.M.S. van Winden, 2016), Kinderformularium.nl en Farmacotherapeutisch Kompas" } },
  { med: "Propofol (onderhoud)", factor: 12, unit: "mg/uur", range: "9–15 mg/kg/uur (hoger bij <3 jr)", categorie: "Anesthetica", perUur: true,
    bron: { status: "✅", tekst: "AMC-overzicht (T.M.S. van Winden, 2016) + Kinderformularium.nl + Farmacotherapeutisch Kompas — was eerder 1 mg/kg/uur, gecorrigeerd" } },
  { med: "Sufentanyl (inductie)", factor: 0.3, unit: "µg", range: "0,2–0,5 µg/kg (max 1 bij hartchirurgie)", categorie: "Opioïden",
    bron: { status: "✅", tekst: "Farmacotherapeutisch Kompas" } },
  { med: "Sufentanyl (onderhoud, oplaad)", factor: 1, unit: "µg", range: "0,3–2 µg/kg oplaad + 0,1–1 µg/kg aanvullend (max 5 totaal bij hartchirurgie)", categorie: "Opioïden",
    bron: { status: "✅", tekst: "Farmacotherapeutisch Kompas" } },
  // pompConc: standaard ampulconcentratie 50 µg/ml (AMC-overzicht) — pas aan als de afdeling een andere verdunning gebruikt
  { med: "Remifentanil (infuus, start)", factor: 0.25, unit: "µg/min", range: "0,25 µg/kg/min, titreren elke 2-5 min (niet aanbevolen <1 jaar)", categorie: "Opioïden", pompConc: 50,
    bron: { status: "✅", tekst: "Kinderformularium.nl + Farmacotherapeutisch Kompas; pompstand gebaseerd op AMC-ampulconcentratie 50 µg/ml — verifieer lokale verdunning" } },
  { med: "Morfine", factor: 0.1, unit: "mg", range: "0,05–0,1 mg/kg (of 0,1–0,2 mg/kg, max 15 mg per gift)", categorie: "Opioïden",
    bron: { status: "✅", tekst: "Kinderformularium.nl: IV bolus 0,05-0,1 mg/kg of 0,1-0,2 mg/kg (max 15 mg), elke 4 uur te herhalen" } },
  { med: "Rocuronium (inductie)", factor: 0.6, unit: "mg", range: "0,6 mg/kg (tot 1,2 mg/kg bij RSI)", categorie: "Relaxantia",
    bron: { status: "✅", tekst: "Kinderformularium.nl + Farmacotherapeutisch Kompas + AMC-overzicht" } },
  { med: "Rocuronium (vervolgdosis)", factor: 0.15, unit: "mg", range: "0,15 mg/kg (0,075–0,1 mg/kg bij >1 uur inhalatieanesthesie)", categorie: "Relaxantia",
    bron: { status: "✅", tekst: "Farmacotherapeutisch Kompas" } },
  { med: "S-Ketamine", factor: 0.75, unit: "mg", range: "0,5–1 mg/kg", categorie: "Anesthetica",
    bron: { status: "✅", tekst: "Kinderformularium.nl + Farmacotherapeutisch Kompas" } },
  { med: "Paracetamol", factor: 15, unit: "mg", range: "15 mg/kg (>10 kg) / 7,5 mg/kg (≤10 kg)", categorie: "Analgetica",
    bron: { status: "✅", tekst: "Kinderformularium.nl + Farmacotherapeutisch Kompas — gewichtsdrempel nu verwerkt in de berekening" } },
  { med: "Metamizol", factor: 15, unit: "mg", range: "15 mg/kg", categorie: "Analgetica",
    bron: { status: "✅", tekst: "Kinderformularium.nl (8–16 mg/kg)" } },
  { med: "Cefazoline", factor: 30, unit: "mg", range: "30 mg/kg (verifieer lokaal protocol)", categorie: "Antibiotica",
    bron: { status: "🟠", tekst: "SWAB-richtlijn geeft tegenstrijdige cijfers in verschillende bronvermeldingen (10 mg/kg max 1g vs. 30 mg/kg max 2g) — kon niet worden geadjudiceerd. Juiste bron is de 'Blauwdruk pediatrische antimicrobiële therapie' (niet toegankelijk vanuit deze omgeving) — navragen bij ziekenhuisapotheek/microbioloog" } },
  { med: "Cefuroxim", factor: 30, unit: "mg", range: "30 mg/kg (max 2 g) — vanaf 1 maand; ≥40 kg vaste dosis 1,5 g", categorie: "Antibiotica",
    bron: { status: "✅", tekst: "SWAB-richtlijn peri-operatieve profylaxe: 30 mg/kg (max 2 g) vanaf 1 maand — onafhankelijk bevestigd door zowel het Nederlandse als het Duitse Kinderformularium, geen tegenstrijdigheid gevonden (in tegenstelling tot Cefazoline hierboven)" } },
  { med: "Metronidazol", factor: 15, unit: "mg", range: "15 mg/kg (verifieer lokaal protocol)", categorie: "Antibiotica",
    bron: { status: "🟡", tekst: "Perioperatieve profylaxedosis bij kinderen niet gevonden los van de niet-toegankelijke 'Blauwdruk pediatrische antimicrobiële therapie' — gevonden KF-cijfer (50 mg/kg/dag) betrof een andere indicatie" } },
  { med: "Amoxicilline", factor: 50, unit: "mg", range: "50 mg/kg (verifieer lokaal protocol)", categorie: "Antibiotica",
    bron: { status: "🔴", tekst: "Kinderformularium geeft 50-90 mg/kg/DAG verdeeld over 3 doses voor behandeling — als eenmalige profylaxedosis mogelijk te hoog. Officiële profylaxedosis staat vermoedelijk in de niet-toegankelijke 'Blauwdruk pediatrische antimicrobiële therapie' — verifieer bij ziekenhuisapotheek" } },
  { med: "Dexamethason", factor: 0.15, unit: "mg", range: "0,15 mg/kg", categorie: "Corticosteroïden",
    bron: { status: "🟡", tekst: "PONV-indicatie bevestigd via Kinderformularium/richtlijnendatabase.nl, maar geen directe KF-quote gevonden voor het exacte 0,15 mg/kg-cijfer (wel een vaste 8-10 mg volwassendosis)" } },
  { med: "Adrenaline (nood)", factor: 0.01, unit: "mg", range: "0,01 mg/kg", categorie: "Noodmedicatie",
    bron: { status: "✅", tekst: "Kinderformularium.nl + Reanimatieraad (10 µg/kg)" } },
  { med: "Atropine (nood)", factor: 0.02, unit: "mg", range: "0,02 mg/kg (min 0,1 max 0,5)", categorie: "Noodmedicatie",
    bron: { status: "✅", tekst: "Kinderformularium.nl (0,01-0,02 mg/kg)" } },
  { med: "Efedrine", factor: 0.1, unit: "mg", range: "0,1–0,2 mg/kg (off-label, niet geregistreerd <12 jaar)", categorie: "Noodmedicatie",
    bron: { status: "🟠", tekst: "Cijfer bevestigd in de literatuur (0,1-0,2 mg/kg per injectie); niet geregistreerd voor kinderen <12 jaar, dus off-labelgebruik — nu vermeld in de app" } },
  { med: "Fenylefrine", factor: 1, unit: "µg", range: "1–5 µg/kg (off-label, geen officiële pediatrische dosis)", categorie: "Noodmedicatie",
    bron: { status: "🟡", tekst: "Bevestigd: fenylefrine is niet geregistreerd voor kinderen en er bestaat geen officiële pediatrische mg/kg-dosis in KF/FK — huidig cijfer is een praktijkextrapolatie, off-label, verifieer bij anesthesioloog" } },
  { med: "Ondansetron", factor: 0.1, unit: "mg", range: "0,1 mg/kg (max 4 mg)", categorie: "Antiemetica",
    bron: { status: "✅", tekst: "Kinderformularium.nl + Farmacotherapeutisch Kompas (PONV-indicatie)" } },
  { med: "Droperidol", factor: 0.015, unit: "mg", range: "0,01–0,02 mg/kg (bereik 0,01-0,05 mg/kg, max 1,25 mg)", categorie: "Antiemetica",
    bron: { status: "✅", tekst: "Meerdere onafhankelijke bronnen bevestigen 10-50 µg/kg (max 1,25 mg) voor 2-18 jr, niet aanbevolen <2 jr — huidige waarde valt hierbinnen" } },
  { med: "Tranexaminezuur (laaddosis)", factor: 15, unit: "mg", range: "10–15 mg/kg (max 1 g)", categorie: "Antifibrinolytica",
    bron: { status: "✅", tekst: "Richtlijnendatabase.nl" } },
  { med: "Tranexaminezuur (onderhoud)", factor: 4, unit: "mg/uur", range: "3–5 mg/kg/uur na de laaddosis", categorie: "Antifibrinolytica", perUur: true,
    bron: { status: "✅", tekst: "Richtlijnendatabase.nl" } },
  { med: "Erytrocytenconcentraat (anemie, geen bloedverlies)", factor: 15, unit: "ml", range: "15 ml/kg", categorie: "Transfusie",
    bron: { status: "✅", tekst: "AUMC-protocol Perioperatief vochtbeleid kinderen (JAW Polderman, v4.1, 2025). Bij ongoing/massaal bloedverlies: transfunderen volgens 1:1:1-ratio massaal transfusieprotocol i.p.v. dit getal — zie Spoedbundel Kind." } },
  { med: "Sugammadex (T2-reversal)", factor: 2, unit: "mg", range: "2 mg/kg (standaard reversal, ≥2 jaar)", categorie: "Antagonisten",
    bron: { status: "✅", tekst: "Farmacotherapeutisch Kompas + AMC-overzicht" } },
  { med: "Sugammadex (noodgeval)", factor: 16, unit: "mg", range: "16 mg/kg (acute reversal zonder T2-respons)", categorie: "Antagonisten",
    bron: { status: "✅", tekst: "Kinderformularium.nl + AMC-overzicht" } },
  { med: "Glycopyrronium", factor: 0.01, unit: "mg", range: "0,004–0,01 mg/kg (4–10 µg/kg)", categorie: "Anticholinergica",
    bron: { status: "✅", tekst: "AMC-overzicht (T.M.S. van Winden, 2016) + Kinderformularium.nl" } },
  // AUMC-protocol: NIET standaard geven bij ingrepen <2 uur zonder risicofactoren voor hypoglykemie
  { med: "Glucose 10% — neonaat (tot 28 dagen)", factor: 0.9, unit: "ml/uur", range: "1–2 mg/kg/min = 0,6–1,2 ml/kg/uur", categorie: "Vocht/glucose", perUur: true,
    bron: { status: "✅", tekst: "AUMC-protocol Perioperatief vochtbeleid kinderen (JAW Polderman, v4.1, 2025)" } },
  { med: "Glucose 10% — kind <1jr of risicofactoren", factor: 0.6, unit: "ml/uur", range: "1 mg/kg/min = 0,6 ml/kg/uur — alleen bij <1 jr, risicofactoren hypoglykemie, ingreep >2u, of metabole stoornis; NIET standaard bij korte ingrepen", categorie: "Vocht/glucose", perUur: true,
    bron: { status: "✅", tekst: "AUMC-protocol Perioperatief vochtbeleid kinderen (JAW Polderman, v4.1, 2025)" } },
  { med: "Glucose 10% — bolus bij hypoglykemie", factor: 2, unit: "ml", range: "2 ml/kg bij glucose <3,5 mmol/L (neonaten <2,6 mmol/L) + onderhoud ophogen", categorie: "Vocht/glucose",
    bron: { status: "✅", tekst: "AUMC-protocol Perioperatief vochtbeleid kinderen (JAW Polderman, v4.1, 2025)" } },
  { med: "Onderhoudsvocht — eerste uur (<1 jaar)", factor: 10, unit: "ml/uur", range: "10 ml/kg/uur, alleen het eerste uur bij kinderen <1 jaar (compensatie nuchter zijn)", categorie: "Vocht/glucose", perUur: true,
    bron: { status: "✅", tekst: "AUMC-protocol Perioperatief vochtbeleid kinderen (JAW Polderman, v4.1, 2025)" } },
  { med: "Onderhoudsvocht (4-2-1 regel, na 1e uur)", factor: 1, unit: "ml/uur", range: "4 ml/kg/u (eerste 10kg) + 2 ml/kg/u (tweede 10kg) + 1 ml/kg/u (>20kg)", categorie: "Vocht/glucose", is421: true,
    bron: { status: "✅", tekst: "Holliday-Segar-regel — AUMC-protocol Perioperatief vochtbeleid kinderen (JAW Polderman, v4.1, 2025)" } },
];

const ANTIEMETICA = [
  { naam: "Ondansetron", dosis: "4 mg", obv75: "4 mg, 2 ml", duur: "4–8 uur", conc: "2 mg/ml", inhoud: "2 ml", opmerking: "Max 8 mg per gift. Eerste keuze PONV-profylaxe" },
  { naam: "Dexamethason", dosis: "4–8 mg", obv75: "4–8 mg, 1–2 ml", duur: "24 uur", conc: "4 mg/ml", inhoud: "1 ml / 5 ml", opmerking: "Combineer met ondansetron bij hoog PONV-risico. Max 12 mg/dag" },
  { naam: "Droperidol", dosis: "0,625–1,25 mg", obv75: "0,625–1,25 mg", duur: "4–6 uur", conc: "2,5 mg/ml", inhoud: "1 ml", opmerking: "Cave QTc-verlenging. Alternatief bij ondansetron-falen" },
];

const KINDER_ANTIEMETICA = [
  { naam: "Ondansetron", dosis: "0,1 mg/kg IV", max: "max 4 mg", conc: "2 mg/ml", opmerking: "Eerste keuze PONV-profylaxe" },
  { naam: "Dexamethason", dosis: "0,15 mg/kg IV", max: "max 8 mg", conc: "4 mg/ml", opmerking: "Combineer met ondansetron bij hoog PONV-risico" },
  { naam: "Droperidol", dosis: "0,02 mg/kg IV", max: "max 1,25 mg", conc: "2,5 mg/ml", opmerking: "Cave QTc-verlenging. Alternatief bij ondansetron-falen" },
];

// Beademingskapje (masker) maten op basis van leeftijd
const MASKER_MATEN = [
  { leeftijdMin: 0, leeftijdMax: 0, label: "Prematuur/Neonaat", maat: "0", kleur: "#FF453A" },
  { leeftijdMin: 0, leeftijdMax: 0.5, label: "0–6 maanden", maat: "1", kleur: "#FF9F0A" },
  { leeftijdMin: 0.5, leeftijdMax: 3, label: "6 mnd – 3 jaar", maat: "2", kleur: "#FFD60A" },
  { leeftijdMin: 3, leeftijdMax: 6, label: "3–6 jaar", maat: "2–3", kleur: "#30D158" },
  { leeftijdMin: 6, leeftijdMax: 12, label: "6–12 jaar", maat: "3–4", kleur: "#0A84FF" },
  { leeftijdMin: 12, leeftijdMax: 99, label: ">12 jaar", maat: "4–5", kleur: "#BF5AF2" },
];

// LMA (Laryngeal Mask Airway) maten op basis van leeftijd/gewicht
const LMA_MATEN = [
  { leeftijdMin: 0, leeftijdMax: 0.5, label: "< 5 kg / neonaat", maat: "1", maxVol: "4 ml", kleur: "#FF453A" },
  { leeftijdMin: 0.5, leeftijdMax: 1, label: "5–10 kg / infant", maat: "1½", maxVol: "7 ml", kleur: "#FF9F0A" },
  { leeftijdMin: 1, leeftijdMax: 5, label: "10–20 kg / 1–5 jaar", maat: "2", maxVol: "10 ml", kleur: "#FFD60A" },
  { leeftijdMin: 5, leeftijdMax: 8, label: "20–30 kg / 5–8 jaar", maat: "2½", maxVol: "14 ml", kleur: "#30D158" },
  { leeftijdMin: 8, leeftijdMax: 12, label: "30–50 kg / 8–12 jaar", maat: "3", maxVol: "20 ml", kleur: "#0A84FF" },
  { leeftijdMin: 12, leeftijdMax: 99, label: "50–70 kg / volwassene", maat: "4", maxVol: "30 ml", kleur: "#BF5AF2" },
];

// Dermatomen — landmarks voor klinische oriëntatie
const DERMATOOM_LANDMARKS = [
  { niveau: "C2–C3", landmark: "Achterhoofd, nek", kleur: "#FF453A" },
  { niveau: "C3–C4", landmark: "Schouder (supraclaviculair)", kleur: "#FF453A" },
  { niveau: "C5–C6", landmark: "Laterale bovenarm, duim", kleur: "#FF9F0A" },
  { niveau: "C7", landmark: "Middelvinger", kleur: "#FF9F0A" },
  { niveau: "C8–T1", landmark: "Pink, mediale onderarm", kleur: "#FF9F0A" },
  { niveau: "T2", landmark: "Axilla (oksel)", kleur: "#FFD60A" },
  { niveau: "T4", landmark: "Tepellijn", kleur: "#FFD60A" },
  { niveau: "T6", landmark: "Processus xiphoideus", kleur: "#FFD60A" },
  { niveau: "T10", landmark: "Navel", kleur: "#30D158" },
  { niveau: "T12", landmark: "Lies (inguinaal)", kleur: "#30D158" },
  { niveau: "L1", landmark: "Bovenbeen (iliohypogastrisch)", kleur: "#0A84FF" },
  { niveau: "L2–L3", landmark: "Voorzijde bovenbeen", kleur: "#0A84FF" },
  { niveau: "L3–L4", landmark: "Knie, mediale onderbeen", kleur: "#0A84FF" },
  { niveau: "L4–L5", landmark: "Laterale onderbeen, voetrug", kleur: "#BF5AF2" },
  { niveau: "L5–S1", landmark: "Laterale voet, kleine teen", kleur: "#BF5AF2" },
  { niveau: "S1–S2", landmark: "Voetzool, achterzijde been", kleur: "#BF5AF2" },
  { niveau: "S2–S4", landmark: "Perineaal (zadelvorm)", kleur: "#BF5AF2" },
];

// Veelgebruikte zenuwblokkades met dermatoomgebied
const ZENUWBLOKKADES = [
  {
    categorie: "Bovenste extremiteit",
    kleur: "#FF9F0A",
    blokkades: [
      { naam: "Interscalenair blok", zenuw: "Plexus brachialis (C5–C7)", gebied: "Schouder, proximale bovenarm", dermatomen: "C5–C7", tip: "Let op n. phrenicus uitval (diafragma)" },
      { naam: "Supraclaviculair blok", zenuw: "Plexus brachialis", gebied: "Gehele arm vanaf schouder", dermatomen: "C5–T1", tip: "Risico pneumothorax" },
      { naam: "Infraclaviculair blok", zenuw: "Plexus brachialis", gebied: "Elleboog, onderarm, hand", dermatomen: "C5–T1", tip: "Goed voor katheterplaatsing" },
      { naam: "Axillair blok", zenuw: "N. medianus, ulnaris, radialis, musculocutaneus", gebied: "Onderarm en hand", dermatomen: "C6–T1", tip: "Veilig, laag complicatierisico" },
    ],
  },
  {
    categorie: "Thorax & abdomen",
    kleur: "#FFD60A",
    blokkades: [
      { naam: "Thoracale epiduraal", zenuw: "Spinale zenuwen", gebied: "Thorax en bovenbuik", dermatomen: "T2–T12 (afhankelijk van niveau)", tip: "Segmentaal, bilateraal" },
      { naam: "Paravertebraal blok", zenuw: "Spinale zenuw (unilateraal)", gebied: "Eénzijdig thoraxwand", dermatomen: "Per niveau T1–L2", tip: "Alternatief voor epiduraal" },
      { naam: "TAP-blok (transversus abdominis plane)", zenuw: "Intercostale zenuwen T6–L1", gebied: "Buikwand", dermatomen: "T6–L1", tip: "Alleen somatisch, niet visceraal" },
      { naam: "Rectusschede blok", zenuw: "Intercostale zenuwen", gebied: "Mediaan buikwand", dermatomen: "T9–T11", tip: "Rond navel, mediane laparotomie" },
    ],
  },
  {
    categorie: "Onderste extremiteit",
    kleur: "#0A84FF",
    blokkades: [
      { naam: "Femoralis blok", zenuw: "N. femoralis (L2–L4)", gebied: "Voorzijde bovenbeen, knie", dermatomen: "L2–L4", tip: "Goed voor knieoperaties" },
      { naam: "Adductorkanaal blok", zenuw: "N. saphenus", gebied: "Mediale onderbeen, knie", dermatomen: "L3–L4", tip: "Spaart quadriceps (mobilisatie)" },
      { naam: "Ischiadicus blok (popliteaal)", zenuw: "N. ischiadicus", gebied: "Onderbeen, voet (behalve mediaal)", dermatomen: "L4–S3", tip: "Combineer met femoralis voor knie" },
      { naam: "Enkel blok", zenuw: "Tibialis, suralis, peroneus", gebied: "Voet", dermatomen: "L4–S2", tip: "5 zenuwen, voorvoetoperaties" },
    ],
  },
  {
    categorie: "Neuraxiaal",
    kleur: "#BF5AF2",
    blokkades: [
      { naam: "Spinaal (sub-arachnoïdaal)", zenuw: "Cauda equina / spinale zenuwen", gebied: "Afhankelijk van niveau en bariteit", dermatomen: "Variabel, vaak T6–S5", tip: "Snelle onset, beperkte duur" },
      { naam: "Lumbale epiduraal", zenuw: "Spinale zenuwen", gebied: "Onderbuik, bekken, benen", dermatomen: "T10–S5", tip: "Titreerbaar, katheter mogelijk" },
      { naam: "Caudaal blok", zenuw: "Sacrale zenuwen", gebied: "Perineaal, benen", dermatomen: "S2–S5 (kan hoger)", tip: "Veel gebruikt bij kinderen" },
    ],
  },
];

// Vaatstelsel — belangrijkste vaten als referentie
const VAATSTELSEL = [
  {
    categorie: "Arterieel — hoofd/hals",
    kleur: "#FF453A",
    vaten: [
      { naam: "A. carotis communis", vertakking: "→ A. carotis interna + externa", klinisch: "Pulsatie palpabel in hals" },
      { naam: "A. vertebralis", vertakking: "→ A. basilaris", klinisch: "Posterieure cerebrale circulatie" },
    ],
  },
  {
    categorie: "Arterieel — bovenste extremiteit",
    kleur: "#FF453A",
    vaten: [
      { naam: "A. subclavia", vertakking: "→ A. axillaris", klinisch: "Oorsprong plexus brachialis-blokkades" },
      { naam: "A. brachialis", vertakking: "→ A. radialis + A. ulnaris", klinisch: "Bloeddruk meten, arterielijnen" },
      { naam: "A. radialis", vertakking: "Distaal", klinisch: "Arterielijnen, Allen's test, pols" },
    ],
  },
  {
    categorie: "Arterieel — romp",
    kleur: "#FF453A",
    vaten: [
      { naam: "Aorta", vertakking: "→ Truncus coeliacus, A. mesenterica sup/inf", klinisch: "Centraal, aneurysma screening" },
      { naam: "A. iliaca communis", vertakking: "→ A. iliaca interna + externa", klinisch: "Overgang naar bekken en been" },
    ],
  },
  {
    categorie: "Arterieel — onderste extremiteit",
    kleur: "#FF453A",
    vaten: [
      { naam: "A. femoralis", vertakking: "→ A. profunda femoris", klinisch: "Arterielijnen, Seldinger, palpatie lies" },
      { naam: "A. poplitea", vertakking: "→ A. tibialis anterior + posterior", klinisch: "Achter knie, palpatie" },
      { naam: "A. dorsalis pedis", vertakking: "Distaal", klinisch: "Perifere pulsatie voetrug" },
      { naam: "A. tibialis posterior", vertakking: "Distaal", klinisch: "Palpatie achter mediale malleolus" },
    ],
  },
  {
    categorie: "Veneus — centraal",
    kleur: "#0A84FF",
    vaten: [
      { naam: "V. jugularis interna", vertakking: "→ V. brachiocephalica", klinisch: "CVC-lijn, echogeleide punctie" },
      { naam: "V. subclavia", vertakking: "→ V. brachiocephalica", klinisch: "CVC-lijn, infraclaviculair" },
      { naam: "V. cava superior", vertakking: "→ Rechter atrium", klinisch: "Tip CVC-katheter" },
      { naam: "V. cava inferior", vertakking: "→ Rechter atrium", klinisch: "Echo: vullingsstatus" },
      { naam: "V. femoralis", vertakking: "→ V. iliaca externa", klinisch: "CVC-lijn (noodtoegang), lies" },
    ],
  },
  {
    categorie: "Veneus — perifeer (arm)",
    kleur: "#0A84FF",
    vaten: [
      { naam: "V. cephalica", vertakking: "Lateraal arm → V. axillaris", klinisch: "Perifeer infuus, lateraal" },
      { naam: "V. basilica", vertakking: "Mediaal arm → V. brachialis", klinisch: "PICC-lijn, mediaal" },
      { naam: "V. mediana cubiti", vertakking: "Elleboogplooi", klinisch: "Meest gebruikte venapunctie-plek" },
    ],
  },
  {
    categorie: "Veneus — onderste extremiteit",
    kleur: "#0A84FF",
    vaten: [
      { naam: "V. saphena magna", vertakking: "Mediaal been → V. femoralis", klinisch: "Noodtoegang enkel (cutdown)" },
      { naam: "V. saphena parva", vertakking: "Lateraal → V. poplitea", klinisch: "Achterzijde onderbeen" },
    ],
  },
];

// Afbeeldingen uit de originele zakkaart-PDF (base64 encoded JPEG)
//#if !calc
const IMG_DERMATOMEN = __IMG("dermatomen.jpg");
const IMG_VAATSTELSEL = __IMG("vaatstelsel.jpg");
const IMG_AMC_CAMPUS = __IMG("amc-campus.jpg");
const IMG_AMC_PLATTEGROND = __IMG("amc-plattegrond.jpg");
const IMG_VUMC_CAMPUS = __IMG("vumc-campus.jpg");

//#endif

// ============================================================
// ICONS (simple SVG inline)
// ============================================================


PERSONEEL_GROEPEN.push(
  {
    titel: "Cardiochirurgie — diensten",
    kleur: "#FF453A",
    items: [
      { naam: "Cardiochirurgie coördinator", nummer: "28683" },
      { naam: "Regelsein Cardio", nummer: "64617" },
    ],
  },
  {
    titel: "Orthopedie & Oogheelkunde — diensten",
    kleur: "#0A84FF",
    items: [
      { naam: "Dienstdoende assistent ORT", nummer: "81 59306" },
      { naam: "Oogheelkunde — dienstdoende (housephys.)", nummer: "29543" },
    ],
  },
);

const Icons = {
  home: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/>
    </svg>
  ),
  gear: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
  phone: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
    </svg>
  ),
  heart: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  ),
  pill: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"/>
      <rect x="6" y="2" width="12" height="20" rx="2"/>
      <line x1="6" y1="12" x2="18" y2="12"/>
    </svg>
  ),
  clipboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
    </svg>
  ),
  baby: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 10-16 0"/>
      <circle cx="10" cy="7" r="0.5" fill="currentColor"/><circle cx="14" cy="7" r="0.5" fill="currentColor"/>
    </svg>
  ),
  alert: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  book: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
    </svg>
  ),
  shield: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  search: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  zap: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  wind: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1014 16H2m15.73-8.27A2.5 2.5 0 1119.5 12H2"/>
    </svg>
  ),
  droplet: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.69s5 5.5 5 9.5a5 5 0 01-10 0c0-4 5-9.5 5-9.5z"/>
    </svg>
  ),
  map: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
      <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
    </svg>
  ),
  biohazard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2"/><path d="M12 9a5.5 5.5 0 00-4.76 2.75M12 9a5.5 5.5 0 014.76 2.75M7.24 14.25a5.5 5.5 0 009.52 0"/>
      <circle cx="12" cy="12" r="10"/>
    </svg>
  ),
  calc: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/>
      <line x1="8" y1="10" x2="8" y2="10.01"/><line x1="12" y1="10" x2="12" y2="10.01"/>
      <line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/>
      <line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/>
      <line x1="8" y1="18" x2="8" y2="18.01"/><line x1="12" y1="18" x2="16" y2="18"/>
    </svg>
  ),
  anatomy: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="16"/>
      <line x1="8" y1="11" x2="16" y2="11"/><line x1="12" y1="16" x2="8" y2="22"/>
      <line x1="12" y1="16" x2="16" y2="22"/>
    </svg>
  ),
  tube: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6v11a3 3 0 01-6 0V3z"/>
      <line x1="9" y1="3" x2="15" y2="3"/>
      <line x1="9" y1="8" x2="15" y2="8"/>
    </svg>
  ),
  calendar: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
};

const ALL_SECTIONS = [
  { id: "nood", label: "Nood", icon: Icons.alert, color: "#FF453A" },
  { id: "tel", label: "Telefoonnummers", icon: Icons.phone, color: "#30D158" },
  { id: "ok", label: "OK's", icon: Icons.map, color: "#40C8E0" },
  { id: "abcde", label: "ABCDE", icon: Icons.heart, color: "#FF453A" },
  { id: "medicatie", label: "Medicatie", icon: Icons.pill, color: "#FF9F0A" },
  { id: "checks", label: "Checks", icon: Icons.clipboard, color: "#30D158" },
  { id: "bloedgas", label: "Bloedgas", icon: Icons.wind, color: "#0A84FF" },
  { id: "kinder", label: "Kinderen", icon: Icons.baby, color: "#40C8E0" },
  { id: "als", label: "ALS", icon: Icons.zap, color: "#FF9F0A" },
  { id: "spoed", label: "Noodknop", icon: Icons.alert, color: "#FF375F" },
  { id: "team", label: "Team", icon: Icons.users, color: "#0A84FF" },
  { id: "epas", label: "EPA's", icon: Icons.book, color: "#5E5CE6" },
  { id: "isolatie", label: "Isolatie", icon: Icons.biohazard, color: "#FF9F0A" },
  { id: "personeel", label: "Interne lijst", icon: Icons.users, color: "#8E8E93" },
  { id: "calculator", label: "Calculator", icon: Icons.calc, color: "#30D158" },
  { id: "dermatomen", label: "Dermatomen", icon: Icons.anatomy, color: "#BF5AF2" },
  { id: "vaatstelsel", label: "Vaatstelsel", icon: Icons.heart, color: "#FF453A" },
  { id: "plattegrond", label: "Plattegrond", icon: Icons.map, color: "#0A84FF" },
  { id: "buizen", label: "Buizen", icon: Icons.tube, color: "#FF453A" },
  { id: "ecg", label: "ECG", icon: Icons.heart, color: "#FF375F" },
  { id: "rooster", label: "Rooster", icon: Icons.calendar, color: "#FF453A" },
  { id: "cardio", label: "Cardio", icon: Icons.heart, color: "#FF453A" },
];

// Logische groepering van de tabbladen voor het startscherm
const ALL_SECTION_GROUPS = [
  { titel: "Acute zorg", kleur: "#FF453A", ids: ["abcde", "als", "spoed"] },
  { titel: "Medicatie & rekenen", kleur: "#FF9F0A", ids: ["medicatie", "calculator"] },
  { titel: "Specialismes", kleur: "#FF453A", ids: ["kinder", "cardio"] },
  { titel: "Checks & overdracht", kleur: "#30D158", ids: ["checks"] },
  { titel: "Metingen", kleur: "#0A84FF", ids: ["bloedgas", "ecg"] },
  { titel: "Contact & locatie", kleur: "#0A84FF", ids: ["tel", "ok", "plattegrond", "buizen", "isolatie", "personeel"] },
  { titel: "Anatomie", kleur: "#BF5AF2", ids: ["dermatomen", "vaatstelsel"] },
  { titel: "Opleiding & werk", kleur: "#63E6E2", ids: ["epas", "team", "rooster"] },
];

// ---- Varianten: dezelfde bron levert drie apps (APP wordt bij het bouwen gezet) ----
//   full = alles · info = zonder Calculator/Medicatie · calc = alleen Calculator + Medicatie
const VARIANT_IDS = APP === "calc" ? ["calculator", "medicatie"]
  : APP === "info" ? ALL_SECTIONS.map(s => s.id).filter(id => id !== "calculator" && id !== "medicatie")
  : ALL_SECTIONS.map(s => s.id);
const SECTIONS = APP === "calc"
  ? VARIANT_IDS.map(id => ALL_SECTIONS.find(s => s.id === id))
  : ALL_SECTIONS.filter(s => VARIANT_IDS.includes(s.id));
const SECTION_GROUPS = ALL_SECTION_GROUPS
  .map(g => ({ ...g, ids: g.ids.filter(id => VARIANT_IDS.includes(id)) }))
  .filter(g => g.ids.length > 0);
const HOME = APP === "calc" ? "calculator" : null;
const SETTINGS_ID = "instellingen";
const APP_TITLE = "Zakkaart";
const APP_SUBTITLE = APP === "info" ? "Info · anesthesiemedewerkers" : "Anesthesiemedewerkers";
const TABS = APP === "calc"
  ? [
      { id: "calculator", label: "Calculator", icon: Icons.calc },
      { id: "medicatie", label: "Medicatie", icon: Icons.pill },
    ]
  : [
      { id: null, label: "Start", icon: Icons.home },
      { id: "nood", label: "Nood", icon: Icons.alert },
      { id: "tel", label: "Telefoon", icon: Icons.phone },
      APP === "info"
        ? { id: "personeel", label: "Interne lijst", icon: Icons.users }
        : { id: "calculator", label: "Calculator", icon: Icons.calc },
    ];

// Lokaal anesthetica — maximale doseringen (FK / gangbaar; verifieer AUMC-protocol)
// zonder/met = mg/kg · cap = absolute max enkelvoudige dosis (mg) · conc = beschikbare mg/ml
const LA_MEDS = [
  { naam: "Lidocaïne", zonder: 3, met: 7, capZonder: 200, capMet: 500, conc: [10, 20] },
  { naam: "Prilocaïne", zonder: 6, met: 8, capZonder: 400, capMet: 600, conc: [10, 20] },
  { naam: "Mepivacaïne", zonder: 4, met: 7, capZonder: 300, capMet: 500, conc: [10, 20] },
  { naam: "Ropivacaïne", zonder: 3, met: null, capZonder: 225, capMet: null, conc: [2, 7.5] },
  { naam: "Bupivacaïne", zonder: 2, met: null, capZonder: 150, capMet: null, conc: [2.5, 5] },
  { naam: "Levobupivacaïne", zonder: 2, met: null, capZonder: 150, capMet: null, conc: [2.5, 5, 7.5] },
];
const fmtNum = n => (Math.round(n * 10) / 10).toString().replace(".", ",");
const concLabel = c => {
  const pctStr = (Math.round((c / 10) * 100) / 100).toString().replace(".", ",");
  return `${pctStr}% (${fmtNum(c)} mg/ml)`;
};

// ============================================================
// APP COMPONENT
// ============================================================

const DEFAULT_SETTINGS = { fontSize: "normal", defaultLocatie: "amc", startView: "list", taal: "nl" };
const ACCENT = "#30D158";

function ZakkaartApp() {
  const [activeSection, setActiveSection] = useState(HOME);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tabSearchQuery, setTabSearchQuery] = useState("");
  const [locatie, setLocatie] = useState(() => {
    try { return JSON.parse(localStorage.getItem("zakkaart_settings") || "{}").defaultLocatie === "vumc" ? "vumc" : "amc"; } catch { return "amc"; }
  });
  const [gewicht, setGewicht] = useState("");
  const [leeftijdCalc, setLeeftijdCalc] = useState("");
  const [expandedALS, setExpandedALS] = useState(null);
  const [plattegrondTab, setPlattegrondTab] = useState("amc");
  const [plattegrondZoek, setPlattegrondZoek] = useState("");
  const [laGewicht, setLaGewicht] = useState(70);
  const [collapseTarget, setCollapseTarget] = useState(null);

  // Calculator trommelroller state
  const defaultLeeftijdIdx = AGE_ITEMS.findIndex(a => a.value === 2) || 13;
  const [calcLeeftijdIdx, setCalcLeeftijdIdx] = useState(defaultLeeftijdIdx >= 0 ? defaultLeeftijdIdx : 13);
  const [calcGewichtIdx, setCalcGewichtIdx] = useState(weightIndexFor(calcStandardWeight(AGE_ITEMS[defaultLeeftijdIdx >= 0 ? defaultLeeftijdIdx : 13].value)));
  const [gewichtManual, setGewichtManual] = useState(false);

  // Settings state (geladen vanuit localStorage)
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("zakkaart_settings");
      return { ...DEFAULT_SETTINGS, ...(saved ? JSON.parse(saved) : {}) };
    } catch { return { ...DEFAULT_SETTINGS }; }
  });
  const zoomMap = { small: 0.88, normal: 1.0, large: 1.13 };
  const t = (nl, en) => settings.taal === "en" ? en : nl;
  const [leidingOpen, setLeidingOpen] = useState(false);
  const [openBronMed, setOpenBronMed] = useState(null);
  const [openBloedgasParam, setOpenBloedgasParam] = useState(null);
  const [showDetailBron, setShowDetailBron] = useState(false);
  const [showOverzichtskaart, setShowOverzichtskaart] = useState(false);
  const [selectedBuis, setSelectedBuis] = useState(null);
  const [ecgTab, setEcgTab] = useState("patronen");
  const scrollRef = useRef(null);
  const navSolidRef = useRef(false);
  const [navSolid, setNavSolid] = useState(false);
  const skipPersonResetRef = useRef(false);

  // Instellingen opslaan in localStorage
  useEffect(() => {
    try { localStorage.setItem("zakkaart_settings", JSON.stringify(settings)); } catch {}
  }, [settings]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setLeidingOpen(false);
    if (skipPersonResetRef.current) {
      skipPersonResetRef.current = false;
    } else {
      setSelectedPerson(null);
    }
  }, [activeSection]);

  // ---- Render helpers ----

  const Card = ({ children, className = "" }) => (
    <div className={"zk-card" + (className ? " " + className : "")}>
      {children}
    </div>
  );

  const SectionTitle = ({ children, color = "#fff" }) => (
    <h3 className="zk-section-title" style={{ color: color === "#fff" ? "rgba(235,235,245,0.6)" : color }}>{children}</h3>
  );

  const PhoneRow = ({ naam, nummer }) => (
    <div className="zk-phone-row">
      <span className="zk-phone-name">{naam}</span>
      <span className="zk-phone-num">{nummer}</span>
    </div>
  );

  const TableRow = ({ cells, header = false, accentKleur = null }) => (
    <div style={{
      display: "grid",
      gridTemplateColumns: cells.length === 4 ? "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" : cells.length === 3 ? "minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)",
      gap: "6px",
      padding: header ? "8px 0" : "8px 4px",
      borderBottom: "0.5px solid rgba(84,84,88,0.65)",
      borderLeft: !header && accentKleur ? `4px solid ${accentKleur}` : !header ? "4px solid transparent" : "none",
      paddingLeft: !header ? "8px" : "0",
      fontWeight: header ? 600 : 400,
      fontSize: header ? "12px" : "14px",
      textTransform: header ? "uppercase" : "none",
      letterSpacing: header ? "0.3px" : "0",
      color: header ? "rgba(235,235,245,0.6)" : "rgba(235,235,245,0.86)",
    }}>
      {cells.map((c, i) => (
        <span key={i} style={{ minWidth: 0, overflowWrap: "anywhere", fontSize: !header && i > 0 ? "13px" : "inherit" }}>{c}</span>
      ))}
    </div>
  );

  const PersonCard = ({ p }) => (
    <Card>
      <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "rgba(235,235,245,0.6)", marginBottom: "4px" }}>{p.rol}</div>
      <div style={{ fontWeight: 600, fontSize: "17px", color: "#fff", marginBottom: "8px" }}>{p.naam}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {p.tel !== "—" && <div style={{ fontSize: "15px", color: "#0A84FF" }}>📱 {p.tel}</div>}
        {p.intern !== "—" && <div style={{ fontSize: "15px", color: "rgba(235,235,245,0.8)" }}>☎️ Intern: {p.intern}</div>}
        <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", overflowWrap: "anywhere" }}>✉️ {p.email}</div>
      </div>
    </Card>
  );

  const ImageCard = ({ src, alt, beschrijving }) => (
    <Card>
      <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", marginBottom: "8px" }}>
        {beschrijving} — tik om te vergroten
      </div>
      <div style={{
        borderRadius: "10px",
        overflow: "hidden",
        cursor: "pointer",
      }}
        onClick={(e) => {
          const img = e.currentTarget.querySelector('img');
          if (img.style.maxHeight === 'none') {
            img.style.maxHeight = '350px';
            img.style.objectFit = 'cover';
          } else {
            img.style.maxHeight = 'none';
            img.style.objectFit = 'contain';
          }
        }}
      >
        <img src={src} alt={alt} style={{
          width: "100%",
          maxHeight: "350px",
          objectFit: "cover",
          objectPosition: "center",
          display: "block",
          transition: "max-height 0.3s ease",
        }} />
      </div>
    </Card>
  );

  // ---- Section content renderers ----

  const SEIN_MELDINGEN = [
    { code: "BEL 55", uitleg: "Reanimatieoproep in het ziekenhuis of verwacht op de shockroom (meestal 5). Bel 55 (vaste telefoon) of 5555 (zebra); bij ingesprektoon ophangen en opnieuw bellen tot je de meldcentrale krijgt — meld je seinnummer." },
    { code: "TRAUMA", uitleg: "Traumapatiënt verwacht op de shockroom (meestal 2)." },
    { code: "TRAUMA KIND", uitleg: "Traumapatiënt < 18 jaar verwacht op de shockroom (meestal 2)." },
    { code: "UPGRADE", uitleg: "Traumaopvang is al gaande maar geëscaleerd — patiënt te instabiel voor het kleine traumateam; groot traumateam gevraagd." },
    { code: "AAAA", uitleg: "Verdenking acuut aneurysma aorta abdominalis op de shockroom (meestal 3). Ook verdenking Type A dissectie valt hieronder." },
    { code: "S SECTIO", uitleg: "Verlosafdeling drukt noodbel — spoedsectio (meestal OK 14, anders OK 18 of OK 8)." },
    { code: "ECMO SEH", uitleg: "ECMO-patiënt verwacht op de shockroom óf ECMO wordt daar geplaatst (plaatsen meestal shockroom 5, reeds aanwezige ECMO meestal shockroom 2)." },
    { code: "A1 OK **", uitleg: "Noodbel ingedrukt in de betreffende OK." },
    { code: "PIEP", uitleg: "Het sein wordt gebeld — bel 8259577 om op te nemen." },
    { code: "ALARM", uitleg: "Er is een noodoproep uitgezet naar het sein." },
  ];

  const renderNood = () => (
    <div>
      <div style={{
        background: "linear-gradient(135deg, #FF453A, #FF453A)",
        borderRadius: "16px",
        padding: "24px",
        textAlign: "center",
        marginBottom: "16px",
      }}>
        <div style={{ fontSize: "42px", fontWeight: 900, fontFamily: "inherit", letterSpacing: "4px" }}>
          {NOODNUMMERS.brand}
        </div>
        <div style={{ fontSize: "13px", textTransform: "uppercase", letterSpacing: "3px", marginTop: "4px", opacity: 0.8 }}>
          Brand / Beveiliging
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "12px", marginBottom: "16px" }}>
        <div style={{
          background: "linear-gradient(135deg, #FF9F0A, #FF9F0A)",
          borderRadius: "12px",
          padding: "20px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "32px", fontWeight: 900, fontFamily: "inherit", letterSpacing: "3px" }}>
            {NOODNUMMERS.reanimatie}
          </div>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.3px", marginTop: "4px", opacity: 0.8 }}>
            Reanimatieteam
          </div>
        </div>
        <div style={{
          background: "linear-gradient(135deg, #8E8E93, #8E8E93)",
          borderRadius: "12px",
          padding: "20px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "32px", fontWeight: 900, fontFamily: "inherit" }}>
            {NOODNUMMERS.centraleBalie}
          </div>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.3px", marginTop: "4px", opacity: 0.8 }}>
            Centrale Balie
          </div>
        </div>
      </div>
      <Collapse title="Noodmedicatie" color="#FF453A" icon={Icons.pill}>
        {NOODMEDICATIE.map((m, i) => (
          <div key={i} style={{
            padding: "8px 0 8px 8px",
            borderBottom: i < NOODMEDICATIE.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
            borderLeft: `4px solid ${getMedKleur(m.med)?.bg || "#FF453A"}`,
          }}>
            <div style={{ fontWeight: 700, color: "#fff", fontSize: "16px" }}>{m.med}</div>
            <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.6)", marginTop: "2px" }}>
              <span style={{ fontFamily: "inherit", color: "#FFD60A" }}>{m.dosering}</span>
              {" — "}{m.indicatie}
            </div>
          </div>
        ))}
      </Collapse>
      <Collapse title="Reversibele oorzaken (4H's + 4T's)" color="#FF453A" icon={Icons.alert}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "6px" }}>
          {ALS_REVERSIBEL_KORT.map((item, i) => (
            <div key={i} style={{
              padding: "8px 10px",
              background: "rgba(255,69,58,0.1)",
              borderRadius: "8px",
              fontSize: "13px",
              color: "rgba(235,235,245,0.8)",
              border: "1px solid rgba(255,69,58,0.15)",
            }}>{zw(item)}</div>
          ))}
        </div>
      </Collapse>
      <Collapse title="Meldingen op het sein" color="#FF453A" icon={Icons.phone}>
        {SEIN_MELDINGEN.map((s, i) => (
          <div key={i} style={{
            padding: "10px 0 10px 10px",
            borderBottom: i < SEIN_MELDINGEN.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
            borderLeft: "4px solid #FF453A",
            marginBottom: "2px",
          }}>
            <div style={{ fontWeight: 800, color: "#FF453A", fontSize: "15px", fontFamily: "inherit", letterSpacing: "0.3px" }}>{s.code}</div>
            <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", marginTop: "3px", lineHeight: 1.5 }}>{s.uitleg}</div>
          </div>
        ))}
      </Collapse>
    </div>
  );

  const renderTelefoonTab = () => {
    const opties = [
      { id: "amc", label: "Locatie AMC", color: "#0A84FF" },
      { id: "vumc", label: "Locatie VU", color: "#BF5AF2" },
    ];
    const actief = opties.find(o => o.id === locatie) || opties[0];
    return (
      <div>
        <div className="zk-seg" role="group" aria-label="Locatie" style={{ marginBottom: "14px" }}>
          {opties.map(o => (
            <button key={o.id} type="button" className={locatie === o.id ? "is-on" : ""} aria-pressed={locatie === o.id} onClick={() => setLocatie(o.id)}>{o.label}</button>
          ))}
        </div>
        {locatie === "vumc"
          ? renderTelefoon(TELEFOON_VUMC, "AUMC, locatie VU")
          : renderTelefoon(TELEFOON_AMC, "AUMC, locatie AMC")}
      </div>
    );
  };

  const renderTelefoon = (data, label) => {
    const locLeiding = LEIDINGGEVENDEN.filter(p =>
      p.rol.toLowerCase().includes("hoofd") ||
      p.rol.toLowerCase().includes(label.toLowerCase())
    );

    const leidingGroepen = {};
    locLeiding.forEach(p => {
      if (!leidingGroepen[p.rol]) leidingGroepen[p.rol] = [];
      leidingGroepen[p.rol].push(p);
    });

    return (
    <div>
      {/* Leidinggevenden - collapsible */}
      <div style={{
        marginBottom: "12px",
        borderRadius: "12px",
        overflow: "hidden",
        border: leidingOpen ? "1px solid rgba(10,132,255,0.3)" : "1px solid rgba(118,118,128,0.24)",
        transition: "border-color 0.2s",
      }}>
        <button
          onClick={() => setLeidingOpen(prev => !prev)}
          style={{
            width: "100%",
            padding: "14px 16px",
            background: leidingOpen ? "rgba(10,132,255,0.08)" : "rgba(118,118,128,0.18)",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "inherit",
            color: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#0A84FF" }}>{Icons.users}</span>
            <span style={{ fontWeight: 600, fontSize: "15px" }}>Leidinggevenden {label}</span>
          </div>
          <span style={{
            fontSize: "18px",
            color: "rgba(235,235,245,0.45)",
            transform: leidingOpen ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}>›</span>
        </button>
        {leidingOpen && (
          <div style={{ padding: "4px 16px 14px" }}>
            {Object.entries(leidingGroepen).map(([rol, personen], gi) => (
              <div key={gi} style={{ marginBottom: gi < Object.keys(leidingGroepen).length - 1 ? "12px" : 0 }}>
                <div style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.3px",
                  color: "#0A84FF",
                  marginBottom: "6px",
                  marginTop: "8px",
                }}>{rol}</div>
                {personen.map((p, i) => (
                  <div key={i} style={{
                    padding: "8px 0",
                    borderBottom: "0.5px solid rgba(84,84,88,0.65)",
                  }}>
                    <div style={{ fontWeight: 600, color: "#fff", fontSize: "15px", marginBottom: "4px" }}>{p.naam}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {p.tel !== "—" && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                          <span style={{ color: "rgba(235,235,245,0.6)" }}>Mobiel</span>
                          <span style={{ fontFamily: "inherit", color: "#0A84FF" }}>{p.tel}</span>
                        </div>
                      )}
                      {p.intern !== "—" && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                          <span style={{ color: "rgba(235,235,245,0.6)" }}>Intern</span>
                          <span style={{ fontFamily: "inherit", color: "#fff" }}>{p.intern}</span>
                        </div>
                      )}
                      <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.45)", marginTop: "2px" }}>{p.email}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <Collapse title="Vaste nummers" color="#0A84FF" defaultOpen={true} icon={Icons.phone}>
        {data.vast.map((p, i) => <PhoneRow key={i} {...p} />)}
      </Collapse>
      {data.dagcentrumOK && (
        <Collapse title="Dagcentrum OK's" color="#0A84FF" icon={Icons.map}>
          {data.dagcentrumOK.map((p, i) => <PhoneRow key={i} {...p} />)}
        </Collapse>
      )}
      {data.ic && (
        <Collapse title="Intensive Care" color="#FF453A" icon={Icons.alert}>
          {data.ic.map((p, i) => <PhoneRow key={i} {...p} />)}
        </Collapse>
      )}
      {data.bloed && (
        <Collapse title="Bloed halen" color="#FF453A" icon={Icons.droplet}>
          {data.bloed.map((p, i) => <PhoneRow key={i} {...p} />)}
        </Collapse>
      )}
      {data.buizenpost && (
        <Collapse title="Buizenpost locaties" color="#BF5AF2" icon={Icons.tube}>
          {data.buizenpost.map((p, i) => <PhoneRow key={i} {...p} />)}
        </Collapse>
      )}
      <Collapse title="Seinnummers" color="#30D158" icon={Icons.phone}>
        {data.sein.map((p, i) => <PhoneRow key={i} {...p} />)}
      </Collapse>
      <Collapse title="Dienstseinen AM" color="#FFD60A" icon={Icons.phone}>
        {data.dienstAM.map((p, i) => <PhoneRow key={i} {...p} />)}
      </Collapse>
      <Collapse title="Dienstseinen Anesthesiologen" color="#FF9F0A" icon={Icons.phone}>
        {data.dienstAnes.map((p, i) => <PhoneRow key={i} {...p} />)}
      </Collapse>
      <Collapse title={`Diensten ${label}`} color="#0A84FF" icon={Icons.calendar}>
        {(label.includes("locatie AMC") ? DIENSTEN_AMC : DIENSTEN_VUMC).map((d, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 0",
            borderBottom: "0.5px solid rgba(84,84,88,0.65)",
          }}>
            <span>
              <span style={{ fontWeight: 700, color: "#fff", fontFamily: "inherit", marginRight: "8px" }}>{d.code}</span>
              <span style={{ color: "rgba(235,235,245,0.6)", fontSize: "14px" }}>{d.naam}</span>
            </span>
            <span style={{ fontFamily: "inherit", color: "#0A84FF", fontSize: "14px" }}>{d.tijd}</span>
          </div>
        ))}
      </Collapse>
    </div>
    );
  };

  const renderOK = () => (
    <div>
      {/* Schipholbord legenda */}
      <Collapse title="Schipholbord — Legenda" color="#FF9F0A" icon={Icons.map}>
        <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.45)", marginBottom: "12px" }}>
          Kleurcodes patiëntflow op het OK-planningsbord
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {SCHIPHOLBORD.map((item, i) => (
            <div key={i} style={{
              display: "flex",
              alignItems: "center",
              gap: "0",
            }}>
              {/* Timeline connector */}
              <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "32px",
                flexShrink: 0,
              }}>
                {i > 0 && <div style={{ width: "2px", height: "8px", background: "rgba(118,118,128,0.32)" }} />}
                <div style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  background: item.kleur,
                  flexShrink: 0,
                  border: "2px solid rgba(118,118,128,0.32)",
                }} />
                {i < SCHIPHOLBORD.length - 1 && <div style={{ width: "2px", height: "8px", background: "rgba(118,118,128,0.32)" }} />}
              </div>
              {/* Label */}
              <div style={{
                flex: 1,
                padding: "6px 12px",
                margin: "2px 0",
                borderRadius: "8px",
                background: item.kleur,
                color: item.tekst,
                fontWeight: 600,
                fontSize: "14px",
                letterSpacing: "0.3px",
              }}>
                {item.fase}
              </div>
            </div>
          ))}
        </div>
      </Collapse>

      <Collapse title="OK's per specialisme — AUMC, locatie AMC" color="#40C8E0" icon={Icons.map}>
        {OK_SPECIALISMEN.map((item, i) => (
          <div key={i} style={{
            display: "flex",
            gap: "12px",
            padding: "8px 0",
            borderBottom: "0.5px solid rgba(84,84,88,0.65)",
            alignItems: "baseline",
          }}>
            <span style={{
              fontFamily: "inherit",
              fontWeight: 700,
              color: "#40C8E0",
              minWidth: "48px",
              fontSize: "15px",
            }}>OK {item.ok}</span>
            <span style={{ color: "rgba(235,235,245,0.8)", fontSize: "14px" }}>{item.spec}</span>
          </div>
        ))}
      </Collapse>
    </div>
  );

  const renderABCDE = () => (
    <div>
      {ABCDE.map((item, i) => (
        <div key={i} style={{
          marginBottom: "16px",
          borderRadius: "14px",
          overflow: "hidden",
          border: `1px solid ${item.kleur}30`,
        }}>
          <div style={{
            background: `linear-gradient(135deg, ${item.kleur}20, ${item.kleur}08)`,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            borderBottom: `1px solid ${item.kleur}20`,
          }}>
            <span style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: item.kleur,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: "18px",
              flexShrink: 0,
            }}>{item.letter}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: "17px" }}>{item.titel}</div>
              <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)" }}>{item.subtitel}</div>
            </div>
          </div>
          <div style={{ padding: "14px 16px" }}>
            <div style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.3px", color: "rgba(235,235,245,0.6)", marginBottom: "6px" }}>🔎 Observaties</div>
              {item.observaties.map((o, j) => (
                <div key={j} style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", padding: "3px 0", paddingLeft: "12px", position: "relative" }}>
                  <span style={{ position: "absolute", left: 0, color: "rgba(235,235,245,0.45)" }}>•</span>{o}
                </div>
              ))}
            </div>
            <div style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.3px", color: "#FF453A", marginBottom: "6px" }}>⚠️ Risico's</div>
              {item.risicos.map((r, j) => (
                <div key={j} style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", padding: "3px 0", paddingLeft: "12px", position: "relative" }}>
                  <span style={{ position: "absolute", left: 0, color: "rgba(235,235,245,0.45)" }}>•</span>{r}
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.3px", color: "#30D158", marginBottom: "6px" }}>✅ Acties</div>
              {item.acties.map((a, j) => (
                <div key={j} style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", padding: "3px 0", paddingLeft: "12px", position: "relative" }}>
                  <span style={{ position: "absolute", left: 0, color: "rgba(235,235,245,0.45)" }}>•</span>{a}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderSettings = () => {
    const Seg = ({ value, options, onChange, label }) => (
      <div className="zk-seg" role="group" aria-label={label}>
        {options.map(o => (
          <button key={o.v} type="button" className={value === o.v ? "is-on" : ""} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.l}</button>
        ))}
      </div>
    );
    const andereApps = [
      APP !== "full" && { label: "Zakkaart (alles in één)", href: "./" },
      APP !== "info" && { label: "Zakkaart Info", href: "./info.html" },
      APP !== "calc" && { label: "Zakkaart Calculator", href: "./calculator.html" },
    ].filter(Boolean);
    return (
      <div className="zk-section" data-section-content>
        {APP !== "calc" && (
          <React.Fragment>
            <div className="zk-gh" style={{ marginTop: "8px" }}>Startscherm</div>
            <div className="zk-list" style={{ padding: "10px 12px" }}>
              <Seg label="Startscherm" value={settings.startView === "tiles" ? "tiles" : "list"} onChange={v => setSettings(s => ({ ...s, startView: v }))}
                options={[{ v: "list", l: "Lijst" }, { v: "tiles", l: "Tegels" }]} />
            </div>
            <div className="zk-gf">Kies hoe de tabbladen op het startscherm staan.</div>
          </React.Fragment>
        )}

        <div className="zk-gh">Tekstgrootte</div>
        <div className="zk-list" style={{ padding: "10px 12px" }}>
          <Seg label="Tekstgrootte" value={settings.fontSize || "normal"} onChange={v => setSettings(s => ({ ...s, fontSize: v }))}
            options={[{ v: "small", l: "Klein" }, { v: "normal", l: "Normaal" }, { v: "large", l: "Groot" }]} />
        </div>

        {APP !== "calc" && (
          <React.Fragment>
            <div className="zk-gh">Standaardlocatie</div>
            <div className="zk-list" style={{ padding: "10px 12px" }}>
              <Seg label="Standaardlocatie" value={settings.defaultLocatie === "vumc" ? "vumc" : "amc"} onChange={v => { setSettings(s => ({ ...s, defaultLocatie: v })); setLocatie(v); }}
                options={[{ v: "amc", l: "AMC" }, { v: "vumc", l: "VUmc" }]} />
            </div>
            <div className="zk-gf">Bepaalt welke telefoonlijst als eerste opent.</div>
          </React.Fragment>
        )}

        <div className="zk-gh">Andere apps</div>
        <div className="zk-list">
          {andereApps.map(a => (
            <a key={a.href} className="zk-row" href={a.href}>
              <span className="zk-grow">{a.label}</span>
              <ChevronRight />
            </a>
          ))}
        </div>

        <div className="zk-gh">Over</div>
        <div className="zk-list">
          <div className="zk-row"><span className="zk-grow">Versie</span><span className="zk-val">{VERSIE}</span></div>
        </div>
        <div className="zk-gf">Instellingen worden bewaard op dit apparaat.</div>
      </div>
    );
  };

  const renderMedicatie = () => (
    <div>
      <Collapse title="Standaardmedicatie volwassenen" color="#FF9F0A" icon={Icons.pill}>
        <div style={{ overflowX: "auto" }}>
          <TableRow cells={["Medicament", "Inductie", "Onderhoud"]} header />
          {MEDICATIE_STANDAARD.map((m, i) => (
            <TableRow key={i} cells={[
              <div>
                <div>
                  {m.med}
                  {m.bron && (
                    <span
                      onClick={() => setOpenBronMed(openBronMed === m.med ? null : m.med)}
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: "16px", height: "16px", marginLeft: "6px",
                        borderRadius: "50%", border: "1px solid #666", color: "rgba(235,235,245,0.6)",
                        fontSize: "11px", fontStyle: "italic", fontWeight: 700,
                        cursor: "pointer", verticalAlign: "middle",
                      }}
                    >i</span>
                  )}
                </div>
                {m.concentratie && (
                  <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.6)", fontWeight: 400, marginTop: "2px", lineHeight: 1.3 }}>
                    {m.concentratie}
                  </div>
                )}
                {m.bron && openBronMed === m.med && (
                  <div style={{
                    fontSize: "12px", color: "rgba(235,235,245,0.6)", marginTop: "6px", padding: "6px 8px",
                    background: "rgba(118,118,128,0.18)", borderRadius: "6px", maxWidth: "260px",
                  }}>
                    <span style={{ marginRight: "4px" }}>{m.bron.status}</span>
                    {m.bron.tekst}
                  </div>
                )}
              </div>,
              m.inductie,
              m.onderhoud
            ]} accentKleur={getMedKleur(m.med)?.bg} />
          ))}
        </div>
      </Collapse>

      <Collapse title="LAST — toxiciteit lokaal anestheticum (Intralipid)" color="#FF453A" icon={Icons.alert}>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginBottom: "10px" }}>
          Internationaal gestandaardiseerd noodprotocol (AAGBI/ASRA), niet AUMC-specifiek. Vooral van toepassing bij volwassenen.
        </div>
        {LAST_PROTOCOL.stappen.map((s, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: "8px", padding: "6px 0",
            borderBottom: i < LAST_PROTOCOL.stappen.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
          }}>
            <span style={{ color: "#FF453A", fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
            <span style={{ color: "rgba(235,235,245,0.8)", fontSize: "14px" }}>{s}</span>
          </div>
        ))}
        <div style={{ fontWeight: 700, color: "#fff", fontSize: "14px", margin: "14px 0 8px" }}>
          Intralipid 20% — doseerschema
        </div>
        {LAST_PROTOCOL.intralipid.map((r, i) => (
          <div key={i} style={{
            padding: "8px 0",
            borderBottom: i < LAST_PROTOCOL.intralipid.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ color: "rgba(235,235,245,0.8)", fontSize: "14px", fontWeight: 600 }}>{r.stap}</span>
              <span style={{ fontFamily: "inherit", color: "#FF453A", fontWeight: 700, fontSize: "14px", textAlign: "right" }}>{r.dosis}</span>
            </div>
            <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginTop: "2px" }}>{r.opmerking}</div>
          </div>
        ))}
      </Collapse>

      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "10px 12px", margin: "4px 0 12px",
        background: "rgba(255,214,10,0.08)", border: "1px solid rgba(255,214,10,0.25)",
        borderRadius: "10px", cursor: "pointer",
      }} onClick={() => setShowDetailBron(v => !v)}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: "16px", height: "16px", borderRadius: "50%", border: "1px solid #FFD60A",
          color: "#FFD60A", fontSize: "11px", fontStyle: "italic", fontWeight: 700, flexShrink: 0,
        }}>i</span>
        <span style={{ fontSize: "13px", color: "#FFD60A" }}>
          Bron: „Veelgebruikte geneesmiddelen anesthesie op het AMC" (T.M.S. van Winden, 2016) — tik voor details
        </span>
      </div>
      {showDetailBron && (
        <div style={{
          fontSize: "13px", color: "rgba(235,235,245,0.6)", lineHeight: 1.6, padding: "10px 12px",
          background: "rgba(118,118,128,0.18)", borderRadius: "10px", marginBottom: "12px",
        }}>
          Alle doses hieronder (Inductie t/m Overige) komen letterlijk uit één document: „Overzicht veelgebruikte
          geneesmiddelen anesthesie op het AMC", T.M.S. van Winden, 2016. <span style={{ color: "#FFD60A", fontWeight: 700 }}>Dit document is inmiddels 10 jaar oud</span> — er is niet gecontroleerd
          of dit nog het actuele AUMC-beleid weerspiegelt. Vraag na bij de afdeling of hier een recentere versie van bestaat.
        </div>
      )}
      {MEDICATIE_DETAIL.map((cat, ci) => (
        <Collapse key={ci} title={cat.categorie} color={cat.kleur} icon={Icons.pill}>
          {cat.meds.map((m, i) => {
            const itemKleur = cat.categorie === "Antagonisten"
              ? (i % 2 === 0 ? "#8B5E3C" : "#C49A6C")
              : cat.kleur;
            const medKleurBg = getMedKleur(m.naam)?.bg;
            return (
            <div key={i} style={{
              paddingBottom: i < cat.meds.length - 1 ? "12px" : 0,
              marginBottom: i < cat.meds.length - 1 ? "12px" : 0,
              borderBottom: i < cat.meds.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
              borderLeft: medKleurBg ? `4px solid ${medKleurBg}` : "4px solid transparent",
              paddingLeft: "8px",
            }}>
              <div style={{ fontWeight: 700, color: "#fff", fontSize: "15px", marginBottom: "6px" }}>{m.naam}</div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "4px 10px" }}>
                {[
                  { label: "Dosis", val: m.dosis },
                  { label: "~75 kg", val: m.obv75 },
                  { label: "Duur", val: m.duur },
                  { label: "Conc.", val: m.conc },
                  { label: "Ampul", val: m.inhoud },
                ].filter(r => r.val && r.val !== "—").map((row, j) => (
                  <div key={j} style={{ fontSize: "13px" }}>
                    <span style={{ color: "rgba(235,235,245,0.45)" }}>{row.label}: </span>
                    <span style={{ fontFamily: "inherit", color: itemKleur }}>{row.val}</span>
                  </div>
                ))}
              </div>
              {m.opmerking && (
                <div style={{
                  marginTop: "6px",
                  fontSize: "13px",
                  color: "#FFD60A",
                  background: "rgba(255,214,10,0.06)",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  border: "1px solid rgba(255,214,10,0.12)",
                }}>💡 {m.opmerking}</div>
              )}
            </div>
            );
          })}
          <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.3)", marginTop: "10px", textAlign: "right" }}>
            Bron: T.M.S. van Winden, 2016 — AUMC, locatie AMC
          </div>
        </Collapse>
      ))}

      <Collapse title="Lokaal anesthetica — max dosering" color="#40C8E0" icon={Icons.pill}>
        <div style={{
          background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.3)", borderLeft: "4px solid #FF453A",
          borderRadius: "10px", padding: "10px 12px", marginBottom: "14px", fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.5,
        }}>
          ⚠ <strong style={{ color: "#FF453A" }}>LAST — Local Anesthetic Systemic Toxicity.</strong> Vroege tekenen: tongtintelingen, metaalsmaak, duizeligheid, oorsuizen → later convulsies, ritmestoornissen, collaps. Bij verdenking: <strong>stop injectie</strong>, hulp inroepen, <strong>Intralipid 20%</strong> klaarmaken, AUMC LAST-/Intralipidprotocol volgen.
        </div>

        <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "#40C8E0", fontWeight: 700, marginBottom: "8px" }}>Rekenhulp — voer gewicht in</div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
          <input
            type="number" inputMode="numeric" min="1" max="200" value={laGewicht}
            onChange={e => setLaGewicht(Math.max(0, Math.min(250, parseFloat(e.target.value) || 0)))}
            style={{
              width: "90px", fontSize: "18px", fontWeight: 700, textAlign: "center",
              fontFamily: "inherit", color: "#fff", background: "rgba(64,200,224,0.12)",
              border: "1px solid rgba(64,200,224,0.4)", borderRadius: "10px", padding: "10px 8px",
            }}
          />
          <span style={{ fontSize: "16px", color: "#40C8E0", fontWeight: 700 }}>kg</span>
        </div>

        {LA_MEDS.map((m, i) => {
          const w = laGewicht || 0;
          const maxZonder = Math.min(m.zonder * w, m.capZonder);
          const maxMet = m.met != null ? Math.min(m.met * w, m.capMet) : null;
          return (
            <div key={i} style={{
              background: "rgba(64,200,224,0.06)", border: "1px solid rgba(64,200,224,0.25)",
              borderLeft: "4px solid #40C8E0", borderRadius: "10px", padding: "12px", marginBottom: "12px",
            }}>
              <div style={{ fontWeight: 700, color: "#40C8E0", fontSize: "16px", marginBottom: "8px" }}>{m.naam}</div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "6px 12px", marginBottom: "10px" }}>
                <div style={{ fontSize: "13px" }}>
                  <div style={{ color: "rgba(235,235,245,0.6)", marginBottom: "2px" }}>Zonder adrenaline</div>
                  <div style={{ fontFamily: "inherit", color: "#fff", fontSize: "14px" }}>
                    {fmtNum(m.zonder)} mg/kg → <strong style={{ color: "#40C8E0" }}>{fmtNum(maxZonder)} mg</strong>
                  </div>
                </div>
                <div style={{ fontSize: "13px" }}>
                  <div style={{ color: "rgba(235,235,245,0.6)", marginBottom: "2px" }}>Met adrenaline</div>
                  <div style={{ fontFamily: "inherit", color: maxMet != null ? "#fff" : "rgba(235,235,245,0.45)", fontSize: "14px" }}>
                    {maxMet != null
                      ? <span>{fmtNum(m.met)} mg/kg → <strong style={{ color: "#40C8E0" }}>{fmtNum(maxMet)} mg</strong></span>
                      : "—"}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginBottom: "4px" }}>Max volume per concentratie <span style={{ color: "rgba(235,235,245,0.45)" }}>(o.b.v. dosis zónder adrenaline)</span></div>
              {m.conc.map((c, j) => (
                <div key={j} style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "5px 0", borderBottom: j < m.conc.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
                }}>
                  <span style={{ fontSize: "13px", color: "rgba(235,235,245,0.8)" }}>{concLabel(c)}</span>
                  <span style={{ fontFamily: "inherit", color: "#40C8E0", fontSize: "13px" }}>{fmtNum(maxZonder / c)} ml</span>
                </div>
              ))}
            </div>
          );
        })}
        <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.3)", marginTop: "6px", textAlign: "right" }}>
          Richtwaarden (Farmacotherapeutisch Kompas) — verifieer tegen AUMC-protocol
        </div>
      </Collapse>
    </div>
  );

  const renderChecks = () => (
    <div>
      <Collapse title="SALTMOVIES — Check voor start inleiding" color="#30D158" icon={Icons.clipboard}>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.45)", marginBottom: "10px" }}>
          Systematische check vóór elke inductie — tik een item aan als het klaar is
        </div>
        {SALTMOVIES.map((item, i) => (
          <div key={i} style={{
            padding: "10px 0",
            borderBottom: i < SALTMOVIES.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
              <span style={{
                width: "28px", height: "28px", borderRadius: "7px",
                background: "#30D158", display: "flex", alignItems: "center",
                justifyContent: "center", fontWeight: 900, fontSize: "15px", flexShrink: 0,
              }}>{item.letter}</span>
              <span style={{ fontWeight: 600, fontSize: "15px", color: "#fff" }}>{item.item}</span>
            </div>
            <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", lineHeight: 1.6, paddingLeft: "38px" }}>
              {item.uitleg}
            </div>
          </div>
        ))}
      </Collapse>
      <Collapse title="LEMON-law — Luchtwegbeoordeling" color="#0A84FF" icon={Icons.wind}>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.45)", marginBottom: "10px" }}>
          Voorspelt moeilijke intubatie — score ≥ 2 factoren = verhoogd risico
        </div>
        {LEMON.map((item, i) => (
          <div key={i} style={{
            padding: "10px 0",
            borderBottom: i < LEMON.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <span style={{
                width: "28px", height: "28px", borderRadius: "7px",
                background: "#0A84FF", display: "flex", alignItems: "center",
                justifyContent: "center", fontWeight: 900, fontSize: "15px", flexShrink: 0,
              }}>{item.letter}</span>
              <span style={{ fontWeight: 600, fontSize: "15px", color: "#fff" }}>{item.tekst}</span>
            </div>
            <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", lineHeight: 1.7, paddingLeft: "38px" }}>
              {item.uitleg}
            </div>
          </div>
        ))}
      </Collapse>
      <Collapse title="SBAR — Overdracht" color="#BF5AF2" icon={Icons.clipboard}>
        {Object.entries(SBAR).map(([key, items]) => (
          <div key={key} style={{ marginBottom: "12px" }}>
            <div style={{
              fontWeight: 700,
              fontSize: "15px",
              color: "#BF5AF2",
              marginBottom: "4px",
              textTransform: "capitalize",
            }}>
              <span style={{ fontWeight: 900, fontSize: "17px" }}>{key[0].toUpperCase()}</span>
              {key.slice(1)}
            </div>
            {items.map((item, i) => (
              <div key={i} style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", padding: "2px 0 2px 14px", position: "relative" }}>
                <span style={{ position: "absolute", left: 2, color: "rgba(235,235,245,0.45)" }}>–</span>{item}
              </div>
            ))}
          </div>
        ))}
      </Collapse>
      <Collapse title="Essentiële veiligheidsafspraken" color="#8E8E93" icon={Icons.shield}>
        {VEILIGHEIDSAFSPRAKEN.map((v, i) => (
          <div key={i} style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 0",
            borderBottom: "0.5px solid rgba(84,84,88,0.65)",
          }}>
            <span style={{
              width: "24px",
              height: "24px",
              borderRadius: "6px",
              background: "rgba(142,142,147,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              color: "#AEAEB2",
              flexShrink: 0,
              fontWeight: 700,
            }}>{i + 1}</span>
            <span style={{ fontSize: "15px", color: "rgba(235,235,245,0.8)" }}>{v}</span>
          </div>
        ))}
      </Collapse>
    </div>
  );

  const renderBloedgas = () => (
    <div>
      <Collapse title="Normaalwaarden bloedgasanalyse" color="#0A84FF" icon={Icons.droplet}>
        {BLOEDGAS.map((b, i) => (
          <div key={i} style={{ borderBottom: "0.5px solid rgba(84,84,88,0.65)" }}>
            <button
              onClick={() => setOpenBloedgasParam(openBloedgasParam === b.param ? null : b.param)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                padding: "10px 0",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <span style={{ fontWeight: 600, color: "#fff", fontSize: "15px", textDecoration: "underline", textDecorationStyle: "dotted", textDecorationColor: "#586069", textUnderlineOffset: "3px" }}>{b.param}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                <span style={{ fontFamily: "inherit", color: "#0A84FF", fontSize: "14px" }}>{b.waarde}</span>
                <span style={{
                  flexShrink: 0,
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  border: "1px solid #444",
                  color: "#777",
                  fontSize: "11px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: openBloedgasParam === b.param ? "rotate(45deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                  ...(openBloedgasParam === b.param ? { borderColor: "#0A84FF", color: "#0A84FF" } : {}),
                }}>+</span>
              </span>
            </button>
            {openBloedgasParam === b.param && (
              <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", lineHeight: 1.5, padding: "0 2px 10px 0" }}>
                {b.uitleg}
              </div>
            )}
          </div>
        ))}
      </Collapse>
      <Collapse title="Beademing" color="#40C8E0" icon={Icons.wind}>
        {BEADEMING.map((b, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "10px 0",
            borderBottom: "0.5px solid rgba(84,84,88,0.65)",
          }}>
            <span style={{ fontWeight: 600, color: "#fff", fontSize: "15px" }}>{b.param}</span>
            <span style={{ fontFamily: "inherit", color: "#40C8E0", fontSize: "14px" }}>{b.waarde}</span>
          </div>
        ))}
      </Collapse>

      {/* ROTEM — Stollingsdiagnostiek */}
      <Collapse title="ROTEM — AUMC stollingsprotocol" color="#BF5AF2" icon={Icons.droplet}>
        <div style={{
          background: "linear-gradient(135deg, rgba(191,90,242,0.08) 0%, rgba(191,90,242,0.02) 100%)",
          border: "1px solid rgba(191,90,242,0.2)",
          borderRadius: "10px",
          padding: "10px 12px",
          marginBottom: "14px",
          fontSize: "13px",
          color: "rgba(235,235,245,0.8)",
          lineHeight: 1.5,
        }}>
          ⚠ <strong style={{ color: "#BF5AF2" }}>Corrigeer alleen de stolling als er sprake is van een bloeding.</strong> ROTEM kan niet voorspellen óf het gaat bloeden, alleen laten zien <em>waarom</em> het bloedt.
        </div>

        <div style={{
          background: "rgba(191,90,242,0.06)",
          border: "1px solid rgba(191,90,242,0.2)",
          borderRadius: "10px",
          padding: "10px 12px",
          marginBottom: "14px",
          fontSize: "14px",
          color: "rgba(235,235,245,0.8)",
        }}>
          <div style={{ fontWeight: 700, color: "#BF5AF2", marginBottom: "6px" }}>🔑 Inloggen ROTEM (op OK)</div>
          <div>Inlognaam: <span style={{ fontFamily: "inherit", color: "#fff" }}>rotem</span></div>
          <div>Wachtwoord: <span style={{ fontFamily: "inherit", color: "#fff" }}>Rotemremote1</span></div>
          <a
            href="https://apl-rotemlive-p.prod1.umcinfra.nl/rotem/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
              marginTop: "10px", padding: "10px 12px", borderRadius: "8px",
              background: "rgba(191,90,242,0.18)", border: "1px solid rgba(191,90,242,0.45)",
              color: "#fff", fontWeight: 700, textDecoration: "none",
            }}
          >
            <span>ROTEM live openen (GEMweb Live)</span>
            <span style={{ color: "#BF5AF2" }}>↗</span>
          </a>
        </div>

        {ROTEM_PROTOCOL.map((stap, i) => (
          <div key={i} style={{
            background: `${stap.kleur}12`,
            border: `1px solid ${stap.kleur}40`,
            borderLeft: `4px solid ${stap.kleur}`,
            borderRadius: "10px",
            padding: "12px",
            marginBottom: "10px",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "10px",
            }}>
              <div style={{
                background: stap.kleur,
                color: "#fff",
                width: "26px",
                height: "26px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "14px",
                flexShrink: 0,
              }}>{i + 1}</div>
              <div style={{ fontWeight: 700, color: stap.kleur, fontSize: "15px" }}>{stap.titel}</div>
            </div>
            {stap.triggers.map((trig, ti) => (
              <div key={ti} style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                gap: "8px",
                alignItems: "center",
                padding: "8px 0",
                borderTop: ti > 0 ? "1px solid rgba(118,118,128,0.24)" : "none",
              }}>
                <div style={{
                  fontFamily: "inherit",
                  fontSize: "13px",
                  color: "#fff",
                  background: "rgba(0,0,0,0.25)",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  lineHeight: 1.4,
                }} dangerouslySetInnerHTML={{ __html: trig.criterium }} />
                <div style={{ color: stap.kleur, fontSize: "17px", textAlign: "center" }}>→</div>
                <div style={{
                  fontWeight: 700,
                  fontSize: "13px",
                  color: stap.kleur,
                  background: `${stap.kleur}25`,
                  padding: "6px 8px",
                  borderRadius: "6px",
                  textAlign: "center",
                  lineHeight: 1.4,
                }}>{trig.actie}</div>
              </div>
            ))}
          </div>
        ))}

        <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.45)", marginTop: "10px", textAlign: "right" }}>
          Bron: AUMC stollingsprotocol — ROTEM sigma
        </div>
      </Collapse>

      <Collapse title="ROTEM — Parameter uitleg" color="#BF5AF2" icon={Icons.droplet}>
        {ROTEM_PARAMETERS.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: ci < ROTEM_PARAMETERS.length - 1 ? "16px" : 0 }}>
            <div style={{
              fontSize: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.3px",
              color: cat.kleur,
              fontWeight: 700,
              marginBottom: "8px",
              paddingBottom: "4px",
              borderBottom: `1px solid ${cat.kleur}33`,
            }}>{cat.groep}</div>
            {cat.params.map((p, i) => (
              <div key={i} style={{
                padding: "8px 0 8px 10px",
                borderLeft: `3px solid ${cat.kleur}`,
                marginBottom: "4px",
                background: i % 2 === 0 ? "rgba(118,118,128,0.18)" : "transparent",
                borderRadius: "0 6px 6px 0",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "2px" }}>
                  <div>
                    <span style={{ fontFamily: "inherit", fontWeight: 700, color: cat.kleur, fontSize: "14px" }}>{p.acroniem}</span>
                    <span style={{ color: "rgba(235,235,245,0.8)", fontSize: "14px", marginLeft: "8px" }}>{p.naam}</span>
                  </div>
                  <span style={{ fontSize: "11px", color: "rgba(235,235,245,0.45)", fontFamily: "inherit" }}>{p.unit}</span>
                </div>
                <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", lineHeight: 1.4 }}>{p.beschrijving}</div>
              </div>
            ))}
          </div>
        ))}
      </Collapse>

      <Collapse title="ROTEM — Tests in 1 oogopslag" color="#BF5AF2" icon={Icons.droplet}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "8px" }}>
          {ROTEM_TESTS.map((t, i) => (
            <div key={i} style={{
              background: `${t.kleur}10`,
              border: `1px solid ${t.kleur}30`,
              borderLeft: `4px solid ${t.kleur}`,
              borderRadius: "8px",
              padding: "10px",
            }}>
              <div style={{ fontWeight: 700, color: t.kleur, fontSize: "14px", marginBottom: "4px" }}>{t.naam}</div>
              <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.8)", lineHeight: 1.4 }}>{t.uitleg}</div>
            </div>
          ))}
        </div>
      </Collapse>

      <Collapse title="Antistolling — antagoneren bij overdosering" color="#FF453A" icon={Icons.droplet}>
        {ANTISTOLLING_REVERSAL.map((g, i) => (
          <div key={i} style={{
            background: "rgba(255,69,58,0.06)",
            border: "1px solid rgba(255,69,58,0.18)",
            borderLeft: "4px solid #FF453A",
            borderRadius: "8px",
            padding: "10px 12px",
            marginBottom: "10px",
          }}>
            <div style={{ fontWeight: 700, color: "#FF453A", fontSize: "14px", marginBottom: "2px" }}>{g.klasse}</div>
            <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginBottom: "6px" }}>{g.middelen}</div>
            <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.5 }}>{g.handelen}</div>
          </div>
        ))}
      </Collapse>
    </div>
  );

  const renderKinder = () => (
    <div>
      <Collapse title="Checklist kinderanesthesie" color="#FF9F0A" icon={Icons.clipboard}>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.45)", marginBottom: "10px", lineHeight: 1.5 }}>
          Standaardchecklist AUMC, locatie AMC — loop deze door vóór elke kinder-OK.
        </div>
        {KINDER_CHECKLIST.map((sec, si) => (
          <div key={si} style={{ marginBottom: si < KINDER_CHECKLIST.length - 1 ? "14px" : 0 }}>
            <div style={{
              fontSize: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.3px",
              color: sec.kleur,
              fontWeight: 700,
              marginBottom: "6px",
              paddingBottom: "4px",
              borderBottom: `1px solid ${sec.kleur}33`,
            }}>{sec.sectie}</div>
            {sec.items.map((it, i) => (
              <div key={i} style={{
                padding: "8px 0 8px 10px",
                borderLeft: `3px solid ${sec.kleur}`,
                borderBottom: i < sec.items.length - 1 ? "1px solid rgba(118,118,128,0.18)" : "none",
                marginBottom: "2px",
              }}>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: "14px", marginBottom: "2px" }}>{it.item}</div>
                <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.5 }}>{it.tekst}</div>
              </div>
            ))}
          </div>
        ))}
      </Collapse>
      <Collapse title="Temperatuur" color="#FFD60A" icon={Icons.heart}>
        <div style={{ fontSize: "15px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6 }}>
          Neonaat: <strong style={{ color: "#FFD60A" }}>27°C</strong> — Anders: <strong style={{ color: "#FFD60A" }}>24°C</strong>
        </div>
        <div style={{ fontSize: "13px", color: "#FF9F0A", marginTop: "6px", fontStyle: "italic" }}>
          ⚠ OK 7 en 8: max 25°C (i.v.m. röntgenbuis-calibratie)
        </div>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.6)", marginTop: "8px" }}>
          {"<"}10 kg: Neoslangen · {">"}10 kg: Volwassenslangen (evt. kleine 1L ballon)
        </div>
      </Collapse>
      <Collapse title="Formules" color="#FFD60A" icon={Icons.calc}>
        {KINDER_FORMULES.map((f, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 0",
            borderBottom: "0.5px solid rgba(84,84,88,0.65)",
          }}>
            <span style={{ color: "rgba(235,235,245,0.8)", fontSize: "15px" }}>{f.formule}</span>
            <span style={{ fontFamily: "inherit", color: "#FFD60A", fontWeight: 600, fontSize: "14px" }}>{f.berekening}</span>
          </div>
        ))}
      </Collapse>
      <Collapse title="Vochtbeleid" color="#FFD60A" icon={Icons.droplet}>
        {KINDER_VOCHT.map((v, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 0",
            borderBottom: "0.5px solid rgba(84,84,88,0.65)",
            gap: "12px",
          }}>
            <span style={{ color: "rgba(235,235,245,0.8)", fontSize: "14px" }}>{v.item}</span>
            <span style={{ fontFamily: "inherit", color: "#FFD60A", fontSize: "13px", textAlign: "right", maxWidth: "62%" }}>{v.waarde}</span>
          </div>
        ))}
      </Collapse>
      <Collapse title="Naloxon bij ademdepressie" color="#FF453A" icon={Icons.pill}>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6 }}>
          <div>Staak medicijntoediening, meet sedatiescore + SpO2.</div>
          <div style={{ marginTop: "6px" }}><span style={{ fontFamily: "inherit", color: "#FF453A", fontWeight: 700 }}>0,2–0,4 mg IV</span>, titreren naar effect tot max. 1 mg.</div>
          <div style={{ marginTop: "4px", fontSize: "13px", color: "rgba(235,235,245,0.6)" }}>Op verkoever: verdunnen met 9 ml NaCl 0,9% en titreren met 1-2 ml (= 0,04-0,08 mg) per keer. Geen verbetering → overleg supervisor/zaalarts.</div>
        </div>
      </Collapse>
      <Collapse title="Normaalwaarden vitale parameters" color="#FFD60A" icon={Icons.heart}>
        <div style={{ overflowX: "auto" }}>
          <TableRow cells={["Leeftijd", "Pols", "SBD ↓", "Adem/min"]} header />
          {KINDER_VITAAL.map((v, i) => (
            <TableRow key={i} cells={[v.leeftijd, v.pols, v.sbdOnder, v.adem]} />
          ))}
        </div>
      </Collapse>
      <Collapse title="Kindermedicatie" color="#FFD60A" icon={Icons.pill}>
        <div style={{ overflowX: "auto" }}>
          <TableRow cells={["Medicament", "Inductie", "Onderhoud"]} header />
          {KINDERMEDICATIE.map((m, i) => (
            <TableRow key={i} cells={[m.med, m.inductie, m.onderhoud]} accentKleur={getMedKleur(m.med)?.bg} />
          ))}
        </div>
      </Collapse>
      <Collapse title="Noodmedicatie kinderen" color="#FF453A" icon={Icons.pill}>
        {NOODMEDICATIE.map((m, i) => (
          <div key={i} style={{
            padding: "8px 0 8px 8px",
            borderBottom: i < NOODMEDICATIE.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
            borderLeft: `4px solid ${getMedKleur(m.med)?.bg || "#FF453A"}`,
          }}>
            <div style={{ fontWeight: 700, color: "#fff" }}>{m.med}</div>
            <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.6)" }}>
              <span style={{ fontFamily: "inherit", color: "#FF453A" }}>{m.dosering}</span> — {m.indicatie}
            </div>
          </div>
        ))}
      </Collapse>

      <Collapse title="Antiemetica — PONV-profylaxe" color="#40C8E0" icon={Icons.pill}>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.45)", marginBottom: "10px" }}>
          PONV-profylaxe kinderen — doses per kg lichaamsgewicht
        </div>
        {KINDER_ANTIEMETICA.map((m, i) => (
          <div key={i} style={{
            paddingBottom: i < KINDER_ANTIEMETICA.length - 1 ? "12px" : 0,
            marginBottom: i < KINDER_ANTIEMETICA.length - 1 ? "12px" : 0,
            borderBottom: i < KINDER_ANTIEMETICA.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
            borderLeft: `4px solid ${getMedKleur(m.naam)?.bg || "#40C8E0"}`,
            paddingLeft: "8px",
          }}>
            <div style={{ fontWeight: 700, color: "#fff", fontSize: "15px", marginBottom: "6px" }}>{m.naam}</div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "4px 10px" }}>
              {[
                { label: "Dosis", val: m.dosis },
                { label: "Maximum", val: m.max },
                { label: "Conc.", val: m.conc },
              ].filter(r => r.val && r.val !== "—").map((row, j) => (
                <div key={j} style={{ fontSize: "13px" }}>
                  <span style={{ color: "rgba(235,235,245,0.45)" }}>{row.label}: </span>
                  <span style={{ fontFamily: "inherit", color: "#40C8E0" }}>{row.val}</span>
                </div>
              ))}
            </div>
            {m.opmerking && (
              <div style={{
                marginTop: "6px",
                fontSize: "13px",
                color: "#FFD60A",
                background: "rgba(255,214,10,0.06)",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid rgba(255,214,10,0.12)",
              }}>💡 {m.opmerking}</div>
            )}
          </div>
        ))}
      </Collapse>
    </div>
  );

  const renderALS = () => {
    const toggleALS = (titel) => {
      setExpandedALS(prev => prev === titel ? null : titel);
      // Scroll to item after a tick
      setTimeout(() => {
        const el = document.getElementById(`als-${titel.replace(/[^a-zA-Z]/g, '')}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    };

    // Map short labels to detailed items
    const labelToItems = {
      "Hypoxie": ["Hypoxie"],
      "Hypovolemie": ["Hypovolemie"],
      "Hypo-/hyperkaliëmie/metabool": ["Hyperkaliëmie", "Hypokaliëmie", "Hypoglycemie", "Hypocalciëmie", "Hypomagnesiëmie"],
      "Hypothermie/hyperthermie": ["Hypothermie", "Hyperthermie"],
      "Trombose (coronair/pulmonaal)": ["(Trombo)embolie — Coronairocclusie", "(Trombo)embolie — Longembolie"],
      "Tensie (spannings)pneumothorax": ["Tensie (spannings)pneumothorax"],
      "Tamponade (cardiaal)": ["Tamponade"],
      "Toxinen": ["Toxinen / Intoxicatie"],
    };

    return (
    <div>
      <div style={{
        background: "linear-gradient(135deg, #C0392B20, #E74C3C08)",
        borderRadius: "14px",
        padding: "16px",
        marginBottom: "16px",
        border: "1px solid rgba(255,69,58,0.2)",
      }}>
        <SectionTitle color="#FF453A">Specialistische reanimatie (ALS)</SectionTitle>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
          <strong style={{ color: "#fff" }}>Schokbaar (VF/VT):</strong> 1 schok → 2 min BLS → herhaal.
          <strong style={{ color: "#fff" }}> AUMC volwassenen: eerste schok 200 J, daarna 360 J.</strong> Kinderen {"<"}50 kg: 4 J/kg.
          Bij 3e blok adrenaline 1 mg + amiodaron 300 mg; herhaal elke 2 blokken; 5e blok nogmaals amiodaron 150 mg.
        </div>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7, marginTop: "10px" }}>
          <strong style={{ color: "#fff" }}>Niet-schokbaar (PEA/Asystolie):</strong> Adrenaline 1 mg vanaf 1e blok, daarna elke 2 blokken (3e, 5e …). Kinderen 10 µg/kg (max 1 mg) elke 3–5 min.
        </div>
      </div>
      <Collapse title="Tijdens reanimatie" color="#FF453A" icon={Icons.zap}>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
          Kwalitatief hoogwaardige thoraxcompressies · Minimaliseer onderbrekingen · Zuurstof toedienen ·
          Ononderbroken compressies na geavanceerde luchtwegtechniek · Vasculaire toegang (IV/IO) ·
          Adrenaline elke 3–5 min · Capnografie gebruiken
        </div>
      </Collapse>
      <Collapse title="Post-ROSC" color="#30D158" icon={Icons.heart}>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
          ABCDE benadering · SaO₂ 94–98% · Normale PaCO₂ · 12-afleidingen ECG ·
          Behandel onderliggende oorzaak · Doelgericht temperatuurmanagement
        </div>
      </Collapse>

      <Collapse title="4H's + 4T's — Tik voor details" color="#FF453A" icon={Icons.alert}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "6px" }}>
          {ALS_REVERSIBEL_KORT.map((label, i) => {
            const items = labelToItems[label] || [];
            const isActive = items.some(t => expandedALS === t);
            return (
              <button
                key={i}
                onClick={() => toggleALS(items[0])}
                style={{
                  padding: "10px 10px",
                  background: isActive ? "rgba(255,69,58,0.25)" : "rgba(255,69,58,0.08)",
                  borderRadius: "8px",
                  fontSize: "13px",
                  color: isActive ? "#fff" : "rgba(235,235,245,0.8)",
                  border: isActive ? "1.5px solid rgba(255,69,58,0.5)" : "1px solid rgba(255,69,58,0.12)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  fontWeight: isActive ? 600 : 400,
                  transition: "all 0.15s ease",
                }}
              >{zw(label)}</button>
            );
          })}
        </div>
      </Collapse>

      {/* Expandable detail items */}
      {VIER_H_VIER_T.map((item, i) => {
        const isOpen = expandedALS === item.titel;
        const itemId = `als-${item.titel.replace(/[^a-zA-Z]/g, '')}`;
        return (
          <div
            key={i}
            id={itemId}
            style={{
              marginBottom: "8px",
              borderRadius: "12px",
              overflow: "hidden",
              border: `1px solid ${isOpen ? item.kleur + '40' : 'rgba(118,118,128,0.24)'}`,
              transition: "border-color 0.2s ease",
            }}
          >
            <button
              onClick={() => toggleALS(item.titel)}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: isOpen
                  ? `linear-gradient(135deg, ${item.kleur}20, ${item.kleur}08)`
                  : "rgba(118,118,128,0.18)",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontFamily: "inherit",
                color: "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "6px",
                  background: isOpen ? item.kleur : item.kleur + '30',
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: 900,
                  flexShrink: 0,
                  color: isOpen ? "#fff" : item.kleur,
                  transition: "all 0.15s",
                }}>{item.categorie}</span>
                <span style={{
                  fontWeight: isOpen ? 700 : 500,
                  fontSize: "15px",
                  color: isOpen ? "#fff" : "rgba(235,235,245,0.8)",
                }}>{item.titel}</span>
              </div>
              <span style={{
                fontSize: "17px",
                color: "rgba(235,235,245,0.45)",
                transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease",
              }}>›</span>
            </button>
            {isOpen && (
              <div style={{
                padding: "10px 14px 14px",
                background: `${item.kleur}06`,
              }}>
                {item.acties.map((a, j) => (
                  <div key={j} style={{
                    fontSize: "14px",
                    color: "rgba(235,235,245,0.8)",
                    padding: "4px 0 4px 18px",
                    position: "relative",
                    lineHeight: 1.6,
                  }}>
                    <span style={{
                      position: "absolute",
                      left: 0,
                      color: item.kleur,
                      fontWeight: 700,
                    }}>→</span>{a}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <Collapse title="Kinderen beademingsfrequentie" color="#FFD60A" icon={Icons.wind}>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
          Zuigeling: 25/min · 1–8 jr: 20/min · 8–12 jr: 15/min · {">"}12 jr: 10/min
        </div>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7, marginTop: "8px" }}>
          Initieel 5 beademingen. Verhouding: volwassenen 30:2, kinderen 15:2.
        </div>
      </Collapse>
    </div>
    );
  };

  const renderSpoed = () => (
    <div>
      <Collapse title="Noodknop" color="#FF453A" icon={Icons.alert}>
        {NOODKNOP_INFO.map((n, i) => (
          <div key={i} style={{ marginBottom: "12px" }}>
            <div style={{ fontWeight: 700, color: "#FF453A", fontSize: "14px" }}>{n.locatie}</div>
            <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.5, marginTop: "4px" }}>{n.tekst}</div>
          </div>
        ))}
        <div style={{
          background: "rgba(255,69,58,0.12)",
          borderRadius: "8px",
          padding: "10px",
          fontSize: "13px",
          color: "#FF453A",
          lineHeight: 1.5,
          marginTop: "8px",
          border: "1px solid rgba(255,69,58,0.2)",
        }}>
          ⚠️ Alleen indrukken op aanwijzing van anesthesioloog, anesthesiemedewerker of operateur.
        </div>
      </Collapse>
      <Collapse title="Spoedbundel (fysiek + QR)" color="#0A84FF" icon={Icons.clipboard}>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6 }}>
          De spoedbundels liggen in de <span style={{ color: "#63E6E2", fontWeight: 700 }}>onderste lade</span> (met de sticker "spoedbundel").
          Houd deze lade hiervoor gereserveerd.
          <br /><br />
          Op elke OK hangen <span style={{ color: "#63E6E2", fontWeight: 700 }}>QR-codes</span> waarmee je de spoedbundel op je telefoon opent:
          <br />
          🟦 vierkantje = volwassenen &nbsp;·&nbsp; 🐟 visje = kind
          <br />
          Geplakt onder de pc op de muur, en op het dagcentrum bij de intercom.
          <br /><br />
          <span style={{ color: "#63E6E2" }}>Digitaal nalezen?</span> Gebruik de knoppen
          "Spoedbundel volwassenen" / "Spoedbundel kind" boven aan het startscherm.
        </div>
      </Collapse>
      <Collapse title="Moeilijke Luchtwegkar (MLK)" color="#BF5AF2" icon={Icons.wind}>
        {MLK_INFO.map((m, i) => (
          <div key={i} style={{ marginBottom: "10px" }}>
            <div style={{ fontWeight: 700, color: "#BF5AF2", fontSize: "14px" }}>{m.locatie}</div>
            <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.5, marginTop: "4px" }}>{m.tekst}</div>
          </div>
        ))}
      </Collapse>
      <Collapse title="Prik-, snij-, bijt- & spataccident" color="#FF9F0A" icon={Icons.alert}>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6 }}>
          <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", marginBottom: "12px" }}>
            Bij accident met humaan bloed, weefsel of vocht — risico op Hepatitis B, Hepatitis C en/of HIV.
          </div>

          <div style={{ background: "rgba(231,126,34,0.1)", border: "1px solid rgba(231,126,34,0.25)", borderRadius: "10px", padding: "10px 12px", marginBottom: "14px" }}>
            <div style={{ fontWeight: 700, color: "#FF9F0A", marginBottom: "6px" }}>📞 Melden</div>
            <div><span style={{ color: "#fff", fontWeight: 700 }}>08.00–16.30 uur:</span> direct bij Arbodienst Amsterdam UMC via <span style={{ fontFamily: "inherit", color: "#fff" }}>020-566 20 83</span>.</div>
            <div style={{ marginTop: "6px" }}><span style={{ color: "#fff", fontWeight: 700 }}>Buiten kantooruren:</span> meld je <span style={{ color: "#FF453A", fontWeight: 700 }}>FYSIEK</span> op de Spoedeisende Hulp. Neem, indien brononderzoek geïndiceerd, de geëtiketteerde buizen bloed mee naar de SEH.</div>
          </div>

          <div style={{ fontWeight: 700, color: "#FF9F0A", marginBottom: "6px" }}>Wat te doen</div>
          <ol style={{ margin: "0 0 14px 18px", padding: 0 }}>
            <li>Wond goed laten doorbloeden of uitknijpen</li>
            <li>Wond afspoelen met water</li>
            <li>Wond desinfecteren met Jodium of Chloorhexidinetinctuur</li>
          </ol>

          <div style={{ fontWeight: 700, color: "#FF9F0A", marginBottom: "6px" }}>Risicomateriaal</div>
          <ol style={{ margin: "0 0 14px 18px", padding: 0 }}>
            <li>Bloed</li>
            <li>Punctie- of drainagevocht</li>
            <li>Vaginaal vocht</li>
            <li>Semen</li>
            <li>Slijm bij tand- of mondheelkundige procedures</li>
            <li>Alle secreta en excreta, vermengd met bloed</li>
            <li>Niet-gefixeerde weefsels of organen</li>
            <li>Cellijnen, weefsel- en orgaanculturen, mogelijk besmet met bloed-overdraagbare virussen</li>
          </ol>

          <div style={{ fontWeight: 700, color: "#FF9F0A", marginBottom: "6px" }}>Brononderzoek</div>
          <div style={{ marginBottom: "10px" }}>
            Bloedonderzoek bij de bron vereist <span style={{ color: "#fff", fontWeight: 700 }}>toestemming</span> van de bron of zijn/haar vertegenwoordiger. Lukt dat niet, overleg dan met de hoofdbehandelaar van de (bron)patiënt.
          </div>
          <div style={{ marginBottom: "8px" }}>
            Gebruik <span style={{ color: "#fff", fontWeight: 700 }}>2 serumbuizen met GELE dop</span>:
          </div>
          <ul style={{ margin: "0 0 12px 18px", padding: 0 }}>
            <li>1 serumbuis voor de HIV-sneltest</li>
            <li>1 serumbuis voor anti-HIV en anti-HCV serologie</li>
          </ul>
          <div style={{ marginBottom: "12px" }}>
            De hoofdbehandelaar van de bronpatiënt ordert de bronbloedonderzoeken zelf in EPIC o.v.v. <span style={{ color: "#fff", fontWeight: 700 }}>prikaccident</span> en voorziet de buizen van etiketten.
          </div>

          <div style={{ background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.25)", borderRadius: "10px", padding: "10px 12px", color: "#FF453A", fontWeight: 600 }}>
            Na gebruik de 2 serumbuizen aanvullen — verkoever kast 22, lade 7B.
          </div>
        </div>
      </Collapse>
    </div>
  );

  const renderTeam = () => {

    if (selectedPerson) {
      return (
        <div>
          <button
            onClick={() => setSelectedPerson(null)}
            style={{
              background: "none", border: "none", color: "#0A84FF",
              fontSize: "14px", cursor: "pointer", padding: "0 0 12px 0",
              fontFamily: "inherit", display: "flex", alignItems: "center", gap: "4px",
            }}
          >← Alle leidinggevenden</button>
          <PersonCard p={selectedPerson} />
        </div>
      );
    }

    return (
      <div>
        {LEIDINGGEVENDEN.map((p, i) => <PersonCard key={i} p={p} />)}
        <Collapse title="Vertrouwenspersoon" color="#30D158" icon={Icons.users}>
          <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6 }}>
            vertrouwenspersonen@amsterdamumc.nl
          </div>
          <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", marginTop: "8px" }}>
            App: #zouikwatzeggen (App Store / Play Store)
          </div>
        </Collapse>
        <Collapse title="Peersupport" color="#FF9F0A" icon={Icons.users}>
          <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6 }}>
            care4ourown-anest@amsterdamumc.nl
          </div>
        </Collapse>
      </div>
    );
  };

  const renderEPAs = () => (
    <div>
      <Collapse title="Supervisieniveaus" color="#63E6E2" defaultOpen={true} icon={Icons.book}>
        {SUPERVISIE.map((s, i) => (
          <div key={i} style={{
            display: "flex",
            gap: "12px",
            padding: "10px 0",
            borderBottom: i < SUPERVISIE.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
            alignItems: "flex-start",
          }}>
            <span style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              background: s.niveau === 4 ? "#63E6E2" : `rgba(99,230,226,${0.15 + s.niveau * 0.1})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: "16px",
              flexShrink: 0,
              color: s.niveau === 4 ? "#fff" : "#63E6E2",
            }}>{s.niveau}</span>
            <span style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6 }}>{s.tekst}</span>
          </div>
        ))}
      </Collapse>

      <Collapse title="Bewijsinstrumenten EPA's" color="#63E6E2" icon={Icons.clipboard}>
        {[
          {
            naam: "KPE van dienst",
            desc: "Een KPE die gekoppeld kan worden aan meerdere EPA's, waardoor er met één formulier bewijsstukken voor diverse EPA's verzameld kan worden. De KPE van dienst kan gezien worden als dagevaluatie. De student laat hier groei in de ontwikkeling zien aan de hand van de verschillende supervisieniveaus.",
          },
          {
            naam: "KPE Specifiek",
            desc: "Formulier waarmee feedback op specifieke EPA's en overstijgende feedback gegeven wordt. KPE specifiek kan worden ingevuld wanneer voldoende bewijslast op niveau 4 in de KPE van dienst is verzameld. KPE specifiek mag daarna direct op niveau 4 worden afgetekend.",
          },
          {
            naam: "CBD — Case Based Discussion",
            desc: "Instrument waarmee samen met de werkbegeleider mondeling klinisch wordt geredeneerd over een casus. In het gesprek kunnen variaties op de daadwerkelijke casus worden besproken om na te gaan hoe de student hiermee om zou gaan. De centrale vraag is: 'Kan ik de student deze EPA toevertrouwen in verschillende situaties?'",
            vragen: true,
          },
          {
            naam: "Vaardigheidstoets / OSATS",
            desc: "Bij de vaardigheidstoets observeert de werkbegeleider de student terwijl hij/zij een medisch-technische vaardigheid die onderdeel is van een EPA uitvoert, door middel van een Objective Structured Assessment of Technical Skills (OSATS).",
          },
          {
            naam: "Reflectie",
            desc: "Instrument waarmee feedback wordt gegeven op het leerproces door middel van een reflectieverslag aan de hand van de STARR methode.",
          },
          {
            naam: "Product",
            desc: "Instrument waarmee feedback gegeven wordt op een opdracht, verslag, presentatie etc. waarin de anesthesiemedewerker in opleiding aan een gedeelte van de EPA gewerkt heeft (in een bijlage/link).",
          },
          {
            naam: "EOL formulier",
            desc: "Registratieformulier om de uren bij te houden die gemaakt zijn voor de EOL.",
          },
        ].map((item, i) => (
          <div key={i} style={{ padding: "10px 0", borderBottom: "0.5px solid rgba(84,84,88,0.65)" }}>
            <div style={{ fontWeight: 700, color: "#63E6E2", fontSize: "15px", marginBottom: "4px" }}>{item.naam}</div>
            <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6 }}>{item.desc}</div>
            {item.vragen && (
              <div style={{ marginTop: "10px" }}>
                <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "rgba(235,235,245,0.45)", marginBottom: "6px" }}>Onderwerpen case based discussie</div>
                {CBD_VRAGEN.map((v, j) => (
                  <div key={j} style={{
                    background: "rgba(99,230,226,0.06)",
                    borderLeft: "2px solid #63E6E2",
                    padding: "8px 10px",
                    marginBottom: "6px",
                    borderRadius: "0 6px 6px 0",
                  }}>
                    <div style={{ fontSize: "13px", color: "#fff", fontWeight: 600, marginBottom: "2px" }}>{v.vraag}</div>
                    <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)" }}>{v.doel}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </Collapse>

      <Collapse title="Tijdlijn — streefmoment niveau 4" color="#63E6E2" icon={Icons.calendar}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginBottom: "10px", fontSize: "12px" }}>
          {["geel", "blauw", "groen", "roze", "rood"].map(cat => (
            <span key={cat} style={{ display: "flex", alignItems: "center", gap: "5px", color: "rgba(235,235,245,0.6)" }}>
              <i style={{ width: "11px", height: "11px", borderRadius: "3px", background: EPA_CAT_KLEUR[cat], display: "inline-block" }} />
              {EPA_CAT_LABEL[cat]}
            </span>
          ))}
        </div>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginBottom: "8px", lineHeight: 1.5 }}>
          Elk halfjaar = 2 kolommen. De balk loopt tot het halfjaar waarin je <b style={{ color: "#fff" }}>niveau 4</b> (de <b style={{ color: "#fff" }}>4</b>) hoort te bereiken. De kleur geeft de complexiteit aan.
        </div>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", border: "0.5px solid rgba(84,84,88,0.65)", borderRadius: "8px" }}>
          <div style={{ minWidth: "560px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "100px repeat(12,minmax(0, 1fr))", background: "rgba(118,118,128,0.18)", borderBottom: "0.5px solid rgba(84,84,88,0.65)" }}>
              <div style={{ padding: "6px 8px", fontSize: "11px", fontWeight: 700, color: "rgba(235,235,245,0.6)", fontFamily: "inherit" }}>EPA</div>
              {[1, 2, 3, 4, 5, 6].map(hj => (
                <div key={hj} style={{ gridColumn: "span 2", textAlign: "center", padding: "6px 0", fontSize: "11px", fontWeight: 700, color: "rgba(235,235,245,0.6)", borderLeft: "2px solid rgba(118,118,128,0.32)" }}>{hj}e hj</div>
              ))}
            </div>
            {EPA_TIJDSCHEMA.map((e, ri) => {
              const c = EPA_CAT_KLEUR[e.cat];
              return (
                <div key={ri} style={{ display: "grid", gridTemplateColumns: "100px repeat(12,minmax(0, 1fr))", borderBottom: ri < EPA_TIJDSCHEMA.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "0 6px", minHeight: "26px", overflow: "hidden" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: c, flexShrink: 0 }} />
                    <span style={{ fontFamily: "inherit", fontSize: "11px", color: "rgba(235,235,245,0.8)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.code}</span>
                  </div>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => {
                    const on = h >= e.start && h <= e.zelf;
                    const is4 = h === e.zelf;
                    return (
                      <div key={h} style={{
                        borderLeft: h % 2 === 1 ? "2px solid rgba(118,118,128,0.32)" : "1px solid rgba(118,118,128,0.24)",
                        minHeight: "26px", display: "flex", alignItems: "center", justifyContent: "center",
                        background: on ? c : "transparent",
                        color: "#fff", fontWeight: 800, fontSize: "11px",
                      }}>{is4 ? "4" : ""}</div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </Collapse>

      <Collapse title="Tijdschema EPA's" color="#63E6E2" icon={Icons.calendar}>
        <div style={{
          background: "rgba(99,230,226,0.08)",
          border: "1px solid rgba(99,230,226,0.25)",
          borderRadius: "10px",
          padding: "12px",
          marginBottom: "12px",
        }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#63E6E2", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.3px" }}>
            Wat betekenen de codes?
          </div>
          <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6, marginBottom: "10px" }}>
            Een <b>EPA</b> (Entrustable Professional Activity) is een toevertrouwbare beroepsactiviteit: een afgebakende taak die je in de praktijk leert. Per EPA werk je toe naar <b>niveau 4</b> = de activiteit zelfstandig uitvoeren met toezicht op afstand. Het <b>streefmoment</b> geeft aan in welk halfjaar je dat niveau hoort te bereiken.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 10px", fontSize: "13px", color: "rgba(235,235,245,0.8)" }}>
            <span style={{ fontFamily: "inherit", color: "#63E6E2", fontWeight: 700 }}>MO</span><span>Medisch Ondersteunend</span>
            <span style={{ fontFamily: "inherit", color: "#63E6E2", fontWeight: 700 }}>AZ</span><span>Acute Zorg</span>
            <span style={{ fontFamily: "inherit", color: "#63E6E2", fontWeight: 700 }}>AM</span><span>Anesthesiemedewerker</span>
            <span style={{ fontFamily: "inherit", color: "#63E6E2", fontWeight: 700 }}>OA</span><span>Operatieassistent</span>
            <span style={{ fontFamily: "inherit", color: "#63E6E2", fontWeight: 700 }}>FO</span><span>Functie-overstijgend (bijv. EPA 'Opvangen en begeleiden van de zorgvrager')</span>
            <span style={{ fontFamily: "inherit", color: "#63E6E2", fontWeight: 700 }}>REC</span><span>Recovery (verkoeverkamer)</span>
            <span style={{ fontFamily: "inherit", color: "#63E6E2", fontWeight: 700 }}>BAZ</span><span>Basis Acute Zorg</span>
          </div>
          <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginTop: "10px", lineHeight: 1.5 }}>
            Voorbeeld: <b style={{ color: "#63E6E2" }}>MO-AM-1</b> = Medisch Ondersteunend – Anesthesiemedewerker, EPA 1.<br/>
            Codes tussen haakjes zijn alternatieve benamingen (aliassen) voor dezelfde EPA.<br/>
            <b style={{ color: "#FFD60A" }}>BVP ✓</b> markeert de EPA's die je tijdens je beroepsvoorbereidende periode afrondt.
          </div>
        </div>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.45)", marginBottom: "10px" }}>
          Streefmoment niveau 4 per EPA — Leerjaar 1 t/m 3 (6 halfjaren)
        </div>
        {[1,2,3,4,5,6].map(hj => {
          const kleurMap = { 1: "#D4AC0D", 2: "#D4AC0D", 3: "#FF9F0A", 4: "#FF9F0A", 5: "#0A84FF", 6: "#BF5AF2" };
          const kleur = kleurMap[hj];
          const epas = EPA_TIJDSCHEMA.filter(e => e.niveau4HalfJaar === hj);
          const lj = hj <= 2 ? 1 : hj <= 4 ? 2 : 3;
          return (
            <div key={hj} style={{ marginBottom: "10px" }}>
              <div style={{
                fontSize: "12px",
                fontWeight: 700,
                color: kleur,
                textTransform: "uppercase",
                letterSpacing: "0.3px",
                marginBottom: "4px",
              }}>Leerjaar {lj} — {hj}e halfjaar</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {epas.map((e, i) => (
                  <div key={i} style={{
                    background: `${kleur}18`,
                    border: `1px solid ${kleur}40`,
                    borderRadius: "6px",
                    padding: "4px 8px",
                    fontSize: "12px",
                  }}>
                    <span style={{ fontFamily: "inherit", color: kleur, fontWeight: 700 }}>{e.code}</span>
                    {e.alias && <span style={{ color: "rgba(235,235,245,0.45)", marginLeft: "4px" }}>({e.alias})</span>}
                    {e.bvp && <span style={{ marginLeft: "4px", color: "#FFD60A", fontSize: "11px" }}>BVP ✓</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Collapse>
    </div>
  );

  const renderIsolatie = () => (
    <div>
      {/* Snel overzicht — altijd open, zodat je in één oogopslag de juiste
          isolatievorm kunt vinden voordat je 'm hieronder opent voor details. */}
      <Card>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginBottom: "10px" }}>
          Zoek de juiste isolatievorm op basis van de voorbeelden, en tik 'm
          hieronder open voor de volledige maatregelen.
        </div>
        <TableRow cells={["Type", "Voorbeelden"]} header />
        {ISOLATIE_TABEL.map((iv, i) => (
          <TableRow key={i} cells={[iv.type, iv.voorbeelden]} accentKleur={iv.kleur} />
        ))}
      </Card>

      {ISOLATIE_TABEL.map((iv, i) => (
        <Collapse key={i} title={iv.type} color={iv.kleur} icon={Icons.biohazard}>
          <div style={{
            fontSize: "13px",
            color: iv.kleur,
            fontStyle: "italic",
            marginBottom: "10px",
          }}>{iv.voorbeelden}</div>

          {/* Extra maatregelen OK-medewerkers (1 of 2 varianten, bv. Druppel vs. Druppel+aerosol) */}
          {iv.varianten.map((v, vi) => (
            <div key={vi} style={{ marginBottom: vi < iv.varianten.length - 1 ? "10px" : "0", paddingBottom: vi < iv.varianten.length - 1 ? "10px" : "0", borderBottom: vi < iv.varianten.length - 1 ? `1px dashed ${iv.kleur}30` : "none" }}>
              {v.naam && (
                <div style={{ fontSize: "13px", fontWeight: 700, color: iv.kleur, marginBottom: "4px" }}>{v.naam}</div>
              )}
              {[
                { label: "Steriel", val: v.steriel },
                { label: "Niet steriel", val: v.nietSteriel },
                { label: "Einde programma", val: v.eindeProgramma },
              ].map((row, j) => (
                <div key={j} style={{
                  display: "flex",
                  gap: "10px",
                  padding: "4px 0",
                  fontSize: "14px",
                }}>
                  <span style={{
                    color: "rgba(235,235,245,0.6)",
                    width: "124px",
                    flexShrink: 0,
                    fontSize: "12px",
                    textTransform: "uppercase",
                    letterSpacing: "0.2px",
                    paddingTop: "2px",
                  }}>{zw(row.label)}</span>
                  <span style={{ color: "rgba(235,235,245,0.8)" }}>{row.val}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${iv.kleur}20`, marginTop: "10px", paddingTop: "8px" }}>
            {[
              { label: "Holding/verkoever/PACU", val: iv.holding },
              { label: "Disposable", val: iv.disposable },
              { label: "Re-usable", val: iv.reusable },
              { label: "Leegruimen", val: iv.leegruimen },
              { label: "OK-kamer schoonmaak", val: iv.schoonmaak },
            ].map((row, j) => (
              <div key={j} style={{
                display: "flex",
                gap: "10px",
                padding: "4px 0",
                fontSize: "14px",
              }}>
                <span style={{
                  color: "rgba(235,235,245,0.6)",
                  width: "124px",
                  flexShrink: 0,
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.2px",
                  paddingTop: "2px",
                }}>{zw(row.label)}</span>
                <span style={{ color: "rgba(235,235,245,0.8)" }}>{row.val}</span>
              </div>
            ))}
          </div>
        </Collapse>
      ))}

      <Card>
        {ISOLATIE_VOETNOTEN.map((v, i) => (
          <div key={i} style={{
            fontSize: "12px", color: i === 0 ? "#FF9F0A" : "rgba(235,235,245,0.6)",
            lineHeight: 1.5, marginBottom: i < ISOLATIE_VOETNOTEN.length - 1 ? "8px" : 0,
          }}>
            {i === 0 && "⚠️ "}{v}
          </div>
        ))}
        <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.45)", marginTop: "10px", textAlign: "right" }}>
          Bron: {ISOLATIE_BRON}
        </div>
      </Card>
    </div>
  );

  const renderPersoneel = () => (
    <div>
      <Card>
        <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", lineHeight: 1.5 }}>
          Interne telefoonlijsten van AUMC. Gebruik de zoekbalk bovenaan de app
          om snel een naam, afdeling of nummer te vinden — dat doorzoekt ook
          deze lijst.
        </div>
      </Card>

      {PERSONEEL_GROEPEN.map((groep, gi) => (
        <Collapse key={gi} title={groep.titel} color={groep.kleur} icon={Icons.phone}>
          {groep.items.map((item, i) => (
            <PhoneRow key={i} naam={item.naam} nummer={item.nummer} />
          ))}
        </Collapse>
      ))}
    </div>
  );

  const renderCalculator = () => {
    const age = AGE_ITEMS[calcLeeftijdIdx]?.value ?? null;
    const w = WEIGHT_ITEMS[calcGewichtIdx]?.value ?? null;
    const hasAge = age != null;
    const hasWeight = w != null;
    const calcWeight = w;
    const kg = v => String(v).replace(".", ",");
    // AUMC: hele én halve tubematen → afronden op 0,5. Ook < 1 jaar berekenen.
    const ettNum = !hasAge ? null : (
      age < 0.5 ? 3.5 :          // < 6 mnd
      age < 1 ? 4.0 :            // 6–11 mnd
      Math.round((age / 4 + 3.5) * 2) / 2   // ≥ 1 jr, afgerond op halve maat
    );
    const ettMaat = ettNum != null ? ettNum.toFixed(1) : null;
    const ettDiepte = ettMaat ? (parseFloat(ettMaat) * 3).toFixed(1) : null;
    const maagSonde = ettMaat ? (parseFloat(ettMaat) * 2).toFixed(1) : null;
    const blaasKatheter = ettMaat ? (parseFloat(ettMaat) * 2).toFixed(1) : null;
    const larynxBlad = !hasAge ? null : (
      age < 1 ? "Miller 0–1" :
      age < 2 ? "Mac 1 / Miller 1" :
      age < 6 ? "Mac 2 / Miller 2" :
      age < 12 ? "Mac 2–3 / Miller 2" :
      "Mac 3 / Miller 3"
    );
    // Prematuur/neonaat (< 3 kg op het gewichtswiel): tube-maten op gewicht, niet op leeftijd
    const isPrematuur = hasWeight && w < 3;
    const neoBand = !isPrematuur ? null : (w < 1 ? NEONAAT_TUBES[0] : w < 2 ? NEONAAT_TUBES[1] : NEONAAT_TUBES[2]);
    const tubeMaat = isPrematuur ? neoBand.ett : ettMaat;
    const tubeDiepte = isPrematuur ? neoBand.diepte : ettDiepte;
    const tubeBlad = isPrematuur ? "Miller 0" : larynxBlad;
    const tubeSonde = isPrematuur ? neoBand.sonde : maagSonde;
    const tubeKath = isPrematuur ? neoBand.katheter : blaasKatheter;
    // Beademingskapje & LMA-maat — gedeeld tussen de losse Collapse en de Overzichtskaart.
    // Onder 3 kg geldt de rij "Prematuur/Neonaat" uit de kapjestabel.
    const masker = isPrematuur ? MASKER_MATEN[0]
      : hasAge ? (MASKER_MATEN.find(m => age >= m.leeftijdMin && age < m.leeftijdMax) || MASKER_MATEN[MASKER_MATEN.length - 1]) : null;
    const lma = hasAge ? (LMA_MATEN.find(g => age >= g.leeftijdMin && age < g.leeftijdMax) || LMA_MATEN[LMA_MATEN.length - 1]) : null;

    const categorieGroepen = {};
    KINDER_CALC_MEDS.forEach(m => {
      if (!categorieGroepen[m.categorie]) categorieGroepen[m.categorie] = [];
      categorieGroepen[m.categorie].push(m);
    });

    // Curatie voor de Overzichtskaart: kernmedicatie/waarden per fase van de ingreep
    const OVERZICHT_MEDS = calcWeight ? [
      { fase: "Inductie", namen: ["Propofol (inductie)", "Sufentanyl (inductie)", "Rocuronium (inductie)"] },
      { fase: "Onderhoud", namen: ["Propofol (onderhoud)", "Onderhoudsvocht (4-2-1 regel, na 1e uur)"] },
      { fase: "Nood", namen: ["Adrenaline (nood)", "Atropine (nood)"] },
    ].map(groep => ({
      fase: groep.fase,
      items: groep.namen.map(naam => {
        const m = KINDER_CALC_MEDS.find(x => x.med === naam);
        if (!m) return null;
        const r = computeMedDosis(m, calcWeight, age, hasAge);
        return { naam: m.med.replace(/\s*\(.*\)/, ""), unit: m.unit, ...r };
      }).filter(Boolean),
    })) : [];

    const zoom = zoomMap[settings.fontSize] || 1;
    const ValueRow = ({ label, value, unit, sub }) => (
      <div className="zk-kv">
        <span className="zk-kv-label">{label}{sub && <span className="zk-kv-sub">{sub}</span>}</span>
        <span className="zk-kv-value">{value}{unit && <small>{unit}</small>}</span>
      </div>
    );

    return (
      <div>
        {/* Wielen: blijven in beeld tijdens het scrollen */}
        <div className="zk-calc-head" style={{ top: `calc((44px + env(safe-area-inset-top, 0px)) / ${zoom})` }}>
          <div className="zk-wheels">
            <div>
              <div className="zk-wheel-label">{t("Leeftijd", "Age")}</div>
              <ScrollPicker
                label={t("Leeftijd", "Age")}
                items={AGE_ITEMS}
                selectedIndex={calcLeeftijdIdx}
                onIndexChange={idx => {
                  setCalcLeeftijdIdx(idx);
                  const ageVal = AGE_ITEMS[idx].value;
                  const stdW = calcStandardWeight(ageVal);
                  setCalcGewichtIdx(weightIndexFor(stdW));
                  setGewichtManual(false);
                }}
              />
            </div>
            <div>
              <div className="zk-wheel-label" style={gewichtManual ? { color: "#FFD60A" } : undefined}>
                {gewichtManual ? t("Gewicht · handmatig", "Weight · manual") : t("Gewicht · standaard", "Weight · standard")}
              </div>
              <ScrollPicker
                label={t("Gewicht", "Weight")}
                items={WEIGHT_ITEMS}
                selectedIndex={calcGewichtIdx}
                onIndexChange={idx => { setCalcGewichtIdx(idx); setGewichtManual(true); }}
              />
            </div>
          </div>
          <div className="zk-calc-bar">
            <span data-calc-summary>
              {AGE_ITEMS[calcLeeftijdIdx]?.label} · {WEIGHT_ITEMS[calcGewichtIdx]?.label}
              {isPrematuur && ` (${Math.round(w * 1000)} g)`}
            </span>
            <span style={{ display: "flex", gap: "14px" }}>
              {gewichtManual && (
                <button type="button" className="zk-link" onClick={() => {
                  setCalcGewichtIdx(weightIndexFor(calcStandardWeight(age)));
                  setGewichtManual(false);
                }}>{t("Standaardgewicht", "Standard weight")}</button>
              )}
              {calcWeight && (
                <button type="button" className="zk-link" aria-pressed={showOverzichtskaart} onClick={() => setShowOverzichtskaart(v => !v)}>
                  {showOverzichtskaart ? t("Verberg overzicht", "Hide summary") : t("Overzicht", "Summary")}
                </button>
              )}
            </span>
          </div>
        </div>

        {isPrematuur && (
          <div className="zk-notice" data-neonaat-melding>
            <strong>Prematuur of neonaat ({kg(w)} kg).</strong> De doseringen hieronder zijn kale rekenwaarden per kilo. Ze zijn niet
            gecontroleerd voor deze groep. Overleg met de (kinder)anesthesioloog.
          </div>
        )}

        {/* Overzichtskaart: compacte samenvatting van kernwaarden per fase */}
        {showOverzichtskaart && calcWeight && (
          <Card>
            <SectionTitle>
              {t("Overzicht", "Summary")} — {AGE_ITEMS[calcLeeftijdIdx]?.label} · {WEIGHT_ITEMS[calcGewichtIdx]?.label}
            </SectionTitle>

            {/* Luchtweg */}
            {(hasAge || isPrematuur) && (
              <div style={{ marginBottom: "14px" }}>
                <div className="zk-cap" style={{ color: "#FFD60A" }}>{t("Luchtweg", "Airway")}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {[
                    { label: "ETT", waarde: tubeMaat, eenheid: "" },
                    { label: "Blad", waarde: tubeBlad, eenheid: "" },
                    { label: "Kapje", waarde: masker?.maat, eenheid: "" },
                    { label: "LMA", waarde: lma?.maat, eenheid: "" },
                  ].filter(x => x.waarde != null).map((x, i) => (
                    <div key={i} style={{ background: "rgba(118,118,128,0.24)", borderRadius: "8px", padding: "6px 10px" }}>
                      <span style={{ fontWeight: 600, color: "#FFD60A", fontSize: "15px" }}>{x.waarde}{x.eenheid}</span>
                      <span style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginLeft: "5px" }}>{x.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Medicatie per fase */}
            {OVERZICHT_MEDS.map((groep, gi) => (
              <div key={gi} style={{ marginBottom: gi < OVERZICHT_MEDS.length - 1 ? "14px" : 0 }}>
                <div className="zk-cap" style={{ color: groep.fase === "Nood" ? "#FF453A" : ACCENT }}>{t(groep.fase, groep.fase)}</div>
                {groep.items.map((it, ii) => (
                  <div key={ii} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "10px",
                    padding: "7px 0", borderBottom: ii < groep.items.length - 1 ? "0.5px solid rgba(84,84,88,0.65)" : "none",
                  }}>
                    <span style={{ fontSize: "15px", color: "rgba(235,235,245,0.86)" }}>
                      {it.naam}
                      {it.propPct && <span style={{ fontSize: "12px", color: "#FFD60A", marginLeft: "5px" }}>({it.propPct})</span>}
                      {it.minClamp && <span style={{ fontSize: "12px", color: "#FF9F0A", marginLeft: "5px" }}>⚠ minimum</span>}
                    </span>
                    <span style={{ textAlign: "right", flexShrink: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: "17px", color: groep.fase === "Nood" ? "#FF453A" : ACCENT }}>{it.dosisStr}</span>
                      <span style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginLeft: "3px" }}>{it.unit}</span>
                      {it.propMlStr && (
                        <span style={{ fontSize: "13px", color: "#FFD60A", fontWeight: 600, marginLeft: "6px" }}>
                          · {it.propMlStr} ml{it.propLabel && it.propLabel.includes("onderhoud") ? "/uur" : ""}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </Card>
        )}

        {/* ETT / Tube info */}
        {(hasAge || isPrematuur) && (
          <Collapse title={isPrematuur ? "Tube, sonde, blad & katheter (prematuur)" : "Tube, sonde, blad & katheter (op leeftijd)"} color="#FF9F0A" icon={Icons.tube}>
            {isPrematuur && (
              <div style={{ fontSize: "13px", color: "#FFD60A", marginBottom: "6px", fontWeight: 600 }}>
                Prematuur / neonaat {WEIGHT_ITEMS[calcGewichtIdx]?.label} — uncuffed, maten op gewicht
              </div>
            )}
            {[
              { label: "ETT maat", waarde: tubeMaat, eenheid: "" },
              { label: "ETT diepte", waarde: tubeDiepte, eenheid: "cm" },
              { label: "Laryngoscoopblad", waarde: tubeBlad, eenheid: "" },
              { label: "Maagsonde", waarde: tubeSonde, eenheid: "Fr" },
              { label: "Blaaskatheter", waarde: tubeKath, eenheid: "Ch" },
            ].filter(item => item.waarde != null).map((item, i) => (
              <ValueRow key={i} label={item.label} value={item.waarde} unit={item.eenheid} />
            ))}
          </Collapse>
        )}

        {/* Beademingskapje & LMA maten */}
        {hasAge && (
          <Collapse title="Beademingskapje & LMA" color="#BF5AF2" icon={Icons.wind}>
            <ValueRow label="Beademingskapje" sub={masker.label} value={`maat ${masker.maat}`} />
            <ValueRow label="LMA" sub={`${lma.label} · manchet max ${lma.maxVol}`} value={`maat ${lma.maat}`} />
            {/* Reference tabel masker */}
            <div style={{ marginTop: "16px" }}>
              <div className="zk-cap">Beademingskapje — alle maten</div>
              {MASKER_MATEN.map((m, i) => {
                const highlight = m === masker;
                return (
                  <div key={i} className={"zk-ref-row" + (highlight ? " is-on" : "")}>
                    <span>{m.label}</span>
                    <span style={{ fontWeight: highlight ? 600 : 400 }}>maat {m.maat}</span>
                  </div>
                );
              })}
            </div>
            {/* Reference tabel LMA */}
            <div style={{ marginTop: "14px" }}>
              <div className="zk-cap">LMA — alle maten</div>
              {LMA_MATEN.map((m, i) => {
                const highlight = m === lma;
                return (
                  <div key={i} className={"zk-ref-row" + (highlight ? " is-on" : "")}>
                    <span>{m.label}</span>
                    <span style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
                      <span style={{ fontWeight: highlight ? 600 : 400 }}>maat {m.maat}</span>
                      <span style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)" }}>{m.maxVol}</span>
                    </span>
                  </div>
                );
              })}
              <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginTop: "8px" }}>* Bij volwassenen: maat 4 (50–70 kg), maat 5 (70–100 kg), maat 6 (&gt;100 kg)</div>
            </div>
          </Collapse>
        )}

        {/* Vochtbeleid */}
        {calcWeight && (() => {
          // 4-2-1 regel (Holliday-Segar) onderhoudsvocht in ml/uur
          const w = calcWeight;
          let mlPerUur;
          let breakdown;
          if (w <= 10) {
            mlPerUur = 4 * w;
            breakdown = `4 × ${kg(w)} kg`;
          } else if (w <= 20) {
            mlPerUur = 40 + 2 * (w - 10);
            breakdown = `40 + 2 × ${(w - 10).toFixed(w % 1 ? 1 : 0)} kg`;
          } else {
            mlPerUur = 60 + 1 * (w - 20);
            breakdown = `60 + 1 × ${(w - 20).toFixed(w % 1 ? 1 : 0)} kg`;
          }
          const mlPerUurStr = mlPerUur < 10 ? mlPerUur.toFixed(1) : mlPerUur.toFixed(0);
          return (
            <Collapse title="Vochtbeleid" color="#0A84FF" icon={Icons.droplet}>
              <ValueRow label="Onderhoud 1e ½ uur" sub="10 ml/kg" value={(w * 10).toFixed(0)} unit="ml" />
              <ValueRow label="Vochtbolus" sub="10–20 ml/kg" value={`${(w * 10).toFixed(0)}–${(w * 20).toFixed(0)}`} unit="ml" />
              <ValueRow label="4-2-1 onderhoud" sub={`= ${breakdown}`} value={mlPerUurStr} unit="ml/uur" />
              <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginTop: "10px", lineHeight: 1.5 }}>
                4 ml/kg/u (0–10 kg) · +2 ml/kg/u (10–20 kg) · +1 ml/kg/u (&gt;20 kg)
              </div>
            </Collapse>
          );
        })()}

        {/* Medicatiedoseringen */}
        {calcWeight ? (
          Object.entries(categorieGroepen).map(([cat, meds]) => (
            <Card key={cat}>
              <SectionTitle color={cat === "Noodmedicatie" ? "#FF453A" : "#fff"}>{cat}</SectionTitle>
              {meds.map((m, i) => {
                const { dosisStr, altStr, minClamp, perKgStr, medKleur, propPct, propLabel, propMlStr, pompMlUurStr } = computeMedDosis(m, calcWeight, age, hasAge);
                const bronOpen = m.bron && openBronMed === m.med;
                return (
                  <div key={i} data-med={m.med} data-dose={dosisStr} data-unit={m.unit} style={{
                    padding: "10px 0 10px 10px",
                    borderBottom: i < meds.length - 1 ? "0.5px solid rgba(84,84,88,0.65)" : "none",
                    borderLeft: medKleur ? `4px solid ${medKleur.bg}` : "4px solid transparent",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: "#fff", fontSize: "16px", lineHeight: 1.25 }}>
                          {m.med}
                          {propPct && (
                            <span style={{
                              marginLeft: "6px", fontSize: "12px", fontWeight: 600, padding: "1px 6px", borderRadius: "6px",
                              background: "rgba(255,214,10,0.2)", color: "#FFD60A",
                            }}>{propPct}</span>
                          )}
                        </div>
                        <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", marginTop: "2px" }}>
                          {m.range}
                          {propPct && <span> · {propLabel}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, maxWidth: "46%" }}>
                        <span style={{ fontWeight: 600, fontSize: "20px", color: cat === "Noodmedicatie" ? "#FF453A" : "#30D158" }}>{dosisStr}</span>
                        <span style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", marginLeft: "3px" }}>{m.unit}</span>
                        {altStr && (
                          <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.8)", marginTop: "1px" }}>= {altStr}</div>
                        )}
                        {propMlStr && (
                          <div style={{ fontSize: "13px", color: "#FFD60A", fontWeight: 600, marginTop: "2px" }}>
                            {propMlStr} <span style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", fontWeight: 400 }}>ml{m.perUur ? "/uur" : ""}</span>
                          </div>
                        )}
                        {pompMlUurStr && (
                          <div style={{ fontSize: "13px", color: "#FFD60A", fontWeight: 600, marginTop: "2px" }}>
                            {pompMlUurStr} <span style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", fontWeight: 400 }}>ml/uur (bij {m.pompConc} {m.unit.split("/")[0]}/ml)</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {minClamp && (
                      <div className="zk-warn" data-atropine-waarschuwing>
                        Het minimum van 0,1 mg is toegepast. Dat is {perKgStr} mg/kg bij dit gewicht; de rekenregel is 0,02 mg/kg.
                        Onder 5 kg is dit minimum omstreden. Overleg met de anesthesioloog.
                      </div>
                    )}
                    {m.bron && (
                      <button type="button" className="zk-bron-btn" aria-expanded={bronOpen} onClick={() => setOpenBronMed(bronOpen ? null : m.med)}>
                        {m.bron.status} Bron {bronOpen ? "verbergen" : "tonen"}
                      </button>
                    )}
                    {bronOpen && (
                      <div style={{
                        fontSize: "13px", color: "rgba(235,235,245,0.8)", marginTop: "6px", padding: "8px 10px", lineHeight: 1.4,
                        background: "rgba(118,118,128,0.24)", borderRadius: "8px",
                      }}>
                        {m.bron.tekst}
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          ))
        ) : (
          <div className="zk-empty">
            {t("Selecteer leeftijd om doseringen te berekenen", "Select age to calculate doses")}
          </div>
        )}
      </div>
    );
  };

  const renderDermatomen = () => (
    <div>
      <Collapse title="Anatomische kaart" color="#FF9F0A" icon={Icons.anatomy}>
        <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.45)", marginBottom: "10px" }}>
          Tik op de afbeelding om te vergroten
        </div>
        <div style={{
          borderRadius: "10px",
          overflow: "hidden",
          border: "0.5px solid rgba(84,84,88,0.65)",
          cursor: "pointer",
        }}
          onClick={(e) => {
            const img = e.currentTarget.querySelector('img');
            if (img.style.maxHeight === 'none') {
              img.style.maxHeight = '400px';
              img.style.objectFit = 'cover';
            } else {
              img.style.maxHeight = 'none';
              img.style.objectFit = 'contain';
            }
          }}
        >
          <img src={IMG_DERMATOMEN} alt="Dermatomen zenuwblokkade" style={{
            width: "100%",
            maxHeight: "400px",
            objectFit: "cover",
            objectPosition: "top",
            display: "block",
            transition: "max-height 0.3s ease",
          }} />
        </div>
      </Collapse>
      <Collapse title="Dermatoom-landmarks" color="#FF9F0A" icon={Icons.anatomy}>
        <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.45)", marginBottom: "12px" }}>
          Klinische oriëntatiepunten per dermatoomniveau
        </div>
        {DERMATOOM_LANDMARKS.map((d, i) => (
          <div key={i} style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 0",
            borderBottom: "0.5px solid rgba(84,84,88,0.65)",
          }}>
            <span style={{
              fontFamily: "inherit",
              fontWeight: 700,
              color: d.kleur,
              minWidth: "52px",
              fontSize: "14px",
            }}>{d.niveau}</span>
            <span style={{ color: "rgba(235,235,245,0.8)", fontSize: "14px" }}>{d.landmark}</span>
          </div>
        ))}
      </Collapse>

      {ZENUWBLOKKADES.map((cat, i) => (
        <Card key={i}>
          <SectionTitle color={cat.kleur}>{cat.categorie}</SectionTitle>
          {cat.blokkades.map((b, j) => (
            <div key={j} style={{
              marginBottom: j < cat.blokkades.length - 1 ? "14px" : 0,
              paddingBottom: j < cat.blokkades.length - 1 ? "14px" : 0,
              borderBottom: j < cat.blokkades.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                <span style={{ fontWeight: 700, color: "#fff", fontSize: "15px" }}>{b.naam}</span>
                <span style={{
                  fontFamily: "inherit",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: cat.kleur,
                  background: `${cat.kleur}15`,
                  padding: "2px 8px",
                  borderRadius: "6px",
                  flexShrink: 0,
                  marginLeft: "8px",
                }}>{b.dermatomen}</span>
              </div>
              <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", marginBottom: "2px" }}>
                {b.zenuw}
              </div>
              <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", marginBottom: "4px" }}>
                Gebied: {b.gebied}
              </div>
              <div style={{
                fontSize: "13px",
                color: "#FFD60A",
                background: "rgba(255,214,10,0.06)",
                padding: "4px 8px",
                borderRadius: "6px",
                display: "inline-block",
              }}>
                💡 {b.tip}
              </div>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );

  const renderVaatstelsel = () => (
    <div>
      <Collapse title="Anatomische kaart" color="#FF453A" icon={Icons.anatomy}>
        <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.45)", marginBottom: "10px" }}>
          Tik op de afbeelding om te vergroten
        </div>
        <div style={{
          borderRadius: "10px",
          overflow: "hidden",
          border: "0.5px solid rgba(84,84,88,0.65)",
          cursor: "pointer",
        }}
          onClick={(e) => {
            const img = e.currentTarget.querySelector('img');
            if (img.style.maxHeight === 'none') {
              img.style.maxHeight = '400px';
              img.style.objectFit = 'cover';
            } else {
              img.style.maxHeight = 'none';
              img.style.objectFit = 'contain';
            }
          }}
        >
          <img src={IMG_VAATSTELSEL} alt="Vaatstelsel" style={{
            width: "100%",
            maxHeight: "400px",
            objectFit: "cover",
            objectPosition: "top",
            display: "block",
            transition: "max-height 0.3s ease",
          }} />
        </div>
      </Collapse>
      {VAATSTELSEL.map((cat, i) => (
        <Card key={i}>
          <SectionTitle color={cat.kleur}>{cat.categorie}</SectionTitle>
          {cat.vaten.map((v, j) => (
            <div key={j} style={{
              padding: "8px 0",
              borderBottom: j < cat.vaten.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "2px" }}>
                <span style={{ fontWeight: 700, color: "#fff", fontSize: "15px" }}>{v.naam}</span>
                <span style={{ fontSize: "13px", color: "rgba(235,235,245,0.45)" }}>{v.vertakking}</span>
              </div>
              <div style={{
                fontSize: "13px",
                color: cat.kleur === "#FF453A" ? "#FF453A" : "#0A84FF",
                opacity: 0.8,
              }}>
                {v.klinisch}
              </div>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );

  const renderPlattegrond = () => {
    const tabs = [
      { id: "amc", label: "AUMC, locatie AMC" },
      { id: "vumc", label: "AUMC, locatie VU" },
    ];

    const zoekTerm = plattegrondZoek.toLowerCase().trim();
    const gefilterdeAMCBouwdelen = zoekTerm
      ? AMC_BOUWDELEN.filter(bd =>
          bd.afdelingen.some(afd => afd.toLowerCase().includes(zoekTerm)) ||
          bd.bouwdeel.toLowerCase().includes(zoekTerm) ||
          bd.omschrijving.toLowerCase().includes(zoekTerm)
        )
      : AMC_BOUWDELEN;

    return (
      <div>
        {/* Zoekbalk */}
        <div className="zk-search" style={{ marginTop: 0, marginBottom: "12px" }}>
          {Icons.search}
          <input
            type="search"
            placeholder="Zoek afdeling of bouwdeel"
            aria-label="Zoek afdeling of bouwdeel"
            value={plattegrondZoek}
            onChange={e => setPlattegrondZoek(e.target.value)}
          />
          {plattegrondZoek && (
            <button type="button" className="zk-search-clear" aria-label="Zoekveld leegmaken" onClick={() => setPlattegrondZoek("")}><span>✕</span></button>
          )}
        </div>
        {/* Zoekresultaten */}
        {zoekTerm && (
          <div style={{ marginBottom: "12px" }}>
            {gefilterdeAMCBouwdelen.length === 0 ? (
              <div style={{ color: "rgba(235,235,245,0.6)", fontSize: "14px", padding: "8px" }}>Geen resultaten gevonden.</div>
            ) : (
              gefilterdeAMCBouwdelen.map((bd, i) => (
                <div key={i} style={{
                  background: `${bd.kleur}15`,
                  border: `1px solid ${bd.kleur}40`,
                  borderRadius: "10px",
                  padding: "10px 14px",
                  marginBottom: "8px",
                }}>
                  <div style={{ fontWeight: 700, color: bd.kleur, fontSize: "14px", marginBottom: "4px" }}>
                    Bouwdeel {bd.bouwdeel} — {bd.omschrijving}
                  </div>
                  {bd.afdelingen.filter(afd => !zoekTerm || afd.toLowerCase().includes(zoekTerm)).map((afd, j) => (
                    <div key={j} style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", padding: "2px 0 2px 10px" }}>· {afd}</div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
        {/* Tab switcher */}
        <div className="zk-seg" role="group" aria-label="Locatie plattegrond" style={{ marginBottom: "14px" }}>
          {tabs.map(tab => (
            <button key={tab.id} type="button" className={plattegrondTab === tab.id ? "is-on" : ""} aria-pressed={plattegrondTab === tab.id} onClick={() => setPlattegrondTab(tab.id)}>{tab.label}</button>
          ))}
        </div>

        {plattegrondTab === "amc" && (
          <>
            <ImageCard
              src={IMG_AMC_CAMPUS}
              alt="AUMC, locatie AMC campus overzicht"
              beschrijving="Campus overzicht — bouwdelen A t/m M, Q"
            />
            <ImageCard
              src={IMG_AMC_PLATTEGROND}
              alt="AUMC, locatie AMC plattegrond begane grond"
              beschrijving="Begane grond — poliklinieken, routes, voorzieningen"
            />
            <Collapse title="Codering AUMC, locatie AMC" color="#40C8E0" icon={Icons.map}>
              <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
                Alle ruimten worden aangeduid als <strong style={{ color: "#40C8E0", fontFamily: "inherit" }}>H8-314</strong> = bouwdeel H, 8e verdieping, kamer 314.
              </div>
              <div style={{ marginTop: "10px", fontSize: "14px", color: "rgba(235,235,245,0.6)", lineHeight: 1.6 }}>
                Verpleegafdelingen & Emma Kinderziekenhuis: lift bij F, G of H.
                Dagcentrum: bouwdeel D. OK-complex: boven bouwdeel C/D.
              </div>
            </Collapse>
            <Collapse title="Ingangen AUMC, locatie AMC" color="#40C8E0" icon={Icons.map}>
              {[
                { nr: "1", naam: "Hoofdingang", locatie: "Meibergdreef (bij P1)" },
                { nr: "2", naam: "Ingang Oost", locatie: "Faculteit (bij P4)" },
                { nr: "3", naam: "Ingang West", locatie: "Parkeergarage P2" },
                { nr: "4", naam: "SEH / HAP", locatie: "Spoedeisende Hulp & Huisartsenpost" },
                { nr: "5", naam: "Ingang APC", locatie: "Academisch Psychiatrisch Centrum" },
                { nr: "6", naam: "Ingang Dianet", locatie: "Dialyse" },
              ].map((item, i) => (
                <div key={i} style={{
                  display: "flex",
                  gap: "10px",
                  padding: "6px 0",
                  borderBottom: "0.5px solid rgba(84,84,88,0.65)",
                  alignItems: "baseline",
                }}>
                  <span style={{
                    fontFamily: "inherit",
                    fontWeight: 700,
                    color: "#40C8E0",
                    minWidth: "20px",
                  }}>{item.nr}</span>
                  <div>
                    <span style={{ fontWeight: 600, color: "#fff", fontSize: "15px" }}>{item.naam}</span>
                    <span style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", marginLeft: "6px" }}>{item.locatie}</span>
                  </div>
                </div>
              ))}
            </Collapse>
            {(zoekTerm ? [] : AMC_BOUWDELEN).map((bd, i) => (
              <Collapse key={i} title={`Bouwdeel ${bd.bouwdeel}`} color={bd.kleur} icon={Icons.map}>
                <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", marginBottom: "8px", fontStyle: "italic" }}>{bd.omschrijving}</div>
                {bd.afdelingen.map((afd, j) => (
                  <div key={j} style={{
                    fontSize: "14px",
                    color: "rgba(235,235,245,0.8)",
                    padding: "4px 0 4px 14px",
                    position: "relative",
                    borderBottom: j < bd.afdelingen.length - 1 ? "1px solid rgba(118,118,128,0.18)" : "none",
                  }}>
                    <span style={{ position: "absolute", left: 0, color: bd.kleur }}>·</span>{afd}
                  </div>
                ))}
              </Collapse>
            ))}
          </>
        )}

        {plattegrondTab === "vumc" && (
          <>
            <ImageCard
              src={IMG_VUMC_CAMPUS}
              alt="AUMC, locatie VU campus overzicht"
              beschrijving="Campus overzicht — bouwdelen A t/m Z, ACTA, Imaging Center"
            />
            <Collapse title="Ingangen AUMC, locatie VU" color="#40C8E0" icon={Icons.map}>
              {[
                { nr: "1", naam: "Ingang Ziekenhuis", locatie: "De Boelelaan 1117 + UHP" },
                { nr: "2", naam: "Ingang Poliklinieken", locatie: "De Boelelaan 1118" },
                { nr: "3", naam: "Ingang P1", locatie: "Vanuit parkeergarage" },
                { nr: "4", naam: "Gastenverblijf", locatie: "AUMC, locatie VU" },
                { nr: "5", naam: "SSO", locatie: "Specialistische Spoed Opvang" },
                { nr: "6", naam: "GGZ inGeest", locatie: "" },
                { nr: "7", naam: "IVF-centrum", locatie: "" },
                { nr: "8", naam: "Imaging Center", locatie: "" },
              ].map((item, i) => (
                <div key={i} style={{
                  display: "flex",
                  gap: "10px",
                  padding: "6px 0",
                  borderBottom: "0.5px solid rgba(84,84,88,0.65)",
                  alignItems: "baseline",
                }}>
                  <span style={{
                    fontFamily: "inherit",
                    fontWeight: 700,
                    color: "#40C8E0",
                    minWidth: "20px",
                  }}>{item.nr}</span>
                  <div>
                    <span style={{ fontWeight: 600, color: "#fff", fontSize: "15px" }}>{item.naam}</span>
                    {item.locatie && <span style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", marginLeft: "6px" }}>{item.locatie}</span>}
                  </div>
                </div>
              ))}
            </Collapse>
            <Collapse title="Gebouwen AUMC, locatie VU" color="#40C8E0" icon={Icons.map}>
              <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
                Ziekenhuisgebouw en polikliniekgebouw zijn verbonden door een brug. OK's: 6e etage (6A). Dagcentrum OK's: 2e etage.
              </div>
            </Collapse>
          </>
        )}
      </div>
    );
  };

  const renderRooster = () => (
    <div>
      {/* Snelle toegang */}
      <Collapse title="Snelle toegang OWS" color="#BF5AF2" defaultOpen={true} icon={Icons.calendar}>
        <div style={{
          background: "linear-gradient(135deg, rgba(191,90,242,0.12) 0%, rgba(191,90,242,0.04) 100%)",
          border: "1px solid rgba(191,90,242,0.3)",
          borderRadius: "12px",
          padding: "14px",
          marginBottom: "12px",
        }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "#BF5AF2", fontWeight: 700, marginBottom: "6px" }}>Web</div>
          <a href="https://mijnrooster.amsterdamumc.nl/" target="_blank" rel="noopener" style={{
            color: "#fff", fontSize: "15px", fontFamily: "inherit", textDecoration: "none",
            display: "block", marginBottom: "12px",
          }}>mijnrooster.amsterdamumc.nl ↗</a>

          <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "#BF5AF2", fontWeight: 700, marginBottom: "6px" }}>App</div>
          <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", marginBottom: "4px" }}>Ortec ESS 7 <span style={{ color: "rgba(235,235,245,0.45)" }}>(App Store / Play Store)</span></div>
          <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", marginBottom: "12px" }}>Toegangscode: <span style={{ fontFamily: "inherit", color: "#fff", background: "rgba(191,90,242,0.25)", padding: "2px 8px", borderRadius: "4px", fontWeight: 700 }}>AUMCP</span></div>

          <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "#BF5AF2", fontWeight: 700, marginBottom: "6px" }}>Code prefix</div>
          <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)" }}>
            <span style={{ color: "#fff", fontWeight: 700 }}>M</span> = Meibergdreef (AMC) · <span style={{ color: "#fff", fontWeight: 700 }}>B</span> = Boelelaan (VU)
          </div>
        </div>
      </Collapse>

      {/* Voorkeur vs Verlof */}
      <Collapse title="Voorkeur vs Verlof" color="#FF453A" defaultOpen={true} icon={Icons.calendar}>
        <div style={{ fontSize: "13px", color: "#FF453A", fontStyle: "italic", marginBottom: "10px" }}>
          Cruciaal onderscheid — wil je zéker vrij zijn, vraag dan altijd VERLOF aan, geen voorkeur.
        </div>

        <div style={{
          background: "rgba(10,132,255,0.08)",
          border: "1px solid rgba(10,132,255,0.3)",
          borderLeft: "4px solid #0A84FF",
          borderRadius: "10px",
          padding: "12px",
          marginBottom: "10px",
        }}>
          <div style={{ fontWeight: 700, color: "#0A84FF", fontSize: "15px", marginBottom: "8px" }}>📝 Voorkeur</div>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
            <li>Verzoek aan roostermaker — <strong style={{ color: "#fff" }}>geen garantie</strong></li>
            <li>Voor "wel/niet werken op datum X"</li>
            <li>Max 3 werkdagen aaneen "niet werken"</li>
            <li>Verwerkt ~3 mnd vóór roosteruitgave</li>
            <li>Leidinggevende ziet dit niet</li>
          </ul>
        </div>

        <div style={{
          background: "rgba(48,209,88,0.08)",
          border: "1px solid rgba(48,209,88,0.3)",
          borderLeft: "4px solid #30D158",
          borderRadius: "10px",
          padding: "12px",
        }}>
          <div style={{ fontWeight: 700, color: "#30D158", fontSize: "15px", marginBottom: "8px" }}>🏖 Verlof</div>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
            <li>Aanvraag aan leidinggevende — <strong style={{ color: "#fff" }}>beoordeeld & goedgekeurd</strong></li>
            <li>Voor gegarandeerd vrij zijn (vakantie)</li>
            <li>Roostermakers plannen daarna VA-dagen in</li>
          </ul>
        </div>
      </Collapse>

      {/* Vakantie-deadlines */}
      <Collapse title="Vakantie-aanvraag deadlines" color="#FF9F0A" defaultOpen={true} icon={Icons.calendar}>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginBottom: "12px", lineHeight: 1.5, fontStyle: "italic" }}>
          Indienen vóór de deadline — anders niet gegarandeerd.
        </div>
        {[
          { maanden: "juni / juli / aug / sept", deadline: "1 december", kleur: "#FF9F0A" },
          { maanden: "okt / nov / dec / jan", deadline: "1 mei", kleur: "#0A84FF" },
          { maanden: "feb / mrt / apr / mei", deadline: "1 september", kleur: "#30D158" },
        ].map((v, i) => (
          <div key={i} style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: "10px",
            alignItems: "center",
            padding: "10px 12px",
            marginBottom: "8px",
            background: `${v.kleur}10`,
            border: `1px solid ${v.kleur}30`,
            borderLeft: `4px solid ${v.kleur}`,
            borderRadius: "10px",
          }}>
            <div>
              <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", textTransform: "uppercase", letterSpacing: "0.3px", marginBottom: "2px" }}>Vakantie in</div>
              <div style={{ fontSize: "14px", color: "#fff", fontWeight: 600 }}>{v.maanden}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.6)", textTransform: "uppercase", letterSpacing: "0.3px" }}>Deadline</div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: v.kleur, fontFamily: "inherit" }}>{v.deadline}</div>
            </div>
          </div>
        ))}
      </Collapse>

      {/* Zelfroosteren */}
      <Collapse title="Zelfroosteren (vanaf augustus 2026)" color="#63E6E2" icon={Icons.calendar}>
        <div style={{
          background: "rgba(99,230,226,0.08)",
          border: "1px solid rgba(99,230,226,0.3)",
          borderLeft: "4px solid #63E6E2",
          borderRadius: "10px",
          padding: "12px",
          marginBottom: "10px",
        }}>
          <div style={{ fontSize: "14px", color: "#fff", marginBottom: "8px", lineHeight: 1.5 }}>
            <strong style={{ color: "#63E6E2" }}>Zelfroosteren vervangt dienstwensen.</strong> Eerste rooster: <strong>augustus 2026</strong>.
          </div>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
            <li>Per ronde een periode openstellen — communicatie via Outlook-agenda</li>
            <li>Vul je gewenste diensten in via app of mijnrooster.amsterdamumc.nl</li>
            <li>Je ziet hoeveel collega's zich al hebben aangemeld voor een dienst</li>
            <li>Alleen diensten passend bij jouw functieprofiel & kwalificaties zichtbaar</li>
            <li>Roosteraars maken het rooster kloppend, met oog op eerlijke verdeling</li>
            <li>Verlofaanvragen blijven gelijk (apart van zelfroosteren)</li>
          </ul>
        </div>
      </Collapse>

      {/* Jokers */}
      <Collapse title="Jokers — extra zwaarwegende wensen" color="#FF375F" icon={Icons.calendar}>
        <div style={{
          background: "linear-gradient(135deg, rgba(233,30,99,0.12) 0%, rgba(233,30,99,0.03) 100%)",
          border: "1px solid rgba(233,30,99,0.3)",
          borderRadius: "12px",
          padding: "14px",
          marginBottom: "10px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
            <div style={{
              background: "#FF375F", color: "#fff", width: "40px", height: "40px",
              borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "22px", fontWeight: 700,
            }}>3</div>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff" }}>jokers per AMW per maand</div>
              <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)" }}>Niet overdraagbaar</div>
            </div>
          </div>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
            <li>Markeer een dienstwens of vrije dag die <strong style={{ color: "#fff" }}>echt belangrijk</strong> is</li>
            <li>Roosteraars wegen deze zwaarder mee — geen garantie</li>
            <li>Serie nachtdiensten: joker bij start = geldt voor hele reeks</li>
            <li>Joker op zaterdag = geldt voor hele weekend</li>
          </ul>
        </div>
      </Collapse>

      {/* ATW */}
      <Collapse title="ATW — arbeidstijdenwet regels" color="#FFD60A" icon={Icons.book}>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginBottom: "12px", lineHeight: 1.5, fontStyle: "italic" }}>
          Vertaling naar AUMC roostercodes. Het ziekenhuis kan boetes krijgen bij schending.
        </div>

        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "#FFD60A", fontWeight: 700, marginBottom: "6px", borderBottom: "1px solid rgba(255,214,10,0.3)", paddingBottom: "4px" }}>
            Arbeidstijd
          </div>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
            <li>Max <strong style={{ color: "#fff" }}>12 uur per dienst</strong></li>
            <li>Max <strong style={{ color: "#fff" }}>60 uur per week</strong> (ma t/m zo)</li>
            <li>Bij 9 uur/dag → max 6 dagen/week = 54 uur</li>
          </ul>
        </div>

        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "#FFD60A", fontWeight: 700, marginBottom: "6px", borderBottom: "1px solid rgba(255,214,10,0.3)", paddingBottom: "4px" }}>
            Dagelijkse rust
          </div>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
            <li>Norm: <strong style={{ color: "#fff" }}>11 uur</strong> aaneengesloten tussen 2 diensten</li>
            <li>1× per week mag <strong style={{ color: "#fff" }}>8 uur</strong> (bv. avond tot 23:00 → start volgende dag 7:00)</li>
            <li>Dagdienst na avonddienst: standaard niet gewenst, ruilen mag</li>
          </ul>
        </div>

        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "#FFD60A", fontWeight: 700, marginBottom: "6px", borderBottom: "1px solid rgba(255,214,10,0.3)", paddingBottom: "4px" }}>
            Nachtarbeid
          </div>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
            <li>Na <strong style={{ color: "#fff" }}>1 nachtdienst</strong> → 14 uur rust (uitzondering: min 8 uur)</li>
            <li>Na <strong style={{ color: "#fff" }}>3 nachtdiensten</strong> → 46 uur rust</li>
            <li><strong style={{ color: "#FF453A" }}>BD na A1: NIET toegestaan</strong> (7u45min rust)</li>
            <li><strong style={{ color: "#30D158" }}>D1 na A1: WEL toegestaan</strong> (8 uur rust)</li>
          </ul>
        </div>

        <div style={{
          background: "rgba(255,214,10,0.08)",
          border: "1px solid rgba(255,214,10,0.3)",
          borderRadius: "8px",
          padding: "10px",
          fontSize: "13px",
          color: "rgba(235,235,245,0.8)",
          lineHeight: 1.5,
        }}>
          📅 <strong style={{ color: "#FFD60A" }}>Minimaal 22 vrije weekenden per jaar.</strong> Eén dag in het weekend werken = telt al als gewerkt weekend.
        </div>
      </Collapse>

      {/* Onderling ruilen */}
      <Collapse title="Onderling ruilen via OWS" color="#0A84FF" icon={Icons.calendar}>
        <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
          <li>Ruilen kan zelf via OWS — niet meer via roosteraars (behalve 3-hoeksruil)</li>
          <li>Collega moet voldoen aan <strong style={{ color: "#fff" }}>functieprofiel, kwalificaties, ATW & cao</strong></li>
          <li>AMW ↔ SPS'er: alleen als SPS'er die dag een anesthesiedag heeft</li>
        </ul>
        <div style={{
          marginTop: "12px",
          background: "rgba(255,69,58,0.08)",
          border: "1px solid rgba(255,69,58,0.3)",
          borderLeft: "4px solid #FF453A",
          borderRadius: "8px",
          padding: "10px",
          fontSize: "13px",
          color: "rgba(235,235,245,0.8)",
          lineHeight: 1.5,
        }}>
          ⚠ <strong style={{ color: "#FF453A" }}>Ruiling &lt;1 dag tevoren</strong> (of vrijdag voor weekend/maandag): <strong style={{ color: "#fff" }}>meld de dagcoördinatie zelf</strong> i.v.m. EPIC-indeling.
        </div>
      </Collapse>

      {/* Roostercodes per groep */}
      {ROOSTER_GROEPEN.map((groep, gi) => (
        <Collapse key={gi} title={groep.naam} color={groep.kleur} icon={Icons.calendar}>
          <div style={{ overflowX: "auto" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 0.7fr) minmax(0, 0.7fr)",
              gap: "4px",
              padding: "8px 0",
              borderBottom: "0.5px solid rgba(84,84,88,0.65)",
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.3px",
              color: "rgba(235,235,245,0.45)",
              fontWeight: 700,
            }}>
              <div>Dienst</div>
              <div style={{ textAlign: "center" }}>AMC</div>
              <div style={{ textAlign: "center" }}>VU</div>
            </div>
            {groep.codes.map((c, i) => (
              <div key={i} style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 0.7fr) minmax(0, 0.7fr)",
                gap: "4px",
                padding: "8px 4px",
                borderBottom: i < groep.codes.length - 1 ? "1px solid rgba(118,118,128,0.18)" : "none",
                borderLeft: `4px solid ${groep.kleur}`,
                paddingLeft: "8px",
                alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: "13px", color: "#fff", fontWeight: 600, lineHeight: 1.3 }}>{c.naam}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "inherit", fontSize: "13px", color: groep.kleur, fontWeight: 700 }}>{c.amc}</div>
                  <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.45)" }}>{c.tijdAMC}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "inherit", fontSize: "13px", color: groep.kleur, fontWeight: 700 }}>{c.vu}</div>
                  <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.45)" }}>{c.tijdVU}</div>
                </div>
              </div>
            ))}
          </div>
        </Collapse>
      ))}

      {/* Studenten */}
      <Collapse title="Studenten / leerlingen" color="#40C8E0" icon={Icons.users}>
        <div style={{ overflowX: "auto" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 0.7fr) minmax(0, 0.7fr)",
            gap: "4px",
            padding: "8px 0",
            borderBottom: "0.5px solid rgba(84,84,88,0.65)",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.3px",
            color: "rgba(235,235,245,0.45)",
            fontWeight: 700,
          }}>
            <div>Dienst</div>
            <div style={{ textAlign: "center" }}>AMC</div>
            <div style={{ textAlign: "center" }}>VU</div>
          </div>
          {ROOSTER_STUDENT.map((c, i) => (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 0.7fr) minmax(0, 0.7fr)",
              gap: "4px",
              padding: "8px 4px",
              borderBottom: i < ROOSTER_STUDENT.length - 1 ? "1px solid rgba(118,118,128,0.18)" : "none",
              borderLeft: "4px solid #40C8E0",
              paddingLeft: "8px",
              alignItems: "center",
            }}>
              <div style={{ fontSize: "13px", color: "#fff", fontWeight: 600, lineHeight: 1.3 }}>{c.naam}</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "inherit", fontSize: "13px", color: "#40C8E0", fontWeight: 700 }}>{c.amc}</div>
                <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.45)" }}>{c.tijdAMC}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "inherit", fontSize: "13px", color: "#40C8E0", fontWeight: 700 }}>{c.vu}</div>
                <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.45)" }}>{c.tijdVU}</div>
              </div>
            </div>
          ))}
        </div>
      </Collapse>

      {/* Diensttoeslagen */}
      <Collapse title="Diensttoeslagen (CAO-codes)" color="#FFD60A" icon={Icons.calc}>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginBottom: "10px", lineHeight: 1.5 }}>
          Codes die je terugziet in je rooster of jaarurenkaart.
        </div>
        {DIENST_TOESLAGEN.map((t, i) => (
          <div key={i} style={{
            display: "grid",
            gridTemplateColumns: "70px minmax(0, 1fr)",
            gap: "10px",
            padding: "8px 0",
            borderBottom: i < DIENST_TOESLAGEN.length - 1 ? "1px solid rgba(118,118,128,0.18)" : "none",
            alignItems: "start",
          }}>
            <div style={{
              fontFamily: "inherit",
              fontSize: "13px",
              fontWeight: 700,
              color: "#FFD60A",
              background: "rgba(255,214,10,0.12)",
              padding: "4px 6px",
              borderRadius: "4px",
              textAlign: "center",
            }}>{t.code}</div>
            <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.4, paddingTop: "4px" }}>{t.uitleg}</div>
          </div>
        ))}
      </Collapse>

      {/* Balansverlof */}
      <Collapse title="Balansverlof" color="#40C8E0" icon={Icons.calc}>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginBottom: "12px", lineHeight: 1.5, fontStyle: "italic" }}>
          Verlofuren sparen zonder vervaltermijn — voor je werk-privé balans.
        </div>

        <div style={{
          background: "rgba(64,200,224,0.08)",
          border: "1px solid rgba(64,200,224,0.3)",
          borderLeft: "4px solid #40C8E0",
          borderRadius: "10px",
          padding: "12px",
          marginBottom: "10px",
        }}>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
            <li>Sparen tot <strong style={{ color: "#fff" }}>max 100× je weekuren</strong> (36 u → 3600 u)</li>
            <li><strong style={{ color: "#fff" }}>Verjaart NIET</strong> — i.t.t. wettelijk (1,5 jr) / bovenwettelijk (5 jr)</li>
            <li>Opnemen alleen in overleg met leidinggevende</li>
          </ul>
        </div>

        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "#40C8E0", fontWeight: 700, marginBottom: "8px", borderBottom: "1px solid rgba(64,200,224,0.3)", paddingBottom: "4px" }}>
            📅 Koopperiodes (in MijnHR)
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
            gap: "6px",
            fontSize: "13px",
            color: "rgba(235,235,245,0.8)",
          }}>
            <div style={{ fontWeight: 600, color: "#fff" }}>Vakantietoeslag</div>
            <div style={{ fontFamily: "inherit", color: "#40C8E0" }}>18 april – 8 mei</div>
            <div style={{ fontWeight: 600, color: "#fff" }}>Eindejaarsuitkering</div>
            <div style={{ fontFamily: "inherit", color: "#40C8E0" }}>17 okt – 8 nov</div>
          </div>
        </div>

        <div style={{
          background: "rgba(255,214,10,0.08)",
          border: "1px solid rgba(255,214,10,0.3)",
          borderLeft: "4px solid #FFD60A",
          borderRadius: "8px",
          padding: "10px",
          fontSize: "13px",
          color: "rgba(235,235,245,0.8)",
          lineHeight: 1.5,
          marginBottom: "10px",
        }}>
          ⚠ <strong style={{ color: "#FFD60A" }}>Pensioenwaarschuwing:</strong> max <strong style={{ color: "#fff" }}>10% van bruto jaaruren</strong> kopen per jaar — anders lagere pensioenopbouw met terugwerkende kracht.
        </div>

        <div style={{
          background: "rgba(255,69,58,0.08)",
          border: "1px solid rgba(255,69,58,0.3)",
          borderLeft: "4px solid #FF453A",
          borderRadius: "8px",
          padding: "10px",
          fontSize: "13px",
          color: "rgba(235,235,245,0.8)",
          lineHeight: 1.5,
        }}>
          🚫 <strong style={{ color: "#FF453A" }}>Bij pensionering niet uit te betalen</strong> — wel inzetbaar vóór pensioen. Bij uitdiensttreding (anders dan pensioen): wél uit te betalen.
        </div>

        <div style={{ fontSize: "11px", color: "rgba(235,235,245,0.45)", marginTop: "10px", textAlign: "right", fontStyle: "italic" }}>
          Volledige uitleg: K2 iProva → "Balansverlof"
        </div>
      </Collapse>

      {/* Tips */}
      <Collapse title="Tips & contact" color="#0A84FF" icon={Icons.phone}>
        <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
          <li><strong style={{ color: "#fff" }}>Periode invoeren:</strong> 1<sup>e</sup> t/m laatste dag van de maand (niet 1<sup>e</sup> tot 1<sup>e</sup>)</li>
          <li><strong style={{ color: "#fff" }}>Jaarurenkaart</strong> = voorheen "moederkaart" — real-time saldo</li>
          <li>Uitwisselaars: één rooster (niet meer twee)</li>
          <li>Help nodig? Roosteraars: <strong style={{ color: "#fff" }}>Mirjam, Harjan, Michael, Leendert, Esther</strong></li>
        </ul>
      </Collapse>
    </div>
  );

  const renderBuizen = () => (
    <div>
      <Collapse title="Buissoorten AUMC, locatie AMC — CDL" color="#FF453A" defaultOpen={true} icon={Icons.tube}>
        <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.45)", marginBottom: "10px" }}>
          Tik op de dop voor een afbeelding · AUMC, locatie AMC
        </div>
        {BUISSOORTEN.map((buis, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: "10px",
            padding: "9px 0",
            borderBottom: i < BUISSOORTEN.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
          }}>
            <button onClick={() => setSelectedBuis(buis)} style={{
              width: "44px", height: "44px", borderRadius: "10px", background: buis.dopKleur,
              flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: "1px",
              fontSize: "11px", fontWeight: 700, color: buis.dopTekst,
              border: "2px solid rgba(255,255,255,0.2)", cursor: "pointer", fontFamily: "inherit",
            }}>
              <span>{buis.code}</span>
              <span style={{ fontSize: "11px", opacity: 0.7 }}>🔍</span>
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "#fff", fontSize: "14px" }}>{buis.kenmerk}</div>
              <div style={{ fontSize: "13px", color: "#0A84FF", marginTop: "2px" }}>{buis.doel}</div>
              <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", marginTop: "1px" }}>
                {buis.anticoagulans !== "—" && <span style={{ color: "rgba(235,235,245,0.6)" }}>{buis.anticoagulans} · </span>}
                <span>{buis.volume}</span>
                {buis.bestelnr !== "—" && <span style={{ color: "rgba(235,235,245,0.45)" }}> · #{buis.bestelnr}</span>}
              </div>
              {buis.opmerking && (
                <div style={{ fontSize: "12px", color: "#FFD60A", marginTop: "2px" }}>⚠ {buis.opmerking}</div>
              )}
            </div>
          </div>
        ))}
      </Collapse>

      <Collapse title="Niet versturen via buizenpost" color="#FF453A" icon={Icons.alert}>
        {NIET_BUIZENPOST.map((item, i) => (
          <div key={i} style={{
            fontSize: "14px", color: "rgba(235,235,245,0.8)",
            padding: "6px 0 6px 16px", position: "relative",
            borderBottom: i < NIET_BUIZENPOST.length - 1 ? "1px solid rgba(118,118,128,0.24)" : "none",
          }}>
            <span style={{ position: "absolute", left: 0, color: "#FF453A" }}>✕</span>
            {item}
          </div>
        ))}
      </Collapse>

      <Collapse title="Etiket plakken" color="#0A84FF" icon={Icons.tube}>
        <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
          Plak etiketten correct op de bijbehorende buizen.
        </div>
        <div style={{ marginTop: "10px", background: "rgba(10,132,255,0.08)", borderRadius: "8px", padding: "10px", fontSize: "13px", color: "#0A84FF", border: "1px solid rgba(10,132,255,0.15)", lineHeight: 1.6 }}>
          💡 Citraatbuis: na het vullen minimaal <strong>10 seconden</strong> aangekoppeld laten.
        </div>
      </Collapse>
    </div>
  );

  const renderECG = () => {
    const tabStyle = (id) => ({
      flex: 1, padding: "8px 4px", borderRadius: "8px", border: "none",
      fontFamily: "inherit", fontWeight: 600, fontSize: "13px", cursor: "pointer",
      background: ecgTab === id ? "#FF453A" : "rgba(118,118,128,0.24)",
      color: ecgTab === id ? "#fff" : "rgba(235,235,245,0.6)",
      transition: "all 0.2s",
    });
    const row = (label, value, note) => (
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start",
        padding:"6px 0", borderBottom:"0.5px solid rgba(84,84,88,0.65)", gap:8 }}>
        <span style={{ fontSize:"12px", color:"rgba(235,235,245,0.8)", flex:1 }}>{label}</span>
        <span style={{ fontSize:"12px", color:"#fff", fontWeight:600, textAlign:"right", maxWidth:"55%" }}>{value}</span>
        {note && <div style={{ fontSize:"10px", color:"#FFD60A", marginTop:2 }}>{note}</div>}
      </div>
    );
    // Baseline helpers
    // Grid: 320x80, major grid 20px, baseline y=55, 1px=~0.5mm
    // Normal complex: P(bump 8px), PR(flat), QRS(spike), ST, T(bump)
    const sinus1 = "M4,55 C8,55 10,55 12,52 C14,49 16,49 18,52 C20,55 22,55 24,55 L28,55 L29,53 L30,10 L31,60 L32,55 L36,55 C38,55 40,55 44,53 C48,51 50,51 54,53 C56,55 58,55 62,55";
    const sinus2 = "M68,55 C72,55 74,55 76,52 C78,49 80,49 82,52 C84,55 86,55 88,55 L92,55 L93,53 L94,10 L95,60 L96,55 L100,55 C102,55 104,55 108,53 C112,51 114,51 118,53 C120,55 122,55 126,55";
    const sinus3 = "M132,55 C136,55 138,55 140,52 C142,49 144,49 146,52 C148,55 150,55 152,55 L156,55 L157,53 L158,10 L159,60 L160,55 L164,55 C166,55 168,55 172,53 C176,51 178,51 182,53 C184,55 186,55 190,55";
    const sinus4 = "M196,55 C200,55 202,55 204,52 C206,49 208,49 210,52 C212,55 214,55 216,55 L220,55 L221,53 L222,10 L223,60 L224,55 L228,55 C230,55 232,55 236,53 C240,51 242,51 246,53 C248,55 250,55 254,55 L316,55";

    const ECG_PATRONEN_SECTIONS = [
      {
        title: "Basisbegrippen papier", color: "#0A84FF",
        svg: {
          viewBox: "0 0 320 80",
          paths: [
            { d: "M0,55 L320,55", color:"rgba(235,235,245,0.6)", w:0.5 },
            // Annotatiepijlen
            { d: "M20,70 L60,70", color:"#0A84FF", w:1.5 },
            { d: "M20,72 L20,68", color:"#0A84FF", w:1.5 },
            { d: "M60,72 L60,68", color:"#0A84FF", w:1.5 },
            { d: "M80,70 L84,70", color:"#FF453A", w:1.5 },
            { d: "M80,72 L80,68", color:"#FF453A", w:1.5 },
            { d: "M84,72 L84,68", color:"#FF453A", w:1.5 },
            // mV lijn
            { d: "M200,55 L200,35", color:"#30D158", w:1.5 },
            { d: "M198,35 L202,35", color:"#30D158", w:1.5 },
            { d: "M200,35 L220,35 L220,55", color:"#30D158", w:1.5 },
          ],
          labels: [
            { x:22, y:78, t:"5mm = 0,20s (groot)", color:"#0A84FF", size:7 },
            { x:80, y:78, t:"1mm = 0,04s", color:"#FF453A", size:7 },
            { x:222, y:44, t:"10mm = 1mV", color:"#30D158", size:7 },
          ]
        },
        items: [
          { label: "Groot hokje", value: "5 mm breed = 0,20 sec" },
          { label: "Klein hokje", value: "1 mm = 0,04 sec" },
          { label: "Standaard snelheid", value: "25 mm/sec" },
          { label: "Standaard gevoeligheid", value: "10 mm/mV" },
        ]
      },
      {
        title: "Normaal sinusritme", color: "#30D158",
        svg: {
          viewBox: "0 0 320 80",
          paths: [
            { d: "M4,55 L8,55", color:"#CC0000", w:1.5 },
            { d: sinus1, color:"#CC0000", w:1.5 },
            { d: sinus2, color:"#CC0000", w:1.5 },
            { d: sinus3, color:"#CC0000", w:1.5 },
            { d: sinus4, color:"#CC0000", w:1.5 },
          ],
          labels: [
            { x:12, y:50, t:"P", color:"#30D158", size:8, bold:true },
            { x:29, y:9, t:"R", color:"#30D158", size:8, bold:true },
            { x:45, y:50, t:"T", color:"#30D158", size:8, bold:true },
            { x:120, y:68, t:"60–100/min, regelmatig", color:"#333", size:8 },
          ]
        },
        items: [
          { label: "P-top", value: "Iedere P gevolgd door QRS" },
          { label: "Frequentie", value: "60–100/min" },
          { label: "Regelmatig", value: "Ja" },
        ]
      },
      {
        title: "Ventrikelextrasystole (VES)", color: "#FF9F0A",
        svg: {
          viewBox: "0 0 320 80",
          paths: [
            // 2 normale slagen
            { d: "M4,55 L8,55 C12,55 14,55 16,52 C18,49 20,49 22,52 C24,55 26,55 28,55 L32,55 L33,53 L34,14 L35,62 L36,55 L40,55 C42,55 44,55 48,53 C52,51 54,51 58,53 C60,55 62,55 70,55", color:"#CC0000", w:1.5 },
            { d: "M70,55 C74,55 76,55 78,52 C80,49 82,49 84,52 C86,55 88,55 90,55 L94,55 L95,53 L96,14 L97,62 L98,55 L102,55 C104,55 106,55 110,53 C114,51 116,51 120,53 C122,55 124,55 130,55", color:"#CC0000", w:1.5 },
            // VES: breed, bizarre morfologie, geen P, compensatoire pauze
            { d: "M130,55 L138,55 L140,58 L142,20 L144,68 L146,58 L150,52 L154,58 L156,55 L168,55", color:"#FF9F0A", w:2 },
            // normale slag na pauze
            { d: "M168,55 C172,55 174,55 176,52 C178,49 180,49 182,52 C184,55 186,55 188,55 L192,55 L193,53 L194,14 L195,62 L196,55 L200,55 C202,55 204,55 208,53 C212,51 214,51 218,53 C220,55 222,55 226,55 L316,55", color:"#CC0000", w:1.5 },
          ],
          labels: [
            { x:135, y:18, t:"VES", color:"#FF9F0A", size:8, bold:true },
            { x:134, y:74, t:"breed, geen P, comp. pauze", color:"#FF9F0A", size:7 },
          ]
        },
        items: [
          { label: "QRS", value: "Breed (>0,12 sec), afwijkende morfologie" },
          { label: "P-top", value: "Geen voorafgaande P" },
          { label: "Compensatoire pauze", value: "Ja (meestal)" },
          { label: "V1 uiterlijk", value: "RSR' of brede monofasische R/S" },
        ]
      },
      {
        title: "Bundeltakblokken", color: "#BF5AF2",
        svg: {
          viewBox: "0 0 320 130",
          paths: [
            // Label lijnen
            { d: "M4,10 L316,10", color:"rgba(235,235,245,0.8)", w:0.3 },
            { d: "M4,75 L316,75", color:"rgba(235,235,245,0.8)", w:0.3 },
            // === RBTB — bovenste helft, V1 lead ===
            // RBTB in V1: RsR' patroon (rabbit ear) — eindigt positief
            { d: "M10,40 L14,40 L15,38 L17,20 L18,44 L19,40 L22,38 L24,22 L25,42 L26,40 L32,40 C36,40 38,40 42,38 C46,36 48,36 52,38 C54,40 56,40 60,40", color:"#BF5AF2", w:1.8 },
            { d: "M70,40 L74,40 L75,38 L77,20 L78,44 L79,40 L82,38 L84,22 L85,42 L86,40 L92,40 C96,40 98,40 102,38 C106,36 108,36 112,38 C114,40 116,40 120,40", color:"#BF5AF2", w:1.8 },
            // RBTB in V6: breed S na R — eindigt negatief
            { d: "M10,105 L18,105 L19,103 L20,85 L21,112 L22,105 L26,112 L28,115 L30,105 L36,105 C40,105 42,105 46,103 C50,101 52,101 56,103 C58,105 60,105 64,105", color:"#BF5AF2", w:1.8 },
            { d: "M74,105 L82,105 L83,103 L84,85 L85,112 L86,105 L90,112 L92,115 L94,105 L100,105 C104,105 106,105 110,103 C114,101 116,101 120,103 C122,105 124,105 128,105", color:"#BF5AF2", w:1.8 },
            // === LBTB — rechter helft ===
            // LBTB in V1: QS of rS patroon — eindigt negatief
            { d: "M170,40 L174,40 L176,30 L178,46 L180,40 L190,40 C194,40 196,40 200,38 C204,36 206,36 210,38 C212,40 214,40 218,40", color:"#FF453A", w:1.8 },
            { d: "M228,40 L232,40 L234,30 L236,46 L238,40 L248,40 C252,40 254,40 258,38 C262,36 264,36 268,38 C270,40 272,40 276,40 L300,40", color:"#FF453A", w:1.8 },
            // LBTB in V6: brede R, geen Q, positief eindigt
            { d: "M170,105 L178,105 L180,80 L182,115 L184,105 L190,105 C194,105 196,105 200,103 C204,101 206,101 210,103 C212,105 214,105 218,105", color:"#FF453A", w:1.8 },
            { d: "M228,105 L236,105 L238,80 L240,115 L242,105 L248,105 C252,105 254,105 258,103 C262,101 264,101 268,103 C270,105 272,105 276,105 L300,105", color:"#FF453A", w:1.8 },
          ],
          labels: [
            { x:4, y:9, t:"RBTB", color:"#BF5AF2", size:9, bold:true },
            { x:4, y:74, t:"LBTB", color:"#FF453A", size:9, bold:true },
            { x:4, y:52, t:"V1 — RsR'", color:"#BF5AF2", size:7 },
            { x:4, y:118, t:"V1 — QS/rS", color:"#FF453A", size:7 },
            { x:140, y:52, t:"V6 — breed S", color:"#BF5AF2", size:7 },
            { x:140, y:118, t:"V6 — brede R", color:"#FF453A", size:7 },
          ]
        },
        items: [
          { label: "RBTB – QRS", value: ">0,12 sec" },
          { label: "RBTB – V1", value: "RsR' (rabbit ear), positief eindgedeelte" },
          { label: "RBTB – V6", value: "Breed S na R, negatief eindgedeelte" },
          { label: "LBTB – QRS", value: ">0,12 sec" },
          { label: "LBTB – V1", value: "QS of rS, negatief eindigt" },
          { label: "LBTB – V6", value: "Brede R, geen Q, positief eindgedeelte" },
          { label: "Nieuw LBTB", value: "⚠ Overweeg ischemie!" },
        ]
      },
      {
        title: "Linker ventrikelhypertrofie (LVH)", color: "#63E6E2",
        svg: {
          viewBox: "0 0 320 100",
          paths: [
            // V5/V6: hoge R (>35mm = 35px hier 3.5x schaal => toon als relatief hoog)
            { d: "M10,65 L14,65 L15,63 L16,5 L17,72 L18,65 L22,65 C26,65 28,65 32,62 C36,59 38,59 42,62 C44,65 46,65 52,65", color:"#63E6E2", w:1.8 },
            { d: "M62,65 L66,65 L67,63 L68,5 L69,72 L70,65 L74,65 C78,65 80,65 84,62 C88,59 90,59 94,62 C96,65 98,65 104,65", color:"#63E6E2", w:1.8 },
            // V1: diepe S golf
            { d: "M160,42 L166,42 L168,44 L170,65 L171,40 L172,42 L178,42 C182,42 184,42 188,40 C192,38 194,38 198,40 C200,42 202,42 208,42", color:"#63E6E2", w:1.8 },
            { d: "M218,42 L224,42 L226,44 L228,65 L229,40 L230,42 L236,42 C240,42 242,42 246,40 C250,38 252,38 256,40 C258,42 260,42 266,42", color:"#63E6E2", w:1.8 },
            // Sokolow annotatie
            { d: "M68,5 L68,2 L170,2 L170,5", color:"#FF453A", w:1 },
          ],
          labels: [
            { x:4, y:14, t:"V5/V6 — hoge R", color:"#63E6E2", size:7 },
            { x:153, y:68, t:"V1 — diepe S", color:"#63E6E2", size:7 },
            { x:90, y:9, t:"S(V1) + R(V5/V6) > 35 mm = Sokolow", color:"#FF453A", size:7 },
          ]
        },
        items: [
          { label: "Sokolow–Lyon", value: "S in V1 + R in V5/V6 > 35 mm" },
          { label: "Cornell (man)", value: "R aVL + S V3 > 28 mm" },
          { label: "Cornell (vrouw)", value: "R aVL + S V3 > 20 mm" },
          { label: "Indicatie", value: "Hypertensie, aortaklepasstenose" },
        ]
      },
      {
        title: "Supraventriculaire tachycardieën (SVT)", color: "#FF453A",
        svg: {
          viewBox: "0 0 320 160",
          paths: [
            // === AVNRT: smal QRS snel, retrograde P in of vlak na QRS ===
            { d: "M8,32 L10,32 L11,30 L12,8 L13,36 L14,32 L20,32 L21,30 L22,8 L23,36 L24,32 L30,32 L31,30 L32,8 L33,36 L34,32 L40,32 L41,30 L42,8 L43,36 L44,32 L50,32 L51,30 L52,8 L53,36 L54,32 L60,32 L61,30 L62,8 L63,36 L64,32 L70,32 L71,30 L72,8 L73,36 L74,32 L80,32 L81,30 L82,8 L83,36 L84,32 L90,32 L91,30 L92,8 L93,36 L94,32 L100,32 L316,32", color:"#FF453A", w:1.6 },
            // === Boezemfibrilleren: onregelmatig, golvende basislijn, chaotisch ===
            { d: "M8,80 C12,78 14,82 16,79 C18,76 20,81 22,80 L23,78 L24,58 L25,84 L26,80 C30,78 32,82 34,79 L36,80 C38,78 40,83 42,80 L44,78 L45,76 L46,58 L47,84 L48,80 C52,77 54,82 56,79 C60,76 62,81 64,80 L65,78 L66,58 L67,84 L68,80 C72,78 74,82 76,79 C80,76 82,82 84,80 L86,78 L87,58 L88,84 L89,80 C94,77 96,82 98,79 C102,76 104,81 106,80 L107,78 L108,58 L109,84 L110,80 C114,78 116,82 118,79 C122,76 124,81 126,80 L316,80", color:"#CC0000", w:1.5 },
            // === Boezemflutter: zaagvorm basislijn, regelmatig ===
            { d: "M8,128 L16,118 L16.5,130 L24,120 L24.5,132 L32,122 L32.5,134 L40,124 L40.5,136 L48,120 L48.5,132 L56,122 L56.5,134 L64,124 L65,128 L66,126 L67,108 L68,134 L69,128 L76,120 L76.5,132 L84,122 L84.5,134 L92,124 L92.5,136 L100,120 L100.5,132 L108,122 L108.5,134 L116,124 L117,128 L118,126 L119,108 L120,134 L121,128 L128,120 L128.5,132 L136,122 L136.5,134 L144,124 L144.5,136 L152,120 L152.5,132 L160,122 L160.5,134 L168,124 L169,128 L170,126 L171,108 L172,134 L173,128 L316,128", color:"#FF453A", w:1.5 },
          ],
          labels: [
            { x:4, y:14, t:"AVNRT — smal QRS, snel (~170/min)", color:"#FF453A", size:7, bold:true },
            { x:4, y:62, t:"Boezemfibrilleren — onregelmatig, golvend", color:"#CC0000", size:7, bold:true },
            { x:4, y:112, t:"Boezemflutter — zaagvorm, regelmatig 2:1", color:"#FF453A", size:7, bold:true },
          ]
        },
        items: [
          { label: "QRS", value: "<120 ms (smal) — tenzij aberrantie of RBTB/LBTB" },
          { label: "AVNRT", value: "Retrograde P in QRS of vlak na QRS; 'cherchez le P'" },
          { label: "Boezemfibrilleren", value: "Onregelmatig, chaotisch, geen echte P-toppen" },
          { label: "Boezemflutter", value: "Zaagvorm ~300/min, regelmatig bij 2:1 of 3:1 blok" },
          { label: "WPW", value: "Delta-golf, korte PQ-tijd (<0,12 sec)" },
          { label: "AV re-entry (AVRT)", value: "Retrograde P ver na QRS" },
          { label: "Atriale tachycardie", value: "Andere P-morfologie, 1 focus" },
        ]
      },
      {
        title: "Ventrikeltachycardie (VT)", color: "#FF453A",
        svg: {
          viewBox: "0 0 320 80",
          paths: [
            // 2 normale slagen dan VT start
            { d: "M4,52 C8,52 10,52 12,50 C14,47 16,47 18,50 C20,52 22,52 24,52 L26,52 L27,50 L28,18 L29,58 L30,52 L34,52 C36,52 38,52 42,50 C46,48 48,48 52,50 C54,52 56,52 60,52", color:"#CC0000", w:1.5 },
            // VT: brede bizarre complexen snel, geen P
            { d: "M60,52 L62,52 L64,46 L66,14 L68,62 L70,55 L72,50 L74,55 L76,52 L78,46 L80,14 L82,62 L84,55 L86,50 L88,55 L90,52 L92,46 L94,14 L96,62 L98,55 L100,50 L102,55 L104,52 L106,46 L108,14 L110,62 L112,55 L114,50 L116,55 L118,52 L120,46 L122,14 L124,62 L126,55 L128,50 L130,55 L132,52 L134,46 L136,14 L138,62 L140,55 L142,50 L144,55 L146,52 L148,46 L150,14 L152,62 L154,55 L156,50 L158,55 L160,52 L162,46 L164,14 L166,62 L168,55 L170,50 L172,55 L174,52 L176,46 L178,14 L180,62 L182,55 L184,50 L186,55 L188,52 L190,46 L192,14 L194,62 L196,55 L198,50 L200,55 L202,52 L204,46 L206,14 L208,62 L210,55 L212,50 L214,55 L216,52 L218,46 L220,14 L222,62 L224,55 L226,50 L228,55 L230,52 L316,52", color:"#FF453A", w:2 },
          ],
          labels: [
            { x:4, y:12, t:"VT — breed QRS >120ms, snel, AV-dissociatie", color:"#FF453A", size:7, bold:true },
            { x:56, y:70, t:"VT start →", color:"#FF453A", size:8 },
          ]
        },
        items: [
          { label: "Frequentie", value: ">120/min" },
          { label: "QRS", value: "Breed >120 ms, bizarre morfologie" },
          { label: "Dissociatie", value: "AV-dissociatie (P ≠ QRS)" },
          { label: "Brugada-criteria", value: "RS > 100 ms in 1 precordiaal, LBTB of RBTB zonder gewone morfologie" },
          { label: "Typisch ouder pt", value: "Buiten bewustzijn → direct cardioversie" },
          { label: "SVT met aberrantie", value: "QRS breed maar P vóór QRS, RBTB/LBTB patroon" },
        ]
      },
      {
        title: "Pathologische Q-golf", color: "#8E8E93",
        svg: {
          viewBox: "0 0 320 80",
          paths: [
            // Normaal: kleine q
            { d: "M10,52 L14,52 C16,52 18,52 20,50 C22,47 24,47 26,50 C28,52 30,52 32,52 L33,50 L34,48 L35,14 L36,58 L37,52 L42,52 C44,52 46,52 50,50 C54,48 56,48 60,50 C62,52 64,52 70,52", color:"#30D158", w:1.5 },
            // Pathologische Q: diep, breed, dan kleine R
            { d: "M160,52 L164,52 C166,52 168,52 170,50 C172,47 174,47 176,50 C178,52 180,52 182,52 L183,52 L184,62 L185,68 L188,52 L189,30 L190,56 L191,52 L196,52 C200,52 202,52 206,50 C210,48 212,48 216,50 C218,52 220,52 226,52 L316,52", color:"#FF453A", w:1.8 },
            // Annotatielijnen Q
            { d: "M184,52 L184,78", color:"#FF453A", w:0.8, strokeDasharray:"2,2" },
            { d: "M188,52 L188,78", color:"#FF453A", w:0.8, strokeDasharray:"2,2" },
          ],
          labels: [
            { x:8, y:12, t:"Normaal: kleine q", color:"#30D158", size:8, bold:true },
            { x:140, y:12, t:"Pathologisch: Q breed + diep", color:"#FF453A", size:8, bold:true },
            { x:175, y:76, t:">0,04s + >¼R", color:"#FF453A", size:7 },
          ]
        },
        items: [
          { label: "Definitie", value: "Q > 0,04 sec breedte of > ¼ R-amplitude" },
          { label: "Minimaal", value: "2 aangrenzende afleidingen, diepte ≥ 1 mm" },
          { label: "Indicatie", value: "Doorgemaakt infarct" },
          { label: "Uitzondering", value: "Q alleen in III of aVR is normaal" },
        ]
      },
      {
        title: "Infarctlocalisatie", color: "#FF453A",
        svg: {
          viewBox: "0 0 320 130",
          paths: [
            // === Voorwandinfarct V1-V4: ST-elevatie ===
            { d: "M10,48 L14,48 C16,48 18,48 20,46 C22,43 24,43 26,46 C28,48 30,48 32,48 L33,46 L34,44 L35,18 L36,52 L37,55 L38,52 L42,48 L44,38 L50,30 L56,35 L60,40 L64,45 L68,48", color:"#FF453A", w:1.8 },
            // Reciproke ST-depressie (aVF/III bij voorwand)
            { d: "M10,98 L14,98 C16,98 18,98 20,96 C22,93 24,93 26,96 C28,98 30,98 32,98 L33,96 L34,94 L35,72 L36,100 L37,102 L38,100 L42,103 L44,108 L50,112 L56,110 L60,107 L64,103 L68,98", color:"#0A84FF", w:1.8 },
            // === Onderwandinfarct II/III/aVF: ST-elevatie ===
            { d: "M170,98 L174,98 C176,98 178,98 180,96 C182,93 184,93 186,96 C188,98 190,98 192,98 L193,96 L194,94 L195,68 L196,102 L197,105 L198,102 L202,98 L204,90 L210,82 L216,86 L220,90 L224,95 L228,98", color:"#FF453A", w:1.8 },
            // Reciproke depressie (I/aVL bij onderwand)
            { d: "M170,48 L174,48 C176,48 178,48 180,46 C182,43 184,43 186,46 C188,48 190,48 192,48 L193,46 L194,44 L195,18 L196,52 L197,55 L198,52 L202,57 L204,62 L210,66 L216,64 L220,61 L224,56 L228,48", color:"#0A84FF", w:1.8 },
          ],
          labels: [
            { x:4, y:10, t:"Voorwand (V1–V4)", color:"#FF453A", size:8, bold:true },
            { x:4, y:78, t:"Reciproke depressie (aVF)", color:"#0A84FF", size:7 },
            { x:4, y:120, t:"ST↑", color:"#FF453A", size:7 },
            { x:162, y:38, t:"Onderwand (II/III/aVF)", color:"#FF453A", size:8, bold:true },
            { x:162, y:88, t:"ST↑", color:"#FF453A", size:7 },
            { x:162, y:22, t:"Reciproke (I/aVL)", color:"#0A84FF", size:7 },
          ]
        },
        items: [
          { label: "Voorwand (LAD)", value: "ST-elevatie V1–V4; reciprook II, III, aVF" },
          { label: "Onderwand (RCA/RCX)", value: "ST-elevatie II, III, aVF; reciprook I, aVL" },
          { label: "Zijwand (RCX)", value: "ST-elevatie I, aVL, V5–V6" },
          { label: "Posterobasaal", value: "Hoge R en ST-depressie V1–V3 (spiegelbeeld)" },
          { label: "Rechter ventrikel", value: "ST-elevatie in V4R; bij onderwand infarct" },
          { label: "Hoofdstam", value: "Diffuse ST-depressie + elevatie aVR" },
        ]
      },
      {
        title: "Kleurschema infarctlocalisatie", color: "#FF453A",
        svg: {
          viewBox: "0 0 320 90",
          paths: [],
          labels: [
            { x:10, y:16, t:"I", color:"#fff", size:9, bold:true },
            { x:10, y:36, t:"II", color:"#fff", size:9, bold:true },
            { x:10, y:56, t:"III", color:"#fff", size:9, bold:true },
            { x:10, y:76, t:"aVR", color:"#fff", size:9, bold:true },
            { x:90, y:16, t:"aVL", color:"#fff", size:9, bold:true },
            { x:90, y:36, t:"aVF", color:"#fff", size:9, bold:true },
            { x:170, y:16, t:"V1", color:"#fff", size:9, bold:true },
            { x:170, y:36, t:"V2", color:"#fff", size:9, bold:true },
            { x:170, y:56, t:"V3", color:"#fff", size:9, bold:true },
            { x:170, y:76, t:"V4", color:"#fff", size:9, bold:true },
            { x:250, y:16, t:"V5", color:"#fff", size:9, bold:true },
            { x:250, y:36, t:"V6", color:"#fff", size:9, bold:true },
          ],
          rects: [
            { x:4, y:4, w:72, h:20, fill:"#0A84FF", label:"Lateraal" },
            { x:4, y:24, w:72, h:20, fill:"#FF453A", label:"Inferior" },
            { x:4, y:44, w:72, h:20, fill:"#FF453A", label:"Inferior" },
            { x:4, y:64, w:72, h:20, fill:"#8E8E93", label:"Hoofdstam" },
            { x:84, y:4, w:72, h:20, fill:"#0A84FF", label:"Lateraal" },
            { x:84, y:24, w:72, h:20, fill:"#FF453A", label:"Inferior" },
            { x:164, y:4, w:72, h:20, fill:"#FFD60A", label:"Septaal" },
            { x:164, y:24, w:72, h:20, fill:"#FFD60A", label:"Septaal" },
            { x:164, y:44, w:72, h:20, fill:"#FF9F0A", label:"Anterior" },
            { x:164, y:64, w:72, h:20, fill:"#FF9F0A", label:"Anterior" },
            { x:244, y:4, w:72, h:20, fill:"#0A84FF", label:"Lateraal" },
            { x:244, y:24, w:72, h:20, fill:"#0A84FF", label:"Lateraal" },
          ]
        },
        items: [
          { label: "I – Lateraal", value: "🔵 Blauw" },
          { label: "II – Inferior", value: "🔴 Rood" },
          { label: "III – Inferior", value: "🔴 Rood" },
          { label: "aVR – Hoofdstam", value: "⬛ Donker" },
          { label: "aVL – Lateraal", value: "🔵 Blauw" },
          { label: "aVF – Inferior", value: "🔴 Rood" },
          { label: "V1–V2 – Septaal", value: "🟡 Geel" },
          { label: "V3–V4 – Anterior", value: "🟠 Oranje" },
          { label: "V5–V6 – Lateraal", value: "🔵 Blauw" },
        ]
      },
    ];
    const ECG_STAPPEN = [
      {
        nr: "Stap 1", title: "Wat is het ritme?", color: "#0A84FF",
        items: [
          { label: "Sinusritme", value: "60–100/min, iedere P gevolgd door QRS" },
          { label: "Sinustachycardie", value: ">100/min. Oorzaak: koorts, pijn, stress" },
          { label: "Boezemfibrilleren", value: "Permanent/persistent/paroxismaal; onregelmatig" },
          { label: "Boezemflutter", value: "Zaagvorm 150/min bij 2:1 blok; regelmatig" },
          { label: "AVNRT", value: "Frequent SVT, jonge patiënt, sinus carotis/adenosine" },
          { label: "VT breed-complex", value: ">120/min, gevaarlijk — direct overleg cardioloog" },
          { label: "Bradycardie", value: "<60/min. Overweeg stop betablokkker/calciumantagonist" },
          { label: "1° AV-blok", value: "PQ-tijd > 200 ms" },
          { label: "2° AV-blok Wenckebach", value: "PQ neemt toe tot 1 complex uitvalt — prognostisch gunstig" },
          { label: "2° AV-blok Möbitz", value: "PQ normaal maar niet alle P-toppen gevolgd — pacemaker!" },
          { label: "3° AV-blok totaal", value: "Geen relatie P en QRS — pacemaker!" },
          { label: "Ventriculair escape", value: "Breed-complex ritme <40/min, direct overleg cardioloog" },
        ]
      },
      {
        nr: "Stap 2", title: "Kamerfrequentie", color: "#30D158",
        items: [
          { label: "Methode hokjes", value: "300 / aantal grote hokjes tussen 2 QRS-complexen" },
          { label: "1 hokje", value: "300/min" },
          { label: "2 hokjes", value: "150/min" },
          { label: "3 hokjes", value: "100/min" },
          { label: "4 hokjes", value: "75/min" },
          { label: "5 hokjes", value: "60/min" },
          { label: "6 hokjes", value: "50/min" },
          { label: "Alternatief", value: "Hartfrequentie = 10 × aantal QRS in 15 cm (= 6 seconde)" },
        ]
      },
      {
        nr: "Stap 3", title: "Geleidingstijden (PQ, QRS, QT)", color: "#BF5AF2",
        items: [
          { label: "Normaal PQ", value: "<220 ms (5½ kleine hokjes)" },
          { label: "Normaal QRS", value: "<120 ms (3 kleine hokjes)" },
          { label: "PQ > 220 ms", value: "AV-blok (zie boven)" },
          { label: "PQ < 120 ms + delta-golf", value: "WPW → risico cirkeltachycardie (AVRT)" },
          { label: "QRS > 120 ms", value: "Breed QRS-complex → kijk naar V1" },
          { label: "LBTB", value: "Vertraging linker ventrikel, eindigt negatief in V1" },
          { label: "RBTB", value: "RsR' in V1 (rabbit ear), eindigt positief in V1" },
          { label: "Normaal QTc", value: "Man <450 ms | Vrouw <460 ms" },
          { label: "QTc 50/min", value: "493 ms | 60: 450 | 70: 417 | 80: 390 | 90: 367 | 100: 349" },
          { label: "QTc > 450 ms", value: "Overweeg: hypokaliëmie, medicatie (sotalol, erythromycine) — risico Torsades" },
        ]
      },
      {
        nr: "Stap 4", title: "Hartas", color: "#FF9F0A",
        items: [
          { label: "Normaal", value: "−30° tot +90°" },
          { label: "Normale hartas", value: "QRS positief in I en aVF" },
          { label: "Links as", value: "I positief, aVF negatief → LVH, LBTB" },
          { label: "Rechts as", value: "I negatief, aVF positief → longembolie, COPD" },
          { label: "Tip", value: "Asdraaï t.o.v. vorig ECG? Nieuw LBTB? Hoogte R-top veranderd?" },
        ]
      },
      {
        nr: "Stap 5", title: "P-top morfologie", color: "#63E6E2",
        items: [
          { label: "Normaal", value: "Positief in I en II, bifasisch in V1, elke slag gelijk" },
          { label: "Linker atriumdilatatie", value: "Terminaal negatief deel in V1 > 1 mm² → bijv. mitralisinsufficiëntie" },
          { label: "Rechter atriumdilatatie", value: "P-pulmonale: hoog > 2,5 mm in II, III, aVF → COPD, pulmonale hypertensie" },
          { label: "Let op", value: "Anders morfologische P-toppen → atriale tachycardie" },
        ]
      },
      {
        nr: "Stap 6", title: "QRS morfologie", color: "#FF453A",
        items: [
          { label: "Pathologische Q-golf", value: "Oud infarct (zie verder voor definitie)" },
          { label: "LVH", value: "Sokolow: S in V1 + R in V5/V6 > 35 mm | Cornell man > 28 mm, vrouw > 20 mm" },
          { label: "Microvoltages", value: "QRS-amplitude < 5 mm in alle extremiteitsafleidingen en/of < 10 mm in V1–V6 → pericarditis, tamponade, obesitas, COPD" },
          { label: "Breed QRS (>120 ms)", value: "Stap 3" },
          { label: "R-progressie", value: "Toename R V1–V5, R > S na V3" },
        ]
      },
      {
        nr: "Stap 7", title: "ST-morfologie", color: "#FF453A",
        items: [
          { label: "ST-elevatie", value: "Overweeg ischemie, pericarditis, LVH, vroege repolarisatie" },
          { label: "ST-depressie", value: "Reciprook bij ischemie, strainpatroon bij LVH, digoxine" },
          { label: "Negatieve T-top", value: "Normaal in aVR, V1, III — elders → ischemie, LVH-belasting, longembolie, HOCM" },
          { label: "Vlakke T-top (<0,5mm)", value: "Aspecifiek" },
        ]
      },
      {
        nr: "Stap +1", title: "Vergelijking met oud ECG", color: "#8E8E93",
        items: [
          { label: "Nieuw LBTB?", value: "Asdraai? Nieuwe pathologische Q of pre-existent?" },
          { label: "Afname hoogte R-top?", value: "Mogelijk nieuw infarct" },
          { label: "ST-verandering", value: "Vergelijk exact met vorig ECG in alle afleidingen" },
        ]
      },
      {
        nr: "Stap +2", title: "Trek een conclusie (1 zin)", color: "#30D158",
        items: [
          { label: "Voorbeeld", value: "Sinustachycardie met ST-elevatie over de voorwand en een trifasiculair blok — passend bij acuut voorwandinfarct" },
          { label: "Bevat altijd", value: "Ritme + frequentie + as + geleidingsafwijkingen + ischemietekens" },
        ]
      },
      {
        nr: "Ischemie", title: "ST-elevatie: localisatie", color: "#FF453A",
        items: [
          { label: "Voorwand", value: "V1–V4, I, aVL → LAD. Reciprook: II, III, aVF" },
          { label: "Onderwand", value: "II, III, aVF → 80% RCA, 20% RCX. Reciprook: I, aVL" },
          { label: "Rechter ventrikel", value: "ST↑ in V1 en V4R — vullen indien hypotensief!" },
          { label: "Posteriobasaal", value: "Hoge R en ST-depressie in V1–V3 (spiegelafbeelding)" },
          { label: "Lateraal", value: "I, aVL, V5–V6 → DAK (D-tak)" },
          { label: "Hoofdstam", value: "Diffuse ST-depressie met ST↑ in aVR → zeer hoog risico" },
          { label: "IPL-infarct", value: "Infero-postero-lateraal — combinatie komt vaak voor" },
          { label: "Reciproke depressie", value: "Depressie in tegenoverliggend gebied: bijv. II, III, aVF bij voorwandinfarct" },
        ]
      },
      {
        nr: "Diversen", title: "Aandachtspunten", color: "#8E8E93",
        items: [
          { label: "VES", value: "QRS > 120 ms. Bij 50% van gezonde mannen. Hoger risico bij cardiopathie" },
          { label: "BES", value: "Eerder dan verwachte P-top; smal QRS" },
          { label: "Pericarditis", value: "ST-elevatie alle afleidingen behalve aVR. PTA-depressie in II" },
          { label: "Hyperkaliëmie", value: "Spitse hoge T's, breed QRS, P-top vlak" },
          { label: "Hypokaliëmie", value: "ST-verlaging, normale T-top, U-golf" },
          { label: "Hypercalciëmie", value: "QT kort, hoge T-top" },
          { label: "Longembolie", value: "Sinustachycardie, S1Q3T3, diepe S in I, negatieve T V1–V3, RBTB" },
          { label: "Digitalis-intoxicatie", value: "Komvormige ST-depressie, ectopie, bidirectionele VT" },
          { label: "Borstelektroden", value: "V1 = 4e IC-ruimte rechts; V2 = 4e IC links; V3 = tussen V2 en V4; V4 = IC5 in tepellijn; V5 = tussen V4 en V6; V6 = IC5 mid-axillairlijn" },
        ]
      },
    ];

    return (
      <div>
        {/* Tab-knoppen */}
        <div className="zk-seg" role="group" aria-label="Weergave ECG" style={{ marginBottom: "14px" }}>
          <button type="button" className={ecgTab === "patronen" ? "is-on" : ""} aria-pressed={ecgTab === "patronen"} onClick={() => setEcgTab("patronen")}>Patronen</button>
          <button type="button" className={ecgTab === "stappenplan" ? "is-on" : ""} aria-pressed={ecgTab === "stappenplan"} onClick={() => setEcgTab("stappenplan")}>7+2 Stappenplan</button>
        </div>

        {ecgTab === "patronen" && ECG_PATRONEN_SECTIONS.map((sectie, i) => (
          <Collapse key={i} title={sectie.title} color={sectie.color} icon={Icons.heart}>
            {sectie.svg && (
              <div style={{ background: "#e8f0e8", borderRadius: 8, padding: "6px 4px", marginBottom: 10, overflow: "hidden" }}>
                <svg viewBox={sectie.svg.viewBox || "0 0 320 80"} width="100%" style={{ display: "block" }}
                  xmlns="http://www.w3.org/2000/svg">
                  {/* Grid — alleen als geen rects (kleurschema heeft eigen achtergrond) */}
                  {!sectie.svg.rects && <>
                    <rect width="320" height={parseInt((sectie.svg.viewBox||"0 0 320 80").split(" ")[3])} fill="#f0f7f0"/>
                    {Array.from({length:17},(_,x)=>(
                      <line key={"vg"+x} x1={x*20} y1={0} x2={x*20} y2={999}
                        stroke={x%5===0?"#b8ccb8":"#d0e4d0"} strokeWidth={x%5===0?0.8:0.4}/>
                    ))}
                    {Array.from({length:8},(_,y)=>(
                      <line key={"hg"+y} x1={0} y1={y*20} x2={320} y2={y*20}
                        stroke={y%5===0?"#b8ccb8":"#d0e4d0"} strokeWidth={y%5===0?0.8:0.4}/>
                    ))}
                  </>}
                  {/* Gekleurde rechthoeken (voor kleurschema) */}
                  {sectie.svg.rects && sectie.svg.rects.map((r,ri)=>(
                    <g key={ri}>
                      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} rx={3}/>
                      <text x={r.x+r.w/2} y={r.y+r.h/2+4} fontSize={7} fill="#fff" fontFamily="sans-serif"
                        textAnchor="middle" fontWeight="bold">{r.label}</text>
                    </g>
                  ))}
                  {sectie.svg.paths.map((p, pi) => (
                    <path key={pi} d={p.d} fill="none" stroke={p.color||"#CC0000"} strokeWidth={p.w||1.5} strokeLinejoin="round" strokeLinecap="round"/>
                  ))}
                  {sectie.svg.labels && sectie.svg.labels.map((l, li) => (
                    <text key={li} x={l.x} y={l.y} fontSize={l.size||8} fill={l.color||"#333"} fontFamily="sans-serif" fontWeight={l.bold?"bold":"normal"}>{l.t}</text>
                  ))}
                </svg>
              </div>
            )}
            {sectie.items.map((item, j) => row(item.label, item.value, item.note))}
          </Collapse>
        ))}

        {ecgTab === "stappenplan" && ECG_STAPPEN.map((stap, i) => (
          <Collapse key={i} title={`${stap.nr}: ${stap.title}`} color={stap.color} defaultOpen={i === 0} icon={Icons.heart}>
            {stap.items.map((item, j) => row(item.label, item.value, item.note))}
          </Collapse>
        ))}
      </div>
    );
  };

  const renderCardio = () => {
    const KLEUR = "#FF453A";
    const sub = (t) => (
      <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: KLEUR, fontWeight: 700, margin: "14px 0 8px" }}>{t}</div>
    );
    const li = (items, kleur = KLEUR) => (
      <ul style={{ margin: "0 0 4px", paddingLeft: "18px", fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
        {items.map((x, i) => <li key={i} dangerouslySetInnerHTML={{ __html: x }} />)}
      </ul>
    );
    const kader = (kleur, titel, body) => (
      <div style={{
        background: `${kleur}12`, border: `1px solid ${kleur}40`, borderLeft: `4px solid ${kleur}`,
        borderRadius: "10px", padding: "12px", marginBottom: "10px",
      }}>
        <div style={{ fontWeight: 700, color: kleur, fontSize: "15px", marginBottom: "8px" }}>{titel}</div>
        {body}
      </div>
    );

    const KLAARZET_MEDS = [
      { m: "Sufentanil", c: "5 µg/ml" }, { m: "Lidocaïne 1%", c: "10 mg/ml" },
      { m: "Midazolam", c: "1 mg/ml" }, { m: "Esketamine", c: "5 mg/ml" },
      { m: "Rocuronium", c: "10 mg/ml" }, { m: "Dexamethason", c: "4 / 20 mg/ml" },
      { m: "Cefazoline", c: "2 g / 10 ml" }, { m: "Fenylefrine", c: "100 µg/ml" },
      { m: "Efedrine", c: "5 mg/ml" }, { m: "Atropine", c: "0,5 mg" },
      { m: "Tranexaminezuur", c: "100 mg/ml" }, { m: "Heparine", c: "50 mg (5000 IE)/ml" },
    ];
    const KLAARZET_POMPEN = [
      { m: "Propofol (pomp)", c: "20 mg/ml (2%)" },
      { m: "Noradrenaline (pomp)", c: "100 µg/ml" },
      { m: "Sufentanil (pomp)", c: "5 µg/ml" },
    ];
    const KLAARZET_OVERLEG = [
      { m: "Milrinone", c: "200 µg/ml" }, { m: "Dobutamine", c: "5 mg/ml" },
      { m: "Dopamine", c: "—" },
    ];
    const INOTROPICA = [
      { m: "Argipressine (Empressine)", b: "40 IE/2 ml → aanvullen tot 50 ml NaCl 0,9%", c: "0,8 IE/ml", w: "Arteriële vasoconstrictie" },
      { m: "Dobutamine", b: "250 mg/50 ml, puur", c: "5 mg/ml", w: "Positief inotroop + chronotroop" },
      { m: "Isoprenaline", b: "1 mg/ml → aanvullen tot 50 ml NaCl 0,9%", c: "20 µg/ml", w: "Positief chronotroop, inotroop + dromotroop" },
      { m: "Milrinone", b: "10 mg/10 ml → aanvullen tot 50 ml NaCl 0,9%", c: "200 µg/ml", w: "Positief inotroop + chronotroop + perifere vasodilatatie" },
      { m: "Nitroglycerine", b: "50 mg/50 ml, puur", c: "1 mg/ml", w: "Veneuze vasodilatatie" },
      { m: "Noradrenaline", b: "5 mg/5 ml → aanvullen tot 50 ml NaCl 0,9%", c: "100 µg/ml", w: "Positief chronotroop, inotroop + perifere vasoconstrictie" },
      { m: "Terlipressine", b: "0,85 mg/8,5 ml → aanvullen tot 50 ml NaCl 0,9%", c: "17 µg/ml", w: "Vasoconstrictie abdominaal vaatbed" },
    ];
    const STAPPEN = [
      { t: "Voor incisie", d: "Inleiding, lijnen prikken (arterie + centraal veneus), TEE plaatsen, blaaskatheter + temperatuur, antibioticaprofylaxe (cefazoline)." },
      { t: "Incisie → ECC", d: "Sternotomie, prepareren. 300 IE/kg heparine + 1 g TXA vóór canulatie, na 3 min ACT bepalen: > 350 s canuleren, > 400 s ECC starten." },
      { t: "Aan de ECC (bypass)", d: "Perfusionist neemt circulatie over. Beademing aanpassen/stoppen, hoofd/pupillen controleren, TEE freeze, urine af." },
      { t: "Einde operatie", d: "Ontluchten, opwarmen > 36 °C, ritme/pacing, van de pomp af, protamine geven, hemostase, sluiten." },
      { t: "Transport & overdracht IC", d: "Stabiliseren, pompen mee, gemonitord transport, gestructureerde overdracht aan IC." },
    ];
    const INGREPEN = [
      { t: "CABG — coronaire bypass", stuk: "Eén of meer kransslagaders (coronairen) zijn vernauwd of verstopt door aderverkalking → de hartspier krijgt te weinig zuurstof (angina pectoris, infarctrisico).", stappen: ["Sternotomie", "Bypass-vaten oogsten (a. mammaria interna, v. saphena of a. radialis)", "Meestal aan de ECC met hart stilgelegd; soms off-pump (OPCAB) op het kloppende hart", "Omleiding(en) hechten vóór en achter de vernauwing", "Van de pomp af, ontluchten, sluiten"] },
      { t: "Aortaklep — vervangen (AVR) of sparen (David/VSRR)", stuk: "Aortaklep is vernauwd (stenose) of lekt (insufficiëntie) — door verkalking, aangeboren afwijking of een verwijde aortawortel.", stappen: ["Sternotomie, aan de ECC, aortaklem aan", "Aorta openen, zieke klep beoordelen (TEE)", "AVR: vervangen door kunstklep (mechanisch of biologisch)", "Klepsparend (David/VSRR): aortawortel/ascendens vervangen door buisprothese met behoud van de eigen klepzegels", "Ontluchten, van de pomp af, sluiten"] },
      { t: "Mitralisklep — plastiek (MV repair) of vervanging (MVR)", stuk: "Mitralisklep lekt (insufficiëntie) of is vernauwd (stenose) → bloed stroomt terug richting de longen, kortademigheid.", stappen: ["Sternotomie, aan de ECC, aortaklem aan", "Linker boezem openen, klep beoordelen via TEE", "Voorkeur: plastiek — eigen klep repareren met ring/hechtingen (MV repair)", "Anders vervanging door een kunstklep (MVR)", "Lucht eruit, van de pomp af, sluiten"] },
      { t: "Aorta ascendens / boog (incl. Bentall)", stuk: "Verwijding (aneurysma) of scheur in de wand (dissectie) van de aorta ascendens of boog. Een dissectie is acuut → spoed-OK.", stappen: ["Open hart operatie, aan de ECC", "Boogchirurgie: vaak diepe koeling + tijdelijke circulatiestilstand, cerebrale bescherming (NIRS)", "Aangedaan deel vervangen door buisprothese", "Bentall: buisprothese mét kunstklep + coronairen opnieuw aanhechten", "Opwarmen, ontluchten, van de pomp af"] },
      { t: "PEARS — aortawortelondersteuning", stuk: "Verwijde aortawortel (bv. bij Marfan of bindweefselziekte) met risico op verdere uitzetting, terwijl de eigen aortaklep nog goed werkt.", stappen: ["Vooraf wordt op basis van een CT-scan een op maat geprinte mesh-kous gemaakt", "Sternotomie", "Meestal op het kloppende hart — zonder hart-longmachine en zonder aortaklem", "De maatkous wordt rond de aortawortel/ascendens geschoven en vastgehecht → ondersteunt de wand en remt verdere verwijding", "Eigen aortaklep blijft behouden"] },
      { t: "Aorta descendens (open of EVAR)", stuk: "Aneurysma van de afdalende aorta (operatie meestal bij doorsnede > 5,5 cm) — risico op ruptuur.", stappen: ["Open: via thoracotomie/laparotomie het aangedane deel vervangen (bij TAAA spinaalkatheter ter bescherming van het ruggenmerg)", "EVAR: stentprothese via de lies in de aorta plaatsen (minimaal invasief)"] },
      { t: "Longchirurgie (VATS)", stuk: "Longtumor, -afwijking of pneumothorax; een deel of de hele long moet eruit.", stappen: ["Meestal thoracoscopisch (VATS)", "Één-long ventilatie via dubbellumentube of bronchusblocker", "Wigexcisie / segment / lobectomie, of hele long (pneumectomie)"] },
      { t: "Mini Maze (boezemfibrilleren)", stuk: "Atriumfibrilleren — abnormale elektrische circuits, meestal rond de longvenen.", stappen: ["VATS met één-long ventilatie", "Ablatie (branden): een ring littekenweefsel rond de longvenen om de circuits te blokkeren", "Linker hartoor verwijderen (bron van AF + minder kans op trombus/beroerte)"] },
      { t: "Congenitaal (ASD / VSD)", stuk: "Aangeboren hartafwijking, bv. een gat tussen de boezems (ASD) of kamers (VSD).", stappen: ["Aan de ECC", "Defect sluiten (hechten of patch)", "Vaak grotere kinderen/volwassenen — eigen congenitaal protocol is leidend"] },
      { t: "E-CPR / ECMO (spoed)", stuk: "Circulatiestilstand — hart en longen vallen uit.", stappen: ["Op de shockroom of IC een ECMO plaatsen (canules in de grote vaten)", "ECMO neemt circulatie en oxygenatie tijdelijk over", "Volg het eigen spoed-/ECMO-protocol"] },
    ];
    const ECC_FASES = [
      { f: "Pre-bypass", kleur: "#FF9F0A", items: ["Heparine 300 IE/kg gegeven, na 3 min <strong>ACT > 350 s canuleren</strong>, <strong>> 400 s ECC starten</strong>", "Canulatie gecontroleerd", "TEE freeze", "Urine af, stop extra volume"] },
      { f: "Aan de bypass", kleur: "#0A84FF", items: ["Inspectie hoofd / nek / pupillen", "Beademing halveren bij volle flow", "Bij aortaklem: beademing stop, 5 cmH₂O PEEP, FiO₂ 21%"] },
      { f: "Van de bypass af", kleur: "#30D158", items: ["Lucht verwijderen (80% O₂, Trendelenburg)", "Kerntemperatuur > 36 °C", "Ritme / pacing op orde", "Ca²⁺ en K⁺ normaal", "Vulling op peil, Hb streef ± 6,0 mmol/l", "Protamine standby, TXA loopt"] },
    ];
    const HEPARINE = [
      { m: "Heparine (ECC)", w: "300 IE/kg vóór canulatie; na 3 min ACT bepalen — <strong>> 350 s canuleren, > 400 s ECC starten</strong>" },
      { m: "Heparine (OPCAB, off-pump)", w: "150 IE/kg — streef ACT 300 s" },
      { m: "Protamine", w: "0,8–1 : 1 (protamine : heparine); 5 min na toediening ACT — terug richting uitgangs-ACT" },
      { m: "Tranexaminezuur (TXA)", w: "1 g samen met de heparine vóór ECC (≈ 10 mg/kg), daarna 1–4 mg/kg/u" },
      { m: "Transfusietrigger", w: "Hb < 4 mmol/l: transfunderen · > 6 mmol/l: geen indicatie" },
    ];
    const KLEPPEN = [
      { k: "Aortastenose (AS)", doel: "Vol, normofrequent/traag ritme, sinusritme behouden, hoge SVR. <strong>Vermijd tachycardie en hypotensie.</strong>" },
      { k: "Aortainsufficiëntie (AI)", doel: "\"Fast, full & forward\" — iets sneller ritme, goed gevuld, lage SVR (vlot vooruit pompen)." },
      { k: "Mitralisstenose (MS)", doel: "Normaal tot laag ritme, sinusritme, vermijd tachycardie. <strong>Cave longoedeem.</strong>" },
      { k: "Mitralisinsufficiëntie (MI)", doel: "\"Fast, full & forward\" — lage SVR zodat het hart vooruit pompt i.p.v. terug." },
    ];
    const AFKORTINGEN = [
      ["ABG", "arterial blood gas (arteriële bloedgasanalyse)"], ["ACT", "activated clotting time"], ["AF", "atriumfibrilleren (boezemfibrilleren)"],
      ["AVR", "aortic valve replacement (aortaklepvervanging)"], ["AoX", "aortaklem (cross-clamp)"], ["APC", "atriale premature contractie"],
      ["APTT", "geactiveerde partiële tromboplastinetijd"], ["ASD", "atriumseptumdefect"],
      ["Bentall", "aortawortelvervanging: buisprothese mét kunstklep + herinplant coronairen"],
      ["CABG", "coronary artery bypass graft (coronaire omleiding)"], ["CCH", "cardiochirurgie"], ["CI", "cardiac index"],
      ["CO", "cardiac output"], ["CVD", "centraalveneuze druk"], ["ECC", "extracorporele circulatie (hart-longmachine)"],
      ["ECMO", "extracorporele membraanoxygenatie"], ["EF", "ejectiefractie"],
      ["EVAR", "endovasculair aneurysma repair (stent via de lies)"], ["FiO₂", "ingeademde zuurstoffractie"],
      ["FFP", "fresh frozen plasma"], ["HLM", "hart-longmachine"], ["IC", "intensive care"], ["INR", "international normalized ratio"],
      ["MV repair", "mitral valve repair (mitralisklepplastiek)"], ["MVR", "mitral valve replacement (mitralisklepvervanging)"], ["NIBP", "niet-invasieve bloeddruk"],
      ["OPCAB", "off-pump coronary artery bypass (CABG op kloppend hart)"], ["PAP", "pulmonalisarteriedruk"],
      ["PCWP", "pulmonary capillary wedge pressure"], ["PEARS", "personalised external aortic root support (maatkous rond de aortawortel)"],
      ["PEEP", "positieve eind-expiratoire druk"], ["TAAA", "thoraco-abdominaal aorta-aneurysma"],
      ["TEE", "transoesofageale echocardiografie"], ["VATS", "video-assisted thoracoscopic surgery (kijkoperatie thorax)"],
      ["VF", "ventrikelfibrilleren"], ["VSD", "ventrikelseptumdefect"],
      ["VSRR", "valve sparing root replacement (klepsparend, David-procedure)"],
    ];
    const HULPNUMMERS = [
      { r: "Anesthesie", n: "81-59663" }, { r: "Anesthesiemedewerker", n: "81-59571" },
      { r: "Perfusie", n: "81-57388" }, { r: "OK", n: "81-59152" }, { r: "Chirurg", n: "81-58683" },
    ];

    const medRow = (m, c) => (
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "0.5px solid rgba(84,84,88,0.65)" }}>
        <span style={{ fontWeight: 600, color: "#fff", fontSize: "14px" }}>{m}</span>
        <span style={{ fontFamily: "inherit", color: KLEUR, fontSize: "13px", textAlign: "right" }}>{c}</span>
      </div>
    );

    return (
      <div>
        <Collapse title="Klaarzetlijst cardio" color={KLEUR} icon={Icons.clipboard}>
          {sub("Positionering")}
          {li([
            "Rugligging, armen langs het lichaam in cardioschelpen met gelpads",
            "Tafel neutraal, intubatiekussen onder hoofd",
            "Bair Hugger / warmtedeken",
          ])}
          {sub("Monitoring")}
          {li([
            "NIBP, pulsoximetrie, 5-leads ECG",
            "Invasieve bloeddruk + CVD",
            "Capnografie",
            "Temperatuur (oraal + rectaal/blaas)",
            "NIRS (cerebrale oximetrie)",
          ])}
          {sub("Lijnen")}
          {li([
            "Perifeer infuus ≥ 18 G — voorkeur rechterarm",
            "Arterielijn — voorkeur linker a. radialis, onder echo",
            "Centraalveneuze lijn met side-port (hands-off)",
          ])}
          {sub("Medicatie standaard")}
          {KLAARZET_MEDS.map((x, i) => <React.Fragment key={i}>{medRow(x.m, x.c)}</React.Fragment>)}
          {sub("Standaardpompen")}
          {KLAARZET_POMPEN.map((x, i) => <React.Fragment key={i}>{medRow(x.m, x.c)}</React.Fragment>)}
          {sub("In overleg klaarzetten")}
          {KLAARZET_OVERLEG.map((x, i) => <React.Fragment key={i}>{medRow(x.m, x.c)}</React.Fragment>)}
        </Collapse>

        <Collapse title="Stappen van de operatie" color="#FF9F0A" icon={Icons.clipboard}>
          {STAPPEN.map((s, i) => (
            <div key={i} style={{
              background: "#E67E2212", border: "1px solid #E67E2240", borderLeft: "4px solid #FF9F0A",
              borderRadius: "10px", padding: "12px", marginBottom: "10px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <div style={{ background: "#FF9F0A", color: "#fff", width: "24px", height: "24px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px", flexShrink: 0 }}>{i + 1}</div>
                <div style={{ fontWeight: 700, color: "#FF9F0A", fontSize: "15px" }}>{s.t}</div>
              </div>
              <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6 }}>{s.d}</div>
            </div>
          ))}
        </Collapse>

        <Collapse title="Cardio-ingrepen" color="#FF453A" icon={Icons.heart}>
          {INGREPEN.map((ing, i) => (
            <div key={i} style={{
              background: `${KLEUR}10`, border: `1px solid ${KLEUR}35`, borderLeft: `4px solid ${KLEUR}`,
              borderRadius: "10px", padding: "12px", marginBottom: "12px",
            }}>
              <div style={{ fontWeight: 700, color: KLEUR, fontSize: "15px", marginBottom: "8px" }}>{ing.t}</div>
              <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "#FF453A", fontWeight: 700, marginBottom: "3px" }}>Aandoening</div>
              <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6, marginBottom: "10px" }}>{ing.stuk}</div>
              <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.3px", color: "#30D158", fontWeight: 700, marginBottom: "3px" }}>Ingreep</div>
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.7 }}>
                {ing.stappen.map((s, j) => <li key={j}>{s}</li>)}
              </ul>
            </div>
          ))}
        </Collapse>

        <Collapse title="ECC-checklist (aan/van de pomp)" color="#0A84FF" icon={Icons.clipboard}>
          {ECC_FASES.map((f, i) => kader(f.kleur, f.f, li(f.items, f.kleur)))}
        </Collapse>

        <Collapse title="Heparine · ACT · protamine · TXA" color="#BF5AF2" icon={Icons.pill}>
          {HEPARINE.map((x, i) => (
            <div key={i} style={{ padding: "10px 0", borderBottom: "0.5px solid rgba(84,84,88,0.65)" }}>
              <div style={{ fontWeight: 700, color: "#fff", fontSize: "14px", marginBottom: "3px" }}>{x.m}</div>
              <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: x.w }} />
            </div>
          ))}
        </Collapse>

        <Collapse title="Inotropica & vasopressoren — bereiding" color="#FF9F0A" icon={Icons.pill}>
          <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", fontStyle: "italic", marginBottom: "10px" }}>
            Standaard spuitenpomp-bereidingen CAPU OK (50 ml). Verifieer met protocol 'Inotropica en Medicatie CAPU OK'.
          </div>
          {INOTROPICA.map((x, i) => (
            <div key={i} style={{
              background: "#E67E2210", border: "1px solid #E67E2235", borderLeft: "4px solid #FF9F0A",
              borderRadius: "10px", padding: "12px", marginBottom: "10px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", marginBottom: "4px" }}>
                <span style={{ fontWeight: 700, color: "#FF9F0A", fontSize: "15px" }}>{x.m}</span>
                <span style={{ fontFamily: "inherit", color: "#fff", fontSize: "14px", whiteSpace: "nowrap" }}>{x.c}</span>
              </div>
              <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.5, marginBottom: "4px" }}>{x.b}</div>
              <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.8)", lineHeight: 1.5, fontStyle: "italic" }}>{x.w}</div>
            </div>
          ))}
        </Collapse>

        <Collapse title="Klepafwijkingen — hemodynamische doelen" color="#40C8E0" icon={Icons.heart}>
          <div style={{ fontSize: "12px", color: "rgba(235,235,245,0.6)", fontStyle: "italic", marginBottom: "10px" }}>
            Algemene leerregels — patiëntspecifiek beleid volgt de anesthesioloog.
          </div>
          {KLEPPEN.map((x, i) => kader("#40C8E0", x.k, (
            <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: x.doel }} />
          )))}
        </Collapse>

        <Collapse title="Afkortingen cardio" color="#0A84FF" icon={Icons.book}>
          {AFKORTINGEN.map((x, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "7px 0", borderBottom: "0.5px solid rgba(84,84,88,0.65)" }}>
              <span style={{ fontFamily: "inherit", color: "#0A84FF", fontSize: "14px", fontWeight: 700, flexShrink: 0 }}>{x[0]}</span>
              <span style={{ color: "rgba(235,235,245,0.8)", fontSize: "13px", textAlign: "right" }}>{x[1]}</span>
            </div>
          ))}
        </Collapse>

        <Collapse title="Spoed — verwijzing" color="#FF453A" icon={Icons.alert}>
          <div style={{ fontSize: "14px", color: "rgba(235,235,245,0.8)", lineHeight: 1.6, marginBottom: "12px" }}>
            Bij een acute situatie: volg de <strong style={{ color: "#FF453A" }}>fysieke spoedbundel cardiochirurgie</strong> op de OK (of via QR-code). Deze app vervangt de bundel niet — bij calamiteit altijd de bundel + zorgteam erbij.
          </div>
          {sub("Hulpnummers")}
          {HULPNUMMERS.map((x, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "0.5px solid rgba(84,84,88,0.65)" }}>
              <span style={{ fontWeight: 600, color: "#fff", fontSize: "14px" }}>{x.r}</span>
              <span style={{ fontFamily: "inherit", color: "#FF453A", fontSize: "14px" }}>{x.n}</span>
            </div>
          ))}
        </Collapse>
      </div>
    );
  };

  // Eén centrale map id -> render-functie. Een nieuw tabblad hier toevoegen
  // maakt het automatisch zowel rendervaar ALS volledig doorzoekbaar.
  const SECTION_RENDERERS = {
    nood: renderNood, tel: renderTelefoonTab, ok: renderOK, abcde: renderABCDE,
    medicatie: renderMedicatie, checks: renderChecks, bloedgas: renderBloedgas,
    kinder: renderKinder, als: renderALS, spoed: renderSpoed, team: renderTeam,
    epas: renderEPAs, isolatie: renderIsolatie, personeel: renderPersoneel, calculator: renderCalculator,
    dermatomen: renderDermatomen, vaatstelsel: renderVaatstelsel,
    plattegrond: renderPlattegrond, buizen: renderBuizen, ecg: renderECG,
    rooster: renderRooster, cardio: renderCardio,
  };

  const renderContent = () => {
    const r = SECTION_RENDERERS[activeSection];
    return r ? r() : null;
  };

  // ---- Volledige full-text zoekindex ----
  // Loopt door de ELEMENT-tree van elke tab (zonder te mounten) en verzamelt
  // ALLE tekst, inclusief inline-paragrafen en gesloten collapses. Elke
  // toevoeging aan welk tabblad dan ook wordt zo automatisch vindbaar.
  const buildSearchIndex = () => {
    const idx = [];
    const walk = (node, collapse, sectionId, sectionLabel, loc) => {
      if (node == null || node === false || node === true) return;
      if (typeof node === "string" || typeof node === "number") {
        const s = String(node).trim();
        if (s) idx.push({ section: sectionId, sectionLabel, collapse, text: s, loc });
        return;
      }
      if (Array.isArray(node)) { node.forEach(n => walk(n, collapse, sectionId, sectionLabel, loc)); return; }
      if (typeof node === "object" && node.props) {
        const p = node.props;
        let ct = collapse;
        if (node.type === Collapse && typeof p.title === "string") {
          ct = p.title;
          idx.push({ section: sectionId, sectionLabel, collapse: ct, text: p.title, loc });
        }
        // Leaf-componenten geven hun tekst via props door (niet via children),
        // dus die moeten hier expliciet herkend en geïndexeerd worden — anders
        // blijft alles wat erin staat onvindbaar via de zoekbalk.
        if (node.type === PhoneRow) {
          const naam = typeof p.naam === "string" ? p.naam.trim() : "";
          const nummer = typeof p.nummer === "string" ? p.nummer.trim() : "";
          if (naam || nummer) {
            idx.push({ section: sectionId, sectionLabel, collapse: ct, text: [naam, nummer].filter(Boolean).join(" — "), loc });
          }
        }
        if (node.type === PersonCard && p.p && typeof p.p === "object") {
          const person = p.p;
          const naam = typeof person.naam === "string" ? person.naam.trim() : "";
          const rol = typeof person.rol === "string" ? person.rol.trim() : "";
          if (naam) {
            const kw = [person.tel, person.intern, person.email]
              .filter(v => typeof v === "string" && v.trim() && v !== "—")
              .join(" ");
            idx.push({ section: sectionId, sectionLabel, collapse: ct, text: [naam, rol].filter(Boolean).join(" — "), kw, loc });
          }
        }
        if (node.type === ImageCard && typeof p.beschrijving === "string" && p.beschrijving.trim()) {
          idx.push({ section: sectionId, sectionLabel, collapse: ct, text: p.beschrijving, loc });
        }
        if (node.type === TableRow && Array.isArray(p.cells)) {
          p.cells.forEach(c => {
            if ((typeof c === "string" || typeof c === "number") && String(c).trim()) {
              idx.push({ section: sectionId, sectionLabel, collapse: ct, text: String(c), loc });
            }
          });
        }
        ["label", "placeholder", "alt"].forEach(k => {
          if (typeof p[k] === "string" && p[k].trim()) idx.push({ section: sectionId, sectionLabel, collapse: ct, text: p[k], loc });
        });
        walk(p.children, ct, sectionId, sectionLabel, loc);
      }
    };
    SECTIONS.forEach(s => {
      if (s.id === "tel") {
        // Telefoonnummers worden per locatie gerenderd (AMC/VU) op basis van de
        // huidige `locatie`-keuze; hier indexeren we beide locaties expliciet
        // (met een loc-tag), zodat nummers van de niet-geselecteerde locatie
        // ook vindbaar zijn én een klik op het resultaat de juiste locatie opent.
        try { walk(renderTelefoon(TELEFOON_AMC, "AUMC, locatie AMC"), null, s.id, s.label, "amc"); } catch (e) {}
        try { walk(renderTelefoon(TELEFOON_VUMC, "AUMC, locatie VU"), null, s.id, s.label, "vumc"); } catch (e) {}
        return;
      }
      const r = SECTION_RENDERERS[s.id];
      if (!r) return;
      let tree = null;
      try { tree = r(); } catch (e) { tree = null; }
      walk(tree, null, s.id, s.label);
    });
    // Tabblad-namen + synoniemen — zodat elk tabblad ook via trefwoorden vindbaar blijft
    const SYNONIEMEN = {
      tel: ["telefoon", "nummer", "bellen", "sein", "dienst", "contact"],
      ok: ["operatiekamer", "schiphol", "specialisme"],
      abcde: ["primary survey", "acuut", "benadering"],
      medicatie: ["medicijn", "geneesmiddel", "dosering"],
      checks: ["checklist", "veiligheid", "overdracht", "saltmovies", "lemon", "sbar"],
      bloedgas: ["bga", "rotem", "stolling", "beademing"],
      kinder: ["kind", "pediatrie", "baby", "neonaat"],
      als: ["reanimatie", "cpr", "ritme", "advanced life support"],
      spoed: ["noodknop", "spoedbundel", "luchtwegkar", "mlk"],
      team: ["vertrouwenspersoon", "peersupport", "leidinggevende"],
      epas: ["epa", "supervisie", "opleiding", "bekwaam"],
      isolatie: ["isolatie", "besmetting", "hygiene", "biohazard"],
      personeel: ["telefoonlijst", "personeel", "diensten", "artsen", "collega", "specialisme", "dienstseinen"],
      calculator: ["rekenen", "gewicht", "tube", "dosis", "vocht"],
      dermatomen: ["dermatoom", "zenuw", "blokkade", "anatomie"],
      vaatstelsel: ["vaten", "arterie", "ader", "anatomie"],
      plattegrond: ["kaart", "ingang", "gebouw", "route", "locatie"],
      buizen: ["buis", "buisje", "buizenpost", "afnamebuis", "lab"],
      ecg: ["ecg", "ritme", "hartfilm"],
      cardio: ["hart", "thoracaal", "ecc", "pomp"],
      rooster: ["dienst", "vakantie", "verlof", "joker", "balansverlof", "ows", "atw", "ruilen"],
    };
    SECTIONS.forEach(s => {
      if (s.id === "nood") return;
      idx.push({ section: s.id, sectionLabel: "Tabblad", collapse: null, text: "Open tabblad: " + s.label, kw: [s.label].concat(SYNONIEMEN[s.id] || []).join(" ") });
    });
    return idx;
  };

  const searchIndexRef = useRef(null);
  const searchFuseRef = useRef(null);
  const deaccent = s => (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f\u200B]/g, "").toLowerCase();
  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return null;
    if (!searchIndexRef.current) {
      try { searchIndexRef.current = buildSearchIndex(); }
      catch (e) { searchIndexRef.current = []; }
    }
    if (!searchFuseRef.current && window.Fuse) {
      searchFuseRef.current = new Fuse(searchIndexRef.current, {
        keys: [
          { name: "text", weight: 0.5 },
          { name: "collapse", weight: 0.25 },
          { name: "kw", weight: 0.15 },
          { name: "sectionLabel", weight: 0.1 },
        ],
        includeScore: true,
        ignoreLocation: true,
        threshold: 0.38,
        minMatchCharLength: 2,
      });
    }
    const ql = deaccent(searchQuery);

    // Zoektermen: origineel + medicatie/afkorting-synoniemen (bv. "esmeron" -> ook "rocuronium")
    const terms = [searchQuery];
    const padded = " " + ql + " ";
    for (const key in ZOEK_SYNONIEMEN) {
      if (padded.includes(" " + key + " ")) terms.push(...ZOEK_SYNONIEMEN[key]);
    }

    const seen = new Map(); // "section|collapse|text" -> { item, score }
    if (searchFuseRef.current) {
      for (const term of terms) {
        for (const r of searchFuseRef.current.search(term)) {
          const it = r.item;
          const key = it.section + "|" + (it.collapse || "") + "|" + it.text;
          const prev = seen.get(key);
          if (!prev || r.score < prev.score) seen.set(key, { item: it, score: r.score });
        }
      }
    } else {
      // Fallback zonder Fuse (bv. als fuse.min.js niet kon laden): letterlijke woord-match
      const tokens = ql.split(/\s+/).filter(Boolean);
      for (const item of searchIndexRef.current) {
        const hay = deaccent((item.text || "") + " " + (item.collapse || "") + " " + (item.sectionLabel || "") + " " + (item.kw || ""));
        if (!tokens.every(t => hay.includes(t))) continue;
        const key = item.section + "|" + (item.collapse || "") + "|" + item.text;
        if (!seen.has(key)) seen.set(key, { item, score: 0 });
      }
    }

    // Prefix- en exacte-treffer-boost, zodat de beste match bovenaan staat
    const arr = [...seen.values()];
    arr.forEach(r => {
      const words = deaccent((r.item.text || "") + " " + (r.item.collapse || "")).split(/[\s\-/]+/).filter(Boolean);
      if (words.some(w => w.startsWith(ql))) r.score *= 0.3;
      if (deaccent(r.item.text || "") === ql || deaccent(r.item.collapse || "") === ql) r.score *= 0.1;
    });
    arr.sort((a, b) => a.score - b.score);

    const out = [];
    for (const { item } of arr) {
      const person = (item.section === "team")
        ? LEIDINGGEVENDEN.find(pp => item.text.includes(pp.naam))
        : null;
      out.push({
        section: item.section,
        collapse: item.collapse || null,
        text: item.text,
        cat: item.sectionLabel + (item.collapse ? " · " + item.collapse : ""),
        personData: person || undefined,
        loc: item.loc || undefined,
      });
      if (out.length >= 60) break;
    }
    return out;
  }, [searchQuery]);

  useEffect(() => { setTabSearchQuery(""); }, [activeSection]);

  const tabSearchResults = useMemo(() => {
    if (!activeSection || !tabSearchQuery || tabSearchQuery.length < 2) return null;
    if (!searchIndexRef.current) {
      try { searchIndexRef.current = buildSearchIndex(); }
      catch (e) { searchIndexRef.current = []; }
    }
    if (!searchFuseRef.current && window.Fuse) {
      searchFuseRef.current = new Fuse(searchIndexRef.current, {
        keys: [
          { name: "text", weight: 0.5 },
          { name: "collapse", weight: 0.25 },
          { name: "kw", weight: 0.15 },
          { name: "sectionLabel", weight: 0.1 },
        ],
        includeScore: true,
        ignoreLocation: true,
        threshold: 0.38,
        minMatchCharLength: 2,
      });
    }
    const ql = deaccent(tabSearchQuery);
    const terms = [tabSearchQuery];
    const padded = " " + ql + " ";
    for (const key in ZOEK_SYNONIEMEN) {
      if (padded.includes(" " + key + " ")) terms.push(...ZOEK_SYNONIEMEN[key]);
    }
    const seen = new Map();
    if (searchFuseRef.current) {
      for (const term of terms) {
        for (const r of searchFuseRef.current.search(term)) {
          const it = r.item;
          if (it.section !== activeSection) continue;
          const key = (it.collapse || "") + "|" + it.text;
          const prev = seen.get(key);
          if (!prev || r.score < prev.score) seen.set(key, { item: it, score: r.score });
        }
      }
    } else {
      const tokens = ql.split(/\s+/).filter(Boolean);
      for (const item of searchIndexRef.current) {
        if (item.section !== activeSection) continue;
        const hay = deaccent((item.text || "") + " " + (item.collapse || "") + " " + (item.sectionLabel || "") + " " + (item.kw || ""));
        if (!tokens.every(t => hay.includes(t))) continue;
        const key = (item.collapse || "") + "|" + item.text;
        if (!seen.has(key)) seen.set(key, { item, score: 0 });
      }
    }
    const arr = [...seen.values()];
    arr.forEach(r => {
      const words = deaccent((r.item.text || "") + " " + (r.item.collapse || "")).split(/[\s\-/]+/).filter(Boolean);
      if (words.some(w => w.startsWith(ql))) r.score *= 0.3;
      if (deaccent(r.item.text || "") === ql || deaccent(r.item.collapse || "") === ql) r.score *= 0.1;
    });
    arr.sort((a, b) => a.score - b.score);
    const out = [];
    for (const { item } of arr) {
      const person = (item.section === "team")
        ? LEIDINGGEVENDEN.find(pp => item.text.includes(pp.naam))
        : null;
      out.push({
        collapse: item.collapse || null,
        text: item.text,
        cat: item.collapse || "",
        personData: person || undefined,
        loc: item.loc || undefined,
      });
      if (out.length >= 30) break;
    }
    return out;
  }, [tabSearchQuery, activeSection]);

  // ---- Schil: navigatie, grote titel, tabbalk ----
  const isSettings = activeSection === SETTINGS_ID;
  const activeSectionData = SECTIONS.find(s => s.id === activeSection);
  const isTabRoot = TABS.some(tb => tb.id === activeSection);
  const currentTab = isTabRoot ? activeSection : HOME;
  const screenTitle = isSettings ? "Instellingen" : activeSectionData ? activeSectionData.label : APP_TITLE;
  const showBack = activeSection !== HOME && !isTabRoot;
  const goSection = id => { setCollapseTarget(null); setActiveSection(id); };
  const onScroll = e => {
    const solid = e.currentTarget.scrollTop > 36;
    if (solid !== navSolidRef.current) { navSolidRef.current = solid; setNavSolid(solid); }
  };
  useEffect(() => { window.__zkGo = id => goSection(id === undefined ? HOME : id); }, []);

  const SearchField = (value, onChange, placeholder) => (
    <div className="zk-search">
      {Icons.search}
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" />
      {value && (
        <button type="button" className="zk-search-clear" aria-label="Zoekveld leegmaken" onClick={() => onChange("")}><span>✕</span></button>
      )}
    </div>
  );
  const ResultRow = (r, i, onPick) => (
    <button key={i} type="button" className="zk-row" onClick={onPick}>
      <span className="zk-grow">
        {r.cat && <span className="zk-result-cat">{r.cat}</span>}
        <span className="zk-result-text">{r.text}</span>
      </span>
      <ChevronRight />
    </button>
  );
  const SPOEDBUNDELS = [
    { label: "Spoedbundel volwassenen", url: "https://webshare.zenya.work/DocumentResource/f06ea341-cf2d-4145-ab3c-f7b07b783b05/Document.pdf?webshareid=wh1w34sv1f896hpw&showinlinepdf=1&fullscreen=1" },
    { label: "Spoedbundel kind", url: "https://webshare.zenya.work/DocumentResource/c6da3fb2-d12a-4760-ba21-e457bb2d7d7f/Document.pdf?webshareid=wh1w34sv1f896hpw&showinlinepdf=1&fullscreen=1" },
  ];

  return (
    <div className="zk-app">
      {/* Buis modal — top level zodat position:fixed altijd werkt */}
      {selectedBuis && (() => {
        const b = selectedBuis;
        const isSet = b.code === "QTB";
        const isSpuit = b.code === "SPUI";
        const hasStripe = b.code === "STE6" || b.code === "ETE6";
        const isTransparant = b.code === "EDT3" || b.code === "FLU2";
        return (
          <div onClick={() => setSelectedBuis(null)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
            zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: "#1A1F2E", borderRadius: "20px", padding: "28px 24px",
              maxWidth: "280px", width: "100%", border: `1px solid ${b.dopKleur}50`, textAlign: "center",
            }}>
              {/* SVG afbeelding */}
              <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
                {isSet ? (
                  <svg viewBox="0 0 160 120" xmlns="http://www.w3.org/2000/svg" style={{ width: 200 }}>
                    {["#7D3C98","#82E0AA","#FFD60A","#FF453A"].map((k, i) => (
                      <g key={i} transform={`translate(${18 + i * 34}, 0)`}>
                        <rect x="4" y="18" width="22" height="72" rx="3" fill="#f0f0f0" stroke="#ccc" strokeWidth="1"/>
                        <rect x="4" y="18" width="22" height="16" rx="3" fill={k}/>
                        <rect x="6" y="34" width="8" height="30" rx="2" fill="white" opacity="0.5"/>
                      </g>
                    ))}
                  </svg>
                ) : isSpuit ? (
                  <svg viewBox="0 0 180 80" xmlns="http://www.w3.org/2000/svg" style={{ width: 220 }}>
                    <rect x="10" y="28" width="110" height="22" rx="4" fill="#e8e8e8" stroke="#bbb" strokeWidth="1.5"/>
                    <rect x="10" y="28" width="24" height="22" rx="4" fill="#bbb" stroke="#999" strokeWidth="1"/>
                    <rect x="120" y="34" width="34" height="10" rx="2" fill="#aaa"/>
                    <rect x="152" y="36" width="14" height="6" rx="1" fill="#888"/>
                    <rect x="30" y="32" width="66" height="14" rx="2" fill="white" opacity="0.6"/>
                    <rect x="26" y="22" width="4" height="34" rx="1" fill="#aaa"/>
                    <rect x="96" y="22" width="4" height="34" rx="1" fill="#aaa"/>
                    <text x="90" y="72" textAnchor="middle" fontSize="12" fill="#888" fontFamily="sans-serif">Bloedgas spuit</text>
                  </svg>
                ) : (
                  <svg viewBox="0 0 100 200" xmlns="http://www.w3.org/2000/svg" style={{ width: 110 }}>
                    {/* Buis lichaam */}
                    <rect x="22" y="44" width="56" height="130" rx="8" fill={isTransparant ? "#ddd" : "#f5f5f5"} stroke="#ccc" strokeWidth="1.5"/>
                    {/* Vloeistof */}
                    <rect x="23" y="115" width="54" height="55" rx="0" fill={b.dopKleur} opacity="0.2"/>
                    {/* Dop */}
                    <rect x="20" y="22" width="60" height="28" rx="7" fill={b.dopKleur} stroke="rgba(0,0,0,0.1)" strokeWidth="1"/>
                    {/* Glans dop */}
                    <rect x="26" y="25" width="18" height="14" rx="3" fill="white" opacity="0.3"/>
                    {/* Rode streep */}
                    {hasStripe && <rect x="22" y="72" width="56" height="5" fill="#FF453A" opacity="0.9"/>}
                    {/* Etiket */}
                    <rect x="26" y="56" width="48" height="74" rx="2" fill="white" opacity="0.75" stroke="#ddd" strokeWidth="0.5"/>
                    {/* Streepjescode */}
                    {[0,3,6,9,12,16,20,24,28,32,36,40].map(x => (
                      <rect key={x} x={28+x} y="60" width={x%9===0?2:1} height="18" fill="#333" opacity="0.55"/>
                    ))}
                    {/* Code */}
                    <text x="50" y="104" textAnchor="middle" fontSize="10" fontWeight="700" fill="#333" fontFamily="monospace">{b.code}</text>
                    {/* Glans buis */}
                    <rect x="26" y="46" width="9" height="116" rx="3" fill="white" opacity="0.2"/>
                    {/* Afgerond onderkant */}
                    <ellipse cx="50" cy="174" rx="28" ry="7" fill={b.dopKleur} opacity="0.15"/>
                  </svg>
                )}
              </div>
              <div style={{ display: "inline-block", background: b.dopKleur, color: b.dopTekst, fontWeight: 700, fontSize: "14px", padding: "4px 14px", borderRadius: "20px", marginBottom: "10px" }}>{b.code}</div>
              <div style={{ fontWeight: 700, color: "#fff", fontSize: "16px", marginBottom: "6px" }}>{b.kenmerk}</div>
              <div style={{ fontSize: "14px", color: "#64D2FF", marginBottom: "10px", lineHeight: 1.5 }}>{b.doel}</div>
              <div style={{ fontSize: "13px", color: "rgba(235,235,245,0.6)", lineHeight: 1.8 }}>
                {b.anticoagulans !== "—" && <div>Anticoagulans: <span style={{ color: "rgba(235,235,245,0.8)" }}>{b.anticoagulans}</span></div>}
                {b.volume !== "—" && <div>Volume: <span style={{ color: "rgba(235,235,245,0.8)" }}>{b.volume}</span></div>}
                {b.bestelnr !== "—" && <div>Bestelnr: <span style={{ fontFamily: "monospace", color: "rgba(235,235,245,0.8)" }}>#{b.bestelnr}</span></div>}
              </div>
              {b.opmerking && (
                <div style={{ marginTop: "10px", fontSize: "13px", color: "#FFD60A", background: "rgba(255,214,10,0.08)", padding: "8px", borderRadius: "8px", border: "1px solid rgba(255,214,10,0.2)", lineHeight: 1.5 }}>⚠ {b.opmerking}</div>
              )}
              <button onClick={() => setSelectedBuis(null)} style={{ marginTop: "18px", background: "rgba(118,118,128,0.24)", border: "0.5px solid rgba(84,84,88,0.65)", borderRadius: "10px", padding: "10px 28px", color: "#fff", fontSize: "15px", cursor: "pointer", fontFamily: "inherit", width: "100%" }}>Sluiten</button>
            </div>
          </div>
        );
      })()}

      <div className="zk-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className={"zk-nav" + (navSolid ? " is-solid" : "")}>
          <div className="zk-nav-row">
            <div>
              {showBack && (
                <button type="button" className="zk-back" onClick={() => goSection(HOME)}>
                  <svg viewBox="0 0 12 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 2L2 10l8 8" /></svg>
                  {HOME === null ? "Start" : "Terug"}
                </button>
              )}
            </div>
            <div className="zk-nav-title">{screenTitle}</div>
            <div className="zk-nav-right">
              {activeSection === HOME && (
                <button type="button" className="zk-nav-btn" aria-label="Instellingen" onClick={() => goSection(SETTINGS_ID)}>{Icons.gear}</button>
              )}
            </div>
          </div>
        </div>

        <div style={{ zoom: zoomMap[settings.fontSize] || 1 }}>
          <div className="zk-head">
            <h1 className="zk-large-title">{screenTitle}</h1>
            {activeSection === null && <div className="zk-subtitle">{APP_SUBTITLE} · {VERSIE}</div>}
            {activeSection === null && SearchField(searchQuery, setSearchQuery, "Zoek op naam, nummer, medicatie")}
            {activeSection && !isSettings && SearchField(tabSearchQuery, setTabSearchQuery, `Zoek in ${activeSectionData ? activeSectionData.label : "dit tabblad"}`)}
          </div>

          {/* Zoekresultaten binnen een tabblad */}
          {tabSearchResults && (
            <div className="zk-section" style={{ paddingBottom: "4px" }}>
              {tabSearchResults.length === 0 ? (
                <div className="zk-empty" style={{ padding: "14px 0" }}>Geen resultaten in dit tabblad</div>
              ) : (
                <div className="zk-list">
                  {tabSearchResults.map((r, i) => ResultRow(r, i, () => {
                    if (r.personData) {
                      skipPersonResetRef.current = true;
                      setSelectedPerson(r.personData);
                    } else if (r.loc) {
                      setLocatie(r.loc);
                    }
                    setCollapseTarget(r.collapse ? { title: r.collapse, nonce: Date.now() } : null);
                    setTabSearchQuery("");
                  }))}
                </div>
              )}
            </div>
          )}

          {/* Zoekresultaten over alle tabbladen */}
          {searchResults && activeSection === null && (
            <div className="zk-section">
              {searchResults.length === 0 ? (
                <div className="zk-empty">Geen resultaten gevonden</div>
              ) : (
                <div className="zk-list">
                  {searchResults.map((r, i) => ResultRow(r, i, () => {
                    if (r.personData) {
                      skipPersonResetRef.current = true;
                      setSelectedPerson(r.personData);
                      setActiveSection("team");
                    } else {
                      if (r.loc) setLocatie(r.loc);
                      setActiveSection(r.section);
                    }
                    setCollapseTarget(r.collapse ? { title: r.collapse, nonce: Date.now() } : null);
                    setSearchQuery("");
                  }))}
                </div>
              )}
            </div>
          )}

          {/* Startscherm */}
          {activeSection === null && !searchResults && (
            <div className="zk-section">
              <button type="button" className="zk-nood" onClick={() => goSection("nood")}>
                {Icons.alert}
                <span>Nood & spoednummers</span>
                <span className="zk-nood-num">{NOODNUMMERS.brand}</span>
              </button>

              <div className="zk-list" style={{ marginTop: "12px" }}>
                {SPOEDBUNDELS.map(doc => (
                  <a key={doc.label} className="zk-row" href={doc.url} target="_blank" rel="noopener noreferrer">
                    <span className="zk-grow">{doc.label}</span>
                    <span className="zk-ext" aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>

              {SECTION_GROUPS.map(group => {
                const items = group.ids.map(id => SECTIONS.find(s => s.id === id)).filter(Boolean);
                return (
                  <div key={group.titel}>
                    <div className="zk-gh">{group.titel}</div>
                    {settings.startView === "tiles" ? (
                      <div className="zk-tiles">
                        {items.map(section => (
                          <button key={section.id} type="button" className="zk-tile" onClick={() => goSection(section.id)}>
                            <span className="zk-ic" style={{ background: section.color }}>{React.cloneElement(section.icon, { width: 19, height: 19 })}</span>
                            <span className="zk-tile-label">{section.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="zk-list">
                        {items.map(section => (
                          <button key={section.id} type="button" className="zk-row has-icon" onClick={() => goSection(section.id)}>
                            <span className="zk-ic" style={{ background: section.color }}>{React.cloneElement(section.icon, { width: 17, height: 17 })}</span>
                            <span className="zk-grow">{section.label}</span>
                            <ChevronRight />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Inhoud van een tabblad */}
          {activeSection && !isSettings && (
            <div className="zk-section" data-section-content>
              <CollapseTargetCtx.Provider value={collapseTarget}>
                {renderContent()}
              </CollapseTargetCtx.Provider>
            </div>
          )}
          {isSettings && renderSettings()}
        </div>
      </div>

      <nav className="zk-tabbar" aria-label="Hoofdnavigatie">
        {TABS.map(tb => {
          const on = tb.id === currentTab;
          return (
            <button key={String(tb.id)} type="button"
              className={"zk-tab" + (on ? " is-on" : "") + (tb.id === "nood" ? " is-nood" : "")}
              aria-current={on ? "page" : undefined}
              onClick={() => {
                if (activeSection === tb.id) {
                  if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
                } else goSection(tb.id);
              }}>
              {React.cloneElement(tb.icon, { width: 25, height: 25 })}
              <span>{tb.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}


    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<ZakkaartApp />);
