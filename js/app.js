// ── 상태 ─────────────────────────────────────
let userPos = null;          // { lat, lng }
let activeBrand = "all";
let searchQuery = "";
let selectedIdx = null;
let prevView = null;         // 선택 전 지도 시점 (뒤로가기용)

const markers = [];          // 지점별 Leaflet 마커 (THEATERS와 같은 순서)
let userMarker = null;

// ── 지도 초기화 ──────────────────────────────
// 서비스 지역은 대한민국뿐이므로 지도 이동 범위를 한반도 남부로 고정
const KOREA_BOUNDS = L.latLngBounds([32.8, 124.0], [39.2, 132.0]);

const map = L.map("map", {
  zoomControl: false,
  maxBounds: KOREA_BOUNDS.pad(0.1),
  maxBoundsViscosity: 1.0,
  minZoom: 6,
});
map.fitBounds(KOREA_BOUNDS);
L.control.zoom({ position: "bottomright" }).addTo(map);

// 라벨 없는 미니멀 타일 — 지명은 아래 커스텀 한국어 라벨 레이어로 직접 표기 (서해·동해·남해 등)
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 19,
}).addTo(map);

// ── 한국어 지명 라벨 레이어 ──────────────────
map.createPane("labels");
map.getPane("labels").style.zIndex = 450;   // 타일 위, 극장 마커 아래
map.getPane("labels").style.pointerEvents = "none";

const labelMarkers = PLACE_LABELS.map((p) => ({
  p,
  marker: L.marker([p.lat, p.lng], {
    pane: "labels",
    interactive: false,
    icon: L.divIcon({
      className: "",
      html: `<div class="map-label ${p.kind}">${p.name}</div>`,
      iconSize: null,
    }),
  }),
}));

function updateLabels() {
  const z = map.getZoom();
  labelMarkers.forEach(({ p, marker }) => {
    const show = z >= p.min && z <= (p.max ?? 99);
    if (show && !map.hasLayer(marker)) marker.addTo(map);
    if (!show && map.hasLayer(marker)) marker.remove();
  });
}
map.on("zoomend", updateLabels);
updateLabels();

// ── 유틸 ─────────────────────────────────────
function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── 퍼지 검색 ────────────────────────────────
const CHOSUNG = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

function toChosung(str) {
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHOSUNG[Math.floor(code / 588)] : ch;
  }
  return out;
}

function norm(s) {
  return s.toLowerCase().replace(/\s+/g, "");
}

// q가 t의 부분수열이면 연속 정도에 따라 0~1, 아니면 0
function subseqScore(q, t) {
  let qi = 0, run = 0, score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      run++;
      score += run;
    } else {
      run = 0;
    }
  }
  if (qi < q.length) return 0;
  return score / ((q.length * (q.length + 1)) / 2);
}

// 높을수록 좋은 매칭. 0이면 미매칭.
// 3: 정확한 부분 문자열 / 2.5: 초성 매칭 / 1~2: 오타 허용 퍼지 매칭
function matchScore(rawQuery, t) {
  const q = norm(rawQuery);
  if (!q) return 1;
  const name = norm(t.name);
  const addr = norm(t.addr);
  if (name.includes(q) || addr.includes(q)) return 3;
  const qc = toChosung(q);
  if (/^[ㄱ-ㅎ]+$/.test(q) && (toChosung(name).includes(qc) || toChosung(addr).includes(qc))) return 2.5;
  const s = Math.max(subseqScore(q, name), subseqScore(q, addr));
  return s >= 0.25 ? 1 + s : 0;
}

