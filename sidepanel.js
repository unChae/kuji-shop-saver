let currentShop = null;

const currentShopName = document.getElementById('currentShopName');
const currentShopAddress = document.getElementById('currentShopAddress');
const saveButton = document.getElementById('saveButton');
const shopList = document.getElementById('shopList');
const shopCount = document.getElementById('shopCount');
const emptyMessage = document.getElementById('emptyMessage');
const message = document.getElementById('message');
const copyAllButton = document.getElementById('copyAllButton');
const exportCsvButton = document.getElementById('exportCsvButton');

function buildMyMapsCsv(shops) {
  const rows = [['Order', 'Name', 'Address', 'Latitude', 'Longitude', 'Phone', 'SaleStartTime', 'PurchaseLimit', 'LimitCount', 'Memo', 'GoogleMapsUrl', 'ShopId']];

  shops.forEach((shop, index) => {
    const hasCoordinates = Number.isFinite(shop.lat) && Number.isFinite(shop.lng)
      && Math.abs(shop.lat) <= 90 && Math.abs(shop.lng) <= 180;
    rows.push([
      index + 1, shop.name, shop.address,
      hasCoordinates ? shop.lat : '', hasCoordinates ? shop.lng : '',
      shop.phone, shop.saleStartTime,
      shop.limitType === 'yes' ? 'O' : shop.limitType === 'no' ? 'X' : '',
      shop.limitCount, shop.memo,
      shop.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${shop.address}`)}`,
      shop.shopId
    ]);
  });

  // Keep the header plain ASCII without quotes or a BOM for importer compatibility.
  const header = rows.shift().join(',');
  const body = rows.map(row => row.map(value =>
    `"${String(value ?? '').replace(/"/g, '""')}"`
  ).join(',')).join('\r\n');
  return header + '\r\n' + (body ? body + '\r\n' : '');
}

