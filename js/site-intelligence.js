// ─── SITE INTELLIGENCE MODULE ───
// Site Resilience Analysis: address → hazard results (Present vs 2050) → matched strategies.
// To add a hazard: add an entry to SI_HAZARDS, give it strategies in SI_STRATEGIES,
// and add per-site results under the same id in data/site-resilience-sample.json.

const SI_DATA_URL = 'data/site-resilience-sample.json';
const SI_SAVED_KEY = 'srot.savedStrategies';

const SI_HAZARDS = [
  { id: 'heat',       name: 'Urban heat island', sub: 'Surface and air temperature',  icon: 'ti-temperature-sun', ico: 'ii-amber' },
  { id: 'flood',      name: 'Flooding',          sub: 'Stormwater and riverine',      icon: 'ti-droplet',         ico: 'ii-blue' },
  { id: 'coastal',    name: 'Coastal risk',      sub: 'Sea level rise · storm surge', icon: 'ti-ripple',          ico: 'ii-teal' },
  { id: 'earthquake', name: 'Earthquake',        sub: 'Ground shaking',               icon: 'ti-activity',        ico: 'ii-purple' },
];

const SI_RISK = {
  low:      { label: 'Low',      cls: 'lc-good' },
  moderate: { label: 'Moderate', cls: 'lc-med' },
  high:     { label: 'High',     cls: 'lc-low' },
};

const SRC = {
  epaHeat:   { name: 'EPA · Reduce Heat Islands', url: 'https://www.epa.gov/green-infrastructure/reduce-heat-islands' },
  epaGuide:  { name: 'EPA · Guide to Reducing Heat Islands', url: 'https://www.epa.gov/heatislands/guide-reducing-heat-islands' },
  leedRes:   { name: 'USGBC · LEED Resilient Design Pilot Credits', url: 'https://www.usgbc.org/sites/default/files/LEED-Resilient-Design-Pilot-Credits-Brief-FINAL.pdf' },
  femaP312:  { name: 'FEMA P-312 · Homeowner\'s Guide to Retrofitting', url: 'https://basc.pnnl.gov/library/fema-p-312-homeowners-guide-retrofitting-six-ways-protect-your-home-floods-3rd-edition' },
  femaMsc:   { name: 'FEMA Flood Map Service Center', url: 'https://msc.fema.gov/portal/home' },
  femaP55:   { name: 'FEMA P-55 · Coastal Construction Manual', url: 'https://www.fema.gov/sites/default/files/2020-07/nhp_fema55.pdf' },
  noaaSlr:   { name: 'NOAA · 2022 Sea Level Rise Technical Report', url: 'https://oceanservice.noaa.gov/hazards/sealevelrise/sealevelrise-tech-report.html' },
  crb:       { name: 'Climate Ready Boston (2016) · Executive summary', url: 'https://www.boston.gov/sites/default/files/file/2023/03/2016_climate_ready_boston_executive_summary_1.pdf' },
  thinkEq:   { name: 'ThinkHazard! (GFDRR) · Nepal earthquake', url: 'https://thinkhazard.org/en/report/175-nepal/EQ' },
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
    { id: 'coastal-boston',     title: 'Use local flood projections', desc: 'In Boston, plan against the city\'s sea level rise projections, not only today\'s flood maps.', source: SRC.crb },
  ],
  earthquake: [
    { id: 'eq-design',   title: 'Seismic design from the start', desc: 'Account for earthquake loads in every phase of design and construction, not as a late check.', source: SRC.thinkEq },
    { id: 'eq-retrofit', title: 'Retrofit unreinforced masonry', desc: 'Tie walls, floors and roofs together and add bands or frames so older masonry holds together in shaking.', source: SRC.thinkEq },
  ],
};

let siData = null;          // loaded sample dataset
let siCurrent = null;       // site currently shown
let siOpen = [];            // hazard ids whose strategies the user has opened, in click order

