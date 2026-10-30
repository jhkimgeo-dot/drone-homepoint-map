// 카카오맵·카카오내비로 장소를 넘기는 링크들.
// 카카오맵은 앱 키 없이 URL만으로 열 수 있고, 카카오내비는 공식적으로 JavaScript SDK(앱 키 필요)로만 열 수 있다.

const SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js';
const SDK_INTEGRITY = 'sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w';

export function isMobile() {
  const ua = navigator.userAgent;
  // iPadOS는 데스크톱 Safari로 자신을 소개하므로 터치 지원 여부로 구분한다.
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// 카카오맵 링크는 "이름,위도,경도" 형식이라 이름 안의 쉼표와 슬래시를 지운다.
const linkName = (name) => encodeURIComponent(name.replace(/[,/]/g, ' ').trim() || '목적지');

export const kakaoMapViewUrl = (p) => `https://map.kakao.com/link/map/${linkName(p.name)},${p.lat},${p.lng}`;
export const kakaoMapRouteUrl = (p) => `https://map.kakao.com/link/to/${linkName(p.name)},${p.lat},${p.lng}`;
const kakaoMapAppRouteUrl = (p) => `kakaomap://route?ep=${p.lat},${p.lng}&by=car`;

// 휴대폰에서는 카카오맵 앱의 자동차 길찾기를 바로 열고, 앱이 없어서 화면이 그대로면 웹 길찾기로 넘어간다.
// PC에서는 웹 길찾기를 새 탭으로 연다.
export function openKakaoMapRoute(place) {
  const webUrl = kakaoMapRouteUrl(place);
  if (!isMobile()) {
    window.open(webUrl, '_blank', 'noopener');
    return;
  }
  const fallback = setTimeout(() => {
    if (!document.hidden) location.href = webUrl;
  }, 1500);
  document.addEventListener('visibilitychange', () => clearTimeout(fallback), { once: true });
  location.href = kakaoMapAppRouteUrl(place);
}

let sdkReady = null;

// 앱 키가 있을 때만 SDK를 불러온다. 실패해도 나머지 기능에는 영향이 없다.
export function initKakaoSdk(jsKey) {
  sdkReady ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.integrity = SDK_INTEGRITY;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      try {
        if (!window.Kakao.isInitialized()) window.Kakao.init(jsKey);
        resolve(window.Kakao);
      } catch (err) {
        reject(err);
      }
    };
    script.onerror = () => reject(new Error('카카오 SDK를 불러오지 못했습니다.'));
    document.head.append(script);
  });
  return sdkReady;
}

// 카카오내비 앱으로 길안내를 시작한다. 앱이 없으면 SDK가 설치 페이지로 보낸다. 모바일에서만 동작한다.
export async function startKakaoNavi(place) {
  if (!sdkReady) throw new Error('카카오 앱 키가 설정되지 않았습니다.');
  const Kakao = await sdkReady;
  Kakao.Navi.start({ name: place.name, x: place.lng, y: place.lat, coordType: 'wgs84' });
}