async function exportShopsCsv() {
  exportCsvButton.disabled = true;
  let downloadUrl = null;
  let link = null;
  try {
    const shops = await getSavedShops();
    if (shops.length === 0) {
      message.textContent = '저장된 매장이 없습니다. 매장을 저장한 뒤 CSV를 다운로드하세요.';
      return;
    }

    const blob = new Blob([buildMyMapsCsv(shops)], { type: 'text/csv;charset=utf-8' });
    downloadUrl = URL.createObjectURL(blob);
    link = document.createElement('a');
    link.href = downloadUrl;
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    link.download = `kuji-mymaps-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    message.textContent = `${shops.length}개 매장의 CSV 다운로드를 시작했습니다. 마이맵에서 위치 열은 Address(주소), 제목 열은 Name(매장명)을 선택하세요.`;
  } catch (error) {
    console.error('CSV export failed:', error);
    message.textContent = 'CSV 다운로드에 실패했습니다. 다시 시도해주세요.';
  } finally {
    link?.remove();
    if (downloadUrl) {
      // Allow the browser time to start consuming the download before releasing it.
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);
    }
    exportCsvButton.disabled = false;
  }
}

function getMetaFromFields(shop) {
  const fields = shop?.metaFields || {};
  return {
    phone: fields.phone || '',
    saleStartTime: fields.saleStartTime || '',
    limitType: fields.limitType || '',
    limitCount: fields.limitCount === '' || fields.limitCount == null ? null : Number(fields.limitCount),
    memo: fields.memo || ''
  };
}

async function getSavedShops() {
  const result = await chrome.storage.local.get({ shops: [] });
  return result.shops;
}

function getCurrentLocationCoordinates() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      () => {
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  });
}

function buildOptimalRouteUrl(shops, originCoords = null) {
  const validShops = shops.filter(shop => Number.isFinite(shop.lat) && Number.isFinite(shop.lng));

  if (validShops.length < 2) {
    return null;
  }

  const origin = originCoords
    ? `${originCoords.lat},${originCoords.lng}`
    : '현재위치';

  const ordered = [...validShops];
  const finalStops = [];
  let current = { lat: 0, lng: 0 };

  while (ordered.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < ordered.length; i++) {
      const shop = ordered[i];
      const distance = Math.hypot(shop.lat - current.lat, shop.lng - current.lng);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    const nextShop = ordered.splice(nearestIndex, 1)[0];
    finalStops.push(nextShop);
    current = { lat: nextShop.lat, lng: nextShop.lng };
  }

  const destination = finalStops[0];
  const waypoints = finalStops.slice(1).map(shop => `${shop.lat},${shop.lng}`).join('|');

  const baseUrl = 'https://www.google.com/maps/dir/?api=1';
  if (!destination) return null;

  const params = new URLSearchParams({
    origin,
    destination: `${destination.lat},${destination.lng}`
  });

  if (waypoints) {
    params.set('waypoints', waypoints);
  }

  return `${baseUrl}&${params.toString()}`;
}

async function reorderShops(fromIndex, toIndex) {
  const shops = await getSavedShops();
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= shops.length || toIndex >= shops.length) {
    return;
  }

  const [moved] = shops.splice(fromIndex, 1);
  shops.splice(toIndex, 0, moved);
  await chrome.storage.local.set({ shops });
  await renderShops();
}

async function renderShops() {
  const shops = await getSavedShops();

  shopList.innerHTML = '';
  shopCount.textContent = shops.length;
  emptyMessage.style.display = shops.length === 0 ? 'block' : 'none';

  for (let index = 0; index < shops.length; index++) {
    const shop = shops[index];
    const item = document.createElement('div');
    item.className = 'shop-item';
    item.draggable = true;
    item.dataset.index = String(index);

    item.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', String(index));
      event.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });

    item.addEventListener('drop', async (event) => {
      event.preventDefault();
      const fromIndex = Number(event.dataTransfer.getData('text/plain'));
      const toIndex = Number(item.dataset.index);
      await reorderShops(fromIndex, toIndex);
    });

    const header = document.createElement('div');
    header.className = 'shop-item-header';

    const indexBadge = document.createElement('div');
    indexBadge.className = 'shop-item-index';
    indexBadge.textContent = String(index + 1);

    const name = document.createElement('div');
    name.className = 'shop-item-name';
    name.textContent = shop.name;

    const dragHandle = document.createElement('button');
    dragHandle.className = 'drag-handle';
    dragHandle.type = 'button';
    dragHandle.textContent = '⋮⋮';
    dragHandle.title = '드래그해서 순서 변경';
    dragHandle.setAttribute('aria-label', '매장 순서 변경');

    header.append(indexBadge, name, dragHandle);

    const address = document.createElement('div');
    address.className = 'shop-item-address';
    address.textContent = shop.address;

    const metaInfo = document.createElement('div');
    metaInfo.className = 'shop-item-meta';

    const phoneInfo = document.createElement('div');
    phoneInfo.className = 'shop-item-phone';
    phoneInfo.textContent = shop.phone ? `전화번호: ${shop.phone}` : '전화번호: 없음';

    const saleTimeInfo = document.createElement('div');
    saleTimeInfo.className = 'shop-item-sale-time';
    saleTimeInfo.textContent = shop.saleStartTime ? `판매개시시간: ${shop.saleStartTime}` : '판매개시시간: 없음';

    const limitInfo = document.createElement('div');
    limitInfo.className = 'shop-item-limit';
    limitInfo.textContent = shop.limitType ? `인당 구매 제한: ${shop.limitType === 'yes' ? 'O' : 'X'}${shop.limitCount ? ` (${shop.limitCount}장)` : ''}` : '인당 구매 제한: 미기록';

    const memoInfo = document.createElement('div');
    memoInfo.className = 'shop-item-memo';
    memoInfo.textContent = shop.memo ? `메모: ${shop.memo}` : '메모: 없음';

    metaInfo.append(phoneInfo, saleTimeInfo, limitInfo, memoInfo);

    const details = document.createElement('details');
    details.className = 'shop-item-details';

    const summary = document.createElement('summary');
    summary.textContent = '매장 정보 입력';

    const form = document.createElement('div');
    form.className = 'shop-detail-form';

    const fields = {
      phone: { label: '전화번호', type: 'text', placeholder: '010-1234-5678' },
      saleStartTime: { label: '판매개시시간', type: 'text', placeholder: '예: 10:00' },
      limitType: { label: '인당 구매 제한', type: 'select', options: [{ value: '', label: '선택' }, { value: 'yes', label: 'O' }, { value: 'no', label: 'X' }] },
      limitCount: { label: '제한 수량', type: 'number', placeholder: '예: 2', min: '1' },
      memo: { label: '메모', type: 'textarea', placeholder: '메모를 입력하세요.' }
    };

    for (const [key, config] of Object.entries(fields)) {
      const row = document.createElement('div');
      row.className = 'meta-row';

      const label = document.createElement('label');
      label.textContent = config.label;

      let input;
      if (config.type === 'select') {
        input = document.createElement('select');
        config.options.forEach(option => {
          const optionEl = document.createElement('option');
          optionEl.value = option.value;
          optionEl.textContent = option.label;
          input.appendChild(optionEl);
        });
        input.value = shop.limitType || '';
      } else if (config.type === 'textarea') {
        input = document.createElement('textarea');
        input.placeholder = config.placeholder;
        input.value = shop.memo || '';
      } else {
        input = document.createElement('input');
        input.type = config.type;
        input.placeholder = config.placeholder;
        if (config.min) input.min = config.min;
        if (key === 'phone') input.value = shop.phone || '';
        if (key === 'saleStartTime') input.value = shop.saleStartTime || '';
        if (key === 'limitCount') input.value = shop.limitCount ?? '';
      }

      label.appendChild(input);
      row.appendChild(label);
      form.appendChild(row);
    }

    const saveMetaButton = document.createElement('button');
    saveMetaButton.className = 'save-meta-button';
    saveMetaButton.textContent = '입력 저장';
    saveMetaButton.addEventListener('click', async () => {
      const inputs = form.querySelectorAll('input, textarea, select');
      const updated = {
        ...shop,
        phone: inputs[0].value.trim(),
        saleStartTime: inputs[1].value.trim(),
        limitType: inputs[2].value,
        limitCount: inputs[3].value ? Number(inputs[3].value) : null,
        memo: inputs[4].value.trim()
      };

      const shops = await getSavedShops();
      const next = shops.map(item => {
        if (item.shopId && shop.shopId && item.shopId === shop.shopId) return updated;
        if (!item.shopId && !shop.shopId && item.name === shop.name && item.address === shop.address) return updated;
        return item;
      });

      await chrome.storage.local.set({ shops: next });
      message.textContent = '매장 정보를 저장했습니다.';
      await renderShops();
    });

    form.appendChild(saveMetaButton);
    details.append(summary, form);

    const actions = document.createElement('div');
    actions.className = 'shop-item-actions';

    const openMapButton = document.createElement('button');
    openMapButton.className = 'open-map-button';
    openMapButton.textContent = '구글맵 열기';
    openMapButton.addEventListener('click', async () => {
      const mapsUrl = shop.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${shop.address}`)}`;

      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
      });

      const isGoogleMapsTab = tab?.url && (
        tab.url.includes('https://www.google.com/maps') ||
        tab.url.includes('https://maps.google.com') ||
        tab.url.includes('https://www.google.co.kr/maps')
      );

      if (isGoogleMapsTab && tab?.id) {
        chrome.tabs.update(tab.id, { url: mapsUrl });
        return;
      }

      chrome.tabs.create({ url: mapsUrl });
    });

    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-button';
    deleteButton.textContent = '삭제';
    deleteButton.addEventListener('click', () => deleteShop(shop));

    actions.append(openMapButton, deleteButton);
    item.append(header, address, metaInfo, details, actions);
    shopList.appendChild(item);
  }

  const routeButton = document.getElementById('routeButton');
  if (routeButton) {
    routeButton.disabled = shops.filter(shop => Number.isFinite(shop.lat) && Number.isFinite(shop.lng)).length < 2;
  }
}

function buildSavedShopRecord(shop) {
  const meta = getCurrentShopMeta();
  return {
    ...shop,
    ...meta,
    limitCount: meta.limitCount === '' ? null : Number(meta.limitCount)
  };
}

async function saveCurrentShop() {
  if (!currentShop) return;

  const shops = await getSavedShops();
  const nextShop = {
    ...currentShop,
    phone: '',
    saleStartTime: '',
    limitType: '',
    limitCount: null,
    memo: ''
  };

  const duplicate = shops.some(shop => {
    if (nextShop.shopId && shop.shopId) {
      return shop.shopId === nextShop.shopId;
    }
    return shop.name === nextShop.name &&
           shop.address === nextShop.address;
  });

  if (duplicate) {
    const index = shops.findIndex(shop => {
      if (nextShop.shopId && shop.shopId) {
        return shop.shopId === nextShop.shopId;
      }
      return shop.name === nextShop.name &&
             shop.address === nextShop.address;
    });

    if (index >= 0) {
      shops[index] = nextShop;
      await chrome.storage.local.set({ shops });
      message.textContent = '매장 정보를 갱신했습니다.';
      await renderShops();
      return;
    }
  }

  shops.push(nextShop);
  await chrome.storage.local.set({ shops });

  message.textContent = '매장을 저장했습니다.';
  await renderShops();
}

async function deleteShop(shop) {
  const shops = await getSavedShops();

  const filtered = shops.filter(savedShop => {
    if (shop.shopId && savedShop.shopId) {
      return savedShop.shopId !== shop.shopId;
    }
    return !(savedShop.name === shop.name && savedShop.address === shop.address);
  });

  await chrome.storage.local.set({ shops: filtered });
  await renderShops();
}

function updateCurrentShop(shop) {
  currentShop = shop || null;

  if (!shop) {
    currentShopName.textContent = '매장을 선택해주세요.';
    currentShopAddress.textContent = '1kuji 지도에서 매장을 클릭하면 여기에 표시됩니다.';
    saveButton.disabled = true;
    return;
  }

  currentShopName.textContent = shop.name;
  currentShopAddress.textContent = shop.address;
  saveButton.disabled = false;
  message.textContent = '';
}

function safeRuntimeSendMessage(payload, callback) {
  try {
    if (!chrome?.runtime?.id) return;
    chrome.runtime.sendMessage(payload, callback || (() => {}));
  } catch (error) {
    // extension reloaded during development; ignore this transient case
  }
}

async function syncWithActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  if (!tab?.id || !tab.url?.startsWith('https://1kuji.com/')) {
    updateCurrentShop(null);
    return;
  }

  safeRuntimeSendMessage({
    type: 'GET_CURRENT_SHOP',
    tabId: tab.id
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      return;
    }

    updateCurrentShop(response?.shop || null);
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CURRENT_SHOP_UPDATE') {
    chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    }).then(([tab]) => {
      if (tab?.id === message.tabId) {
        updateCurrentShop(message.shop);
      }
    });
  }
});

chrome.tabs.onActivated.addListener(() => {
  syncWithActiveTab();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    syncWithActiveTab();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.shops) {
    renderShops();
  }
});

saveButton.addEventListener('click', saveCurrentShop);

const routeButton = document.getElementById('routeButton');
if (routeButton) {
  routeButton.addEventListener('click', openOptimizedRoute);
}

async function openOptimizedRoute() {
  const shops = await getSavedShops();
  const validShops = shops.filter(shop => Number.isFinite(shop.lat) && Number.isFinite(shop.lng));

  if (validShops.length < 2) {
    message.textContent = '좌표가 있는 매장이 2개 이상 있어야 경로를 계산할 수 있습니다.';
    return;
  }

  const originCoords = await getCurrentLocationCoordinates();
  const routeUrl = buildOptimalRouteUrl(shops, originCoords);

  if (!routeUrl) {
    message.textContent = '경로를 생성할 수 없습니다. 위치 권한을 확인해주세요.';
    return;
  }

  message.textContent = '최적 경로를 계산했습니다.';
  chrome.tabs.create({ url: routeUrl });
}

async function copyAllShops() {
  const shops = await getSavedShops();

  if (shops.length === 0) {
    message.textContent = '저장된 매장이 없습니다.';
    return;
  }

  const text = shops
    .map(shop => {
      const compactQuery = `${shop.name}${shop.address}`.replace(/\s+/g, '');
      const shortMapsUrl = `https://www.google.com/maps/search/?api=1&query=${compactQuery}`;
      const limitText = shop.limitType ? `인당 구매 제한: ${shop.limitType === 'yes' ? 'O' : 'X'}${shop.limitCount ? ` (${shop.limitCount}장)` : ''}` : '인당 구매 제한: 미기록';
      const memoText = shop.memo ? `메모: ${shop.memo}` : '메모: 없음';
      const phoneText = shop.phone ? `전화번호: ${shop.phone}` : '전화번호: 없음';
      const saleTimeText = shop.saleStartTime ? `판매개시시간: ${shop.saleStartTime}` : '판매개시시간: 없음';

      return `${shop.name}\n${shop.address}\n${phoneText}\n${saleTimeText}\n${limitText}\n${memoText}\n${shortMapsUrl}`;
    })
    .join('\n\n');

  try {
    await navigator.clipboard.writeText(text);
    message.textContent = '전체 매장 리스트가 복사되었습니다.';
  } catch (error) {
    message.textContent = '복사에 실패했습니다. 브라우저 권한을 확인해주세요.';
  }
}

if (copyAllButton) {
  copyAllButton.addEventListener('click', copyAllShops);
}

if (exportCsvButton) {
  exportCsvButton.addEventListener('click', exportShopsCsv);
}

renderShops();
syncWithActiveTab();
