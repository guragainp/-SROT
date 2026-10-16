// ─── SITE INTELLIGENCE MODULE ───
// Site Resilience Analysis: any address → live hazard evidence from public sources
// (FEMA, NOAA, USGS, CMIP6 climate models) + user-added data → Present vs 2050 risk → strategies.
//
// How a level is decided (see SI_RULES for the exact numbers):
//   1. Each source gives its own Low / Moderate / High reading for a hazard and period.
//   2. The hazard's level for that period is the HIGHEST reading from any source (conservative).
//   3. For climate-driven hazards (heat, flood, coastal) 2050 is never lower than Present.
// Every reading is listed on the card with its source, so the result can be checked.
//
// To add a hazard: add it to SI_HAZARDS and SI_STRATEGIES, then have a source push readings for its id.
// To add a source: write an async function (ctx) → readings[] and register it in SI_SOURCES.

const SI_SAVED_KEY = 'srot.savedStrategies';
const SI_USER_KEY = 'srot.userSiteData';
const SI_TIMEOUT_MS = 20000;

// ─── scoring parameters (all thresholds live here) ───
const SI_RULES = {
  heat: {
    hotDayC: 32,                 // a "hot day" has a max temperature ≥ 32 °C (≈ 90 °F)
    moderateDays: 10,            // ≥ 10 hot days per year → Moderate
    highDays: 30,                // ≥ 30 hot days per year → High
  },
  rain: {
    heavyMm: 50,                 // a "heavy-rain day" has ≥ 50 mm (≈ 2 in) of rain
    moderateDays: 1,             // ≥ 1 heavy-rain day per year → Moderate
    highDays: 3,                 // ≥ 3 heavy-rain days per year → High
    futureBumpPct: 20,           // heavy-rain days up ≥ 20% by 2050 → 2050 goes one level above Present
  },
  baseline: [1991, 2020],        // "Present" climate window (WMO standard normal)
  future: [2036, 2050],          // "2050" climate window (the climate model data ends in 2050)
  coastal: {
    highElevM: 3,                // ground ≤ 3 m above sea level near the coast → High
    moderateElevM: 10,           // ground ≤ 10 m near the coast → Moderate
    nearCoastKm: 10,             // "near the coast" = NOAA tide gauge within 10 km (US)
    slr2050M: 0.3,               // NOAA 2022 report: ~0.25–0.30 m US sea level rise by 2050
  },
  quake: {
    radiusKm: 200,               // look for earthquakes within 200 km
    minMag: 5,                   // count earthquakes of magnitude ≥ 5.0
    since: '1975-01-01',         // over the last ~50 years
    moderateCount: 1,            // ≥ 1 such earthquake → Moderate
    highCount: 10,               // ≥ 10 such earthquakes, or any M ≥ 7.0 → High
    highMag: 7,
  },
  userMatchKm: 2,                // user-added data applies to sites within 2 km of where it was added
};

const SI_HAZARDS = [
  { id: 'heat',       name: 'Extreme heat',  sub: 'Hot days · heat waves',          icon: 'ti-temperature-sun', ico: 'ii-amber',  climate: true },
  { id: 'flood',      name: 'Flooding',      sub: 'Stormwater and riverine',        icon: 'ti-droplet',         ico: 'ii-blue',   climate: true },
  { id: 'coastal',    name: 'Coastal risk',  sub: 'Sea level rise · storm surge',   icon: 'ti-ripple',          ico: 'ii-teal',   climate: true },
  { id: 'earthquake', name: 'Earthquake',    sub: 'Ground shaking',                 icon: 'ti-activity',        ico: 'ii-purple', climate: false },
  { id: 'hurricane',  name: 'Hurricane',     sub: 'High wind · tropical storms',    icon: 'ti-tornado',         ico: 'ii-gray',   climate: true },
  { id: 'wildfire',   name: 'Wildfire',      sub: 'Wildland and urban-edge fire',   icon: 'ti-flame',           ico: 'ii-amber',  climate: true },
];

const SI_RISK = {
  low:      { label: 'Low',      cls: 'lc-good', n: 0 },
  moderate: { label: 'Moderate', cls: 'lc-med',  n: 1 },
  high:     { label: 'High',     cls: 'lc-low',  n: 2 },
};
const SI_LEVELS = ['low', 'moderate', 'high'];

