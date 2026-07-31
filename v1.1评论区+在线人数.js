// ==UserScript==
// @name         抖音直播评论+在线人数
// @namespace    local.douyin.comment-only
// @version      1.1.0
// @description  进入抖音直播间后隐藏视频、榜单和其他页面元素，只保留在线观众数量与评论区。
// @author       local
// @match        https://live.douyin.com/*
// @match        https://www.douyin.com/*
// @match        https://douyin.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var state = {
        enabled: true,
        root: null,
        button: null,
        audienceBar: null,
        audienceSource: null,
        lastAudienceText: '',
        style: null,
        observer: null,
        scanTimer: null,
        urlTimer: null,
        lastUrl: location.href,
        originalStyles: new Map(),
        hidden: new Set()
    };

    var ROOT_SELECTORS = [
        '#chatroom',
        '#live-chatroom',
        '[id*="chatroom" i]',
        '[class*="webcast-chatroom" i]',
        '[class*="chatroom" i]',
        '[data-e2e*="chat" i]',
        '[data-e2e*="comment" i]',
        '[class*="comment-list" i]',
        '[class*="comment" i]',
        '[class*="danmaku" i]',
        '[class*="message-list" i]'
    ];

    function isLivePage() {
        var host = location.hostname.toLowerCase().replace(/\.$/, '');
        return host === 'live.douyin.com' ||
            (host.endsWith('.douyin.com') && /^\/live(?:\/|$)/i.test(location.pathname));
    }

    function tokenOf(el) {
        return [el.id, el.className, el.getAttribute('data-e2e'), el.getAttribute('aria-label')]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
    }

    function isUsableCandidate(el) {
        if (!el || el === document.body || el === document.documentElement) return false;
        var tag = el.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') return false;
        var rect = el.getBoundingClientRect();
        return rect.width >= 80 && rect.height >= 50;
    }

    function candidateScore(el) {
        var token = tokenOf(el);
        var rect = el.getBoundingClientRect();
        var textLength = Math.min((el.textContent || '').trim().length, 1800);
        var childCount = el.children.length;
        var score = 0;

        if (token.indexOf('webcast-chatroom') >= 0) score += 140;
        if (token.indexOf('chatroom') >= 0) score += 120;
        if (token.indexOf('comment') >= 0) score += 65;
        if (token.indexOf('danmaku') >= 0) score += 60;
        if (token.indexOf('message') >= 0 || token.indexOf('chat') >= 0) score += 45;
        if (token.indexOf('list') >= 0) score += 12;
        if (el.getAttribute('data-e2e')) score += 15;

        score += Math.min(childCount, 80) * 0.45;
        score += Math.min(textLength, 1000) / 55;
        score += Math.min(rect.height / Math.max(window.innerHeight, 1), 1) * 18;

        // 评论容器通常不是整页根节点，也不应包含播放器。
        if (rect.width > window.innerWidth * 0.97 && rect.height > window.innerHeight * 0.97) score -= 70;
        if (el.querySelector('video')) score -= 90;
        if (el.querySelectorAll('*').length > 3000) score -= 80;
        return score;
    }

    function findCommentRoot() {
        var candidates = [];
        var seen = new Set();

        ROOT_SELECTORS.forEach(function (selector) {
            try {
                document.querySelectorAll(selector).forEach(function (el) {
                    if (!seen.has(el) && isUsableCandidate(el)) {
                        seen.add(el);
                        candidates.push(el);
                    }
                });
            } catch (error) {
                // 某些浏览器对属性选择器的大小写修饰符支持不完整，忽略该选择器即可。
            }
        });

        candidates.sort(function (a, b) { return candidateScore(b) - candidateScore(a); });
        if (!candidates.length) return null;

        var best = candidates[0];
        // 如果命中的是评论列表内层，优先使用附近明确标记为 chatroom 的容器。
        for (var parent = best.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
            var parentToken = tokenOf(parent);
            if (parentToken.indexOf('chatroom') >= 0 && isUsableCandidate(parent) && !parent.querySelector('video')) {
                best = parent;
                break;
            }
        }
        return best;
    }

    function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    function extractAudienceText(value, token) {
        var text = normalizeText(value);
        if (!text || text.length > 80 || /成为在线观众TOP/i.test(text)) return '';

        var match = text.match(/(?:在线观众|当前在线|在线人数|观看人数)\s*[·:：|]?\s*([0-9][0-9,.]*(?:\.[0-9]+)?\s*[万亿]?)/i);
        if (!match) {
            match = text.match(/([0-9][0-9,.]*(?:\.[0-9]+)?\s*[万亿]?)\s*人?\s*(?:正在)?(?:在线|观看中)/i);
        }
        if (!match && /audience|viewer|online[-_ ]?count/i.test(token || '')) {
            match = text.match(/^([0-9][0-9,.]*(?:\.[0-9]+)?\s*[万亿]?)$/);
        }
        return match ? '在线观众 · ' + match[1].replace(/\s+/g, '') : '';
    }

    function audienceInfoFrom(el) {
        if (!el || !el.isConnected || el === state.audienceBar || el === state.root) return null;
        if (state.audienceBar && state.audienceBar.contains(el)) return null;

        var token = tokenOf(el);
        var sources = [
            el.textContent,
            el.getAttribute('aria-label'),
            el.getAttribute('title')
        ];
        for (var i = 0; i < sources.length; i++) {
            var text = extractAudienceText(sources[i], token);
            if (text) return { element: el, text: text };
        }
        return null;
    }

    function findAudienceInfo() {
        var cached = audienceInfoFrom(state.audienceSource);
        if (cached) return cached;

        var selectors = [
            '[data-e2e*="audience" i]',
            '[data-e2e*="viewer" i]',
            '[data-e2e*="online" i]',
            '[class*="audience" i]',
            '[class*="viewer" i]',
            '[class*="online-count" i]',
            '[aria-label*="在线观众"]',
            '[title*="在线观众"]'
        ];
        var candidates = [];
        var seen = new Set();

        selectors.forEach(function (selector) {
            try {
                document.querySelectorAll(selector).forEach(function (el) {
                    if (!seen.has(el)) {
                        seen.add(el);
                        candidates.push(el);
                    }
                });
            } catch (error) { /* ignore unsupported selector */ }
        });

        // 随机类名无法命中时，按页面中实际显示的“在线观众 · 数量”文本兜底。
        document.querySelectorAll('span, p, div').forEach(function (el) {
            if (!seen.has(el) && normalizeText(el.textContent).length <= 80) {
                seen.add(el);
                candidates.push(el);
            }
        });

        var matches = candidates.map(audienceInfoFrom).filter(Boolean);
        matches.sort(function (a, b) {
            var aText = normalizeText(a.element.textContent).length;
            var bText = normalizeText(b.element.textContent).length;
            return aText - bText || a.element.children.length - b.element.children.length;
        });
        if (!matches.length) return null;
        state.audienceSource = matches[0].element;
        return matches[0];
    }

    function rememberStyle(el) {
        if (!state.originalStyles.has(el)) state.originalStyles.set(el, el.getAttribute('style'));
    }

    function setStyle(el, property, value) {
        rememberStyle(el);
        el.style.setProperty(property, value, 'important');
    }

    function hideElement(el) {
        if (el === state.button || el === state.audienceBar) return;
        setStyle(el, 'display', 'none');
        setStyle(el, 'visibility', 'hidden');
        setStyle(el, 'pointer-events', 'none');
        el.setAttribute('data-dy-comment-hidden', '1');
        state.hidden.add(el);
    }

    function restoreElement(el) {
        if (!state.originalStyles.has(el)) return;
        var original = state.originalStyles.get(el);
        if (original === null) el.removeAttribute('style');
        else el.setAttribute('style', original);
        el.removeAttribute('data-dy-comment-hidden');
        state.hidden.delete(el);
    }

    function restoreAll() {
        state.originalStyles.forEach(function (original, el) {
            if (!el || !el.isConnected) return;
            if (original === null) el.removeAttribute('style');
            else el.setAttribute('style', original);
            el.removeAttribute('data-dy-comment-hidden');
            el.removeAttribute('data-dy-comment-root');
            el.removeAttribute('data-dy-comment-ancestor');
        });
        state.originalStyles.clear();
        state.hidden.clear();
        document.querySelectorAll('[data-dy-comment-root], [data-dy-comment-ancestor], [data-dy-comment-hidden]').forEach(function (el) {
            el.removeAttribute('data-dy-comment-root');
            el.removeAttribute('data-dy-comment-ancestor');
            el.removeAttribute('data-dy-comment-hidden');
        });
    }

    function markKeepChain(root) {
        var keep = new Set();
        for (var el = root; el; el = el.parentElement) {
            keep.add(el);
            if (el === document.body) break;
        }
        root.querySelectorAll('*').forEach(function (el) { keep.add(el); });
        if (state.button) keep.add(state.button);
        if (state.audienceBar) {
            keep.add(state.audienceBar);
            state.audienceBar.querySelectorAll('*').forEach(function (el) { keep.add(el); });
        }
        keep.add(document.documentElement);
        keep.add(document.head);
        return keep;
    }

    function styleCommentRoot(root) {
        setStyle(root, 'position', 'fixed');
        setStyle(root, 'top', '46px');
        setStyle(root, 'right', '0');
        setStyle(root, 'bottom', '0');
        setStyle(root, 'left', '0');
        setStyle(root, 'width', '100vw');
        setStyle(root, 'height', 'calc(100vh - 46px)');
        setStyle(root, 'max-width', 'none');
        setStyle(root, 'max-height', 'none');
        setStyle(root, 'z-index', '2147483646');
        setStyle(root, 'box-sizing', 'border-box');
        setStyle(root, 'overflow-y', 'auto');
        setStyle(root, 'overflow-x', 'hidden');
        setStyle(root, 'padding', '12px');
        setStyle(root, 'background', '#171717');
        setStyle(root, 'color', '#f2f2f2');
        setStyle(root, 'font-size', '16px');
        setStyle(root, 'line-height', '1.45');
    }

    function hideRankingInfo(root) {
        var rankPattern = /榜单|小时榜|人气榜|贡献榜|礼物榜|观众榜|在线观众TOP/i;
        var nodes = new Set();
        var selectors = [
            '[data-e2e*="rank" i]', '[data-e2e*="leaderboard" i]',
            '[class*="rank" i]', '[class*="leaderboard" i]',
            '[aria-label*="榜"]', '[title*="榜"]'
        ];

        selectors.forEach(function (selector) {
            try {
                root.querySelectorAll(selector).forEach(function (el) { nodes.add(el); });
            } catch (error) { /* ignore unsupported selector */ }
        });
        root.querySelectorAll('button, a, [role="button"], span, div').forEach(function (el) {
            var text = normalizeText(el.textContent);
            if (text.length > 0 && text.length <= 50 && rankPattern.test(text)) nodes.add(el);
        });

        nodes.forEach(function (el) {
            if (el !== root && !el.contains(root) && el !== state.audienceBar) hideElement(el);
        });
    }

    function updateAudienceBar(info) {
        if (!state.audienceBar) return;
        if (info && info.text) state.lastAudienceText = info.text;
        state.audienceBar.textContent = state.lastAudienceText || '在线观众 · --';
        state.audienceBar.style.setProperty('display', 'flex', 'important');
    }

    function showAudienceBar(show) {
        if (state.audienceBar) {
            state.audienceBar.style.setProperty('display', show ? 'flex' : 'none', 'important');
        }
    }

    function cleanup() {
        if (!state.enabled || !isLivePage() || !document.body) return;

        var root = state.root && state.root.isConnected ? state.root : findCommentRoot();
        if (!root) {
            state.root = null;
            updateButton('等待评论区…');
            return;
        }

        state.root = root;
        var audienceInfo = findAudienceInfo();
        updateAudienceBar(audienceInfo);
        var keep = markKeepChain(root);
        document.body.setAttribute('data-dy-comment-only', '1');

        document.querySelectorAll('[data-dy-comment-root], [data-dy-comment-ancestor]').forEach(function (el) {
            el.removeAttribute('data-dy-comment-root');
            el.removeAttribute('data-dy-comment-ancestor');
        });

        keep.forEach(function (el) {
            if (el.hasAttribute('data-dy-comment-hidden')) restoreElement(el);
            if (el === root) el.setAttribute('data-dy-comment-root', '1');
            else if (el !== document.body && el !== document.documentElement && el !== document.head) {
                el.setAttribute('data-dy-comment-ancestor', '1');
            }
        });

        Array.from(document.body.querySelectorAll('*')).forEach(function (el) {
            if (!keep.has(el)) hideElement(el);
        });

        styleCommentRoot(root);
        if (audienceInfo && root.contains(audienceInfo.element) && audienceInfo.element !== root) {
            hideElement(audienceInfo.element);
        }
        hideRankingInfo(root);
        root.querySelectorAll('video, audio, canvas').forEach(function (media) {
            try { if (typeof media.pause === 'function') media.pause(); } catch (error) { /* ignore */ }
            hideElement(media);
        });
        updateButton('恢复页面');
    }

    function scheduleCleanup() {
        clearTimeout(state.scanTimer);
        state.scanTimer = setTimeout(cleanup, 180);
    }

    function updateButton(label) {
        if (!state.button) return;
        state.button.textContent = state.enabled ? '◩ ' + label : '◫ 只看评论';
        state.button.title = state.enabled ? '恢复完整页面（Ctrl+Shift+L）' : '隐藏视频，仅保留评论（Ctrl+Shift+L）';
    }

    function showButton(show) {
        if (state.button) state.button.style.setProperty('display', show ? 'block' : 'none', 'important');
    }

    function toggle() {
        state.enabled = !state.enabled;
        if (state.enabled) {
            updateButton('只看评论');
            cleanup();
        } else {
            document.body && document.body.removeAttribute('data-dy-comment-only');
            restoreAll();
            showAudienceBar(false);
            updateButton('只看评论');
        }
    }

    function createButton() {
        if (state.button || !document.body) return;
        var button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-dy-comment-toggle', '1');
        button.style.cssText = [
            'position:fixed', 'top:14px', 'right:14px', 'z-index:2147483647',
            'border:1px solid rgba(255,255,255,.24)', 'border-radius:6px',
            'padding:7px 11px', 'background:rgba(30,30,30,.92)', 'color:#fff',
            'font:14px/1.2 sans-serif', 'cursor:pointer', 'box-shadow:0 2px 10px rgba(0,0,0,.35)'
        ].join(';');
        button.addEventListener('click', toggle);
        document.body.appendChild(button);
        state.button = button;
        updateButton('只看评论');
    }

    function createAudienceBar() {
        if (state.audienceBar || !document.body) return;
        var bar = document.createElement('div');
        bar.setAttribute('data-dy-audience-bar', '1');
        bar.style.cssText = [
            'position:fixed', 'top:0', 'right:0', 'left:0', 'height:46px',
            'z-index:2147483646', 'display:none', 'align-items:center',
            'box-sizing:border-box', 'padding:0 130px 0 14px',
            'border-bottom:1px solid rgba(255,255,255,.12)',
            'background:#171717', 'color:#f2f2f2', 'font:600 15px/1.2 sans-serif'
        ].join(';');
        document.body.appendChild(bar);
        state.audienceBar = bar;
    }

    function installStyle() {
        if (state.style) return;
        var style = document.createElement('style');
        style.id = 'douyin-comment-only-style';
        style.textContent = [
            'html,body{min-height:100%;}',
            'body[data-dy-comment-only="1"]{margin:0!important;background:#171717!important;overflow:hidden!important;}',
            'body[data-dy-comment-only="1"] [data-dy-comment-hidden="1"]{display:none!important;visibility:hidden!important;pointer-events:none!important;}',
            'body[data-dy-comment-only="1"] [data-dy-comment-root="1"]{text-align:left!important;}',
            '[data-dy-comment-toggle="1"]{user-select:none!important;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
        state.style = style;
    }

    function handleUrl() {
        if (state.lastUrl === location.href) return;
        state.lastUrl = location.href;
        restoreAll();
        state.root = null;
        state.audienceSource = null;
        state.lastAudienceText = '';
        state.enabled = true;
        if (isLivePage()) {
            showButton(true);
            document.body && document.body.setAttribute('data-dy-comment-only', '1');
            scheduleCleanup();
        } else if (document.body) {
            document.body.removeAttribute('data-dy-comment-only');
            state.enabled = false;
            showAudienceBar(false);
            showButton(false);
        }
    }

    function boot() {
        installStyle();
        createButton();
        createAudienceBar();

        state.observer = new MutationObserver(function () {
            if (state.enabled) scheduleCleanup();
        });
        state.observer.observe(document.documentElement, { childList: true, subtree: true });
        state.urlTimer = setInterval(handleUrl, 1000);
        setInterval(function () { if (state.enabled && isLivePage()) cleanup(); }, 2500);

        if (!isLivePage()) {
            state.enabled = false;
            updateButton('只看评论');
            showAudienceBar(false);
            showButton(false);
            return;
        }

        showButton(true);
        cleanup();
    }

    document.addEventListener('keydown', function (event) {
        var target = event.target;
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l' &&
            !(target && /input|textarea|select/i.test(target.tagName)) &&
            !(target && target.isContentEditable)) {
            event.preventDefault();
            toggle();
        }
    }, true);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
