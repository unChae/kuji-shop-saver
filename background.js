
const currentShopsByTab = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CURRENT_SHOP') {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      currentShopsByTab.set(tabId, message.shop || null);
    }

    // Side Panel 등 열려 있는 확장 프로그램 페이지에 전달
    chrome.runtime.sendMessage({
      type: 'CURRENT_SHOP_UPDATE',
      tabId,
      shop: message.shop || null
    }).catch(() => {
      // Side Panel이 닫혀 있으면 무시
    });

    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GET_CURRENT_SHOP') {
    const tabId = message.tabId;
    sendResponse({
      shop: currentShopsByTab.get(tabId) || null
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  currentShopsByTab.delete(tabId);
});