const SRC = {
  epaHeat:   { name: 'EPA · Reduce Heat Islands', url: 'https://www.epa.gov/green-infrastructure/reduce-heat-islands' },
  epaGuide:  { name: 'EPA · Guide to Reducing Heat Islands', url: 'https://www.epa.gov/heatislands/guide-reducing-heat-islands' },
  leedRes:   { name: 'USGBC · LEED Resilient Design Pilot Credits', url: 'https://www.usgbc.org/sites/default/files/LEED-Resilient-Design-Pilot-Credits-Brief-FINAL.pdf' },
  femaP312:  { name: 'FEMA P-312 · Homeowner\'s Guide to Retrofitting', url: 'https://basc.pnnl.gov/library/fema-p-312-homeowners-guide-retrofitting-six-ways-protect-your-home-floods-3rd-edition' },
  femaMsc:   { name: 'FEMA Flood Map Service Center', url: 'https://msc.fema.gov/portal/home' },
  femaP55:   { name: 'FEMA P-55 · Coastal Construction Manual', url: 'https://www.fema.gov/sites/default/files/2020-07/nhp_fema55.pdf' },
  femaNri:   { name: 'FEMA · National Risk Index', url: 'https://hazards.fema.gov/nri/' },
  femaWind:  { name: 'FEMA · Building Science for Hurricanes', url: 'https://www.fema.gov/emergency-managers/risk-management/building-science/hurricanes' },
  fortified: { name: 'IBHS · FORTIFIED Home standard', url: 'https://fortifiedhome.org/' },
  firewise:  { name: 'NFPA · Firewise USA', url: 'https://www.nfpa.org/firewise' },
  ibhsFire:  { name: 'IBHS · Wildfire research', url: 'https://ibhs.org/wildfire/' },
  noaaSlr:   { name: 'NOAA · 2022 Sea Level Rise Technical Report', url: 'https://oceanservice.noaa.gov/hazards/sealevelrise/sealevelrise-tech-report.html' },
  noaaTides: { name: 'NOAA · Tides & Currents stations', url: 'https://tidesandcurrents.noaa.gov/' },
  nws:       { name: 'NOAA · National Weather Service alerts', url: 'https://www.weather.gov/alerts' },
  usgsEq:    { name: 'USGS · Earthquake Catalog', url: 'https://earthquake.usgs.gov/earthquakes/search/' },
  openMeteo: { name: 'Open-Meteo Climate API · CMIP6 HighResMIP', url: 'https://open-meteo.com/en/docs/climate-api' },
  elevation: { name: 'Open-Meteo Elevation API · Copernicus DEM', url: 'https://open-meteo.com/en/docs/elevation-api' },
  osm:       { name: 'OpenStreetMap Nominatim', url: 'https://nominatim.openstreetmap.org/' },
  thinkEq:   { name: 'ThinkHazard! (GFDRR)', url: 'https://thinkhazard.org/' },
};

const SI_STRATEGIES = {
  heat: [
    { id: 'heat-cool-roof',  title: 'Cool roof',                   desc: 'Specify a high-reflectance roof membrane or coating to cut roof temperature and cooling demand.', source: SRC.epaHeat },
    { id: 'heat-green-roof', title: 'Green roof',                  desc: 'Vegetated roof assemblies shade the roof surface and cool surrounding air through evaporation.', source: SRC.epaHeat },
    { id: 'heat-trees',      title: 'Shade trees and vegetation',  desc: 'Plant trees to shade west and south facades, paving and outdoor spaces.', source: SRC.epaGuide },
    { id: 'heat-passive',    title: 'Passive survivability',       desc: 'Design the envelope and ventilation so the building stays livable during a summer power outage.', source: SRC.leedRes },
  ],
  flood: [
    { id: 'flood-elevate',   title: 'Elevate critical equipment',  desc: 'Place electrical, mechanical and fire systems above the design flood elevation.', source: SRC.femaP312 },
    { id: 'flood-proofing',  title: 'Wet or dry floodproofing',    desc: 'Use flood-resistant materials below the flood line, or seal the lower envelope where allowed.', source: SRC.femaP312 },
    { id: 'flood-zone',      title: 'Confirm the regulatory flood zone', desc: 'Check the parcel on the effective FEMA flood map (FIRM) before setting floor elevations.', source: SRC.femaMsc },
    { id: 'flood-plan',      title: 'Resilience assessment early', desc: 'Assess flood exposure before design starts and set performance targets for the project team.', source: SRC.leedRes },
  ],
  coastal: [
    { id: 'coastal-foundation', title: 'Open, elevated foundations', desc: 'Use piles or open foundations so storm surge and waves pass beneath the building.', source: SRC.femaP55 },
    { id: 'coastal-slr',        title: 'Design for future sea level', desc: 'Set floor and equipment elevations using a sea level rise scenario for the building\'s lifespan.', source: SRC.noaaSlr },
  ],
  earthquake: [
    { id: 'eq-design',   title: 'Seismic design from the start', desc: 'Account for earthquake loads in every phase of design and construction, not as a late check.', source: SRC.thinkEq },
    { id: 'eq-retrofit', title: 'Retrofit unreinforced masonry', desc: 'Tie walls, floors and roofs together and add bands or frames so older masonry holds together in shaking.', source: SRC.thinkEq },
  ],
  hurricane: [
    { id: 'hu-roof',  title: 'Sealed, strapped roof',   desc: 'Seal the roof deck and tie the roof to the walls with straps so wind cannot peel it off.', source: SRC.fortified },
    { id: 'hu-open',  title: 'Protect openings',        desc: 'Use impact-rated windows and doors, or shutters, so the envelope stays closed in high wind.', source: SRC.femaWind },
  ],
  wildfire: [
    { id: 'wf-zone',  title: 'Defensible space',        desc: 'Keep the first 5 ft around the building free of anything that burns, and thin vegetation beyond it.', source: SRC.firewise },
    { id: 'wf-ember', title: 'Ember-resistant envelope', desc: 'Use noncombustible roofing and siding, and fine-mesh vents, so embers cannot get in.', source: SRC.ibhsFire },
  ],
};

let siCurrent = null;       // { site, hazards, status, alerts }
let siOpen = [];            // hazard ids whose strategies the user has opened, in click order
let siLastQuery = '';

// ─── helpers ───
function siEsc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function siLoad(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
}
function siWrite(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* storage unavailable: keep in memory only */ }
}
let siSaved = siLoad(SI_SAVED_KEY);
let siUser = siLoad(SI_USER_KEY);

async function siFetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SI_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json, application/geo+json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json && json.error) throw new Error(json.error.message || 'Service error');
    return json;
  } finally {
    clearTimeout(timer);
  }
}
function siQs(params) {
  return Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}
function siKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
function siLevelFor(value, moderate, high) {
  return value >= high ? 'high' : value >= moderate ? 'moderate' : 'low';
}
function siMax(levels) {
  return levels.reduce((m, l) => (SI_RISK[l].n > SI_RISK[m].n ? l : m), 'low');
}
function siBump(level) {
  return SI_LEVELS[Math.min(SI_RISK[level].n + 1, 2)];
}
// A reading = one source's verdict on one hazard for one period.
function siReading(hazard, period, risk, text, source) {
  return { hazard, period, risk, text, source };
}

// ─── geocoding ───
async function siGeocode(query) {
  try {
    const hits = await siFetchJson('https://nominatim.openstreetmap.org/search?' +
      siQs({ q: query, format: 'jsonv2', limit: 1, addressdetails: 1 }));
    if (hits.length) {
      const h = hits[0], a = h.address || {};
      return {
        label: h.display_name.split(',').slice(0, 3).join(',').trim(),
        region: [a.city || a.town || a.village || a.county, a.state, a.country].filter(Boolean).join(' · '),
        lat: +h.lat, lon: +h.lon,
        country: (a.country_code || '').toLowerCase(),
      };
    }
  } catch (e) { /* fall through to the second geocoder */ }
  const om = await siFetchJson('https://geocoding-api.open-meteo.com/v1/search?' + siQs({ name: query.split(',')[0], count: 1 }));
  const r = om.results && om.results[0];
  if (!r) return null;
  return {
    label: r.name, region: [r.admin1, r.country].filter(Boolean).join(' · '),
    lat: r.latitude, lon: r.longitude, country: (r.country_code || '').toLowerCase(),
  };
}

// ─── sources ───
// Each source: { id, name, ref, usOnly, run(ctx) → readings[] }. ctx = { site, cache }.

// FEMA National Risk Index: census-tract ratings for 18 hazards (US only, present day).
const SI_NRI_URLS = [
  'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Census_Tracts/FeatureServer/0/query',
  'https://hazards.geoplatform.gov/server/rest/services/Hosted/NRI_Tracts_%28October_2020%29/FeatureServer/0/query',
];
const SI_NRI_HAZARDS = { HWAV: 'heat', RFLD: 'flood', CFLD: 'coastal', ERQK: 'earthquake', HRCN: 'hurricane', WFIR: 'wildfire' };
const SI_NRI_NAMES = { HWAV: 'heat wave', RFLD: 'riverine flooding', CFLD: 'coastal flooding', ERQK: 'earthquake', HRCN: 'hurricane', WFIR: 'wildfire' };

function siNriLevel(rating, score) {
  if (rating) {
    const r = rating.toLowerCase();
    if (r.includes('very high') || r.includes('relatively high')) return 'high';
    if (r.includes('moderate')) return 'moderate';
    if (r.includes('low') || r.includes('no rating') || r.includes('not applicable')) return 'low';
    return null;                                  // "Insufficient data" etc. → no reading
  }
  if (typeof score === 'number') return siLevelFor(score, 50, 80);   // national percentile
  return null;
}

async function siSrcNri({ site }) {
  let attrs = null, lastErr = null;
  for (const base of SI_NRI_URLS) {
    try {
      const json = await siFetchJson(base + '?' + siQs({
        geometry: site.lon + ',' + site.lat, geometryType: 'esriGeometryPoint', inSR: 4326,
        spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: false, f: 'json',
      }));
      if (json.features && json.features.length) { attrs = json.features[0].attributes; break; }
    } catch (e) { lastErr = e; }
  }
  if (!attrs) throw lastErr || new Error('No census tract found at this point');
  const get = k => attrs[k] ?? attrs[k.toLowerCase()];
  const out = [];
  for (const [code, hz] of Object.entries(SI_NRI_HAZARDS)) {
    const rating = get(code + '_RISKR'), score = get(code + '_RISKS');
    const level = siNriLevel(rating, score);
    if (!level) continue;
    const detail = rating ? `"${rating}"` : `score ${Math.round(score)} / 100`;
    out.push(siReading(hz, 'present', level, `FEMA rates this census tract ${detail} for ${SI_NRI_NAMES[code]} risk.`, SRC.femaNri));
  }
  return out;
}

// FEMA National Flood Hazard Layer: the regulatory flood zone at the exact point (US only).
async function siSrcNfhl({ site }) {
  const json = await siFetchJson('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?' + siQs({
    geometry: site.lon + ',' + site.lat, geometryType: 'esriGeometryPoint', inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects', outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF', returnGeometry: false, f: 'json',
  }));
  const f = json.features && json.features[0];
  if (!f) return [siReading('flood', 'present', 'low', 'No mapped FEMA flood zone at this point (area may be unmapped).', SRC.femaMsc)];
  const zone = String(f.attributes.FLD_ZONE || '').toUpperCase();
  const sub = String(f.attributes.ZONE_SUBTY || '').toUpperCase();
  if (zone.startsWith('V')) {
    const t = `FEMA flood zone ${zone}: coastal high-hazard area with wave action (1% annual chance).`;
    return [siReading('flood', 'present', 'high', t, SRC.femaMsc), siReading('coastal', 'present', 'high', t, SRC.femaMsc)];
  }
  if (zone.startsWith('A')) return [siReading('flood', 'present', 'high', `FEMA flood zone ${zone}: Special Flood Hazard Area (1% annual chance flood).`, SRC.femaMsc)];
  if (zone === 'X' && sub.includes('0.2')) return [siReading('flood', 'present', 'moderate', 'FEMA shaded zone X: 0.2% annual chance (500-year) flood area.', SRC.femaMsc)];
  if (zone === 'X') return [siReading('flood', 'present', 'low', 'FEMA zone X: minimal flood hazard on the effective map.', SRC.femaMsc)];
  return [];                                       // zone D etc.: undetermined
}