// ── 마커 ─────────────────────────────────────
function makeIcon(brand, selected) {
  const size = selected ? 18 : 13;
  return L.divIcon({
    className: "",
    html: `<div class="brand-marker" style="width:${size}px;height:${size}px;background:${BRANDS[brand].color}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function popupHtml(t) {
  const b = BRANDS[t.brand];
  const name = escapeHtml(t.name);
  const enc = encodeURIComponent(t.name);
  const screens = (t.screens || [])
    .map((s) => `<span class="screen-tag">${escapeHtml(s)}</span>`)
    .join("");
  const dist = userPos ? `<span class="distance"> · ${formatDistance(distanceKm(userPos, t))}</span>` : "";
  return `
    <div class="popup-brand ${t.brand}">${b.label}</div>
    <div class="popup-name">${name}</div>
    <div class="popup-addr">${escapeHtml(t.addr)}${dist}</div>
    ${screens ? `<div class="popup-screens">${screens}</div>` : ""}
    <div class="popup-links">
      <a href="https://map.naver.com/p/search/${enc}" target="_blank" rel="noopener">네이버</a>
      <a href="https://map.kakao.com/link/to/${enc},${t.lat},${t.lng}" target="_blank" rel="noopener">카카오</a>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}" target="_blank" rel="noopener">구글</a>
    </div>
    <a class="popup-booking" href="${b.booking}" target="_blank" rel="noopener">상영시간표 · 예매 →</a>`;
}

THEATERS.forEach((t, i) => {
  const m = L.marker([t.lat, t.lng], { icon: makeIcon(t.brand, false) })
    .bindPopup(() => popupHtml(t))
    .on("click", () => selectTheater(i, { pan: false }));
  markers.push(m);
});

// ── 필터링 & 리스트 렌더링 ───────────────────
const listEl = document.getElementById("theater-list");
const statusEl = document.getElementById("list-status");

function brandFiltered() {
  const result = [];
  THEATERS.forEach((t, i) => {
    if (activeBrand !== "all" && t.brand !== activeBrand) return;
    result.push({ t, i, dist: userPos ? distanceKm(userPos, t) : null });
  });
  return result;
}

// 검색어 매칭 결과. 매칭이 하나도 없으면 가까운 지점을 추천으로 반환.
function visibleTheaters() {
  const pool = brandFiltered();
  const q = searchQuery.trim();

  if (!q) {
    if (userPos) pool.sort((a, b) => a.dist - b.dist);
    return { items: pool, recommended: false };
  }

  const scored = pool
    .map((x) => ({ ...x, score: matchScore(q, x.t) }))
    .filter((x) => x.score > 0);

  if (scored.length) {
    scored.sort((a, b) => b.score - a.score || (a.dist ?? 0) - (b.dist ?? 0));
    return { items: scored, recommended: false };
  }

  // 결과 없음 → 추천: 위치가 있으면 가까운 순, 없으면 특별관 보유 지점 우선
  const rec = [...pool];
  if (userPos) rec.sort((a, b) => a.dist - b.dist);
  else rec.sort((a, b) => (b.t.screens?.length || 0) - (a.t.screens?.length || 0));
  return { items: rec.slice(0, 5), recommended: true };
}

function render() {
  const { items, recommended } = visibleTheaters();
  const visibleSet = new Set(items.map((x) => x.i));

  markers.forEach((m, i) => {
    const shouldShow = visibleSet.has(i);
    if (shouldShow && !map.hasLayer(m)) m.addTo(map);
    if (!shouldShow && map.hasLayer(m)) m.remove();
  });

  if (recommended) {
    statusEl.textContent = `'${searchQuery.trim()}' 검색 결과가 없어요 — 대신 이런 지점은 어떠세요?`;
  } else {
    statusEl.textContent = userPos
      ? `가까운 순 · ${items.length}개 지점`
      : `${items.length}개 지점 — 지도의 📍 버튼으로 가까운 순 정렬`;
  }

  listEl.innerHTML = items
    .map(({ t, i, dist }) => {
      const screens = (t.screens || [])
        .map((s) => `<span class="screen-tag">${escapeHtml(s)}</span>`)
        .join("");
      return `
        <li class="theater-item ${t.brand} ${i === selectedIdx ? "selected" : ""}" data-idx="${i}">
          <div class="theater-name"><span class="dot ${t.brand}"></span>${escapeHtml(t.name)}</div>
          <div class="theater-meta">
            ${dist !== null ? `<span class="distance">${formatDistance(dist)}</span>` : ""}
            <span>${escapeHtml(t.addr)}</span>
          </div>
          ${screens ? `<div class="screens">${screens}</div>` : ""}
        </li>`;
    })
    .join("");
}

listEl.addEventListener("click", (e) => {
  const item = e.target.closest(".theater-item");
  if (item) selectTheater(Number(item.dataset.idx), { pan: true });
});

function selectTheater(idx, { pan }) {
  if (selectedIdx !== null && markers[selectedIdx]) {
    markers[selectedIdx].setIcon(makeIcon(THEATERS[selectedIdx].brand, false));
  }
  selectedIdx = idx;
  const t = THEATERS[idx];
  markers[idx].setIcon(makeIcon(t.brand, true));
  if (pan) {
    if (!prevView) prevView = { center: map.getCenter(), zoom: map.getZoom() };
    map.flyTo([t.lat, t.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
    markers[idx].openPopup();
  }
  document.querySelectorAll(".theater-item").forEach((el) => {
    el.classList.toggle("selected", Number(el.dataset.idx) === idx);
  });
  backBtn.classList.remove("hidden");
}

function deselectTheater() {
  if (selectedIdx !== null && markers[selectedIdx]) {
    markers[selectedIdx].setIcon(makeIcon(THEATERS[selectedIdx].brand, false));
    markers[selectedIdx].closePopup();
  }
  selectedIdx = null;
  if (prevView) {
    map.flyTo(prevView.center, prevView.zoom, { duration: 0.6 });
    prevView = null;
  }
  backBtn.classList.add("hidden");
  render();
}

// ── 지도 컨트롤 (뒤로가기 · 내 위치) ─────────
function makeMapButton(html, title, className, position, onClick) {
  const Control = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create("button", `map-btn ${className}`);
      btn.type = "button";
      btn.innerHTML = html;
      btn.title = title;
      btn.setAttribute("aria-label", title);
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, "click", onClick);
      return btn;
    },
  });
  new Control({ position }).addTo(map);
  return document.querySelector(`.map-btn.${className}`);
}

const ICON_BACK = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>`;

const ICON_LOCATE = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
  </svg>`;

const backBtn = makeMapButton(ICON_BACK, "뒤로가기", "map-back-btn", "topleft", deselectTheater);
backBtn.classList.add("hidden");

const locateBtn = makeMapButton(ICON_LOCATE, "내 위치", "map-locate-btn", "bottomright", () => locateUser());

function locateUser({ silent = false } = {}) {
  if (!navigator.geolocation) {
    if (!silent) statusEl.textContent = "이 브라우저는 위치 기능을 지원하지 않습니다.";
    return;
  }
  locateBtn.disabled = true;
  locateBtn.classList.add("loading");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (userMarker) userMarker.remove();
      userMarker = L.marker([userPos.lat, userPos.lng], {
        icon: L.divIcon({ className: "", html: '<div class="user-marker" style="width:16px;height:16px"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
        zIndexOffset: 1000,
      }).addTo(map).bindPopup("내 위치");
      map.flyTo([userPos.lat, userPos.lng], 12, { duration: 0.8 });
      locateBtn.disabled = false;
      locateBtn.classList.remove("loading");
      locateBtn.classList.add("active");
      render();
    },
    (err) => {
      locateBtn.disabled = false;
      locateBtn.classList.remove("loading");
      if (silent) {
        render();
        return;
      }
      statusEl.textContent =
        err.code === err.PERMISSION_DENIED
          ? "위치 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요."
          : "위치를 가져오지 못했습니다. 다시 시도해 주세요.";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ── 사이드바 컨트롤 ──────────────────────────
document.getElementById("search-input").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  render();
});

document.querySelectorAll("#brand-filters .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#brand-filters .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    activeBrand = chip.dataset.brand;
    render();
  });
});

render();
locateUser({ silent: true });
