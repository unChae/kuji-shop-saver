function getTextContent(element) {
  if (!element) return '';
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
}

function findFirstElement(selectors, root = document) {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function getLatLngFromRouteLink(routeLink) {
  if (!routeLink?.href) return null;

  try {
    const url = new URL(routeLink.href);
    const destination = url.searchParams.get('destination');
    if (!destination) return null;

    const [lat, lng] = destination.split(',').map(value => Number(value.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return { lat, lng };
  } catch (error) {
    return null;
  }
}

function getCurrentShop() {
  const nameElement = findFirstElement([
    '#shop_name',
    '[data-shop-name]',
    '.shop-name',
    '[id*="shop_name"]',
    '[class*="shop-name"]',
    '[class*="shop_name"]'
  ]);

  const addressElement = findFirstElement([
    '#shop_address',
    '[data-address]',
    '.shop-address',
    '.address',
    '[class*="shop-address"]',
    '[class*="address"]'
  ]);

  const routeLink = findFirstElement([
    '.route a[href]',
    '.route-link a[href]',
    'a[href*="map"]',
    'a[href*="navi"]',
    'a[href*="place"]'
  ]);

  const shopIdElement = document.querySelector('#add_favorite')
    || document.querySelector('[data-shopid]')
    || document.querySelector('[data-shop-id]');

  const name = getTextContent(nameElement);
  const address = getTextContent(addressElement);

  if (!name || !address) {
    return null;
  }

  const routeCoords = getLatLngFromRouteLink(routeLink);
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`;

  return {
    shopId: shopIdElement?.dataset.shopid
      || shopIdElement?.dataset.shopId
      || shopIdElement?.getAttribute('data-shop-id')
      || null,
    name,
    address,
    lat: routeCoords?.lat ?? null,
    lng: routeCoords?.lng ?? null,
    mapUrl: routeLink?.href || googleMapsUrl,
    googleMapsUrl
  };
}

let lastSignature = null;

function safeSendCurrentShop(shop) {
  try {
    if (!chrome?.runtime?.id) return;
    chrome.runtime.sendMessage({
      type: 'CURRENT_SHOP',
      shop
    }, () => {});
  } catch (error) {
    // extension reload/restart during dev mode may invalidate the current context
  }
}

function checkForShopChange() {
  const shop = getCurrentShop();
  const signature = shop ? JSON.stringify(shop) : '';

  if (signature === lastSignature) {
    return;
  }

  lastSignature = signature;
  safeSendCurrentShop(shop);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_CURRENT_SHOP') {
    sendResponse({ shop: getCurrentShop() });
    return true;
  }

  return false;
});

// 최초 상태
checkForShopChange();

// 1kuji 상세 영역 변경 감지
const observer = new MutationObserver(() => {
  checkForShopChange();
});

observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true
});

// 클릭 직후 DOM 갱신이 늦는 경우까지 대응
setInterval(checkForShopChange, 300);