// USGS earthquake catalog: how many M5+ earthquakes happened nearby since 1975 (worldwide).
async function siSrcQuake({ site }) {
  const q = SI_RULES.quake;
  const base = { format: 'geojson', latitude: site.lat, longitude: site.lon, maxradiuskm: q.radiusKm, minmagnitude: q.minMag, starttime: q.since };
  const [count, biggest] = await Promise.all([
    siFetchJson('https://earthquake.usgs.gov/fdsnws/event/1/count?' + siQs(base)),
    siFetchJson('https://earthquake.usgs.gov/fdsnws/event/1/query?' + siQs({ ...base, orderby: 'magnitude', limit: 1 })),
  ]);
  const n = count.count || 0;
  const top = biggest.features && biggest.features[0];
  const maxMag = top ? top.properties.mag : 0;
  let level = siLevelFor(n, q.moderateCount, q.highCount);
  if (maxMag >= q.highMag) level = 'high';
  const text = n
    ? `${n} earthquake${n === 1 ? '' : 's'} of M${q.minMag}+ within ${q.radiusKm} km since ${q.since.slice(0, 4)}. Largest: M${maxMag.toFixed(1)}${top ? ' · ' + top.properties.place : ''}.`
    : `No M${q.minMag}+ earthquakes within ${q.radiusKm} km since ${q.since.slice(0, 4)}.`;
  const future = 'Earthquake hazard does not change on climate timescales, so 2050 matches today.';
  return [siReading('earthquake', 'present', level, text, SRC.usgsEq), siReading('earthquake', 'future', level, future, SRC.usgsEq)];
}

// CMIP6 climate model (via Open-Meteo): hot days and heavy-rain days, today vs 2050 (worldwide).
async function siSrcClimate({ site }) {
  const json = await siFetchJson('https://climate-api.open-meteo.com/v1/climate?' + siQs({
    latitude: site.lat, longitude: site.lon, start_date: SI_RULES.baseline[0] + '-01-01', end_date: SI_RULES.future[1] + '-12-31',
    models: 'MRI_AGCM3_2_S', daily: 'temperature_2m_max,precipitation_sum',
  }));
  const d = json.daily || {};
  const key = p => Object.keys(d).find(k => k.startsWith(p));
  const time = d.time || [], tmax = d[key('temperature_2m_max')] || [], rain = d[key('precipitation_sum')] || [];
  if (!time.length) throw new Error('No climate data for this point');

  const perYear = (series, test, [y0, y1]) => {
    let hits = 0;
    for (let i = 0; i < time.length; i++) {
      const y = +time[i].slice(0, 4);
      if (y >= y0 && y <= y1 && series[i] != null && test(series[i])) hits++;
    }
    return hits / (y1 - y0 + 1);
  };
  const H = SI_RULES.heat, R = SI_RULES.rain, B = SI_RULES.baseline, F = SI_RULES.future;
  const hotNow = perYear(tmax, v => v >= H.hotDayC, B), hotFut = perYear(tmax, v => v >= H.hotDayC, F);
  const wetNow = perYear(rain, v => v >= R.heavyMm, B), wetFut = perYear(rain, v => v >= R.heavyMm, F);
  const f1 = v => v.toFixed(v < 10 ? 1 : 0);
  const out = [
    siReading('heat', 'present', siLevelFor(hotNow, H.moderateDays, H.highDays),
      `About ${f1(hotNow)} days a year reach ${H.hotDayC} °C or hotter (${B[0]}–${B[1]} average).`, SRC.openMeteo),
    siReading('heat', 'future', siLevelFor(hotFut, H.moderateDays, H.highDays),
      `Projected ${f1(hotFut)} days a year at ${H.hotDayC} °C or hotter (${F[0]}–${F[1]} average).`, SRC.openMeteo),
    siReading('flood', 'present', siLevelFor(wetNow, R.moderateDays, R.highDays),
      `About ${f1(wetNow)} heavy-rain days (≥ ${R.heavyMm} mm) a year (${B[0]}–${B[1]} average).`, SRC.openMeteo),
  ];
  const wetLevel = siLevelFor(wetFut, R.moderateDays, R.highDays);
  const change = wetNow > 0 ? (wetFut - wetNow) / wetNow * 100 : (wetFut > 0 ? 100 : 0);
  out.push(siReading('flood', 'future', wetLevel,
    `Projected ${f1(wetFut)} heavy-rain days a year (${F[0]}–${F[1]}), ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(0)}% from today.`, SRC.openMeteo));
  return { readings: out, rainChangePct: change };
}

// Ground elevation (Copernicus DEM) + distance to the nearest NOAA tide gauge → coastal exposure.
async function siSrcCoastal({ site, cache }) {
  const C = SI_RULES.coastal;
  const elev = (await siFetchJson('https://api.open-meteo.com/v1/elevation?' + siQs({ latitude: site.lat, longitude: site.lon }))).elevation[0];
  let nearKm = null, station = null;
  if (site.country === 'us') {
    cache.stations = cache.stations || (await siFetchJson('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels')).stations;
    for (const s of cache.stations) {
      const km = siKm(site.lat, site.lon, s.lat, s.lng);
      if (nearKm === null || km < nearKm) { nearKm = km; station = s; }
    }
  }
  const coastKnown = nearKm !== null;
  const nearCoast = coastKnown && nearKm <= C.nearCoastKm;
  const where = coastKnown ? `, ${nearKm.toFixed(1)} km from NOAA tide gauge ${station.name}` : '';
  const levelAt = e => {
    if (coastKnown && !nearCoast) return 'low';
    if (e > C.moderateElevM) return 'low';
    if (!coastKnown) return 'moderate';           // outside the US we can't check distance to the sea
    return e <= C.highElevM ? 'high' : 'moderate';
  };
  const note = coastKnown ? '' : ' Distance to the coast is not checked outside the US, so low ground is flagged for review.';
  const elevFut = elev - C.slr2050M;
  return [
    siReading('coastal', 'present', levelAt(elev), `Ground is ${elev.toFixed(0)} m above sea level${where}.${note}`, coastKnown ? SRC.noaaTides : SRC.elevation),
    siReading('coastal', 'future', levelAt(elevFut),
      `With ${C.slr2050M} m of sea level rise by 2050 (NOAA intermediate scenario), the site sits about ${elevFut.toFixed(1)} m above the sea.`, SRC.noaaSlr),
  ];
}