// ─── helpers ───
function siEsc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function siLoadSaved() {
  try { return JSON.parse(localStorage.getItem(SI_SAVED_KEY)) || []; } catch (e) { return []; }
}
function siWriteSaved(list) {
  try { localStorage.setItem(SI_SAVED_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable: keep in memory only */ }
}
let siSaved = siLoadSaved();

async function siGetData() {
  if (siData) return siData;
  const res = await fetch(SI_DATA_URL);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  siData = await res.json();
  return siData;
}

function siFindSite(data, query) {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  return data.sites.find(s => s.match.some(m => q.includes(m)) || s.label.toLowerCase() === q) || null;
}

// ─── states ───
function siSetState(state, html) {
  const el = document.getElementById('si-results');
  el.dataset.state = state;
  el.innerHTML = html;
}

function siSampleChips() {
  const sites = siData ? siData.sites : [];
  return sites.map(s => `<button class="mat-chip-btn" onclick="siTry('${siEsc(s.label)}')">${siEsc(s.label)}</button>`).join('');
}

function siShowEmpty() {
  siSetState('empty', `
    <div class="empty-state">
      <i class="ti ti-map-pin"></i>
      <div class="empty-state-title">Enter a site address to begin</div>
      <div class="empty-state-text" style="max-width:440px;margin:0 auto 14px">
        SROT checks the site for urban heat, flooding and coastal risk, compares today with 2050, and suggests resilient strategies.
      </div>
      <div class="si-chip-row" id="si-sample-chips">${siSampleChips()}</div>
    </div>`);
}

function siShowLoading(address) {
  siSetState('loading', `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <span style="font-size:12px">Analyzing ${siEsc(address)}…</span>
    </div>`);
}

function siShowError(title, text, showChips) {
  siSetState('error', `
    <div class="empty-state si-error">
      <i class="ti ti-map-pin-off"></i>
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-text" style="max-width:460px;margin:0 auto 14px">${text}</div>
      ${showChips ? `<div class="si-chip-row">${siSampleChips()}</div>` : ''}
    </div>`);
}

// ─── analyze ───
function siTry(label) {
  document.getElementById('si-address').value = label;
  siAnalyze();
}

async function siAnalyze() {
  const input = document.getElementById('si-address');
  const address = input.value.trim();
  if (!address) { siShowEmpty(); input.focus(); return; }

  const btn = document.getElementById('si-analyze-btn');
  btn.disabled = true;
  siShowLoading(address);
  try {
    const data = await siGetData();
    const site = siFindSite(data, address);
    if (!site) {
      siShowError('Address not found',
        `We couldn't find <strong>${siEsc(address)}</strong> in the SROT sample dataset. Live address lookup isn't connected yet, so only these sample sites can be analyzed:`, true);
      return;
    }
    siCurrent = site;
    siRenderResults(site);
  } catch (e) {
    siShowError('Couldn\'t load site data',
      'The site data file failed to load. Check your connection and try again.', false);
  } finally {
    btn.disabled = false;
  }
}

// ─── render ───
function siRefs(refs) {
  const links = (refs || []).map(r =>
    `<a class="mat-db-link si-ref" href="${siEsc(r.url)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> ${siEsc(r.name)}</a>`).join('');
  return `<div class="si-source">
      <span class="si-data-badge" title="Illustrative values from data/site-resilience-sample.json, not live data"><i class="ti ti-flask"></i> Sample data</span>
      ${links || '<span class="si-noref">No published source for this sample note</span>'}
    </div>`;
}

function siPeriod(label, p) {
  const r = SI_RISK[p.risk] || SI_RISK.moderate;
  return `<div class="si-period">
      <div class="si-period-head">
        <span class="col-num" style="margin:0">${label}</span>
        <span class="lifecycle-chip ${r.cls}">${r.label} risk</span>
      </div>
      <div class="insight-desc">${siEsc(p.text)}</div>
      ${siRefs(p.refs)}
    </div>`;
}

function siStratButton(h, result) {
  if (result.present.risk === 'low' && result.future.risk === 'low') {
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
        ${siPeriod('2050', result.future)}
      </div>
      <div class="si-hazard-foot" id="si-btn-${h.id}">${siStratButton(h, result)}</div>
    </div>`;
}

function siIdentified(site) {
  // A hazard is "identified" when it reaches moderate or high in either period.
  return SI_HAZARDS.filter(h => {
    const r = site.hazards[h.id];
    return r && (r.present.risk !== 'low' || r.future.risk !== 'low');
  });
}

function siRenderResults(site) {
  siOpen = [];
  const cards = SI_HAZARDS.filter(h => site.hazards[h.id]).map(h => siHazardCard(h, site.hazards[h.id])).join('');
  siSetState('results', `
    <div class="section">
      <div class="si-site-head">
        <div>
          <div class="eyebrow" style="margin-bottom:4px"><i class="ti ti-map-pin"></i> Site</div>
          <div class="section-title" style="margin:0">${siEsc(site.label)}</div>
          <div class="si-hazard-sub">${siEsc(site.region)}</div>
        </div>
        <div class="si-sample-note"><i class="ti ti-info-circle"></i><span>All results on this page are <strong>sample data</strong> for demonstration. Linked sources back the explanations, not the risk levels.</span></div>
      </div>
    </div>
    <div class="section subtle">
      <div class="section-title"><i class="ti ti-alert-triangle"></i> Hazard results · Present vs 2050</div>
      <div class="si-hazard-list">${cards}</div>
    </div>
    <div class="section" id="si-strat-section" hidden>
      <div class="section-title"><i class="ti ti-shield-check"></i> Resilient strategies</div>
      <div id="si-strategies"></div>
    </div>`);
  siRenderStrategies();
}

function siIsSaved(id) { return siSaved.some(s => s.id === id); }

function siRenderStrategies() {
  const el = document.getElementById('si-strategies');
  if (!el || !siCurrent) return;
  // Show only hazards the user opened with that hazard's "Resilient strategies" button.
  const identified = siIdentified(siCurrent).map(h => h.id);
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
    siSaved.push({ id: s.id, hazard: h.name, title: s.title, source: s.source, site: siCurrent ? siCurrent.label : '' });
  }
  siWriteSaved(siSaved);
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
  el.innerHTML = siSaved.map(s => `
    <div class="contrib-item">
      <div style="flex:1;min-width:0">
        <div class="contrib-name">${siEsc(s.title)}</div>
        <div class="contrib-type">${siEsc(s.hazard)}${s.site ? ' · ' + siEsc(s.site) : ''}</div>
      </div>
      <button class="btn-ghost" style="padding:4px 10px" onclick="siRemoveSaved('${siEsc(s.id)}')" aria-label="Remove ${siEsc(s.title)}"><i class="ti ti-x"></i></button>
    </div>`).join('');
}

function siRemoveSaved(id) {
  siSaved = siSaved.filter(s => s.id !== id);
  siWriteSaved(siSaved);
  siRenderSaved();
  siRenderStrategies();
}

// Called when the module opens.
function siInit() {
  siRenderSaved();
  const el = document.getElementById('si-results');
  if (el.dataset.state) return;           // keep previous results when returning
  siShowEmpty();
  siGetData().then(() => {
    const chips = document.getElementById('si-sample-chips');
    if (chips) chips.innerHTML = siSampleChips();
  }).catch(() => {});
}
