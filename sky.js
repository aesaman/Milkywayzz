/** Sunrise/sunset approx + optional Open-Meteo weather. */

export const CITIES = [
  { id: "tehran", name: "تهران", lat: 35.6892, lon: 51.3890, tz: 3.5 },
  { id: "mashhad", name: "مشهد", lat: 36.2605, lon: 59.6168, tz: 3.5 },
  { id: "isfahan", name: "اصفهان", lat: 32.6546, lon: 51.6680, tz: 3.5 },
  { id: "shiraz", name: "شیراز", lat: 29.5918, lon: 52.5837, tz: 3.5 },
  { id: "tabriz", name: "تبریز", lat: 38.0962, lon: 46.2738, tz: 3.5 },
  { id: "karaj", name: "کرج", lat: 35.8400, lon: 50.9391, tz: 3.5 },
  { id: "ahvaz", name: "اهواز", lat: 31.3183, lon: 48.6706, tz: 3.5 },
  { id: "qom", name: "قم", lat: 34.6416, lon: 50.8746, tz: 3.5 },
  { id: "rasht", name: "رشت", lat: 37.2808, lon: 49.5832, tz: 3.5 },
  { id: "yazd", name: "یزد", lat: 31.8974, lon: 54.3569, tz: 3.5 },
  { id: "kerman", name: "کرمان", lat: 30.2832, lon: 57.0788, tz: 3.5 },
  { id: "kermanshah", name: "کرمانشاه", lat: 34.3142, lon: 47.0650, tz: 3.5 },
  { id: "urmia", name: "ارومیه", lat: 37.5527, lon: 45.0761, tz: 3.5 },
  { id: "sari", name: "ساری", lat: 36.5633, lon: 53.0601, tz: 3.5 },
  { id: "bandarabbas", name: "بندرعباس", lat: 27.1832, lon: 56.2666, tz: 3.5 },
  { id: "istanbul", name: "استانبول", lat: 41.0082, lon: 28.9784, tz: 3 },
  { id: "dubai", name: "دبی", lat: 25.2048, lon: 55.2708, tz: 4 },
  { id: "london", name: "لندن", lat: 51.5074, lon: -0.1278, tz: 0 }
];

function toJulian(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

/** Returns { riseMin, setMin } minutes from local midnight (approx). */
export function sunTimes(lat, lon, date = new Date(), tzOffsetHours = 3.5) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const J = toJulian(y, m, d);
  const n = Math.round(J - 2451545 - 0.0009 - lon / 360);
  const Jstar = 2451545 + 0.0009 + lon / 360 + n;
  const M = (357.5291 + 0.98560028 * (Jstar - 2451545)) % 360;
  const Mr = M * Math.PI / 180;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const L = (M + C + 180 + 102.9372) % 360;
  const Lr = L * Math.PI / 180;
  const Jtransit = Jstar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * Lr);
  const dec = Math.asin(Math.sin(Lr) * Math.sin(23.44 * Math.PI / 180));
  const latr = lat * Math.PI / 180;
  const cosH = (Math.sin(-0.83 * Math.PI / 180) - Math.sin(latr) * Math.sin(dec)) / (Math.cos(latr) * Math.cos(dec));
  if (cosH < -1 || cosH > 1) {
    return { riseMin: 6 * 60, setMin: 18 * 60, polar: true };
  }
  const H = Math.acos(cosH) * 180 / Math.PI;
  const Jrise = Jtransit - H / 360;
  const Jset = Jtransit + H / 360;
  const riseUT = (Jrise - 2451545.5) % 1;
  const setUT = (Jset - 2451545.5) % 1;
  let riseMin = Math.round(((riseUT * 24) + tzOffsetHours) * 60) % (24 * 60);
  let setMin = Math.round(((setUT * 24) + tzOffsetHours) * 60) % (24 * 60);
  if (riseMin < 0) riseMin += 24 * 60;
  if (setMin < 0) setMin += 24 * 60;
  return { riseMin, setMin, polar: false };
}

export function fmtMin(min) {
  const h = Math.floor(min / 60) % 24;
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function skyPosition(now, riseMin, setMin) {
  const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const isDay = mins >= riseMin && mins < setMin;
  let t;
  if (isDay) {
    t = (mins - riseMin) / Math.max(1, setMin - riseMin);
  } else if (mins >= setMin) {
    t = (mins - setMin) / Math.max(1, (24 * 60 - setMin + riseMin));
  } else {
    t = (mins + 24 * 60 - setMin) / Math.max(1, (24 * 60 - setMin + riseMin));
  }
  t = Math.max(0, Math.min(1, t));
  const x = 10 + t * 80;
  const y = 72 - Math.sin(t * Math.PI) * 52;
  return { isDay, x, y, t };
}

const WMO = {
  0: { label: "آفتابی", icon: "☀️" },
  1: { label: "عمدتاً صاف", icon: "🌤" },
  2: { label: "نیمه‌ابری", icon: "⛅" },
  3: { label: "ابری", icon: "☁️" },
  45: { label: "مه", icon: "🌫" },
  48: { label: "مه یخ‌زده", icon: "🌫" },
  51: { label: "نم‌نم", icon: "🌦" },
  61: { label: "باران", icon: "🌧" },
  71: { label: "برف", icon: "❄️" },
  80: { label: "رگبار", icon: "🌧" },
  95: { label: "رعدوبرق", icon: "⛈" }
};

export function weatherLabel(code) {
  if (WMO[code]) return WMO[code];
  if (code >= 71 && code < 80) return WMO[71];
  if (code >= 61 && code < 70) return WMO[61];
  if (code >= 51 && code < 60) return WMO[51];
  if (code >= 95) return WMO[95];
  return { label: "نامشخص", icon: "🌡" };
}

export async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout?.(8000) });
  if (!res.ok) throw new Error("weather");
  const data = await res.json();
  const code = data.current?.weather_code ?? 0;
  const temp = data.current?.temperature_2m;
  const meta = weatherLabel(code);
  return { temp, code, ...meta, at: Date.now() };
}

export function offlineWeatherHint(isDay) {
  return isDay
    ? { temp: null, label: "آفلاین", icon: "☀️", offline: true }
    : { temp: null, label: "آفلاین", icon: "🌙", offline: true };
}