// User-added data stored in this browser, matched to sites within SI_RULES.userMatchKm.
function siSrcUser({ site }) {
  return siUser
    .filter(u => siKm(site.lat, site.lon, u.lat, u.lon) <= SI_RULES.userMatchKm)
    .flatMap(u => (u.period === 'both' ? ['present', 'future'] : [u.period]).map(p =>
      siReading(u.hazard, p, u.risk, u.note || 'Added by you.', u.sourceUrl ? { name: u.sourceName || 'Your source', url: u.sourceUrl } : { name: 'Your data · ' + (u.sourceName || 'no source given') }))
      .map(r => ({ ...r, user: true })));
}

const SI_SOURCES = [
  { id: 'nri',     name: 'FEMA National Risk Index',  ref: SRC.femaNri,   usOnly: true,  run: siSrcNri },
  { id: 'nfhl',    name: 'FEMA Flood Hazard Layer',   ref: SRC.femaMsc,   usOnly: true,  run: siSrcNfhl },
  { id: 'coastal', name: 'NOAA tide gauges + elevation', ref: SRC.noaaTides, usOnly: false, run: siSrcCoastal },
  { id: 'climate', name: 'CMIP6 climate model',       ref: SRC.openMeteo, usOnly: false, run: siSrcClimate },
  { id: 'quake',   name: 'USGS Earthquake Catalog',   ref: SRC.usgsEq,    usOnly: false, run: siSrcQuake },
];

// NOAA NWS active alerts: shown as a banner, not counted in the risk levels.
async function siNwsAlerts(site) {
  if (site.country !== 'us') return [];
  try {
    const json = await siFetchJson('https://api.weather.gov/alerts/active?point=' + site.lat.toFixed(4) + ',' + site.lon.toFixed(4));
    return (json.features || []).map(f => f.properties).slice(0, 3);
  } catch (e) { return []; }
}

// ─── combine readings into a Present / 2050 level per hazard ───
function siCombine(readings, rainChangePct) {
  const out = {};
  for (const h of SI_HAZARDS) {
    const mine = readings.filter(r => r.hazard === h.id);
    if (!mine.length) continue;
    const present = mine.filter(r => r.period === 'present');
    const future = mine.filter(r => r.period === 'future');
    const pLevel = present.length ? siMax(present.map(r => r.risk)) : null;
    let fLevel = future.length ? siMax(future.map(r => r.risk)) : null;
    const notes = [];
    if (h.climate && pLevel) {
      if (h.id === 'flood' && rainChangePct >= SI_RULES.rain.futureBumpPct) {
        const bumped = siBump(pLevel);
        if (!fLevel || SI_RISK[bumped].n > SI_RISK[fLevel].n) {
          fLevel = bumped;
          notes.push(`Heavy rain rises ${rainChangePct.toFixed(0)}% by 2050 (≥ ${SI_RULES.rain.futureBumpPct}% rule), so 2050 is one level above today.`);
        }
      }
      if (!fLevel || SI_RISK[pLevel].n > SI_RISK[fLevel].n) {
        fLevel = pLevel;
        notes.push('No source projects this hazard easing, so 2050 is held at today\'s level.');
      }
    }
    if (!h.climate && pLevel && !fLevel) fLevel = pLevel;
    out[h.id] = {
      present: { risk: pLevel, readings: present },
      future: { risk: fLevel, readings: future, notes },
    };
  }
  return out;
}

// ─── states ───
function siSetState(state, html) {
  const el = document.getElementById('si-results');
  el.dataset.state = state;
  el.innerHTML = html;
}

const SI_EXAMPLES = ['550 Huntington Ave, Boston, MA', 'Seaport Blvd, Boston, MA', 'Kathmandu, Nepal'];
function siExampleChips() {
  return SI_EXAMPLES.map((s, i) => `<button class="mat-chip-btn" onclick="siTry(${i})">${siEsc(s)}</button>`).join('');
}

function siShowEmpty() {
  siSetState('empty', `
    <div class="empty-state">
      <i class="ti ti-map-pin"></i>
      <div class="empty-state-title">Enter any address or city to begin</div>
      <div class="empty-state-text" style="max-width:460px;margin:0 auto 14px">
        SROT pulls hazard data from FEMA, NOAA, USGS and CMIP6 climate models, adds any site data you've entered, compares today with 2050, and suggests resilient strategies.
      </div>
      <div class="si-chip-row">${siExampleChips()}</div>
    </div>`);
}

function siShowLoading(address) {
  siSetState('loading', `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <span style="font-size:12px" id="si-loading-text">Finding ${siEsc(address)}…</span>
    </div>`);
}
function siLoadingText(t) {
  const el = document.getElementById('si-loading-text');
  if (el) el.textContent = t;
}

