// ==UserScript==
// @name         DeepSeek++ Mobile
// @namespace    https://github.com/zhu1090093659/deepseek-pp
// @version      0.1.0
// @description  Mobile userscript version of DeepSeek++ memory, skills, and presets.
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'deepseek_pp_mobile_state_v1';
  const API_PATH = '/api/v0/chat/completion';
  const MEMORY_TOKEN_BUDGET = 1500;
  const PRESET_REINJECTION_INTERVAL = 10;
  const DISABLED_PRESET = '__disabled__';
  const DSML = '|DSML|';
  const DSML_FULL = '｜DSML｜';
  const TOOL_CALL_START = `<${DSML_FULL}tool_calls>`;
  const TOOL_CALL_END = `</${DSML_FULL}tool_calls>`;

  const MEMORY_TYPES = [
    { key: 'user', label: '用户', color: '#2563eb' },
    { key: 'feedback', label: '反馈', color: '#059669' },
    { key: 'topic', label: '话题', color: '#7c3aed' },
    { key: 'reference', label: '资料', color: '#d97706' },
  ];

  const MEMORY_SCOPES = [
    { key: 'global', label: '全局长期' },
    { key: 'session', label: '当前窗口' },
  ];

  const BUILTIN_SKILLS = [
    {
      name: 'memory',
      description: '记忆管理：保存、列出、更新、删除长期记忆',
      instructions: `用户请求管理记忆。每条记忆的格式为 "#ID [type] 标题: 内容"，ID 是唯一标识。

### Additional Tool Schemas

{"type":"function","function":{"name":"memory_update","description":"更新已有记忆","parameters":{"type":"object","properties":{"id":{"type":"integer","description":"记忆ID"},"type":{"type":"string","enum":["user","feedback","topic","reference"],"description":"记忆类型"},"scope":{"type":"string","enum":["global","session"],"description":"global 为全局长期记忆，session 为当前窗口记忆"},"enabled":{"type":"boolean","description":"是否启用注入"},"name":{"type":"string","description":"更新后的标题"},"content":{"type":"string","description":"更新后的内容"},"tags":{"type":"array","items":{"type":"string"},"description":"标签列表"}},"required":["id","type","name","content","tags"]}}}
{"type":"function","function":{"name":"memory_delete","description":"删除记忆","parameters":{"type":"object","properties":{"id":{"type":"integer","description":"记忆ID"}},"required":["id"]}}}

根据用户输入判断操作类型，在回复末尾调用对应工具。保存新内容使用 memory_save；修改使用 memory_update；删除使用 memory_delete；列出则直接列出已有记忆。当前项目、角色、进度、状态类内容保存为 session；用户身份、长期偏好、通用要求保存为 global。`,
      source: 'builtin',
      memoryEnabled: true,
    },
    {
      name: 'ultra-think',
      description: '极致深度思考模式',
      instructions: 'Reasoning Effort: Absolute maximum with no shortcuts permitted. You MUST be very thorough, decompose the problem, test edge cases, and avoid shortcuts.',
      source: 'builtin',
      memoryEnabled: false,
    },
    {
      name: 'frontend-design',
      description: '创建有设计感的前端界面',
      instructions: `你是一位高级前端设计师。在编写任何代码之前，先确定一个有意识的美学方向。

核心原则：
- 避免千篇一律的蓝紫渐变、统一圆角卡片布局
- 追求大胆排版、有主张的配色和明确视觉层次
- 每个动画都应传达信息或引导注意力
- 先确定美学方向，再规划布局和代码实现`,
      source: 'builtin',
      memoryEnabled: false,
    },
    {
      name: 'doc-coauthoring',
      description: '协作式文档创作',
      instructions: `你是一位专业的文档协作伙伴。使用三阶段方法论：信息采集、结构化创作、读者视角审查。先确认读者、目的和约束，再逐节推进，最后检查术语、论点和逻辑流。`,
      source: 'builtin',
      memoryEnabled: false,
    },
    {
      name: 'skill-creator',
      description: '创建和优化 AI Skill',
      instructions: `你是一位 AI Skill 设计专家。先了解用户想让 AI 做什么、在什么场景下使用；再写出清晰可执行的指令；最后用典型输入测试效果。Skill 名称使用 kebab-case。`,
      source: 'builtin',
      memoryEnabled: false,
    },
    {
      name: 'project-setup',
      description: '整理并保存大段项目设定：自动写入项目规则、预设和常驻记忆',
      instructions: `你是项目设定整理助手。用户会提供一大段项目需求、格式规则、风格限定、工作流或领域设定。请先确认这些设定已被整理，并基于设定帮助用户启动项目。

输出时请：
- 用简短条目概括已识别的项目主题、核心任务、结构规则、格式要求和风格要求
- 如果用户要求生成内容，直接开始生成第一版
- 不要重复粘贴完整原始设定，避免浪费上下文`,
      source: 'builtin',
      memoryEnabled: true,
    },
  ];

  const STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '这', '那', '吗', '呢',
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for',
    'you', 'do', 'this', 'but', 'with', 'on', 'my', 'we', 'our', 'how',
  ]);

  const MEMORY_SAVE_SCHEMA = '{"type":"function","function":{"name":"memory_save","description":"保存一条新的长期记忆或当前窗口记忆","parameters":{"type":"object","properties":{"type":{"type":"string","enum":["user","feedback","topic","reference"]},"scope":{"type":"string","enum":["global","session"],"description":"global 表示所有窗口共享的长期记忆；session 表示只绑定当前聊天窗口的项目/角色/进度记忆"},"enabled":{"type":"boolean","description":"是否启用注入，默认 true"},"name":{"type":"string"},"content":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["type","name","content","tags"]}}}';

  const SYSTEM_TEMPLATE_CHAT = `## 角色
你是用户的私人 AI 助手，具有跨对话长期记忆能力。你能记住用户的身份、偏好、技术栈和历史对话中的关键信息，在后续对话中提供个性化帮助。

## 已有记忆
{{memories}}

## Tools

You have access to tools. Invoke tools by writing a "<｜DSML｜tool_calls>" block:

<｜DSML｜tool_calls>
<｜DSML｜invoke name="$TOOL_NAME">
<｜DSML｜parameter name="$PARAMETER_NAME" string="true|false">$PARAMETER_VALUE</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>

String parameters use string="true". JSON values use string="false".

### Available Tool Schemas

${MEMORY_SAVE_SCHEMA}

当用户透露重要的持久信息时，在回复末尾调用 memory_save 工具保存。身份、长期偏好、通用要求保存为 scope=global；当前项目、角色、进度、状态、局部规则保存为 scope=session。不要重复保存已有记忆。

`;

  const SYSTEM_TEMPLATE_THINKING = `你具有长期记忆能力。已有记忆：

{{memories}}

## Tools

You can invoke tools with <｜DSML｜tool_calls> blocks.

### Available Tool Schemas

${MEMORY_SAVE_SCHEMA}

当用户透露重要的持久信息时，在回复末尾调用 memory_save 工具保存。身份、长期偏好、通用要求保存为 scope=global；当前项目、角色、进度、状态、局部规则保存为 scope=session。不要重复保存已有记忆。

---

`;

  const defaultState = {
    memories: [],
    customSkills: [],
    presets: [],
    activePresetId: null,
    sessionPresets: {},
    projectProfiles: [],
    sessionProfiles: {},
    sessionRules: {},
    projectRules: {
      enabled: false,
      title: '全局规则',
      content: '',
      scope: 'global',
      updatedAt: 0,
    },
    syncConfig: {
      url: '',
      username: '',
      password: '',
      remotePath: 'DeepSeekPP',
      lastSyncAt: null,
    },
    expertMode: false,
    messageCounts: {},
    currentSessionKey: null,
    nextMemoryId: 1,
  };

  let state = loadState();
  const PAGE_INSTANCE_KEY = `page:${randomId()}`;
  let responseBuffer = '';
  let notifiedToolCount = 0;
  let currentReaderId = 0;
  let popup = null;
  let panel = null;
  let toastTimer = null;
  let editingMemoryId = null;
  let editingPresetId = null;

  installHooks();
  ready(() => {
    injectStyles();
    mountFab();
    initSkillPopup();
    observeToolText();
  });

  function loadState() {
    let raw = null;
    try {
      raw = typeof GM_getValue === 'function'
        ? GM_getValue(STORE_KEY, null)
        : localStorage.getItem(STORE_KEY);
    } catch {
      raw = localStorage.getItem(STORE_KEY);
    }

    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return normalizeState({ ...defaultState, ...(parsed || {}) });
    } catch {
      return { ...defaultState };
    }
  }

  function saveState() {
    const serialized = JSON.stringify(state);
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(STORE_KEY, serialized);
        return;
      }
    } catch {}
    localStorage.setItem(STORE_KEY, serialized);
  }

  function normalizeState(next) {
    next.memories = normalizeMemoryList(Array.isArray(next.memories) ? next.memories : []);
    next.customSkills = Array.isArray(next.customSkills) ? next.customSkills : [];
    next.presets = Array.isArray(next.presets) ? next.presets : [];
    next.sessionPresets = normalizeStringMap(next.sessionPresets);
    next.projectProfiles = Array.isArray(next.projectProfiles)
      ? next.projectProfiles.map(normalizeProjectProfile).filter(Boolean)
      : [];
    next.sessionProfiles = normalizeStringMap(next.sessionProfiles);
    next.sessionRules = normalizeSessionRulesMap(next.sessionRules);
    next.projectRules = normalizeProjectRules(next.projectRules);
    next.syncConfig = normalizeSyncConfig(next.syncConfig);
    next.messageCounts = next.messageCounts && typeof next.messageCounts === 'object' ? next.messageCounts : {};
    next.currentSessionKey = null;
    next.nextMemoryId = Number(next.nextMemoryId) || next.memories.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1;
    return next;
  }

  function normalizeStringMap(map) {
    if (!map || typeof map !== 'object') return {};
    const next = {};
    for (const [key, value] of Object.entries(map)) {
      if (value == null) continue;
      next[String(key)] = String(value);
    }
    return next;
  }

  function normalizeSessionRulesMap(map) {
    if (!map || typeof map !== 'object') return {};
    const next = {};
    for (const [key, value] of Object.entries(map)) {
      const rules = normalizeProjectRules(value);
      if (rules.content || rules.enabled) next[String(key)] = rules;
    }
    return next;
  }

  function normalizeProjectRules(rules) {
    return {
      enabled: Boolean(rules?.enabled),
      title: String(rules?.title || '项目规则'),
      content: String(rules?.content || ''),
      scope: rules?.scope === 'global' || rules?.scope === 'session' ? rules.scope : '',
      updatedAt: Number(rules?.updatedAt) || 0,
    };
  }

  function normalizeProjectProfile(profile) {
    if (!profile) return null;
    const id = String(profile.id || randomId());
    return {
      id,
      title: String(profile.title || '项目设定'),
      summary: String(profile.summary || ''),
      keywords: Array.isArray(profile.keywords) ? profile.keywords.map(String).filter(Boolean) : [],
      rules: normalizeProjectRules(profile.rules),
      sessionId: profile.sessionId ? String(profile.sessionId) : null,
      presetId: profile.presetId ? String(profile.presetId) : null,
      memorySyncId: profile.memorySyncId ? String(profile.memorySyncId) : null,
      updatedAt: Number(profile.updatedAt) || Date.now(),
    };
  }

  function normalizeSyncConfig(config) {
    return {
      url: String(config?.url || ''),
      username: String(config?.username || ''),
      password: String(config?.password || ''),
      remotePath: String(config?.remotePath || 'DeepSeekPP'),
      lastSyncAt: Number(config?.lastSyncAt) || null,
    };
  }

  function installHooks() {
    hookFetch();
    hookXHR();
  }

  function hookFetch() {
    const originalFetch = window.fetch;
    window.fetch = async function deepseekPPFetch(input, init) {
      const url = getRequestUrl(input);
      if (!isChatCompletionUrl(url)) {
        return originalFetch.apply(this, arguments);
      }

      const bodyText = getBodyText(input, init);
      const modified = bodyText ? modifyRequestBody(bodyText) : null;
      if (!modified) {
        return originalFetch.apply(this, arguments);
      }

      let nextInput = input;
      let nextInit = init ? { ...init, body: modified } : { body: modified };
      if (input instanceof Request) {
        nextInput = new Request(input, { body: modified });
        nextInit = init;
      }

      const response = await originalFetch.call(this, nextInput, nextInit);
      return interceptFetchResponse(response);
    };
  }

  function hookXHR() {
    const urls = new WeakMap();
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function deepseekPPOpen(method, url) {
      urls.set(this, typeof url === 'string' ? url : url.href);
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function deepseekPPSend(body) {
      const url = urls.get(this);
      if (url && isChatCompletionUrl(url) && typeof body === 'string') {
        const modified = modifyRequestBody(body);
        if (modified) {
          setupXHRResponseInterceptor(this);
          return originalSend.call(this, modified);
        }
      }
      return originalSend.apply(this, arguments);
    };
  }

  function getRequestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (input instanceof Request) return input.url;
    return '';
  }

  function getBodyText(input, init) {
    if (typeof init?.body === 'string') return init.body;
    if (typeof input === 'object' && input instanceof Request && input.bodyUsed === false) {
      return null;
    }
    return null;
  }

  function isChatCompletionUrl(url) {
    return typeof url === 'string' && url.includes(API_PATH);
  }

  function modifyRequestBody(bodyStr) {
    let body;
    try {
      body = JSON.parse(bodyStr);
    } catch {
      return null;
    }

    const originalPrompt = body.prompt || '';
    if (!originalPrompt) return null;

    const sessionId = getSessionBindingKey(body);
    state.currentSessionKey = sessionId;
    migrateLegacyGlobalProjectRules(sessionId);
    const isFirstMessage = body.parent_message_id === null || body.parent_message_id === undefined;
    if (isFirstMessage) state.messageCounts[sessionId] = 0;
    state.messageCounts[sessionId] = (state.messageCounts[sessionId] || 0) + 1;

    if (state.expertMode) body.model_type = 'expert';

    const invocation = parseSkillCommand(originalPrompt);
    const localMemory = invocation ? handleLocalMemoryInvocation(invocation, sessionId) : null;
    if (localMemory) {
      body.prompt = localMemory.prompt;
      saveState();
      return JSON.stringify(body);
    }
    const projectSetup = invocation ? handleProjectSetupInvocation(invocation, sessionId) : null;
    const sessionProfile = projectSetup?.profile || resolveSessionProfile(sessionId, originalPrompt, isFirstMessage);
    const activePreset = getSessionPreset(sessionProfile, sessionId);
    const shouldInjectPreset = activePreset &&
      (isFirstMessage || state.messageCounts[sessionId] % PRESET_REINJECTION_INTERVAL === 0);
    const presetPrefix = shouldInjectPreset ? `${activePreset.content}\n\n---\n\n` : '';
    const projectRulesPrefix = getProjectRulesPrefix(sessionProfile, sessionId);
    const thinkingEnabled = body.thinking_enabled === true;

    captureExplicitMemory(originalPrompt, sessionId);

    if (invocation) {
      if (projectSetup) {
        body.prompt = projectRulesPrefix + presetPrefix + projectSetup.prompt;
        saveState();
        return JSON.stringify(body);
      }

      const resolved = resolveSkills(invocation.skillName, invocation.args);
      if (resolved) {
        let prompt = resolved.combinedPrompt;
        let usedMemoryIds = [];
        if (resolved.memoryEnabled) {
          const built = buildAugmentedPrompt(prompt, getSessionMemories(sessionProfile, sessionId), { thinkingEnabled });
          prompt = built.augmented;
          usedMemoryIds = built.usedMemoryIds;
        } else if (state.memories.length > 0) {
          const built = buildAugmentedPrompt(prompt, getSessionMemories(sessionProfile, sessionId), {
            thinkingEnabled,
            identityOnly: true,
          });
          prompt = built.augmented;
          usedMemoryIds = built.usedMemoryIds;
        }
        touchMemories(usedMemoryIds);
        body.prompt = projectRulesPrefix + presetPrefix + prompt;
        saveState();
        return JSON.stringify(body);
      }
    }

    const built = buildAugmentedPrompt(originalPrompt, getSessionMemories(sessionProfile, sessionId), { thinkingEnabled });
    body.prompt = projectRulesPrefix + presetPrefix + built.augmented;
    touchMemories(built.usedMemoryIds);
    saveState();
    return JSON.stringify(body);
  }

  function getSessionBindingKey(body) {
    const urlSessionId = getUrlSessionId();
    const apiSessionId = body.chat_session_id || body.chatSessionId || '';

    if (urlSessionId) {
      const urlKey = `url:${urlSessionId}`;
      const apiKey = apiSessionId ? `api:${apiSessionId}` : null;
      if (!state.sessionProfiles[urlKey] && apiKey && state.sessionProfiles[apiKey]) {
        state.sessionProfiles[urlKey] = state.sessionProfiles[apiKey];
      }
      if (!state.sessionPresets[urlKey] && apiKey && state.sessionPresets[apiKey]) {
        state.sessionPresets[urlKey] = state.sessionPresets[apiKey];
      }
      if (!state.sessionRules[urlKey] && apiKey && state.sessionRules[apiKey]) {
        state.sessionRules[urlKey] = state.sessionRules[apiKey];
      }
      migrateSessionBinding(apiKey, urlKey);
      migrateSessionBinding(PAGE_INSTANCE_KEY, urlKey, true);
      return urlKey;
    }

    if (apiSessionId) {
      const apiKey = `api:${apiSessionId}`;
      migrateSessionBinding(PAGE_INSTANCE_KEY, apiKey, true);
      return apiKey;
    }

    return PAGE_INSTANCE_KEY;
  }

  function getUrlSessionId() {
    const match = location.pathname.match(/\/s\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }

  function getShortSessionId(sessionId = getCurrentSessionKey()) {
    return String(sessionId || '')
      .replace(/^url:/, '')
      .replace(/^api:/, '')
      .replace(/^page:/, '临时窗口:')
      .slice(0, 18);
  }

  function getCurrentSessionKey() {
    const urlSessionId = getUrlSessionId();
    if (urlSessionId) return `url:${urlSessionId}`;
    return state.currentSessionKey || PAGE_INSTANCE_KEY;
  }

  function getSessionProfileByKey(sessionId = getCurrentSessionKey()) {
    const profileId = state.sessionProfiles[sessionId];
    return state.projectProfiles.find((profile) => profile.id === profileId)
      || state.projectProfiles.find((profile) => profile.sessionId === sessionId)
      || null;
  }

  function getSessionStatus(sessionId = getCurrentSessionKey()) {
    const profile = getSessionProfileByKey(sessionId);
    const sessionRules = normalizeProjectRules(state.sessionRules[sessionId]);
    const activeMemories = getSessionMemories(profile, sessionId);
    const sessionMemories = state.memories.filter((memory) => (
      normalizeMemoryScope(memory.scope) === 'session' && memory.sessionId === sessionId
    ));
    const globalMemories = state.memories.filter((memory) => normalizeMemoryScope(memory.scope) === 'global');
    const enabledSessionMemoryCount = sessionMemories.filter((memory) => memory.enabled !== false).length;
    const enabledGlobalMemoryCount = globalMemories.filter((memory) => memory.enabled !== false).length;
    const activeSessionMemoryCount = activeMemories.filter((memory) => normalizeMemoryScope(memory.scope) === 'session').length;
    const activeGlobalMemoryCount = activeMemories.filter((memory) => normalizeMemoryScope(memory.scope) === 'global').length;
    return {
      sessionId,
      urlSessionId: getUrlSessionId(),
      profile,
      sessionRules,
      sessionMemoryCount: sessionMemories.length,
      globalMemoryCount: globalMemories.length,
      enabledSessionMemoryCount,
      enabledGlobalMemoryCount,
      activeSessionMemoryCount,
      activeGlobalMemoryCount,
      activeMemoryCount: activeMemories.length,
      hasSessionRules: Boolean(sessionRules.enabled && sessionRules.content.trim()),
      hasGlobalRules: Boolean(state.projectRules?.enabled && String(state.projectRules.content || '').trim()),
      preset: getSessionPreset(profile, sessionId),
    };
  }

  function renderBindingStatusCard() {
    const status = getSessionStatus();
    const profileName = status.profile?.title || '未绑定项目';
    const bindingState = status.profile ? '已绑定' : '未绑定';
    const projectState = status.hasSessionRules || status.activeSessionMemoryCount > 0 ? '项目注入生效' : '项目注入停用';
    const rulesState = [
      status.hasSessionRules ? '当前窗口规则生效' : '当前窗口规则未启用',
      status.hasGlobalRules ? '全局规则生效' : '全局规则未启用',
    ].join(' / ');

    return `
      <div class="dpp-card dpp-status-card">
        <div class="dpp-card-top">
          <b>当前窗口绑定</b>
          <span class="${status.profile ? 'dpp-badge-neutral' : 'dpp-badge-off'}">${bindingState}</span>
        </div>
        <p>链接ID：<code>${escapeHtml(getShortSessionId(status.sessionId))}</code></p>
        <p>项目：${escapeHtml(profileName)}</p>
        <p>预设：${escapeHtml(status.preset?.name || '未启用')}</p>
        <p>项目状态：${escapeHtml(projectState)}</p>
        <p>规则：${escapeHtml(rulesState)}</p>
        <p>记忆：当前窗口 ${status.activeSessionMemoryCount}/${status.sessionMemoryCount} 实际注入 / 全局 ${status.activeGlobalMemoryCount}/${status.globalMemoryCount} 实际注入 / 本次可用 ${status.activeMemoryCount} 条</p>
        <div class="dpp-card-actions">
          <small>${status.urlSessionId ? '已绑定 DeepSeek /s/ 链接' : '临时窗口绑定，发送后会迁移到真实会话'}</small>
          <span>
            ${status.profile ? '<button data-action="unbind-session-profile">解绑项目</button>' : ''}
            ${status.hasSessionRules ? '<button data-action="clear-session-rules">清当前规则</button>' : ''}
          </span>
        </div>
      </div>
    `;
  }

  function migrateLegacyGlobalProjectRules(sessionId) {
    const rules = normalizeProjectRules(state.projectRules);
    if (!rules.content || rules.scope) return;
    if (!/项目|规则|设定|角色|格式|文风|玩法|状态|存档|进度/.test(`${rules.title}\n${rules.content}`)) {
      state.projectRules = { ...rules, scope: 'global' };
      return;
    }
    if (sessionId && !state.sessionRules[sessionId]) {
      state.sessionRules[sessionId] = { ...rules, title: rules.title || '当前窗口规则', scope: 'session' };
      state.sessionRules[sessionId].updatedAt = Date.now();
    }
    state.projectRules = {
      enabled: false,
      title: '全局规则',
      content: '',
      scope: 'global',
      updatedAt: Date.now(),
    };
  }

  function getProjectRulesPrefix(profile, sessionId) {
    const blocks = [];
    const seen = new Set();
    const pushRules = (rules) => {
      const normalized = normalizeProjectRules(rules);
      const content = normalized.content.trim();
      if (!normalized.enabled || !content || seen.has(content)) return;
      seen.add(content);
      blocks.push(normalized);
    };
    const globalRules = normalizeProjectRules(state.projectRules);
    const sessionRules = normalizeProjectRules(state.sessionRules?.[sessionId]);

    pushRules(globalRules);
    pushRules(sessionRules);

    if (!blocks.length) return '';
    return blocks
      .map((rules) => `## ${rules.title || '项目规则'}\n${rules.content.trim()}`)
      .join('\n\n---\n\n') + '\n\n---\n\n';
  }

  function getSessionPreset(profile, sessionId = getCurrentSessionKey()) {
    const sessionPresetId = state.sessionPresets?.[sessionId];
    if (sessionPresetId === DISABLED_PRESET) return null;
    if (sessionPresetId) {
      const preset = state.presets.find((p) => p.id === sessionPresetId);
      if (preset) return preset;
    }
    if (profile?.presetId) {
      const preset = state.presets.find((p) => p.id === profile.presetId);
      if (preset) return preset;
    }
    return state.presets.find((p) => p.id === state.activePresetId) || null;
  }

  function getSessionMemories(profile, sessionId) {
    return state.memories.filter((memory) => {
      if (memory.enabled === false) return false;
      const scope = normalizeMemoryScope(memory.scope);
      if (scope === 'global') return true;
      if (memory.sessionId === sessionId) return true;
      return false;
    });
  }

  function migrateSessionBinding(fromSessionId, toSessionId, deleteOld = false) {
    if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return;
    let changed = false;

    if (!state.sessionProfiles[toSessionId] && state.sessionProfiles[fromSessionId]) {
      state.sessionProfiles[toSessionId] = state.sessionProfiles[fromSessionId];
      changed = true;
      if (deleteOld) delete state.sessionProfiles[fromSessionId];
    }

    if (!state.sessionPresets[toSessionId] && state.sessionPresets[fromSessionId]) {
      state.sessionPresets[toSessionId] = state.sessionPresets[fromSessionId];
      changed = true;
      if (deleteOld) delete state.sessionPresets[fromSessionId];
    }

    if (!state.sessionRules[toSessionId] && state.sessionRules[fromSessionId]) {
      state.sessionRules[toSessionId] = state.sessionRules[fromSessionId];
      changed = true;
      if (deleteOld) delete state.sessionRules[fromSessionId];
    }

    for (const profile of state.projectProfiles) {
      if (profile.sessionId === fromSessionId) {
        profile.sessionId = toSessionId;
        profile.updatedAt = Date.now();
        changed = true;
      }
    }

    for (const memory of state.memories) {
      if (memory.sessionId === fromSessionId) {
        memory.sessionId = toSessionId;
        memory.updatedAt = Date.now();
        changed = true;
      }
    }
    if (changed) saveState();
  }

  function parseSkillCommand(input) {
    const match = String(input).match(/^\/(\S+)\s*([\s\S]*)$/);
    if (!match) return null;
    return {
      skillName: match[1],
      args: (match[2] || '').trim(),
      rawInput: input,
    };
  }

  function handleLocalMemoryInvocation(invocation, sessionId) {
    if (invocation.skillName !== 'memory' && invocation.skillName !== '记忆') return null;
    const args = invocation.args.trim();
    if (!args) {
      return {
        prompt: buildMemoryCommandResult([
          '记忆命令用法：',
          '- /memory 内容：让模型优化后保存',
          '- /memory global 内容：模型优化后保存为全局',
          '- /memory session 内容：模型优化后保存为当前窗口',
          '- /memory raw 内容：原样保存',
          '- /memory list',
          '- /memory on #ID / off #ID / delete #ID',
        ]),
      };
    }

    const deleteMatch = args.match(/^(?:delete|del|remove|删除)\s*#?(\d+)$/i);
    if (deleteMatch) {
      const id = Number(deleteMatch[1]);
      const memory = findEditableMemory(id, sessionId);
      if (!memory) return { prompt: buildMemoryCommandResult([`未找到可操作的记忆 #${id}`]) };
      state.memories = state.memories.filter((item) => item.id !== id);
      showToast(`已删除记忆 #${id}`);
      renderPanelIfOpen();
      return { prompt: buildMemoryCommandResult([`已删除记忆 #${id}`]) };
    }

    const toggleMatch = args.match(/^(on|enable|启用|off|disable|停用)\s*#?(\d+)$/i);
    if (toggleMatch) {
      const action = toggleMatch[1].toLowerCase();
      const id = Number(toggleMatch[2]);
      const memory = findEditableMemory(id, sessionId);
      if (!memory) return { prompt: buildMemoryCommandResult([`未找到可操作的记忆 #${id}`]) };
      const shouldEnable = action === 'on' || action === 'enable' || action === '启用';
      memory.enabled = shouldEnable;
      memory.updatedAt = Date.now();
      showToast(`${shouldEnable ? '已启用' : '已停用'}记忆 #${id}`);
      renderPanelIfOpen();
      return { prompt: buildMemoryCommandResult([`${shouldEnable ? '已启用' : '已停用'}记忆 #${id}: ${memory.name}`]) };
    }

    if (/^(?:list|ls|列表|列出|查看)$/i.test(args)) {
      const memories = getVisibleMemoriesForSession(sessionId);
      return {
        prompt: buildMemoryCommandResult(memories.length
          ? ['当前可见记忆：', ...memories.map(formatMemoryStatusLine)]
          : ['当前没有可见记忆']),
      };
    }

    const parsed = parseMemorySaveArgs(args);
    const content = parsed.content.trim();
    if (!content) return { prompt: buildMemoryCommandResult(['没有检测到要保存的内容']) };
    const scope = parsed.scope || inferMemoryScope(content);
    if (!parsed.raw) {
      return { prompt: buildMemoryOptimizationPrompt(content, scope, sessionId) };
    }
    if (isDuplicateMemory(content, scope, sessionId)) {
      return { prompt: buildMemoryCommandResult(['这条记忆已存在，没有重复保存']) };
    }

    const memory = saveMemoryRecord({
      type: inferMemoryType(content),
      name: makeMemoryTitle(content),
      content,
      tags: ['手动记忆', 'memory命令'],
      pinned: scope === 'global',
      enabled: true,
      scope,
      sessionId,
    });
    showToast(`已保存${scope === 'global' ? '全局' : '当前窗口'}记忆：${memory.name}`);
    return {
      prompt: buildMemoryCommandResult([
        `已保存${scope === 'global' ? '全局' : '当前窗口'}记忆。`,
        formatMemoryStatusLine(memory),
      ]),
    };
  }

  function parseMemorySaveArgs(args) {
    const rawGlobalMatch = args.match(/^(?:global|全局|长期)\s+(?:raw|原样|直接保存)\s*[:：]?\s*([\s\S]+)$/i);
    if (rawGlobalMatch) return { content: rawGlobalMatch[1], scope: 'global', raw: true };
    const rawSessionMatch = args.match(/^(?:session|窗口|当前|当前窗口|项目)\s+(?:raw|原样|直接保存)\s*[:：]?\s*([\s\S]+)$/i);
    if (rawSessionMatch) return { content: rawSessionMatch[1], scope: 'session', raw: true };
    const rawMatch = args.match(/^(?:raw|原样|直接保存)\s*[:：]?\s*([\s\S]+)$/i);
    if (rawMatch) return { content: rawMatch[1], scope: null, raw: true };
    const explicit = extractExplicitMemoryText(args);
    if (explicit) return { content: explicit, scope: null, raw: false };
    const globalMatch = args.match(/^(?:global|全局|长期)\s*[:：]?\s*([\s\S]+)$/i);
    if (globalMatch) return { content: globalMatch[1], scope: 'global', raw: false };
    const sessionMatch = args.match(/^(?:session|窗口|当前|当前窗口|项目)\s*[:：]?\s*([\s\S]+)$/i);
    if (sessionMatch) return { content: sessionMatch[1], scope: 'session', raw: false };
    return { content: args, scope: null, raw: false };
  }

  function findEditableMemory(id, sessionId) {
    const memory = state.memories.find((item) => item.id === id);
    if (!memory) return null;
    const scope = normalizeMemoryScope(memory.scope);
    if (scope === 'global' || memory.sessionId === sessionId) return memory;
    return null;
  }

  function getVisibleMemoriesForSession(sessionId) {
    return state.memories.filter((memory) => normalizeMemoryScope(memory.scope) === 'global' || memory.sessionId === sessionId);
  }

  function formatMemoryStatusLine(memory) {
    const scope = normalizeMemoryScope(memory.scope) === 'global' ? '全局' : '当前窗口';
    const enabled = memory.enabled === false ? '停用' : '启用';
    return `#${memory.id} [${scope}/${enabled}] ${memory.name}: ${memory.content}`;
  }

  function buildMemoryCommandResult(lines) {
    return [
      'DeepSeek++ 本地记忆已处理。',
      ...lines,
      '',
      '请简短确认，不要输出工具调用。',
    ].join('\n');
  }

  function buildMemoryOptimizationPrompt(content, scope, sessionId) {
    const visible = getVisibleMemoriesForSession(sessionId).slice(0, 20).map(formatMemoryStatusLine).join('\n') || '(暂无)';
    return [
      '你是 DeepSeek++ 的记忆整理器。请把用户输入优化成一条适合长期调用的记忆，并在回复末尾调用 memory_save 工具保存。',
      '',
      '## Tools',
      '',
      'You have access to a set of tools to help answer the user\'s question. You can invoke tools by writing a "<｜DSML｜tool_calls>" block exactly like the following:',
      '',
      '<｜DSML｜tool_calls>',
      '<｜DSML｜invoke name="$TOOL_NAME">',
      '<｜DSML｜parameter name="$PARAMETER_NAME" string="true|false">$PARAMETER_VALUE</｜DSML｜parameter>',
      '</｜DSML｜invoke>',
      '</｜DSML｜tool_calls>',
      '',
      '### Available Tool Schemas',
      '',
      MEMORY_SAVE_SCHEMA,
      '{"type":"function","function":{"name":"memory_update","description":"更新已有记忆","parameters":{"type":"object","properties":{"id":{"type":"integer"},"type":{"type":"string","enum":["user","feedback","topic","reference"]},"scope":{"type":"string","enum":["global","session"]},"enabled":{"type":"boolean"},"name":{"type":"string"},"content":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["id","type","name","content","tags"]}}}',
      '',
      '工具调用格式必须遵守：',
      '- 必须使用 <｜DSML｜invoke>，不要写成 <invoke>。',
      '- 必须使用 <｜DSML｜parameter>，不要使用 value="..." 属性承载参数值。',
      '- string="true" 表示纯文本参数；string="false" 表示 JSON/布尔/数组参数。',
      '- tags 必须使用 JSON 数组并设置 string="false"。',
      '- enabled 必须使用 true/false 并设置 string="false"。',
      '- 工具调用必须放在回复末尾。',
      '',
      '保存要求：',
      `- scope 必须使用 "${scope}"。`,
      `- type 根据内容选择 user、feedback、topic、reference。`,
      '- name 写成短标题，不要超过 18 个汉字。',
      '- content 写成清晰、可复用、无废话的记忆事实或偏好；必要时保留用户原意，不要过度扩写。',
      '- tags 写 1-4 个短标签。',
      '- enabled 使用 true。',
      '- 如果和已有记忆重复或冲突，请优先调用 memory_update 更新最相关的旧记忆；没有合适旧记忆才调用 memory_save。',
      '- 只保存用户明确想记住的内容，不要把本条指令本身保存进去。',
      '',
      '当前可见记忆：',
      visible,
      '',
      '用户要整理保存的原始内容：',
      content,
      '',
      '请先用一句话说明你整理成了什么，然后在回复末尾输出标准 DSML 工具调用。',
      '',
      '标准示例：',
      '<｜DSML｜tool_calls>',
      '<｜DSML｜invoke name="memory_save">',
      '<｜DSML｜parameter name="type" string="true">topic</｜DSML｜parameter>',
      `<｜DSML｜parameter name="scope" string="true">${scope}</｜DSML｜parameter>`,
      '<｜DSML｜parameter name="name" string="true">短标题</｜DSML｜parameter>',
      '<｜DSML｜parameter name="content" string="true">整理后的清晰记忆内容</｜DSML｜parameter>',
      '<｜DSML｜parameter name="tags" string="false">["标签1","标签2"]</｜DSML｜parameter>',
      '<｜DSML｜parameter name="enabled" string="false">true</｜DSML｜parameter>',
      '</｜DSML｜invoke>',
      '</｜DSML｜tool_calls>',
    ].join('\n');
  }

  function resolveSessionProfile(sessionId, prompt, isFirstMessage) {
    const boundId = state.sessionProfiles[sessionId];
    const bound = state.projectProfiles.find((profile) => profile.id === boundId);
    if (bound && !isFirstMessage) return bound;

    const sessionOwned = state.projectProfiles.find((profile) => profile.sessionId === sessionId);
    if (sessionOwned) {
      state.sessionProfiles[sessionId] = sessionOwned.id;
      return sessionOwned;
    }

    const matched = matchProjectProfile(prompt);
    if (matched) {
      const sessionProfile = ensureSessionProfile(matched, sessionId);
      state.sessionProfiles[sessionId] = sessionProfile.id;
      return sessionProfile;
    }

    return bound || null;
  }

  function ensureSessionProfile(profile, sessionId) {
    if (!profile) return null;
    if (profile.sessionId === sessionId) return profile;
    const existing = state.projectProfiles.find((item) => item.title === profile.title && item.sessionId === sessionId);
    if (existing) return existing;

    const cloned = normalizeProjectProfile({
      ...profile,
      id: randomId(),
      sessionId,
      memorySyncId: null,
      updatedAt: Date.now(),
    });
    upsertProjectProfile(cloned);
    if (profile.rules?.content && !state.sessionRules[sessionId]) {
      state.sessionRules[sessionId] = {
        ...normalizeProjectRules(profile.rules),
        title: `${profile.title} 当前窗口规则`,
        scope: 'session',
        updatedAt: Date.now(),
      };
    }
    return cloned;
  }

  function matchProjectProfile(prompt) {
    if (!state.projectProfiles.length) return null;
    const words = new Set(segmentText(prompt));
    let best = null;
    let bestScore = 0;

    for (const profile of state.projectProfiles) {
      if (profile.sessionId) continue;
      let score = 0;
      for (const keyword of profile.keywords) {
        const normalized = keyword.toLowerCase();
        if (!normalized) continue;
        if (prompt.includes(keyword) || words.has(normalized)) score += 8;
      }
      if (profile.title && prompt.includes(profile.title.replace(/\.\.\.$/, ''))) score += 30;
      if (score > bestScore) {
        best = profile;
        bestScore = score;
      }
    }

    return bestScore >= 12 ? best : null;
  }

  function handleProjectSetupInvocation(invocation, sessionId) {
    if (invocation.skillName !== 'project-setup' && invocation.skillName !== '项目设定') return null;
    const spec = invocation.args.trim();
    if (spec.length < 20) {
      return {
        prompt: '请告诉用户：请在 /project-setup 后粘贴完整项目设定、格式规则或文风要求，我会自动保存到项目规则、预设和常驻记忆。',
      };
    }

    const profile = analyzeProjectSpec(spec);
    const savedProfile = saveProjectSpec(profile, spec, sessionId);
    state.sessionProfiles[sessionId] = savedProfile.id;
    showToast(`已保存项目设定：${profile.title}`);

    return {
      profile: savedProfile,
      prompt: [
        `## 已保存的项目设定：${profile.title}`,
        `主题：${profile.summary}`,
        `已自动写入：项目规则、启动预设、常驻记忆。`,
        '',
        '请基于上述项目设定继续执行用户需求。如果这是一个可执行项目，请先给出可直接开始的第一版。不要要求用户重新粘贴设定。',
        '',
        '用户原始设定摘要：',
        profile.bullets.map((item) => `- ${item}`).join('\n'),
      ].join('\n'),
    };
  }

  function analyzeProjectSpec(spec) {
    const lines = spec
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const sections = extractProjectSections(lines);
    const fields = extractProjectFields(lines);
    const rules = extractProjectRuleLines(lines, sections);
    const title = makeProjectTitle(findProjectTitle(lines, sections) || spec);
    const summary = summarizeProjectSpec(title, sections, fields, rules, spec);
    return {
      id: randomId(),
      title,
      summary,
      sections,
      fields,
      rules,
      bullets: buildProjectBullets({ spec, sections, fields, rules }),
      keywords: extractProjectKeywords({ spec, title, sections, fields, rules }),
    };
  }

  function makeProjectTitle(text) {
    const cleaned = String(text || '')
      .replace(/^#+\s*/, '')
      .replace(/[：:]\s*$/, '')
      .trim();
    return cleaned.length > 24 ? cleaned.slice(0, 24) + '...' : cleaned || '项目设定';
  }

  function findProjectTitle(lines, sections) {
    const firstHeading = sections[0]?.title;
    if (firstHeading) return firstHeading;
    const firstLine = lines[0] || '';
    const explicitTitle = firstLine.match(/^(?:项目|主题|标题|名称|Project|Title)\s*[：:]\s*(.+)$/i);
    return explicitTitle ? explicitTitle[1] : firstLine;
  }

  function extractProjectSections(lines) {
    const sections = [];
    let current = null;

    for (const line of lines) {
      if (isSectionHeading(line)) {
        current = { title: normalizeHeading(line), points: [] };
        sections.push(current);
        continue;
      }

      if (current && current.points.length < 8) {
        current.points.push(cleanListMarker(line));
      }
    }

    const fieldLines = extractProjectFields(lines);
    for (const field of fieldLines) {
      if (sections.some((section) => section.title === field.key)) continue;
      sections.push({ title: field.key, points: [field.value] });
      if (sections.length >= 12) break;
    }

    if (sections.length) return sections.slice(0, 12);

    return lines
      .filter((line) => line.length <= 72)
      .slice(0, 8)
      .map((line) => ({ title: normalizeHeading(line), points: [] }));
  }

  function isSectionHeading(line) {
    const text = String(line || '').trim();
    if (!text) return false;
    if (/^#{1,6}\s+\S+/.test(text)) return true;
    if (/^[【\[][^】\]]{2,40}[】\]]$/.test(text)) return true;
    if (/^(?:第[一二三四五六七八九十百\d]+[章节部分]|[一二三四五六七八九十\d]+[、.．])\s*\S+/.test(text)) return true;
    if (/^[^：:\n]{2,32}[：:]$/.test(text)) return true;

    const fieldLike = text.match(/^[^：:\n]{1,24}[：:]\s*\S+/);
    if (fieldLike) return false;
    if (text.length > 28) return false;
    if (/[。！？!?；;]/.test(text)) return false;
    return /^[\p{L}\p{N}\s_-]+$/u.test(text);
  }

  function normalizeHeading(line) {
    return String(line || '')
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[【\[]|[】\]]$/g, '')
      .replace(/^(?:第[一二三四五六七八九十百\d]+[章节部分]|[一二三四五六七八九十\d]+[、.．])\s*/, '')
      .replace(/[：:]\s*$/, '')
      .trim()
      .slice(0, 48) || '未命名模块';
  }

  function cleanListMarker(line) {
    return String(line || '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^[（(]?[一二三四五六七八九十\d]+[）).、]\s*/, '')
      .trim();
  }

  function extractProjectFields(lines) {
    const fields = [];
    for (const line of lines) {
      const match = cleanListMarker(line).match(/^([^：:\n]{1,24})[：:]\s*(.{1,120})$/);
      if (!match) continue;
      fields.push({ key: match[1].trim(), value: match[2].trim() });
      if (fields.length >= 20) break;
    }
    return fields;
  }

  function extractProjectRuleLines(lines, sections = []) {
    const rulePattern = /必须|禁止|不要|不得|不可|只能|需要|应当|应该|优先|保持|遵守|仅限|限定|约束|规则|要求|格式|模板|风格|语气|输出|回复|生成|流程|步骤|边界|限制|权限|同步|保存|读取|每次|始终|默认|务必/i;
    const ruleHeadingPattern = /规则|要求|格式|模板|风格|语气|输出|回复|生成|流程|步骤|边界|限制|禁止|必须|约束/i;
    const rules = [];
    const pushRule = (value) => {
      const cleaned = cleanListMarker(value);
      if (!cleaned || rules.includes(cleaned)) return;
      rules.push(cleaned.length > 120 ? cleaned.slice(0, 120) + '...' : cleaned);
    };

    for (const line of lines) {
      const cleaned = cleanListMarker(line);
      if (!rulePattern.test(cleaned)) continue;
      pushRule(cleaned);
      if (rules.length >= 12) break;
    }

    for (const section of sections) {
      if (rules.length >= 16) break;
      if (!ruleHeadingPattern.test(section.title)) continue;
      for (const point of section.points || []) {
        pushRule(point);
        if (rules.length >= 16) break;
      }
    }

    return rules;
  }

  function summarizeProjectSpec(title, sections, fields, rules, spec) {
    const parts = [];
    const sectionNames = sections.map((section) => section.title).filter(Boolean).slice(0, 4);
    if (sectionNames.length) parts.push(`包含 ${sectionNames.join('、')} 等模块`);
    if (fields.length) parts.push(`包含 ${fields.slice(0, 4).map((field) => field.key).join('、')} 等结构化字段`);
    if (rules.length) parts.push('包含长期规则、格式或执行约束');
    if (!parts.length) {
      const tokens = segmentText(spec).filter((token) => token.length >= 2).slice(0, 5);
      if (tokens.length) parts.push(`围绕 ${tokens.join('、')} 展开`);
    }
    return `${title}：${parts.join('；') || '用户提供的大段项目设定和输出要求'}。`;
  }

  function buildProjectBullets({ spec, sections, fields, rules }) {
    const bullets = [];
    const sectionNames = sections.map((section) => section.title).filter(Boolean).slice(0, 6);
    if (sectionNames.length) bullets.push(`主要模块：${sectionNames.join('、')}`);
    if (fields.length) bullets.push(`关键字段：${fields.slice(0, 8).map((field) => field.key).join('、')}`);

    for (const rule of rules.slice(0, 5)) {
      bullets.push(rule);
    }

    for (const section of sections) {
      if (bullets.length >= 10) break;
      const preview = section.points.filter(Boolean).slice(0, 2).join('；');
      if (!preview) continue;
      bullets.push(`${section.title}：${preview.length > 80 ? preview.slice(0, 80) + '...' : preview}`);
    }

    return bullets.length ? bullets : [spec.slice(0, 100) + (spec.length > 100 ? '...' : '')];
  }

  function extractProjectKeywords({ spec, title, sections, fields, rules }) {
    const keywords = new Set();
    const seed = [
      title,
      sections.map((section) => section.title).join('\n'),
      fields.map((field) => `${field.key} ${field.value}`).join('\n'),
      rules.join('\n'),
      spec,
    ].join('\n');

    for (const token of segmentText(seed)) {
      if (token.length >= 2 && token.length <= 18) keywords.add(token);
      if (keywords.size >= 32) break;
    }
    return Array.from(keywords);
  }

  function saveProjectSpec(profile, spec, sessionId = null) {
    const now = Date.now();
    const rules = {
      enabled: true,
      title: profile.title,
      content: buildProjectRulesContent(profile, spec),
      scope: sessionId ? 'session' : 'global',
      updatedAt: now,
    };

    const preset = upsertPreset({
      name: `${profile.title} - 启动预设`,
      content: buildProjectPresetContent(profile),
      updatedAt: now,
    });

    const memoryContent = [
      `项目：${profile.title}`,
      `摘要：${profile.summary}`,
      '关键点：',
      ...profile.bullets.map((item) => `- ${item}`),
    ].join('\n');

    let memory = state.memories.find((item) => (
      item.name === `${profile.title} 项目设定` &&
      normalizeMemoryScope(item.scope) === 'session' &&
      item.sessionId === sessionId
    ));
    if (memory) {
      memory.content = memoryContent;
      memory.updatedAt = now;
      memory.pinned = true;
    } else if (!isDuplicateMemory(memoryContent, 'session', sessionId)) {
      memory = saveMemoryRecord({
        type: 'topic',
        name: `${profile.title} 项目设定`,
        content: memoryContent,
        tags: ['项目设定', '自动归档'],
        pinned: true,
        scope: 'session',
        sessionId,
      });
    }
    if (memory) {
      memory.scope = 'session';
      memory.sessionId = sessionId || memory.sessionId || null;
      memory.updatedAt = now;
    }

    const savedProfile = normalizeProjectProfile({
      id: profile.id,
      title: profile.title,
      summary: profile.summary,
      keywords: profile.keywords,
      rules,
      sessionId,
      presetId: preset.id,
      memorySyncId: memory?.syncId || null,
      updatedAt: now,
    });

    upsertProjectProfile(savedProfile);
    const templateProfile = normalizeProjectProfile({
      ...savedProfile,
      id: `template:${normalizeComparable(profile.title).slice(0, 48) || randomId()}`,
      sessionId: null,
      memorySyncId: null,
      updatedAt: now,
    });
    upsertProjectProfile(templateProfile);
    if (sessionId) state.sessionRules[sessionId] = rules;
    else state.projectRules = rules;
    if (sessionId) state.sessionPresets[sessionId] = preset.id;
    else state.activePresetId = preset.id;
    return savedProfile;
  }

  function buildProjectRulesContent(profile, spec) {
    const detectedRules = Array.isArray(profile.rules) ? profile.rules : [];
    const fields = Array.isArray(profile.fields) ? profile.fields : [];
    const sections = Array.isArray(profile.sections) ? profile.sections : [];
    return [
      `当前项目：${profile.title}`,
      '',
      '## 项目摘要',
      profile.summary,
      '',
      '## 识别到的执行规则',
      ...(detectedRules.length ? detectedRules : ['请遵守原始设定中的长期要求、格式约束和执行流程。']).map((item) => `- ${item}`),
      '',
      '## 结构字段',
      ...(fields.length ? fields.slice(0, 16).map((field) => `- ${field.key}: ${field.value}`) : ['- 暂无明确字段']),
      '',
      '## 结构模块',
      ...(sections.length ? sections.slice(0, 12).map((section) => {
        const preview = (section.points || []).slice(0, 2).join('；');
        return `- ${section.title}${preview ? `：${preview}` : ''}`;
      }) : ['- 暂无明确模块']),
      '',
      '## 原始设定',
      spec.trim(),
    ].join('\n');
  }

  function buildProjectPresetContent(profile) {
    return [
      `你正在协助用户推进「${profile.title}」。`,
      '',
      '请遵守项目规则中的设定、格式、风格、流程和执行约束。',
      '如果项目包含状态、记录、阶段、版本或进度信息，请持续维护这些信息。',
      '每次输出前先理解当前状态，不要随意丢失已有设定。',
      '',
      '本次请直接进入项目执行，不要要求用户重复粘贴项目设定。',
    ].join('\n');
  }

  function upsertPreset(input) {
    const existing = state.presets.find((preset) => preset.name === input.name);
    if (existing) {
      existing.content = input.content;
      existing.updatedAt = input.updatedAt;
      return existing;
    }
    const preset = {
      id: randomId(),
      name: input.name,
      content: input.content,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
    };
    state.presets.push(preset);
    return preset;
  }

  function upsertProjectProfile(profile) {
    const idx = state.projectProfiles.findIndex((item) => (
      item.id === profile.id ||
      (item.title === profile.title && (item.sessionId || null) === (profile.sessionId || null))
    ));
    if (idx >= 0) {
      state.projectProfiles[idx] = { ...state.projectProfiles[idx], ...profile };
    } else {
      state.projectProfiles.push(profile);
    }
  }

  function captureExplicitMemory(prompt, sessionId = state.currentSessionKey) {
    const text = String(prompt || '').trim();
    if (!text) return;

    const directive = extractDirectiveMemoryBlock(text);
    if (directive) {
      if (!isDuplicateMemory(directive.content)) {
        saveMemoryRecord({
          type: 'feedback',
          name: directive.title,
          content: directive.content,
          tags: ['系统指令', '项目规则'],
          pinned: true,
          scope: 'global',
        });
        showToast(`已保存常驻指令：${directive.title}`);
      }
      return;
    }

    const remembered = extractExplicitMemoryText(text);
    if (!remembered) return;
    const scope = inferMemoryScope(remembered);
    if (isDuplicateMemory(remembered, scope, sessionId)) return;

    saveMemoryRecord({
      type: inferMemoryType(remembered),
      name: makeMemoryTitle(remembered),
      content: remembered,
      tags: ['手动记忆'],
      pinned: true,
      scope,
      sessionId,
    });
    showToast(`已直接保存到移动版记忆：${makeMemoryTitle(remembered)}`);
  }

  function extractDirectiveMemoryBlock(text) {
    const bracketMatch = text.match(/\[([^\]\n]{2,40})\]\s*([\s\S]{2,}?)\s*\[\/\1\]/i);
    if (!bracketMatch) return null;

    const label = bracketMatch[1].trim();
    const lowerLabel = label.toLowerCase();
    const acceptedLabels = [
      'system directive',
      'project directive',
      'directive',
      '系统指令',
      '项目指令',
      '长期指令',
      '常驻指令',
      '规则',
      '项目规则',
    ];

    if (!acceptedLabels.includes(lowerLabel) && !label.includes('指令') && !label.includes('规则')) {
      return null;
    }

    const rawBlock = bracketMatch[0].trim();
    const body = bracketMatch[2].trim();
    if (body.length < 2) return null;

    return {
      title: makeDirectiveTitle(label, body),
      content: rawBlock,
    };
  }

  function makeDirectiveTitle(label, body) {
    const firstLine = String(body || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) return label;
    const compact = firstLine.replace(/\s+/g, ' ');
    return `${label}: ${compact.length > 16 ? compact.slice(0, 16) + '...' : compact}`;
  }

  function extractExplicitMemoryText(text) {
    const patterns = [
      /^(?:请|帮我|给我)?(?:记住|记一下|记下来|记录一下|保存一下|存一下|帮我记住|帮我记一下)[:：\s]*([\s\S]{2,})$/i,
      /^(?:以后|之后|往后)(?:请)?(?:记住|记得)[:：\s]*([\s\S]{2,})$/i,
      /^(?:remember|remember that|note that|save this)[:：\s]+([\s\S]{2,})$/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const content = match?.[1]?.trim();
      if (content) return content;
    }
    return null;
  }

  function inferMemoryType(content) {
    if (/偏好|喜欢|不喜欢|习惯|风格|语气|回答|输出|以后|记得/.test(content)) {
      return 'feedback';
    }
    if (/我是|职业|身份|我叫|我的/.test(content)) {
      return 'user';
    }
    if (/http|https|资料|链接|参考|文档/.test(content)) {
      return 'reference';
    }
    return 'topic';
  }

  function inferMemoryScope(content) {
    if (/当前|这个|本局|本轮|本窗口|此窗口|这次|本次|主角|角色|进度|状态|存档|剧情|章节|任务|项目|规则|设定/.test(content)) {
      return 'session';
    }
    if (/我(?:是|的|喜欢|不喜欢|习惯|偏好)|以后|长期|总是|默认|所有对话|每次|通用|全局/.test(content)) {
      return 'global';
    }
    return 'session';
  }

  function isDuplicateMemory(content, scope = null, sessionId = null) {
    const normalized = normalizeComparable(content);
    return state.memories.some((memory) => {
      if (normalizeComparable(memory.content) !== normalized) return false;
      if (!scope) return true;
      const memoryScope = normalizeMemoryScope(memory.scope);
      if (memoryScope !== normalizeMemoryScope(scope)) return false;
      if (memoryScope === 'session') return memory.sessionId === sessionId;
      return true;
    });
  }

  function normalizeComparable(text) {
    return String(text || '').replace(/\s+/g, '').toLowerCase();
  }

  function makeMemoryTitle(content) {
    const compact = String(content || '').replace(/\s+/g, ' ').trim();
    return compact.length > 18 ? compact.slice(0, 18) + '...' : compact || '手动记忆';
  }

  function saveMemoryRecord(input) {
    const now = Date.now();
    const scope = normalizeMemoryScope(input.scope || (input.pinned ? 'global' : 'session'));
    const memory = {
      id: state.nextMemoryId++,
      syncId: randomId(),
      type: normalizeMemoryType(input.type),
      name: String(input.name || '未命名记忆').trim() || '未命名记忆',
      content: String(input.content || '').trim(),
      description: String(input.description || input.name || '').trim(),
      tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : [],
      pinned: Boolean(input.pinned),
      enabled: input.enabled !== false,
      scope,
      sessionId: scope === 'session' ? String(input.sessionId || state.currentSessionKey || PAGE_INSTANCE_KEY) : null,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessedAt: now,
    };
    if (!memory.content) return null;
    state.memories.push(memory);
    saveState();
    renderPanelIfOpen();
    return memory;
  }

  function getAllSkills() {
    return [...BUILTIN_SKILLS, ...state.customSkills];
  }

  function resolveSkills(skillName, args) {
    const all = getAllSkills();
    const primary = all.find((s) => s.name === skillName);
    if (!primary) return null;

    const second = parseSkillCommand('/' + args);
    if (second) {
      const secondary = all.find((s) => s.name === second.skillName);
      if (secondary) {
        const instructions = `${primary.instructions}\n\n---\n\n${secondary.instructions}`;
        return {
          combinedPrompt: second.args ? wrapUserInput(instructions, second.args) : instructions,
          memoryEnabled: primary.memoryEnabled || secondary.memoryEnabled,
        };
      }
    }

    return {
      combinedPrompt: args ? wrapUserInput(primary.instructions, args) : primary.instructions,
      memoryEnabled: primary.memoryEnabled,
    };
  }

  function wrapUserInput(instructions, userInput) {
    return `${instructions}\n\n---\n\n以下是用户本次的输入，请根据上述指令处理：\n\n${userInput}`;
  }

  function buildAugmentedPrompt(originalPrompt, memories, options = {}) {
    const promptTokens = estimateTokens(originalPrompt);
    const budget = getMemoryBudget(promptTokens);
    const selected = selectMemories(originalPrompt, memories, {
      budget,
      identityOnly: options.identityOnly === true,
    });
    const memBlock = selected.length ? selected.map(formatMemoryLine).join('\n') : '(暂无记忆)';
    const template = options.thinkingEnabled ? SYSTEM_TEMPLATE_THINKING : SYSTEM_TEMPLATE_CHAT;
    const system = template.replace('{{memories}}', memBlock);
    return {
      augmented: system + originalPrompt,
      usedMemoryIds: selected.map((m) => m.id).filter(Boolean),
    };
  }

  function getMemoryBudget(promptTokens) {
    if (promptTokens > 3000) {
      return Math.max(800, MEMORY_TOKEN_BUDGET - Math.floor((promptTokens - 3000) * 0.2));
    }
    return MEMORY_TOKEN_BUDGET;
  }

  function selectMemories(prompt, memories, options) {
    const candidates = options.identityOnly
      ? memories.filter((m) => m.type === 'user' || m.type === 'feedback' || m.pinned)
      : memories;
    const words = segmentText(prompt);

    const pinned = candidates
      .filter((m) => m.pinned)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const regular = candidates.filter((m) => !m.pinned);
    const scored = regular.map((m) => ({
      memory: m,
      score: keywordScore(words, m) + decayScore(m),
    }));
    scored.sort((a, b) => b.score - a.score);

    const selected = [];
    let remaining = options.budget;

    for (const memory of pinned) {
      const cost = estimateTokens(formatMemoryLine(memory));
      if (remaining - cost < 0 && selected.length > 0) break;
      selected.push(memory);
      remaining -= cost;
    }

    for (const { memory } of scored) {
      const cost = estimateTokens(formatMemoryLine(memory));
      if (remaining - cost < 0 && selected.length > 0) break;
      selected.push(memory);
      remaining -= cost;
    }
    return selected;
  }

  function segmentText(text) {
    return String(text)
      .toLowerCase()
      .split(/[\s,，。！？；：、\-_/()[\]{}"'`~!@#$%^&*+=|\\<>.?]+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  }

  function estimateTokens(text) {
    let tokens = 0;
    for (const char of String(text)) {
      tokens += char.charCodeAt(0) > 0x7F ? 1.5 : 0.25;
    }
    return Math.ceil(tokens);
  }

  function keywordScore(promptWords, memory) {
    const promptSet = new Set(promptWords);
    let tagHits = 0;
    for (const tag of memory.tags || []) {
      const lower = String(tag).toLowerCase();
      if (promptSet.has(lower)) tagHits++;
      for (const word of promptWords) {
        if (word.length > 2 && lower.includes(word) && lower !== word) tagHits += 0.5;
      }
    }
    const nameHits = segmentText(memory.name).filter((w) => promptSet.has(w)).length;
    const contentHits = segmentText(memory.content).filter((w) => promptSet.has(w)).length;
    return tagHits * 20 + nameHits * 15 + contentHits * 5;
  }

  function decayScore(memory) {
    const days = (Date.now() - (memory.lastAccessedAt || memory.createdAt || Date.now())) / 86400000;
    const freshness = Math.max(0, 10 - days * 0.1);
    return Math.min(memory.accessCount || 0, 20) + freshness;
  }

  function formatMemoryLine(memory) {
    const id = memory.id != null ? `#${memory.id} ` : '';
    return `- ${id}[${memory.type}] ${sanitizeDSML(memory.name)}: ${sanitizeDSML(memory.content)}`;
  }

  function sanitizeDSML(text) {
    return String(text || '').replaceAll(DSML_FULL, DSML);
  }

  function touchMemories(ids) {
    if (!ids || ids.length === 0) return;
    const now = Date.now();
    const set = new Set(ids);
    for (const memory of state.memories) {
      if (set.has(memory.id)) {
        memory.accessCount = (memory.accessCount || 0) + 1;
        memory.lastAccessedAt = now;
      }
    }
  }

  async function interceptFetchResponse(response) {
    if (!response.body) return response;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const readerId = ++currentReaderId;
    responseBuffer = '';
    notifiedToolCount = 0;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              finalizeResponse(readerId);
              controller.close();
              break;
            }
            controller.enqueue(value);
            const chunk = decoder.decode(value, { stream: true });
            handleSSEText(chunk);
          }
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  function setupXHRResponseInterceptor(xhr) {
    let lastLen = 0;
    const readerId = ++currentReaderId;
    responseBuffer = '';
    notifiedToolCount = 0;

    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState === 3 || xhr.readyState === 4) {
        const raw = xhr.responseText || '';
        const next = raw.slice(lastLen);
        lastLen = raw.length;
        if (next) handleSSEText(next);
      }
      if (xhr.readyState === 4) finalizeResponse(readerId);
    });
  }

  let sseRemainder = '';

  function handleSSEText(chunk) {
    const text = sseRemainder + chunk.replace(/\r\n/g, '\n');
    const blocks = text.split('\n\n');
    sseRemainder = blocks.pop() || '';

    for (const block of blocks) {
      const event = parseSSEBlock(block);
      if (!event || !event.data) continue;
      const parsed = parseJson(event.data);
      if (!parsed) continue;
      const extracted = extractTextFromParsed(parsed);
      if (extracted) {
        responseBuffer += extracted;
        notifyNewToolCalls();
      }
      if (isStreamFinished(parsed)) {
        finalizeResponse(currentReaderId);
      }
    }
  }

  function parseSSEBlock(block) {
    const event = { type: 'message', data: '' };
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event.type = line.slice(6).trim();
      if (line.startsWith('data:')) {
        event.data += event.data ? '\n' + line.slice(5).trim() : line.slice(5).trim();
      }
    }
    return event.data ? event : null;
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function extractTextFromParsed(parsed) {
    if (typeof parsed?.v === 'string') return parsed.v;
    if (parsed?.p && parsed?.o === 'APPEND' && typeof parsed.v === 'string') return parsed.v;
    return null;
  }

  function isStreamFinished(parsed) {
    if (parsed?.p === 'response/status' && parsed?.v === 'FINISHED') return true;
    if (parsed?.o === 'BATCH' && Array.isArray(parsed.v)) {
      return parsed.v.some((item) => item?.p === 'quasi_status' && item?.v === 'FINISHED');
    }
    return false;
  }

  function notifyNewToolCalls() {
    const calls = extractToolCalls(responseBuffer);
    for (let i = notifiedToolCount; i < calls.length; i++) {
      executeToolCall(calls[i]);
    }
    notifiedToolCount = calls.length;
  }

  function finalizeResponse(readerId) {
    if (readerId !== currentReaderId) return;
    notifyNewToolCalls();
    setTimeout(cleanDSMLFromPage, 250);
  }

  function extractToolCalls(text) {
    const calls = [];
    const normalizedText = normalizeDSMLMarkup(text);
    const blockRegex = /<(?:(?:｜DSML｜|DSML｜)?tool_calls)>\s*[\s\S]*?\s*<\/(?:(?:｜DSML｜|DSML｜)?tool_calls)>/g;
    const invokeRegex = /<(?:｜DSML｜)?invoke\s+name="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/(?:｜DSML｜)?invoke>/g;
    let blockMatch;
    while ((blockMatch = blockRegex.exec(normalizedText))) {
      const block = blockMatch[0];
      let invokeMatch;
      while ((invokeMatch = invokeRegex.exec(block))) {
        const payload = parseToolParameters(invokeMatch[2]);
        calls.push({ name: invokeMatch[1], payload, raw: block });
      }
    }
    return calls;
  }

  function normalizeDSMLMarkup(text) {
    return String(text || '')
      .replace(/<DSML｜tool_calls>/g, '<｜DSML｜tool_calls>')
      .replace(/<\/DSML｜tool_calls>/g, '</｜DSML｜tool_calls>')
      .replace(/<\|DSML\|tool_calls>/g, '<｜DSML｜tool_calls>')
      .replace(/<\/\|DSML\|tool_calls>/g, '</｜DSML｜tool_calls>')
      .replace(/<invoke\b/g, '<｜DSML｜invoke')
      .replace(/<\/invoke>/g, '</｜DSML｜invoke>')
      .replace(/<parameter\b/g, '<｜DSML｜parameter')
      .replace(/<\/parameter>/g, '</｜DSML｜parameter>');
  }

  function parseToolParameters(text) {
    const payload = parseLooseToolParameters(text);
    const paramRegex = /<(?:｜DSML｜)?parameter\s+([^>]*)>([\s\S]*?)<\/(?:｜DSML｜)?parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(text))) {
      const attrs = parseTagAttributes(paramMatch[1]);
      const name = attrs.name;
      if (!name || payload[name] != null) continue;
      const value = attrs.value != null ? attrs.value : paramMatch[2];
      payload[name] = normalizeToolValue(value, attrs.string);
    }
    return payload;
  }

  function parseLooseToolParameters(text) {
    const payload = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.includes('parameter')) continue;
      const nameMatch = line.match(/\bname="([^"]+)"/);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      const attrs = parseTagAttributes(line);
      const closedValue = line.match(/\bvalue="([^"]*)"/);
      const openValue = line.match(/\bvalue="([\s\S]*?)(?:<\/(?:｜DSML｜)?parameter>|$)/);
      const bodyValue = line.match(/>([\s\S]*?)<\/(?:｜DSML｜)?parameter>/);
      const value = closedValue?.[1] ?? openValue?.[1] ?? bodyValue?.[1] ?? '';
      payload[name] = normalizeToolValue(value, attrs.string);
    }
    return payload;
  }

  function parseTagAttributes(text) {
    const attrs = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let match;
    while ((match = attrRegex.exec(text))) attrs[match[1]] = decodeHtmlEntities(match[2]);
    return attrs;
  }

  function normalizeToolValue(value, stringFlag) {
    const text = decodeHtmlEntities(String(value ?? '').trim());
    if (stringFlag === 'false') return parseJson(text) ?? text;
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
    if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
      return parseJson(text) ?? text;
    }
    return text;
  }

  function executeToolCall(call) {
    if (call.name === 'memory_save') {
      const payload = call.payload || {};
      const scope = normalizeMemoryScope(payload.scope || inferMemoryScope(payload.content || payload.name || ''));
      const memory = saveMemoryRecord({
        type: normalizeMemoryType(payload.type),
        name: String(payload.name || '未命名记忆').trim() || '未命名记忆',
        content: String(payload.content || '').trim(),
        description: String(payload.name || '').trim(),
        tags: normalizeToolTags(payload.tags),
        pinned: scope === 'global',
        enabled: normalizeToolBoolean(payload.enabled, true),
        scope,
        sessionId: state.currentSessionKey,
      });
      if (memory) {
        showToast(`已保存记忆：${memory.name}`);
      }
      return;
    }

    if (call.name === 'memory_update') {
      const payload = call.payload || {};
      const id = Number(payload.id);
      const memory = state.memories.find((m) => m.id === id);
      if (!memory) {
        showToast(`未找到记忆 #${id}`);
        return;
      }
      memory.type = normalizeMemoryType(payload.type || memory.type);
      memory.name = String(payload.name || memory.name).trim();
      memory.content = String(payload.content || memory.content).trim();
      memory.description = memory.name;
      memory.tags = payload.tags != null ? normalizeToolTags(payload.tags) : memory.tags;
      if (payload.enabled != null) memory.enabled = normalizeToolBoolean(payload.enabled, memory.enabled !== false);
      if (payload.scope) {
        memory.scope = normalizeMemoryScope(payload.scope);
        memory.sessionId = memory.scope === 'session' ? (memory.sessionId || state.currentSessionKey || PAGE_INSTANCE_KEY) : null;
      }
      memory.updatedAt = Date.now();
      saveState();
      renderPanelIfOpen();
      showToast(`已更新记忆：${memory.name}`);
      return;
    }

    if (call.name === 'memory_delete') {
      const id = Number(call.payload?.id);
      const before = state.memories.length;
      state.memories = state.memories.filter((m) => m.id !== id);
      if (state.memories.length !== before) {
        saveState();
        renderPanelIfOpen();
        showToast(`已删除记忆 #${id}`);
      }
    }
  }

  function normalizeMemoryType(type) {
    return MEMORY_TYPES.some((item) => item.key === type) ? type : 'topic';
  }

  function normalizeMemoryScope(scope) {
    return scope === 'session' ? 'session' : 'global';
  }

  function normalizeToolTags(tags) {
    if (Array.isArray(tags)) return tags.map(String).map((tag) => tag.trim()).filter(Boolean);
    return String(tags || '')
      .split(/[,，、\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function normalizeToolBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (/^(true|1|yes|on|启用|是)$/i.test(value.trim())) return true;
      if (/^(false|0|no|off|停用|否)$/i.test(value.trim())) return false;
    }
    return fallback;
  }

  function decodeHtmlEntities(value) {
    return String(value ?? '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function randomId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function cleanDSMLFromPage() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if ((node.textContent || '').includes(DSML_FULL)) targets.push(node);
    }
    for (const node of targets) {
      node.textContent = node.textContent.replace(/<｜DSML｜tool_calls>\s*[\s\S]*?\s*<\/｜DSML｜tool_calls>/g, '').trim();
    }
  }

  function observeToolText() {
    const observer = new MutationObserver(() => {
      if (document.body.textContent && document.body.textContent.includes(TOOL_CALL_START)) {
        setTimeout(cleanDSMLFromPage, 100);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function mountFab() {
    const fab = document.createElement('button');
    fab.className = 'dpp-mobile-fab';
    fab.type = 'button';
    fab.textContent = 'D+';
    fab.addEventListener('click', openPanel);
    document.body.appendChild(fab);
  }

  function openPanel() {
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'dpp-mobile-panel';
      document.body.appendChild(panel);
    }
    panel.classList.add('open');
    renderPanel('memories');
  }

  function closePanel() {
    panel?.classList.remove('open');
  }

  function renderPanelIfOpen() {
    if (panel?.classList.contains('open')) {
      const active = panel.querySelector('.dpp-tab.active')?.dataset.tab || 'memories';
      renderPanel(active);
    }
  }

  function renderPanel(tab) {
    if (!panel) return;
    restoreCurrentSessionProfile();
    if (tab !== 'memories') editingMemoryId = null;
    if (tab !== 'presets') editingPresetId = null;
    panel.innerHTML = `
      <div class="dpp-panel-head">
        <strong>DeepSeek++</strong>
        <button class="dpp-icon-btn" data-action="close">×</button>
      </div>
      <div class="dpp-tabs">
        ${tabButton('memories', '记忆', tab)}
        ${tabButton('skills', 'Skill', tab)}
        ${tabButton('presets', '预设', tab)}
        ${tabButton('rules', '规则', tab)}
        ${tabButton('settings', '设置', tab)}
      </div>
      <div class="dpp-panel-body">${renderTab(tab)}</div>
    `;

    panel.querySelector('[data-action="close"]').addEventListener('click', closePanel);
    panel.querySelectorAll('.dpp-tab').forEach((btn) => {
      btn.addEventListener('click', () => renderPanel(btn.dataset.tab));
    });
    bindPanelActions(tab);
  }

  function tabButton(key, label, active) {
    return `<button class="dpp-tab ${key === active ? 'active' : ''}" data-tab="${key}">${label}</button>`;
  }

  function renderTab(tab) {
    if (tab === 'skills') return renderSkillsTab();
    if (tab === 'presets') return renderPresetsTab();
    if (tab === 'rules') return renderRulesTab();
    if (tab === 'settings') return renderSettingsTab();
    return renderMemoriesTab();
  }

  function renderMemoriesTab() {
    const sessionId = getCurrentSessionKey();
    const editing = state.memories.find((memory) => memory.id === editingMemoryId) || null;
    const items = state.memories
      .slice()
      .filter((memory) => normalizeMemoryScope(memory.scope) === 'global' || memory.sessionId === sessionId)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
      .map((memory) => {
        const type = MEMORY_TYPES.find((t) => t.key === memory.type) || MEMORY_TYPES[2];
        const scope = normalizeMemoryScope(memory.scope);
        const boundHere = scope === 'session' && memory.sessionId === sessionId;
        const enabled = memory.enabled !== false;
        return `
          <article class="dpp-card ${enabled ? '' : 'muted'}">
            <div class="dpp-card-top">
              <span class="dpp-type" style="color:${type.color}">${type.label}</span>
              <b>${escapeHtml(memory.name)}</b>
              <span class="${enabled ? 'dpp-badge-on' : 'dpp-badge-off'}">${enabled ? '生效' : '停用'}</span>
            </div>
            <p>${escapeHtml(memory.content)}</p>
            <div class="dpp-card-actions">
              <small>#${memory.id} ${scope === 'global' ? '全局长期' : (boundHere ? '当前窗口' : '其他窗口')} ${memory.pinned ? '常驻 ' : ''}${enabled ? '会注入 ' : '不注入 '}${escapeHtml((memory.tags || []).join(', '))}</small>
              <span>
                <button data-action="toggle-memory-enabled" data-id="${memory.id}">${enabled ? '停用' : '启用'}</button>
                <button data-action="toggle-memory-scope" data-id="${memory.id}">${scope === 'global' ? '转当前窗口' : '转全局'}</button>
                <button data-action="pin-memory" data-id="${memory.id}">${memory.pinned ? '取消常驻' : '设为常驻'}</button>
                <button data-action="edit-memory" data-id="${memory.id}">编辑</button>
                <button data-action="delete-memory" data-id="${memory.id}">删除</button>
              </span>
            </div>
          </article>
        `;
      })
      .join('');

    return `
      ${renderBindingStatusCard()}
      <form class="dpp-form" data-form="memory">
        <select name="type">
          ${MEMORY_TYPES.map((t) => `<option value="${t.key}" ${editing?.type === t.key ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
        <input name="name" placeholder="标题" required value="${escapeHtml(editing?.name || '')}" />
        <textarea name="content" placeholder="内容" required>${escapeHtml(editing?.content || '')}</textarea>
        <input name="tags" placeholder="标签，用逗号分隔" value="${escapeHtml((editing?.tags || []).join(', '))}" />
        <select name="scope">
          ${MEMORY_SCOPES.map((scope) => `<option value="${scope.key}" ${normalizeMemoryScope(editing?.scope) === scope.key ? 'selected' : ''}>${scope.label}</option>`).join('')}
        </select>
        <label class="dpp-check"><input type="checkbox" name="enabled" ${editing?.enabled === false ? '' : 'checked'} /> 启用注入：保存后会参与当前请求</label>
        <label class="dpp-check"><input type="checkbox" name="pinned" ${editing?.pinned ? 'checked' : ''} /> 常驻注入：每次对话都带上</label>
        <div class="dpp-form-actions">
          <button type="submit">${editing ? '更新记忆' : '保存记忆'}</button>
          ${editing ? '<button type="button" data-action="cancel-edit-memory" class="secondary">取消编辑</button>' : ''}
        </div>
      </form>
      <p class="dpp-empty">提示：这里只显示全局记忆和当前窗口记忆；停用只影响当前这条记忆是否注入。</p>
      <div class="dpp-list">${items || '<p class="dpp-empty">暂无记忆</p>'}</div>
    `;
  }

  function renderSkillsTab() {
    const custom = state.customSkills.map((skill) => `
      <article class="dpp-card">
        <div class="dpp-card-top"><b>/${escapeHtml(skill.name)}</b><button data-action="delete-skill" data-name="${escapeHtml(skill.name)}">删除</button></div>
        <p>${escapeHtml(skill.description || '自定义 Skill')}</p>
      </article>
    `).join('');
    const builtin = BUILTIN_SKILLS.map((skill) => `
      <article class="dpp-card muted">
        <div class="dpp-card-top"><b>/${escapeHtml(skill.name)}</b><span>内置</span></div>
        <p>${escapeHtml(skill.description)}</p>
      </article>
    `).join('');
    return `
      <form class="dpp-form" data-form="skill">
        <input name="name" placeholder="名称，如 my-skill" required />
        <input name="description" placeholder="描述" />
        <textarea name="instructions" placeholder="指令内容" required></textarea>
        <label class="dpp-check"><input type="checkbox" name="memoryEnabled" /> 启用记忆注入</label>
        <button type="submit">保存 Skill</button>
      </form>
      <h3>自定义</h3>
      <div class="dpp-list">${custom || '<p class="dpp-empty">暂无自定义 Skill</p>'}</div>
      <h3>内置</h3>
      <div class="dpp-list">${builtin}</div>
    `;
  }

  function renderPresetsTab() {
    const sessionId = getCurrentSessionKey();
    const currentPreset = getSessionPreset(getSessionProfileByKey(sessionId), sessionId);
    const editing = state.presets.find((preset) => preset.id === editingPresetId) || null;
    const items = state.presets.map((preset) => `
      <article class="dpp-card">
        <div class="dpp-card-top">
          <b>${escapeHtml(preset.name)}</b>
          <span>${preset.id === currentPreset?.id ? '当前窗口启用' : ''}</span>
        </div>
        <p>${escapeHtml(preset.content.slice(0, 140))}${preset.content.length > 140 ? '...' : ''}</p>
        <div class="dpp-card-actions">
          <small>${new Date(preset.updatedAt).toLocaleDateString()}</small>
          <span>
            <button data-action="toggle-preset" data-id="${preset.id}">${preset.id === currentPreset?.id ? '停用' : '当前窗口启用'}</button>
            <button data-action="edit-preset" data-id="${preset.id}">编辑</button>
            <button data-action="delete-preset" data-id="${preset.id}">删除</button>
          </span>
        </div>
      </article>
    `).join('');
    return `
      <form class="dpp-form" data-form="preset">
        <input name="name" placeholder="预设名称" required value="${escapeHtml(editing?.name || '')}" />
        <textarea name="content" placeholder="系统提示词内容" required>${escapeHtml(editing?.content || '')}</textarea>
        <div class="dpp-form-actions">
          <button type="submit">${editing ? '更新预设' : '保存预设'}</button>
          ${editing ? '<button type="button" data-action="cancel-edit-preset" class="secondary">取消编辑</button>' : ''}
        </div>
      </form>
      <p class="dpp-empty">提示：预设默认绑定当前窗口；不同 DeepSeek /s/ 窗口可以启用不同预设。</p>
      <div class="dpp-list">${items || '<p class="dpp-empty">暂无预设</p>'}</div>
    `;
  }

  function renderRulesTab() {
    const sessionId = getCurrentSessionKey();
    const sessionRules = normalizeProjectRules(state.sessionRules[sessionId]);
    const globalRules = state.projectRules;
    return `
      ${renderBindingStatusCard()}
      <div class="dpp-card">
        <div class="dpp-card-top">
          <b>规则开关</b>
          <span>${sessionRules.enabled ? '当前窗口生效' : '当前窗口停用'} / ${globalRules.enabled ? '全局生效' : '全局停用'}</span>
        </div>
        <div class="dpp-card-actions">
          <small>规则内容会保存；关闭后只是不参与注入。</small>
          <span>
            <button data-action="toggle-session-rules">${sessionRules.enabled ? '停用当前规则' : '启用当前规则'}</button>
            <button data-action="toggle-global-rules">${globalRules.enabled ? '停用全局规则' : '启用全局规则'}</button>
          </span>
        </div>
      </div>
      <form class="dpp-form" data-form="rules">
        <b>当前窗口规则</b>
        <label class="dpp-check"><input type="checkbox" name="enabled" ${sessionRules.enabled ? 'checked' : ''} /> 启用当前窗口规则注入</label>
        <input name="title" placeholder="规则标题" value="${escapeHtml(sessionRules.title || '当前窗口规则')}" />
        <textarea name="content" placeholder="只绑定当前窗口的项目设定、角色状态、输出格式、进度规则">${escapeHtml(sessionRules.content || '')}</textarea>
        <button type="submit">保存当前窗口规则</button>
      </form>
      <form class="dpp-form" data-form="global-rules">
        <b>全局规则</b>
        <label class="dpp-check"><input type="checkbox" name="enabled" ${globalRules.enabled ? 'checked' : ''} /> 启用所有窗口共享规则</label>
        <input name="title" placeholder="规则标题" value="${escapeHtml(globalRules.title || '全局规则')}" />
        <textarea name="content" placeholder="所有窗口都需要遵守的通用规则、偏好、格式或边界">${escapeHtml(globalRules.content || '')}</textarea>
        <button type="submit">保存全局规则</button>
      </form>
      <div class="dpp-card">
        <b>用途说明</b>
        <p>当前窗口规则适合保存某个窗口里的项目、角色、进度和格式；全局规则适合保存所有窗口都共用的稳定偏好和边界。</p>
      </div>
      <div class="dpp-card muted">
        <b>建议写法</b>
        <p>把“只属于这个窗口”的内容放当前窗口规则，把“所有窗口都该遵守”的内容放全局规则。规则越具体，后续对话越稳定。</p>
      </div>
    `;
  }

  function renderSettingsTab() {
    const sync = getSyncConfig();
    return `
      <div class="dpp-card">
        <label class="dpp-switch">
          <span>Expert 模式</span>
          <input type="checkbox" data-action="expert-mode" ${state.expertMode ? 'checked' : ''} />
        </label>
        <p>开启后会把 DeepSeek 请求里的 model_type 改为 expert。</p>
      </div>
      <div class="dpp-card">
        <b>记忆保存位置</b>
        <p>记忆会保存到 DeepSeek++ Mobile 的本地记忆库，也就是当前脚本管理器/浏览器本地存储。输入“记住：...”或“帮我记一下 ...”会由脚本直接保存。</p>
      </div>
      <form class="dpp-form" data-form="sync">
        <b>WebDAV 同步</b>
        <input name="url" type="url" placeholder="https://dav.example.com/dav/" value="${escapeHtml(sync.url)}" />
        <input name="username" placeholder="用户名" value="${escapeHtml(sync.username)}" />
        <input name="password" type="password" placeholder="密码或应用密码" value="${escapeHtml(sync.password)}" />
        <input name="remotePath" placeholder="远程路径，如 DeepSeekPP" value="${escapeHtml(sync.remotePath)}" />
        <div class="dpp-form-actions">
          <button type="submit">保存配置</button>
          <button type="button" data-action="webdav-test">测试连接</button>
          <button type="button" data-action="webdav-merge">合并同步</button>
          <button type="button" data-action="webdav-upload">上传覆盖</button>
          <button type="button" data-action="webdav-pull">拉取覆盖</button>
        </div>
        <small>上次同步：${formatSyncTime(sync.lastSyncAt)}</small>
      </form>
      <div class="dpp-card">
        <button data-action="export-data">导出数据</button>
        <button data-action="import-data">导入数据</button>
        <button data-action="clear-data" class="danger">清空本地数据</button>
        <input type="file" accept=".json" class="dpp-hidden-file" />
      </div>
      <p class="dpp-empty">移动版数据保存在当前脚本管理器/浏览器本地。卸载浏览器或清除站点数据前，建议先导出。</p>
    `;
  }

  function bindPanelActions(tab) {
    const body = panel.querySelector('.dpp-panel-body');
    if (!body) return;

    body.querySelector('[data-form="memory"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const now = Date.now();
      const draft = {
        type: form.type.value,
        name: form.name.value.trim(),
        content: form.content.value.trim(),
        description: form.name.value.trim(),
        tags: form.tags.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        pinned: form.pinned.checked,
        enabled: form.enabled.checked,
        scope: normalizeMemoryScope(form.scope.value),
        sessionId: normalizeMemoryScope(form.scope.value) === 'session' ? getCurrentSessionKey() : null,
      };

      if (editingMemoryId != null) {
        const memory = state.memories.find((item) => item.id === editingMemoryId);
        if (memory) {
          Object.assign(memory, draft, { updatedAt: now });
        }
        editingMemoryId = null;
      } else {
        saveMemoryRecord(draft);
      }
      saveState();
      renderPanel('memories');
    });

    body.querySelector('[data-form="skill"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const name = normalizeSkillName(form.name.value);
      if (!name) return;
      const skill = {
        name,
        description: form.description.value.trim(),
        instructions: form.instructions.value.trim(),
        source: 'custom',
        memoryEnabled: form.memoryEnabled.checked,
      };
      const idx = state.customSkills.findIndex((s) => s.name === name);
      if (idx >= 0) state.customSkills[idx] = skill;
      else state.customSkills.push(skill);
      saveState();
      renderPanel('skills');
    });

    body.querySelector('[data-form="preset"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const now = Date.now();
      const draft = {
        name: form.name.value.trim(),
        content: form.content.value.trim(),
        updatedAt: now,
      };

      if (editingPresetId) {
        const preset = state.presets.find((item) => item.id === editingPresetId);
        if (preset) Object.assign(preset, draft);
        editingPresetId = null;
      } else {
        state.presets.push({
          id: randomId(),
          ...draft,
          createdAt: now,
        });
      }
      saveState();
      renderPanel('presets');
    });

    body.querySelector('[data-form="rules"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const sessionId = getCurrentSessionKey();
      state.sessionRules[sessionId] = {
        enabled: form.enabled.checked,
        title: form.title.value.trim() || '当前窗口规则',
        content: form.content.value.trim(),
        scope: 'session',
        updatedAt: Date.now(),
      };
      saveState();
      renderPanel('rules');
      showToast(state.sessionRules[sessionId].enabled ? '当前窗口规则已启用' : '当前窗口规则已保存');
    });

    body.querySelector('[data-form="global-rules"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      state.projectRules = {
        enabled: form.enabled.checked,
        title: form.title.value.trim() || '全局规则',
        content: form.content.value.trim(),
        scope: 'global',
        updatedAt: Date.now(),
      };
      saveState();
      renderPanel('rules');
      showToast(state.projectRules.enabled ? '全局规则已启用' : '全局规则已保存');
    });

    body.querySelector('[data-form="sync"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveSyncConfigFromForm(event.currentTarget);
      showToast('同步配置已保存');
    });

    body.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', handlePanelAction);
      if (el.matches('input[type="checkbox"]')) {
        el.addEventListener('change', handlePanelAction);
      }
    });

    body.querySelector('.dpp-hidden-file')?.addEventListener('change', importDataFromFile);
  }

  function handlePanelAction(event) {
    const el = event.currentTarget;
    const action = el.dataset.action;
    const id = Number(el.dataset.id);

    const currentMemory = () => {
      const memory = state.memories.find((m) => m.id === id);
      if (!memory) return null;
      const scope = normalizeMemoryScope(memory.scope);
      if (scope === 'global' || memory.sessionId === getCurrentSessionKey()) return memory;
      showToast('这条记忆属于其他窗口，当前窗口不能修改');
      return null;
    };

    if (action === 'pin-memory') {
      const memory = currentMemory();
      if (memory) {
        memory.pinned = !memory.pinned;
        memory.updatedAt = Date.now();
        saveState();
        renderPanel('memories');
      }
    }

    if (action === 'toggle-memory-enabled') {
      const memory = currentMemory();
      if (memory) {
        memory.enabled = memory.enabled === false;
        memory.updatedAt = Date.now();
        saveState();
        renderPanel('memories');
      }
    }

    if (action === 'toggle-memory-scope') {
      const memory = currentMemory();
      if (memory) {
        const nextScope = normalizeMemoryScope(memory.scope) === 'global' ? 'session' : 'global';
        memory.scope = nextScope;
        memory.sessionId = nextScope === 'session' ? getCurrentSessionKey() : null;
        memory.updatedAt = Date.now();
        saveState();
        renderPanel('memories');
      }
    }

    if (action === 'edit-memory') {
      const memory = currentMemory();
      if (!memory) return;
      editingMemoryId = memory.id;
      renderPanel('memories');
    }

    if (action === 'cancel-edit-memory') {
      editingMemoryId = null;
      renderPanel('memories');
    }

    if (action === 'delete-memory') {
      if (!currentMemory()) return;
      if (!confirm('删除这条记忆？')) return;
      state.memories = state.memories.filter((m) => m.id !== id);
      if (editingMemoryId === id) editingMemoryId = null;
      saveState();
      renderPanel('memories');
    }

    if (action === 'unbind-session-profile') {
      const sessionId = getCurrentSessionKey();
      const profileId = state.sessionProfiles[sessionId];
      delete state.sessionProfiles[sessionId];
      state.projectProfiles = state.projectProfiles.filter((profile) => (
        profile.sessionId !== sessionId && profile.id !== profileId
      ));
      saveState();
      renderPanel('rules');
      showToast('已解绑当前窗口项目');
    }

    if (action === 'clear-session-rules') {
      const sessionId = getCurrentSessionKey();
      delete state.sessionRules[sessionId];
      saveState();
      renderPanel('rules');
      showToast('已清除当前窗口规则');
    }

    if (action === 'toggle-session-rules') {
      const sessionId = getCurrentSessionKey();
      const rules = normalizeProjectRules(state.sessionRules[sessionId]);
      state.sessionRules[sessionId] = {
        ...rules,
        title: rules.title || '当前窗口规则',
        enabled: !rules.enabled,
        scope: 'session',
        updatedAt: Date.now(),
      };
      saveState();
      renderPanel('rules');
      showToast(state.sessionRules[sessionId].enabled ? '当前窗口规则已启用' : '当前窗口规则已停用');
    }

    if (action === 'toggle-global-rules') {
      const rules = normalizeProjectRules(state.projectRules);
      state.projectRules = {
        ...rules,
        title: rules.title || '全局规则',
        enabled: !rules.enabled,
        scope: 'global',
        updatedAt: Date.now(),
      };
      saveState();
      renderPanel('rules');
      showToast(state.projectRules.enabled ? '全局规则已启用' : '全局规则已停用');
    }

    if (action === 'delete-skill') {
      state.customSkills = state.customSkills.filter((s) => s.name !== el.dataset.name);
      saveState();
      renderPanel('skills');
    }

    if (action === 'toggle-preset') {
      const sessionId = getCurrentSessionKey();
      const currentPreset = getSessionPreset(getSessionProfileByKey(sessionId), sessionId);
      state.sessionPresets[sessionId] = currentPreset?.id === el.dataset.id ? DISABLED_PRESET : el.dataset.id;
      saveState();
      renderPanel('presets');
    }

    if (action === 'edit-preset') {
      const preset = state.presets.find((p) => p.id === el.dataset.id);
      if (!preset) return;
      editingPresetId = preset.id;
      renderPanel('presets');
    }

    if (action === 'cancel-edit-preset') {
      editingPresetId = null;
      renderPanel('presets');
    }

    if (action === 'delete-preset') {
      state.presets = state.presets.filter((p) => p.id !== el.dataset.id);
      if (state.activePresetId === el.dataset.id) state.activePresetId = null;
      for (const [sessionId, presetId] of Object.entries(state.sessionPresets)) {
        if (presetId === el.dataset.id) delete state.sessionPresets[sessionId];
      }
      if (editingPresetId === el.dataset.id) editingPresetId = null;
      saveState();
      renderPanel('presets');
    }

    if (action === 'expert-mode') {
      state.expertMode = el.checked;
      saveState();
    }

    if (
      action === 'webdav-test' ||
      action === 'webdav-merge' ||
      action === 'webdav-upload' ||
      action === 'webdav-pull'
    ) {
      const form = panel.querySelector('[data-form="sync"]');
      if (!form) return;
      saveSyncConfigFromForm(form);

      if (action === 'webdav-upload' && !confirm('上传覆盖会用本地数据覆盖云端文件，云端已删除/旧数据不会保留。继续？')) return;
      if (action === 'webdav-pull' && !confirm('拉取覆盖会用云端数据覆盖本地数据，本地未上传的修改可能丢失。继续？')) return;

      el.disabled = true;
      const mode = action.replace('webdav-', '');
      const label = {
        test: '正在测试 WebDAV...',
        merge: '正在合并同步...',
        upload: '正在上传覆盖...',
        pull: '正在拉取覆盖...',
      }[mode];
      showToast(label);
      runWebdavSync(mode)
        .then((result) => {
          showToast(result.message);
          renderPanel('settings');
        })
        .catch((error) => {
          showToast(error instanceof Error ? error.message : String(error));
          renderPanel('settings');
        });
      return;
    }

    if (action === 'export-data') exportData();
    if (action === 'import-data') panel.querySelector('.dpp-hidden-file')?.click();
    if (action === 'clear-data') {
      if (!confirm('清空移动版本地数据？')) return;
      state = normalizeState({
        ...defaultState,
        memories: [],
        customSkills: [],
        presets: [],
        projectProfiles: [],
        sessionProfiles: {},
        sessionPresets: {},
        sessionRules: {},
        messageCounts: {},
      });
      saveState();
      renderPanel('settings');
    }
  }

  function normalizeSkillName(name) {
    return String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deepseek-pp-mobile-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importDataFromFile(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      state = normalizeState({ ...defaultState, ...imported });
      saveState();
      renderPanel('settings');
      showToast('导入完成');
    } catch {
      showToast('导入失败：JSON 格式不对');
    }
  }

  function formatSyncTime(ts) {
    if (!ts) return '从未同步';
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getSyncConfig() {
    return normalizeSyncConfig(state.syncConfig);
  }

  function saveSyncConfigFromForm(form) {
    state.syncConfig = normalizeSyncConfig({
      url: form.url.value.trim(),
      username: form.username.value.trim(),
      password: form.password.value,
      remotePath: form.remotePath.value.trim() || 'DeepSeekPP',
      lastSyncAt: state.syncConfig?.lastSyncAt ?? null,
    });
    saveState();
  }

  function buildWebdavUrl(config, file) {
    const base = config.url.replace(/\/+$/, '');
    const path = config.remotePath.replace(/^\/+|\/+$/g, '');
    if (!path) return file ? `${base}/${file}` : base;
    return file ? `${base}/${path}/${file}` : `${base}/${path}`;
  }

  function webdavHeaders(config, extra = {}) {
    return {
      Authorization: 'Basic ' + btoa(`${config.username}:${config.password}`),
      ...extra,
    };
  }

  function webdavRequest(config, method, file, body, extraHeaders = {}) {
    if (typeof GM_xmlhttpRequest !== 'function') {
      return Promise.reject(new Error('当前脚本管理器不支持 GM_xmlhttpRequest，无法跨域同步 WebDAV'));
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: buildWebdavUrl(config, file),
        headers: webdavHeaders(config, extraHeaders),
        data: body,
        onload: (res) => resolve(res),
        onerror: () => reject(new Error('网络请求失败')),
        ontimeout: () => reject(new Error('网络请求超时')),
      });
    });
  }

  async function webdavTest(config) {
    const res = await webdavRequest(
      { ...config, remotePath: '' },
      'PROPFIND',
      null,
      null,
      { Depth: '0' },
    );
    if (res.status === 401) throw new Error('认证失败，请检查用户名和密码');
    if (res.status === 403) throw new Error('访问被拒绝');
    if (res.status === 404) throw new Error('服务器地址不存在');
    if (res.status !== 207 && (res.status < 200 || res.status >= 300)) {
      throw new Error(`连接失败 (HTTP ${res.status})`);
    }
  }

  async function webdavMkcol(config) {
    const res = await webdavRequest(config, 'MKCOL', null, null);
    if (res.status === 405 || res.status === 301 || (res.status >= 200 && res.status < 300)) return;
    if (res.status === 409) throw new Error(`无法创建远程目录，请确认父目录存在: ${config.remotePath}`);
    throw new Error(`创建远程目录失败 (HTTP ${res.status})`);
  }

  async function webdavGetJson(config, file, fallback) {
    const res = await webdavRequest(config, 'GET', file, null);
    if (res.status === 404) return fallback;
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`下载 ${file} 失败 (HTTP ${res.status})`);
    }
    if (!res.responseText) return fallback;
    try {
      return JSON.parse(res.responseText);
    } catch {
      throw new Error(`${file} JSON 格式错误`);
    }
  }

  async function webdavPutJson(config, file, value) {
    const res = await webdavRequest(
      config,
      'PUT',
      file,
      JSON.stringify(value, null, 2),
      { 'Content-Type': 'application/json; charset=utf-8' },
    );
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`上传 ${file} 失败 (HTTP ${res.status})`);
    }
  }

  function mergeMemories(local, remote) {
    const map = new Map();
    for (const memory of normalizeMemoryList(remote)) map.set(memory.syncId, memory);
    for (const memory of normalizeMemoryList(local)) {
      const existing = map.get(memory.syncId);
      if (!existing || memory.updatedAt > existing.updatedAt) map.set(memory.syncId, memory);
    }
    return Array.from(map.values()).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }

  function normalizeMemoryList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && item.content)
      .map((item) => ({
        id: Number(item.id) || undefined,
        syncId: String(item.syncId || randomId()),
        type: normalizeMemoryType(item.type),
        name: String(item.name || '未命名记忆'),
        content: String(item.content || ''),
        description: String(item.description || item.name || ''),
        tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
        pinned: Boolean(item.pinned),
        enabled: item.enabled !== false,
        scope: normalizeMemoryScope(item.scope || (item.sessionId ? 'session' : 'global')),
        sessionId: normalizeMemoryScope(item.scope || (item.sessionId ? 'session' : 'global')) === 'session'
          ? String(item.sessionId || '')
          : null,
        createdAt: Number(item.createdAt) || Date.now(),
        updatedAt: Number(item.updatedAt) || Date.now(),
        accessCount: Number(item.accessCount) || 0,
        lastAccessedAt: Number(item.lastAccessedAt) || Date.now(),
      }));
  }

  function reassignMemoryIds(memories) {
    return memories.map((memory, index) => ({ ...memory, id: index + 1 }));
  }

  function mergeSkills(local, remote) {
    const map = new Map();
    for (const skill of Array.isArray(remote) ? remote : []) {
      if (skill?.name) map.set(skill.name, { ...skill, source: 'custom' });
    }
    for (const skill of Array.isArray(local) ? local : []) {
      if (skill?.name) map.set(skill.name, { ...skill, source: 'custom' });
    }
    return Array.from(map.values());
  }

  function mergePresets(local, remote) {
    const map = new Map();
    for (const preset of Array.isArray(remote) ? remote : []) {
      if (preset?.id) map.set(preset.id, preset);
    }
    for (const preset of Array.isArray(local) ? local : []) {
      if (!preset?.id) continue;
      const existing = map.get(preset.id);
      if (!existing || Number(preset.updatedAt) > Number(existing.updatedAt)) map.set(preset.id, preset);
    }
    return Array.from(map.values());
  }

  function mergeMobileState(localRules, remoteState) {
    const remoteRules = normalizeProjectRules(remoteState?.projectRules);
    const localUpdated = Number(localRules?.updatedAt) || 0;
    const remoteUpdated = Number(remoteRules?.updatedAt) || 0;
    return remoteUpdated > localUpdated ? remoteRules : normalizeProjectRules(localRules);
  }

  function mergeSessionRules(local, remote) {
    const map = new Map();
    for (const [key, rules] of Object.entries(normalizeSessionRulesMap(remote))) {
      map.set(key, rules);
    }
    for (const [key, rules] of Object.entries(normalizeSessionRulesMap(local))) {
      const existing = map.get(key);
      if (!existing || Number(rules.updatedAt) > Number(existing.updatedAt)) map.set(key, rules);
    }
    return Object.fromEntries(map);
  }

  function mergeProjectProfiles(local, remote) {
    const map = new Map();
    for (const profile of Array.isArray(remote) ? remote.map(normalizeProjectProfile).filter(Boolean) : []) {
      map.set(profile.id, profile);
    }
    for (const profile of Array.isArray(local) ? local.map(normalizeProjectProfile).filter(Boolean) : []) {
      const existing = map.get(profile.id);
      if (!existing || profile.updatedAt > existing.updatedAt) map.set(profile.id, profile);
    }
    return Array.from(map.values());
  }

  function applyRemoteState(remoteMemories, remoteSkills, remotePresets, remoteMobileState) {
    const memories = reassignMemoryIds(normalizeMemoryList(remoteMemories));
    state.memories = memories;
    state.customSkills = mergeSkills([], remoteSkills);
    state.presets = mergePresets([], remotePresets);
    state.projectRules = normalizeProjectRules(remoteMobileState?.projectRules);
    state.sessionRules = normalizeSessionRulesMap(remoteMobileState?.sessionRules);
    state.sessionPresets = normalizeStringMap(remoteMobileState?.sessionPresets);
    state.projectProfiles = mergeProjectProfiles([], remoteMobileState?.projectProfiles || []);
    state.sessionProfiles = {};
    state.nextMemoryId = memories.reduce((max, memory) => Math.max(max, Number(memory.id) || 0), 0) + 1;
  }

  async function readRemoteSyncFiles(config) {
    return Promise.all([
      webdavGetJson(config, 'memories.json', []),
      webdavGetJson(config, 'skills.json', []),
      webdavGetJson(config, 'presets.json', []),
      webdavGetJson(config, 'mobile-state.json', {}),
    ]);
  }

  async function writeRemoteSyncFiles(config) {
    await Promise.all([
      webdavPutJson(config, 'memories.json', state.memories.map(({ id, ...memory }) => memory)),
      webdavPutJson(config, 'skills.json', state.customSkills),
      webdavPutJson(config, 'presets.json', state.presets),
      webdavPutJson(config, 'mobile-state.json', {
        projectRules: state.projectRules,
        sessionRules: state.sessionRules,
        sessionPresets: state.sessionPresets,
        projectProfiles: state.projectProfiles,
      }),
    ]);
  }

  async function runWebdavSync(mode) {
    const config = getSyncConfig();
    if (!config.url) throw new Error('请先填写 WebDAV 地址');
    if (!config.username || !config.password) throw new Error('请先填写用户名和密码');

    if (mode === 'test') {
      await webdavTest(config);
      return { ok: true, message: '连接成功' };
    }

    await webdavMkcol(config);

    if (mode === 'pull') {
      const remote = await readRemoteSyncFiles(config);
      applyRemoteState(...remote);
    } else if (mode === 'upload') {
      await writeRemoteSyncFiles(config);
    } else {
      const [remoteMemories, remoteSkills, remotePresets, remoteMobileState] = await readRemoteSyncFiles(config);

      const mergedMemories = reassignMemoryIds(mergeMemories(state.memories, remoteMemories));
      const mergedSkills = mergeSkills(state.customSkills, remoteSkills);
      const mergedPresets = mergePresets(state.presets, remotePresets);
      const mergedProjectRules = mergeMobileState(state.projectRules, remoteMobileState);
      const mergedSessionRules = mergeSessionRules(state.sessionRules, remoteMobileState?.sessionRules);
      const mergedSessionPresets = { ...normalizeStringMap(remoteMobileState?.sessionPresets), ...normalizeStringMap(state.sessionPresets) };
      const mergedProjectProfiles = mergeProjectProfiles(state.projectProfiles, remoteMobileState?.projectProfiles || []);

      state.memories = mergedMemories;
      state.customSkills = mergedSkills;
      state.presets = mergedPresets;
      state.projectRules = mergedProjectRules;
      state.sessionRules = mergedSessionRules;
      state.sessionPresets = mergedSessionPresets;
      state.projectProfiles = mergedProjectProfiles;
      state.nextMemoryId = mergedMemories.reduce((max, memory) => Math.max(max, Number(memory.id) || 0), 0) + 1;
      await writeRemoteSyncFiles(config);
    }

    restoreCurrentSessionProfile();
    const lastSyncAt = Date.now();
    state.syncConfig = { ...config, lastSyncAt };
    saveState();

    return {
      ok: true,
      message: mode === 'upload' ? '上传覆盖完成' : mode === 'pull' ? '拉取覆盖完成' : '合并同步完成',
      lastSyncAt,
    };
  }

  function restoreCurrentSessionProfile() {
    const sessionId = getCurrentSessionKey();
    if (state.sessionProfiles[sessionId]) return;
    const profile = state.projectProfiles.find((item) => item.sessionId === sessionId);
    if (profile) state.sessionProfiles[sessionId] = profile.id;
  }

  function initSkillPopup() {
    document.addEventListener('input', (event) => {
      const textarea = event.target;
      if (!(textarea instanceof HTMLTextAreaElement)) return;
      const value = textarea.value;
      if (!value.startsWith('/') || value.slice(1).includes(' ')) {
        hideSkillPopup();
        return;
      }
      const query = value.slice(1).toLowerCase();
      const matches = getCommandPaletteItems(query);
      if (matches.length) showSkillPopup(textarea, matches);
      else hideSkillPopup();
    }, true);

    document.addEventListener('click', (event) => {
      if (popup?.contains(event.target)) return;
      if (event.target instanceof HTMLTextAreaElement) return;
      hideSkillPopup();
    }, true);
  }

  function getCommandPaletteItems(query) {
    const skills = getAllSkills()
      .filter((skill) => skill.name.toLowerCase().startsWith(query))
      .map((skill) => ({
        kind: 'skill',
        id: skill.name,
        label: `/${skill.name}`,
        description: skill.description || 'Skill',
      }));
    const presets = state.presets
      .filter((preset) => preset.name.toLowerCase().includes(query))
      .map((preset) => ({
        kind: 'preset',
        id: preset.id,
        label: `预设：${preset.name}`,
        description: preset.id === state.sessionPresets[getCurrentSessionKey()] ? '当前窗口已启用' : '点选后绑定到当前窗口',
      }));
    return [...presets, ...skills].slice(0, 10);
  }

  function showSkillPopup(textarea, matches) {
    if (!popup) {
      popup = document.createElement('div');
      popup.className = 'dpp-skill-popup';
      document.body.appendChild(popup);
    }
    const rect = textarea.getBoundingClientRect();
    popup.style.left = `${Math.max(8, rect.left)}px`;
    popup.style.bottom = `${Math.max(72, window.innerHeight - rect.top + 8)}px`;
    popup.style.width = `${Math.min(rect.width || 300, window.innerWidth - 16)}px`;
    popup.innerHTML = matches.map((item) => `
      <button type="button" data-kind="${escapeHtml(item.kind)}" data-id="${escapeHtml(item.id)}">
        <b>${escapeHtml(item.label)}</b>
        <span>${escapeHtml(item.description || '')}</span>
      </button>
    `).join('');
    popup.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.kind === 'preset') {
          state.sessionPresets[getCurrentSessionKey()] = button.dataset.id;
          saveState();
          setTextareaValue(textarea, '');
          showToast('已为当前窗口启用预设');
        } else {
          setTextareaValue(textarea, `/${button.dataset.id} `);
        }
        hideSkillPopup();
      });
    });
    popup.style.display = 'block';
  }

  function hideSkillPopup() {
    if (popup) popup.style.display = 'none';
  }

  function setTextareaValue(textarea, value) {
    const tracker = textarea._valueTracker;
    if (tracker) tracker.setValue('');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(textarea, value);
    else textarea.value = value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
    textarea.setSelectionRange(value.length, value.length);
  }

  function showToast(message) {
    let toast = document.querySelector('.dpp-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'dpp-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function injectStyles() {
    if (document.getElementById('dpp-mobile-css')) return;
    const style = document.createElement('style');
    style.id = 'dpp-mobile-css';
    style.textContent = `
      .dpp-mobile-fab {
        position: fixed;
        right: 14px;
        bottom: 92px;
        z-index: 2147483647;
        width: 48px;
        height: 48px;
        border: 0;
        border-radius: 50%;
        background: #4d6bfe;
        color: #fff;
        font-weight: 800;
        box-shadow: 0 8px 24px rgba(0,0,0,.2);
      }
      .dpp-mobile-panel {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483647;
        height: min(78vh, 680px);
        transform: translateY(105%);
        transition: transform .22s ease;
        background: #fff;
        color: #1d1d1f;
        border-radius: 18px 18px 0 0;
        box-shadow: 0 -12px 36px rgba(0,0,0,.18);
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
        overflow: hidden;
      }
      .dpp-mobile-panel.open { transform: translateY(0); }
      .dpp-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px 8px;
      }
      .dpp-icon-btn {
        width: 34px;
        height: 34px;
        border: 0;
        border-radius: 50%;
        background: #f3f4f6;
        font-size: 22px;
      }
      .dpp-tabs {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 4px;
        padding: 0 10px 8px;
        border-bottom: 1px solid #edf0f3;
      }
      .dpp-tab {
        border: 0;
        border-radius: 10px;
        padding: 8px 0;
        background: transparent;
        color: #6b7280;
      }
      .dpp-tab.active {
        background: #eef1ff;
        color: #4d6bfe;
        font-weight: 700;
      }
      .dpp-panel-body {
        height: calc(100% - 94px);
        overflow: auto;
        padding: 12px;
        overscroll-behavior: contain;
      }
      .dpp-form, .dpp-card {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        background: #fff;
        padding: 12px;
        margin-bottom: 10px;
      }
      .dpp-form {
        display: grid;
        gap: 8px;
        background: #f8fafc;
      }
      .dpp-form input, .dpp-form textarea, .dpp-form select {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 10px;
        padding: 9px 10px;
        font: inherit;
        background: #fff;
      }
      .dpp-form textarea { min-height: 86px; resize: vertical; }
      .dpp-form button, .dpp-card button {
        border: 0;
        border-radius: 9px;
        padding: 8px 10px;
        background: #4d6bfe;
        color: #fff;
        font-weight: 700;
      }
      .dpp-form-actions {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
        gap: 8px;
      }
      .dpp-form-actions button:only-child {
        grid-column: 1 / -1;
      }
      .dpp-form button.secondary {
        background: #f3f4f6;
        color: #4b5563;
      }
      .dpp-card button {
        background: #eef1ff;
        color: #4d6bfe;
        padding: 6px 8px;
        font-size: 12px;
      }
      .dpp-card button.danger, .dpp-card .danger {
        background: #fee2e2;
        color: #dc2626;
      }
      .dpp-card.muted {
        background: #fafafa;
      }
      .dpp-card-top, .dpp-card-actions, .dpp-switch {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .dpp-card p {
        margin: 8px 0;
        color: #4b5563;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .dpp-card small, .dpp-empty {
        color: #9ca3af;
      }
      .dpp-status-card {
        background: #f8fafc;
      }
      .dpp-status-card code {
        padding: 2px 5px;
        border-radius: 6px;
        background: #e5e7eb;
        color: #111827;
        font-size: 12px;
        word-break: break-all;
      }
      .dpp-badge-on, .dpp-badge-off, .dpp-badge-neutral {
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 12px;
        font-weight: 700;
      }
      .dpp-badge-on {
        background: #dcfce7;
        color: #166534;
      }
      .dpp-badge-off {
        background: #f3f4f6;
        color: #6b7280;
      }
      .dpp-badge-neutral {
        background: #eef1ff;
        color: #4d6bfe;
      }
      .dpp-type {
        font-size: 12px;
        font-weight: 700;
      }
      .dpp-check {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #4b5563;
      }
      .dpp-hidden-file { display: none !important; }
      .dpp-skill-popup {
        position: fixed;
        z-index: 2147483647;
        display: none;
        max-height: 240px;
        overflow: auto;
        padding: 6px;
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 8px 28px rgba(0,0,0,.14);
      }
      .dpp-skill-popup button {
        display: block;
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 9px 10px;
        background: transparent;
        text-align: left;
      }
      .dpp-skill-popup b {
        display: block;
        color: #4d6bfe;
      }
      .dpp-skill-popup span {
        display: block;
        color: #9ca3af;
        font-size: 12px;
      }
      .dpp-toast {
        position: fixed;
        left: 16px;
        right: 16px;
        bottom: 154px;
        z-index: 2147483647;
        transform: translateY(18px);
        opacity: 0;
        pointer-events: none;
        border-radius: 12px;
        background: rgba(17,24,39,.92);
        color: #fff;
        padding: 10px 12px;
        text-align: center;
        transition: opacity .18s ease, transform .18s ease;
      }
      .dpp-toast.show {
        opacity: 1;
        transform: translateY(0);
      }
      @media (prefers-color-scheme: dark) {
        .dpp-mobile-panel, .dpp-form, .dpp-card, .dpp-skill-popup {
          background: #1f1f1f;
          color: #f3f4f6;
          border-color: #333;
        }
        .dpp-form, .dpp-card.muted { background: #252525; }
        .dpp-status-card { background: #252525; }
        .dpp-status-card code { background: #333; color: #f3f4f6; }
        .dpp-badge-on { background: #064e3b; color: #bbf7d0; }
        .dpp-badge-off { background: #333; color: #d1d5db; }
        .dpp-badge-neutral { background: #27304f; color: #c7d2fe; }
        .dpp-form input, .dpp-form textarea, .dpp-form select {
          background: #171717;
          color: #f3f4f6;
          border-color: #3a3a3a;
        }
        .dpp-card p { color: #cbd5e1; }
        .dpp-icon-btn { background: #333; color: #fff; }
      }
    `;
    document.head.appendChild(style);
  }
})();
