// ── 지금 상영중인 영화 (KOFIC 박스오피스 기반) ─────
// Netlify Function(/.netlify/functions/now-playing)을 통해 영화진흥위원회
// 일별 박스오피스를 가져온다. 지점별 상영 여부가 아니라 전국 흥행 순위 기준이다.
(function () {
  const toggle = document.getElementById("now-playing-toggle");
  const body = document.getElementById("now-playing-body");
  const listEl = document.getElementById("now-playing-list");
  if (!toggle || !body || !listEl) return;

  let loaded = false;

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatOpenDate(d) {
    if (!d || d.length !== 8) return "";
    return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)} 개봉`;
  }

  async function load() {
    listEl.innerHTML = `<li class="now-playing-msg">불러오는 중…</li>`;
    try {
      const res = await fetch("/.netlify/functions/now-playing");
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "요청 실패");

      if (!data.movies || !data.movies.length) {
        listEl.innerHTML = `<li class="now-playing-msg">상영 정보를 불러올 수 없습니다.</li>`;
        return;
      }

      listEl.innerHTML = data.movies
        .map(
          (m) => `
        <li class="now-playing-item">
          <span class="np-rank">${m.rank}</span>
          <div class="np-info">
            <div class="np-name">
              ${escapeHtml(m.name)}
              ${m.isNew ? '<span class="np-new">NEW</span>' : ""}
            </div>
            <div class="np-meta">${formatOpenDate(m.openDate)} · 일일 관객 ${m.audiCount.toLocaleString()}명</div>
          </div>
          <a class="np-link" href="https://map.naver.com/p/search/${encodeURIComponent(m.name + " 영화")}" target="_blank" rel="noopener" title="상영관·시간표 검색">상영관 찾기</a>
        </li>`
        )
        .join("");
    } catch (err) {
      listEl.innerHTML = `<li class="now-playing-msg">영화 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.</li>`;
    }
  }

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    body.classList.toggle("hidden", expanded);
    if (!expanded && !loaded) {
      loaded = true;
      load();
    }
  });
})();