function siShowError(title, text, showChips) {
  siSetState('error', `
    <div class="empty-state si-error">
      <i class="ti ti-map-pin-off"></i>
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-text" style="max-width:460px;margin:0 auto 14px">${text}</div>
      ${showChips ? `<div class="si-chip-row">${siExampleChips()}</div>` : ''}
    </div>`);
}

// ─── analyze ───
function siTry(i) {
  document.getElementById('si-address').value = SI_EXAMPLES[i];
  siAnalyze();
}

async function siAnalyze() {
  const input = document.getElementById('si-address');
  const address = input.value.trim();
  if (!address) { siShowEmpty(); input.focus(); return; }
  siLastQuery = address;

  const btn = document.getElementById('si-analyze-btn');
  btn.disabled = true;
  siShowLoading(address);
  try {
    let site;
    try { site = await siGeocode(address); } catch (e) { site = undefined; }
    if (site === undefined) {
      siShowError('Couldn\'t reach the address service', 'Check your connection and try again.', false);
      return;
    }
    if (!site) {
      siShowError('Address not found', `We couldn't find <strong>${siEsc(address)}</strong>. Try adding the city and country, or pick an example:`, true);
      return;
    }
    if (address !== siLastQuery) return;              // a newer search started
    siLoadingText('Checking hazard sources for ' + site.label + '…');
    await siRunSources(site);
  } finally {
    btn.disabled = false;
  }
}

async function siRunSources(site) {
  const ctx = { site, cache: siRunSources.cache || (siRunSources.cache = {}) };
  const status = [];
  let readings = [], rainChangePct = 0;
  const jobs = SI_SOURCES.map(async src => {
    if (src.usOnly && site.country !== 'us') { status.push({ src, state: 'skip' }); return; }
    try {
      const res = await src.run(ctx);
      const rs = Array.isArray(res) ? res : res.readings;
      if (!Array.isArray(res)) rainChangePct = res.rainChangePct;
      readings = readings.concat(rs);
      status.push({ src, state: 'ok', n: rs.length });
    } catch (e) {
      status.push({ src, state: 'fail', err: e.name === 'AbortError' ? 'timed out' : e.message });
    }
  });
  const [alerts] = await Promise.all([siNwsAlerts(site), ...jobs]);
  const user = siSrcUser(ctx);
  readings = readings.concat(user);
  status.push({ src: { id: 'user', name: 'Your added data', ref: null }, state: user.length ? 'ok' : 'none', n: user.length });
  const order = s => { const i = SI_SOURCES.findIndex(x => x.id === s.src.id); return i < 0 ? SI_SOURCES.length : i; };
  status.sort((a, b) => order(a) - order(b));

  siCurrent = { site, hazards: siCombine(readings, rainChangePct), status, alerts };
  siRenderResults();
}

// ─── render ───
function siReadingRow(r) {
  const risk = SI_RISK[r.risk];
  const src = r.source.url
    ? `<a class="mat-db-link si-ref" href="${siEsc(r.source.url)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> ${siEsc(r.source.name)}</a>`
    : `<span class="si-noref">${siEsc(r.source.name)}</span>`;
  return `<div class="si-reading${r.user ? ' si-user' : ''}">
      <span class="si-dot ${risk.cls}" title="${risk.label}">${risk.label}</span>
      <div style="min-width:0"><div class="insight-desc">${siEsc(r.text)}</div>${src}</div>
    </div>`;
}

function siPeriod(label, p, notes) {
  if (!p.risk) {
    return `<div class="si-period"><div class="si-period-head"><span class="col-num" style="margin:0">${label}</span>
      <span class="si-hazard-sub">No data</span></div></div>`;
  }
  const r = SI_RISK[p.risk];
  return `<div class="si-period">
      <div class="si-period-head">
        <span class="col-num" style="margin:0">${label}</span>
        <span class="lifecycle-chip ${r.cls}">${r.label} risk</span>
      </div>
      <div class="si-readings">${p.readings.map(siReadingRow).join('')}</div>
      ${(notes || []).map(n => `<div class="si-rule"><i class="ti ti-math-function"></i> ${siEsc(n)}</div>`).join('')}
    </div>`;
}

function siStratButton(h, result) {
  if (result.present.risk !== 'moderate' && result.present.risk !== 'high' &&
      result.future.risk !== 'moderate' && result.future.risk !== 'high') {
    return '<div class="si-hazard-sub">Low risk in both periods · no strategies needed</div>';
  }
  const open = siOpen.includes(h.id);
  return `<button class="${open ? 'btn-primary' : 'btn-ghost'} si-strat-btn" aria-expanded="${open}" aria-controls="si-strategies" onclick="siToggleStrategies('${h.id}')">
      <i class="ti ti-shield-check"></i> ${open ? 'Hide resilient strategies' : 'Resilient strategies'}
    </button>`;
}

function siHazardCard(h, result) {
  return `<div class="insight-card si-hazard" id="si-hz-${h.id}">
      <div class="si-hazard-head">
        <div class="insight-ico-wrap ${h.ico}" style="margin:0"><i class="ti ${h.icon}"></i></div>
        <div>
          <div class="insight-title" style="margin:0">${h.name}</div>
          <div class="si-hazard-sub">${h.sub}</div>
        </div>
      </div>
      <div class="si-periods">
        ${siPeriod('Present', result.present)}
        ${siPeriod('2050', result.future, result.future.notes)}
      </div>
      <div class="si-hazard-foot" id="si-btn-${h.id}">${siStratButton(h, result)}</div>
    </div>`;
}

