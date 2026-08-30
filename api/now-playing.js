// 영화진흥위원회(KOFIC) 일별 박스오피스 API 프록시 (Vercel Serverless Function).
// - API 키를 브라우저에 노출하지 않기 위해 서버에서만 사용한다.
// - KOFIC 데이터는 하루 단위로 집계되어 전날 데이터까지만 확정 제공되므로 어제 날짜를 조회한다.
// - 응답은 1시간 캐시하여 호출 횟수를 아낀다.

const KOFIC_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json";

function yesterdayYYYYMMDD() {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + 9); // KST
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const apiKey = process.env.KOFIC_API_KEY;
  if (!apiKey) {
    res.status(500).send(JSON.stringify({ error: "KOFIC_API_KEY가 설정되지 않았습니다." }));
    return;
  }

  const targetDt = yesterdayYYYYMMDD();
  const url = `${KOFIC_URL}?key=${apiKey}&targetDt=${targetDt}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      res.status(502).send(JSON.stringify({ error: `KOFIC API 응답 오류: ${upstream.status}` }));
      return;
    }
    const data = await upstream.json();
    if (data.faultInfo) {
      res.status(502).send(JSON.stringify({ error: data.faultInfo.message || "KOFIC API 오류" }));
      return;
    }

    const list = (data.boxOfficeResult?.dailyBoxOfficeList || []).map((m) => ({
      rank: Number(m.rank),
      name: m.movieNm,
      openDate: m.openDt,
      audiCount: Number(m.audiCnt),
      audiAcc: Number(m.audiAcc),
      isNew: m.rankOldAndNew === "NEW",
    }));

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(JSON.stringify({ targetDate: targetDt, movies: list }));
  } catch (err) {
    res.status(502).send(JSON.stringify({ error: "KOFIC API 호출에 실패했습니다." }));
  }
};
