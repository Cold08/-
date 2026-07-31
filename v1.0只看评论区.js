// ==UserScript==
// @name         抖音直播 - 只看评论区
// @namespace    https://live.douyin.com/
// @version      1.0.0
// @description  隐藏抖音直播间除评论区以外的所有元素，让评论区占满全屏
// @match        https://live.douyin.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  /* ── 选择器列表 ── */
  const HIDE_SELECTORS = [
    // ── 主视频区 ──
    '#PlayerLayout',
    '[id^="living_player_container"]',
    '#PlayerControlLayout',
    '#alpha-player-canvas',
    // ── 连麦 / 动画 / 礼物特效 ──
    '#LinkMicBackgroundLayout',
    '#LinkMicLayout',
    '#LinkMicAnimationLayout',
    '#LikeLayout',
    '#GiftEffectLayout',
    '#GiftTrayLayout',
    '#GiftMenuLayout',
    // ── 弹幕 / 提示 / 水印 ──
    '#DanmakuLayout',
    '#TipsLayout',
    '#EcmoCardLayout',
    '#ShortTouchLayout',
    '#WaterMarkLayout',
    '#ServiceCenterLayout',
    // ── 顶部信息栏 ──
    '#HeaderLayout',
    '#room_info_bar',
    // ── 底部礼物栏 ──
    '#BottomLayout',
    '#LeftBackgroundLayout',
    // ── data-e2e 稳定属性 ──
    // 注意：[data-e2e="living-container"] 是整个页面全屏容器，不能隐藏！
    '[data-e2e="gifts-container"]',
    '[data-e2e="gift-btn"]',
    '[data-e2e="yellowCart-container"]',
    '[data-e2e="rooom-info-bar-anchor"]',
    '[data-e2e="live-followbutton"]',
    '[data-e2e="hour-rank-entrance"]',
    '[data-e2e="gift-setting"]',
    '[data-e2e="danmaku-setting-icon"]',
    '[data-e2e="quality"]',
    '[data-e2e="fullscreen-back"]',
    '[data-e2e="gifts-switch"]',
    '#giftPanelEntrance',
    '[data-e2e="recharge-btn"]',
    // 注意：[data-e2e="live-room-audience"] 在线观众数量保留显示
    // ── 聊天室关闭按钮 ──
    '.chatroom_close',
  ];

  /* ── 状态 ── */
  let isEnabled = true;
  let styleId = null;

  /* ── CSS 规则生成 ── */
  function buildCSS() {
    const hideRule = HIDE_SELECTORS.map(s => `${s}{display:none!important;}`).join('');

    const layoutRule = `
      /* ── 基础：禁止页面滚动，全黑背景 ── */
      html, body {
        overflow: hidden !important;
        background: #000 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      #root,
      #_douyin_live_scroll_container_,
      #ContainerBackgroundLayout {
        background: #000 !important;
        overflow: hidden !important;
        height: 100vh !important;
        width: 100vw !important;
      }

      /* 解除 flex 横向布局，让右侧评论占满 */
      #ContainerBackgroundLayout {
        display: block !important;
      }

      /* 右侧评论区容器撑满全屏 */
      #RightBackgroundLayout {
        width: 100% !important;
        height: 100vh !important;
        max-width: 100% !important;
        flex: none !important;
        background: #000 !important;
        overflow: hidden !important;
      }

      /* 聊天室用 flex 纵向布局 */
      #chatroom {
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        background: #000 !important;
      }

      /* 聊天列表区域自动撑满并允许滚动 */
      .webcast-chatroom {
        flex: 1 !important;
        width: 100% !important;
        min-height: 0 !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
      }

      .webcast-chatroom___list {
        width: 100% !important;
        min-height: 100% !important;
      }

      /* 输入框保持在底部，不脱离文档流 */
      #chatInput {
        flex-shrink: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        background: #1a1a1a !important;
        padding: 6px 8px !important;
        box-sizing: border-box !important;
      }
    `;

    return hideRule + layoutRule;
  }

  /* ── 注入 / 移除样式 ── */
  function enableStyle() {
    if (styleId !== null) return;
    const css = buildCSS();
    const el = document.createElement('style');
    el.textContent = css;
    el.setAttribute('data-douyin-comments-only', '1');
    document.head.appendChild(el);
    styleId = el;
  }

  function disableStyle() {
    if (styleId !== null) {
      styleId.remove();
      styleId = null;
    }
  }

  /* ── 切换按钮 ── */
  function createToggleButton() {
    const btn = document.createElement('div');
    btn.id = '__comments_only_toggle__';
    btn.innerHTML = `
      <style>
        #__comments_only_toggle__ {
          position: fixed;
          top: 12px;
          right: 12px;
          z-index: 9999999;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: rgba(0,0,0,0.7);
          border: 2px solid rgba(255,255,255,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 20px;
          color: #fff;
          user-select: none;
          transition: background 0.2s, transform 0.15s;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        #__comments_only_toggle__:hover {
          background: rgba(0,0,0,0.9);
          transform: scale(1.1);
        }
        #__comments_only_toggle__.active {
          background: rgba(34,138,255,0.8);
          border-color: rgba(34,138,255,0.9);
        }
      </style>
      <span class="__toggle_icon__">💬</span>
    `;
    btn.classList.add('active');
    btn.title = '抖音直播 · 只看评论模式（点击切换）';

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      isEnabled = !isEnabled;
      if (isEnabled) {
        enableStyle();
        startAntiIdle();
        btn.classList.add('active');
        btn.querySelector('.__toggle_icon__').textContent = '💬';
        btn.title = '当前：只看评论模式（点击恢复正常）';
      } else {
        disableStyle();
        stopAntiIdle();
        btn.classList.remove('active');
        btn.querySelector('.__toggle_icon__').textContent = '📺';
        btn.title = '当前：正常模式（点击切换回只看评论）';
      }
    });

    document.body.appendChild(btn);
  }

  /* ── MutationObserver：防止 SPA 路由切换导致样式丢失 ── */
  function startObserver() {
    const observer = new MutationObserver(function (mutations) {
      if (!isEnabled) return;

      /* 确保样式标签还在 */
      if (styleId && !document.contains(styleId)) {
        styleId = null;
        enableStyle();
      }

      /* 确保按钮还在 */
      if (!document.getElementById('__comments_only_toggle__')) {
        createToggleButton();
      }

      /* 自动关闭节能模式/暂停弹窗 */
      dismissEnergySavingPopup(mutations);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  /* ── 防节能模式：模拟用户活动 + 自动关闭弹窗 ── */
  let antiIdleTimer = null;

  function simulateActivity() {
    /* 在聊天区域模拟鼠标移动和滚轮事件，欺骗页面的空闲检测 */
    const chatroom = document.getElementById('chatroom') || document.body;
    const rect = chatroom.getBoundingClientRect();
    const x = rect.left + Math.random() * rect.width * 0.5 + rect.width * 0.25;
    const y = rect.top + Math.random() * rect.height * 0.5 + rect.height * 0.25;

    const opts = { bubbles: true, cancelable: false, clientX: x, clientY: y };

    chatroom.dispatchEvent(new MouseEvent('mousemove', opts));
    chatroom.dispatchEvent(new MouseEvent('mouseenter', opts));

    /* 模拟轻微的滚动，保持 WebSocket 活跃 */
    const chatList = document.querySelector('.webcast-chatroom___list');
    if (chatList) {
      chatList.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: false, deltaY: 0
      }));
    }

    /* 对 document 也派发，覆盖全局空闲检测 */
    document.dispatchEvent(new MouseEvent('mousemove', opts));
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true, cancelable: false, key: 'Shift', keyCode: 16
    }));
  }

  function startAntiIdle() {
    if (antiIdleTimer) return;
    /* 每 30 秒模拟一次用户活动（抖音节能模式通常在 2-5 分钟无操作后触发） */
    antiIdleTimer = setInterval(function () {
      if (!isEnabled) return;
      simulateActivity();
    }, 30000);
    /* 立即执行一次 */
    simulateActivity();
  }

  function stopAntiIdle() {
    if (antiIdleTimer) {
      clearInterval(antiIdleTimer);
      antiIdleTimer = null;
    }
  }

  /* 自动关闭节能模式/暂停/离开提示弹窗 */
  function dismissEnergySavingPopup(mutations) {
    if (!isEnabled) return;

    /* 抖音常见的节能/暂停弹窗关键词 */
    const keywords = ['节能', '暂停', '离开', '不感兴趣', '继续观看', '仍在观看', 'energy', 'saving', 'pause', 'resume'];

    /* 检查是否有新插入的弹窗/对话框元素 */
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;

        const text = node.textContent || '';
        const isPopup = node.matches && (
          node.matches('[class*="modal"]') ||
          node.matches('[class*="dialog"]') ||
          node.matches('[class*="popup"]') ||
          node.matches('[class*="Modal"]') ||
          node.matches('[class*="Dialog"]') ||
          node.matches('[class*="Popup"]') ||
          node.matches('[role="dialog"]') ||
          node.matches('[class*="toast"]') ||
          node.matches('[class*="Toast"]')
        );

        if (isPopup && keywords.some(kw => text.includes(kw))) {
          /* 尝试点击"继续观看"/"确定"/"关闭"等按钮 */
          const buttons = node.querySelectorAll('button, [role="button"], [class*="btn"], [class*="close"], [class*="confirm"]');
          let clicked = false;
          const clickPriority = ['继续观看', '仍在观看', '继续', '确定', '知道了', '关闭', 'OK', '确认'];

          for (const kw of clickPriority) {
            for (const btn of buttons) {
              if (btn.textContent.includes(kw)) {
                btn.click();
                clicked = true;
                break;
              }
            }
            if (clicked) break;
          }

          /* 如果没找到按钮，尝试直接隐藏弹窗 */
          if (!clicked) {
            node.style.display = 'none';
          }
        }
      }
    }
  }

  /* ── 初始化 ── */
  function init() {
    enableStyle();
    createToggleButton();
    startObserver();
    startAntiIdle();
  }

  /* 等待 body 存在 */
  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