function siStatusList(status) {
  const icon = { ok: 'ti-circle-check', fail: 'ti-alert-circle', skip: 'ti-circle-minus', none: 'ti-circle-minus' };
  const text = s => s.state === 'ok' ? `${s.n} reading${s.n === 1 ? '' : 's'}`
    : s.state === 'fail' ? `unavailable (${siEsc(s.err)})`
    : s.state === 'skip' ? 'US sites only' : 'none for this site';
  return status.map(s => `<div class="si-status si-status-${s.state}">
      <i class="ti ${icon[s.state]}"></i>
      <span>${s.src.ref ? `<a href="${siEsc(s.src.ref.url)}" target="_blank" rel="noopener">${siEsc(s.src.name)}</a>` : siEsc(s.src.name)}</span>
      <span class="si-hazard-sub">${text(s)}</span>
    </div>`).join('');
}

function siIdentified() {
  // A hazard is "identified" when it reaches moderate or high in either period.
  return SI_HAZARDS.filter(h => {
    const r = siCurrent.hazards[h.id];
    return r && [r.present.risk, r.future.risk].some(l => l === 'moderate' || l === 'high');
  });
}

function siRenderResults() {
  siOpen = [];
  const { site, hazards, status, alerts } = siCurrent;
  const cards = SI_HAZARDS.filter(h => hazards[h.id]).map(h => siHazardCard(h, hazards[h.id])).join('');
  const alertHtml = alerts.length ? `<div class="si-alert"><i class="ti ti-alert-octagon"></i><div>
      <strong>Active NWS alert${alerts.length > 1 ? 's' : ''}:</strong> ${alerts.map(a => siEsc(a.event)).join(' · ')}
      <a class="mat-db-link" href="${SRC.nws.url}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> ${SRC.nws.name}</a></div></div>` : '';
  siSetState('results', `
    <div class="section">
      <div class="si-site-head">
        <div>
          <div class="eyebrow" style="margin-bottom:4px"><i class="ti ti-map-pin"></i> Site</div>
          <div class="section-title" style="margin:0">${siEsc(site.label)}</div>
          <div class="si-hazard-sub">${siEsc(site.region)} · ${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}</div>
        </div>
        <div class="si-sample-note"><i class="ti ti-info-circle"></i><span>A <strong>screening</strong> estimate from public data. Each level is the highest reading from any source below. Confirm with the official flood map and a site survey before design.</span></div>
      </div>
      ${alertHtml}
    </div>
    <div class="section subtle">
      <div class="section-title"><i class="ti ti-alert-triangle"></i> Hazard results · Present vs 2050</div>
      <div class="si-hazard-list">${cards || '<div class="empty-state-text">No source returned data for this site. You can add your own below.</div>'}</div>
    </div>
    <div class="section">
      <div class="section-title"><i class="ti ti-database"></i> Sources checked</div>
      <div class="si-status-list">${siStatusList(status)}</div>
      <button class="btn-ghost" style="margin-top:10px" onclick="siOpenUserForm()"><i class="ti ti-plus"></i> Add your own data for this site</button>
    </div>
    <div class="section" id="si-strat-section" hidden>
      <div class="section-title"><i class="ti ti-shield-check"></i> Resilient strategies</div>
      <div id="si-strategies"></div>
    </div>`);
  siRenderStrategies();
  siRenderUserForm();
}

function siIsSaved(id) { return siSaved.some(s => s.id === id); }

function siRenderStrategies() {
  const el = document.getElementById('si-strategies');
  if (!el || !siCurrent) return;
  // Show only hazards the user opened with that hazard's "Resilient strategies" button.
  const identified = siIdentified().map(h => h.id);
  const hz = siOpen.filter(id => identified.includes(id)).map(id => SI_HAZARDS.find(h => h.id === id));
  document.getElementById('si-strat-section').hidden = !hz.length;
  el.innerHTML = hz.map(h => `
    <div class="si-strat-group" id="si-strat-${h.id}">
      <div class="eyebrow"><i class="ti ${h.icon}"></i> ${h.name}</div>
      <div class="em-grid">
        ${(SI_STRATEGIES[h.id] || []).map(s => {
          const saved = siIsSaved(s.id);
          return `<div class="em-card si-strat">
            <div style="flex:1">
              <div class="em-title">${siEsc(s.title)}</div>
              <div class="em-desc">${siEsc(s.desc)}</div>
              <a class="mat-db-link" href="${siEsc(s.source.url)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> ${siEsc(s.source.name)}</a>
            </div>
            <button class="${saved ? 'btn-primary' : 'btn-ghost'} si-save" aria-pressed="${saved}" onclick="siToggleSave('${h.id}','${s.id}')">
              <i class="ti ${saved ? 'ti-bookmark-filled' : 'ti-bookmark'}"></i> ${saved ? 'Saved' : 'Save'}
            </button>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function siToggleStrategies(hazardId) {
  const opening = !siOpen.includes(hazardId);
  siOpen = opening ? [...siOpen, hazardId] : siOpen.filter(id => id !== hazardId);
  const h = SI_HAZARDS.find(x => x.id === hazardId);
  document.getElementById('si-btn-' + hazardId).innerHTML = siStratButton(h, siCurrent.hazards[hazardId]);
  siRenderStrategies();
  if (opening) document.getElementById('si-strat-' + hazardId).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function siToggleSave(hazardId, strategyId) {
  if (siIsSaved(strategyId)) {
    siSaved = siSaved.filter(s => s.id !== strategyId);
  } else {
    const s = (SI_STRATEGIES[hazardId] || []).find(x => x.id === strategyId);
    const h = SI_HAZARDS.find(x => x.id === hazardId);
    if (!s || !h) return;
    siSaved.push({ id: s.id, hazard: h.name, title: s.title, source: s.source, site: siCurrent ? siCurrent.site.label : '' });
  }
  siWrite(SI_SAVED_KEY, siSaved);
  siRenderStrategies();
  siRenderSaved();
}

function siRenderSaved() {
  const el = document.getElementById('si-saved');
  const count = document.getElementById('si-saved-count');
  if (count) count.textContent = siSaved.length;
  if (!el) return;
  if (!siSaved.length) {
    el.innerHTML = '<div class="empty-state-text" style="padding:4px 0">No saved strategies yet. Use <strong>Save</strong> on any strategy to keep it here.</div>';
    return;
  }
  el.innerHTML = siSaved.map((s, i) => `
    <div class="contrib-item">
      <div style="flex:1;min-width:0">
        <div class="contrib-name">${siEsc(s.title)}</div>
        <div class="contrib-type">${siEsc(s.hazard)}${s.site ? ' · ' + siEsc(s.site) : ''}</div>
      </div>
      <button class="btn-ghost" style="padding:4px 10px" onclick="siRemoveSaved(${i})" aria-label="Remove ${siEsc(s.title)}"><i class="ti ti-x"></i></button>
    </div>`).join('');
}

function siRemoveSaved(i) {
  siSaved.splice(i, 1);
  siWrite(SI_SAVED_KEY, siSaved);
  siRenderSaved();
  siRenderStrategies();
}

// ─── user-added site data ───
function siOpenUserForm() {
  const form = document.getElementById('si-user-form');
  form.hidden = false;
  siRenderUserForm();
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('si-u-hazard').focus();
}

function siRenderUserForm() {
  const where = document.getElementById('si-u-where');
  const add = document.getElementById('si-u-add');
  if (!where) return;
  where.textContent = siCurrent ? siCurrent.site.label : 'Analyze a site first, then add data for it.';
  add.disabled = !siCurrent;
}

function siAddUserData() {
  if (!siCurrent) return;
  const val = id => document.getElementById(id).value.trim();
  const url = val('si-u-url');
  if (url && !/^https?:\/\//i.test(url)) { alert('Source link must start with http:// or https://'); return; }
  const note = val('si-u-note');
  if (!note) { document.getElementById('si-u-note').focus(); return; }
  const { site } = siCurrent;
  siUser.push({
    id: 'u' + Date.now(), label: site.label, lat: site.lat, lon: site.lon,
    hazard: val('si-u-hazard'), period: val('si-u-period'), risk: val('si-u-risk'),
    note, sourceName: val('si-u-source'), sourceUrl: url, added: new Date().toISOString().slice(0, 10),
  });
  siWrite(SI_USER_KEY, siUser);
  ['si-u-note', 'si-u-source', 'si-u-url'].forEach(id => { document.getElementById(id).value = ''; });
  siRenderUserList();
  siRunSources(site);                                // re-score with the new data
}

function siRemoveUserData(i) {
  siUser.splice(i, 1);
  siWrite(SI_USER_KEY, siUser);
  siRenderUserList();
  if (siCurrent) siRunSources(siCurrent.site);
}

function siRenderUserList() {
  const el = document.getElementById('si-user-list');
  const count = document.getElementById('si-user-count');
  if (count) count.textContent = siUser.length;
  if (!el) return;
  if (!siUser.length) {
    el.innerHTML = '<div class="empty-state-text" style="padding:4px 0">No data added yet. Add local knowledge, a site survey or a city report and it will be counted in the results.</div>';
    return;
  }
  const hzName = id => (SI_HAZARDS.find(h => h.id === id) || { name: id }).name;
  el.innerHTML = siUser.map((u, i) => `
    <div class="contrib-item">
      <div style="flex:1;min-width:0">
        <div class="contrib-name">${siEsc(hzName(u.hazard))} · ${SI_RISK[u.risk] ? SI_RISK[u.risk].label : ''}</div>
        <div class="contrib-type">${siEsc(u.label)} · ${u.period === 'both' ? 'Present + 2050' : u.period === 'future' ? '2050' : 'Present'}</div>
      </div>
      <button class="btn-ghost" style="padding:4px 10px" onclick="siRemoveUserData(${i})" aria-label="Remove entry"><i class="ti ti-x"></i></button>
    </div>`).join('');
}

function siExportUserData() {
  const blob = new Blob([JSON.stringify({ srotSiteData: 1, entries: siUser }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'srot-site-data.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function siImportUserData(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  file.text().then(text => {
    const json = JSON.parse(text);
    const entries = (json.entries || []).filter(u =>
      typeof u.lat === 'number' && typeof u.lon === 'number' && SI_RISK[u.risk] &&
      SI_HAZARDS.some(h => h.id === u.hazard) && ['present', 'future', 'both'].includes(u.period) &&
      (!u.sourceUrl || /^https?:\/\//i.test(u.sourceUrl)));
    const known = new Set(siUser.map(u => u.id));
    siUser = siUser.concat(entries.filter(u => !known.has(u.id)));
    siWrite(SI_USER_KEY, siUser);
    siRenderUserList();
    if (siCurrent) siRunSources(siCurrent.site);
  }).catch(() => alert('That file is not a valid SROT site data export.'))
    .finally(() => { input.value = ''; });
}

// Called when the module opens.
function siInit() {
  siRenderSaved();
  siRenderUserList();
  siRenderUserForm();
  const el = document.getElementById('si-results');
  if (el.dataset.state) return;           // keep previous results when returning
  siShowEmpty();
}
