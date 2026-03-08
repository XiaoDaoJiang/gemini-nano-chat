document.addEventListener('DOMContentLoaded', async () => {
    const messagesContainer = document.getElementById('messages');
    const chatForm = document.getElementById('chat-form');
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const statusIndicator = document.getElementById('status-indicator');
    const setupWarning = document.getElementById('setup-warning');

    let activeSession = null;
    let isReady = false;

    // Auto-resize textarea
    promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
        // Only modify disabled state if we are NOT in stop-mode
        if (!sendBtn.classList.contains('stop-mode')) {
            sendBtn.disabled = !promptInput.value.trim() || !isReady;
        }
    });

    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) {
                chatForm.dispatchEvent(new Event('submit'));
            }
        }
    });

    // Multi-Session Management State
    let sessionHistory = [];
    let savedSessions = {}; // { id: { title, history: [], timestamp } }
    let currentSessionId = null;
    let isBatchMode = false;
    let editingIndex = -1;
    let selectedSessionIds = new Set();
    const HISTORY_KEY = 'gemini-nano-sessions';
    const CURRENT_ID_KEY = 'gemini-nano-current-id';

    async function loadSessions() {
        return new Promise((resolve) => {
            chrome.storage.local.get([HISTORY_KEY, CURRENT_ID_KEY], (result) => {
                savedSessions = result[HISTORY_KEY] || {};
                currentSessionId = result[CURRENT_ID_KEY] || null;

                if (currentSessionId && savedSessions[currentSessionId]) {
                    sessionHistory = savedSessions[currentSessionId].history || [];
                } else {
                    sessionHistory = [];
                }
                renderSessionsList();
                resolve();
            });
        });
    }

    function saveCurrentSession() {
        if (!currentSessionId) {
            currentSessionId = crypto.randomUUID();
        }

        // Generate title if empty and we have a first message
        let title = savedSessions[currentSessionId]?.title || '新对话';
        if (title === '新对话' && sessionHistory.length > 0) {
            title = sessionHistory[0].content.substring(0, 15) + (sessionHistory[0].content.length > 15 ? '...' : '');
        }

        const existingSession = savedSessions[currentSessionId];
        savedSessions[currentSessionId] = {
            title: title,
            history: sessionHistory,
            timestamp: existingSession ? existingSession.timestamp : Date.now()
        };

        chrome.storage.local.set({
            [HISTORY_KEY]: savedSessions,
            [CURRENT_ID_KEY]: currentSessionId
        });
        renderSessionsList();
    }

    function renderSessionsList() {
        const listContainer = document.getElementById('sessions-list');
        listContainer.innerHTML = '';

        const sortedIds = Object.keys(savedSessions).sort((a, b) => savedSessions[b].timestamp - savedSessions[a].timestamp);

        sortedIds.forEach(id => {
            const item = document.createElement('div');
            item.className = `session-item ${id === currentSessionId ? 'active' : ''}`;

            if (isBatchMode) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'session-checkbox';
                checkbox.checked = selectedSessionIds.has(id);
                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) selectedSessionIds.add(id);
                    else selectedSessionIds.delete(id);
                    updateBatchUI();
                });
                item.appendChild(checkbox);
            }

            const titleSpan = document.createElement('span');
            titleSpan.className = 'session-title';
            titleSpan.textContent = savedSessions[id].title;
            titleSpan.style.flex = '1';
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-session-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = '删除会话';
            if (isBatchMode) deleteBtn.style.display = 'none';

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSession(id);
            });

            item.appendChild(titleSpan);
            item.appendChild(deleteBtn);
            item.addEventListener('click', (e) => {
                if (isBatchMode) {
                    const cb = item.querySelector('.session-checkbox');
                    cb.checked = !cb.checked;
                    cb.dispatchEvent(new Event('change'));
                    return;
                }
                switchSession(id);
            });
            listContainer.appendChild(item);
        });

        // Update Header Title
        if (currentSessionId && savedSessions[currentSessionId]) {
            document.getElementById('current-chat-title').textContent = savedSessions[currentSessionId].title;
        } else {
            document.getElementById('current-chat-title').textContent = 'Gemini Nano';
        }
    }

    function updateBatchUI() {
        const counter = document.getElementById('selected-count');
        const deleteBtn = document.getElementById('delete-selected-btn');
        if (counter) counter.textContent = selectedSessionIds.size;
        if (deleteBtn) {
            deleteBtn.disabled = selectedSessionIds.size === 0;
            deleteBtn.style.opacity = selectedSessionIds.size === 0 ? '0.5' : '1';
            deleteBtn.style.cursor = selectedSessionIds.size === 0 ? 'not-allowed' : 'pointer';
        }
    }

    document.getElementById('manage-sessions-btn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        isBatchMode = !isBatchMode;
        selectedSessionIds.clear();

        btn.classList.toggle('active', isBatchMode);
        document.getElementById('batch-actions').classList.toggle('hidden', !isBatchMode);

        updateBatchUI();
        renderSessionsList();
    });

    document.getElementById('delete-selected-btn').addEventListener('click', async () => {
        if (selectedSessionIds.size === 0) return;
        if (!confirm(`确定要删除选中的 ${selectedSessionIds.size} 个会话吗？`)) return;

        let activeWasDeleted = false;
        selectedSessionIds.forEach(id => {
            if (id === currentSessionId) activeWasDeleted = true;
            delete savedSessions[id];
        });

        if (activeWasDeleted) {
            if (activeSession) {
                activeSession.destroy();
                activeSession = null;
            }
            currentSessionId = null;
            sessionHistory = [];
            document.querySelectorAll('.message:not(.greeting)').forEach(m => m.remove());
        }

        if (activeWasDeleted) {
            setStatus(false);
            activeSession = await createSession();
            setStatus(true);
        }

        chrome.storage.local.set({ [HISTORY_KEY]: savedSessions }, () => {
            isBatchMode = false;
            document.getElementById('manage-sessions-btn').classList.remove('active');
            document.getElementById('batch-actions').classList.add('hidden');
            renderSessionsList();
        });
    });

    async function deleteSession(id) {
        if (!confirm('确定要删除这个会话吗？')) return;

        const wasActive = (id === currentSessionId);
        delete savedSessions[id];

        if (wasActive) {
            if (activeSession) {
                activeSession.destroy();
                activeSession = null;
            }
            currentSessionId = null;
            sessionHistory = [];
            const messages = document.querySelectorAll('.message:not(.greeting)');
            messages.forEach(msg => msg.remove());
        }

        if (wasActive) {
            setStatus(false);
            activeSession = await createSession();
            setStatus(true);
        }

        chrome.storage.local.set({ [HISTORY_KEY]: savedSessions }, () => {
            if (wasActive) {
                chrome.storage.local.remove(CURRENT_ID_KEY);
            }
            renderSessionsList();
        });
    }

    async function switchSession(id) {
        if (id === currentSessionId) return;

        if (activeSession) {
            activeSession.destroy();
            activeSession = null;
        }

        currentSessionId = id;
        sessionHistory = savedSessions[id].history || [];

        // UI Clean
        const messages = document.querySelectorAll('.message:not(.greeting)');
        messages.forEach(msg => msg.remove());

        // Re-init
        editingIndex = -1;
        promptInput.value = '';
        setStatus(false);
        activeSession = await createSession();
        setStatus(true);
        saveCurrentSession();
    }

    document.getElementById('new-chat-btn').addEventListener('click', async () => {
        if (activeSession) {
            activeSession.destroy();
            activeSession = null;
        }

        currentSessionId = crypto.randomUUID();
        sessionHistory = [];

        const messages = document.querySelectorAll('.message:not(.greeting)');
        messages.forEach(msg => msg.remove());

        setStatus(false);
        activeSession = await createSession();
        setStatus(true);
        saveCurrentSession();

        // Auto-focus input
        promptInput.focus();
    });

    document.getElementById('toggle-sidebar').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('collapsed');
    });

    let aiModel;
    let localSession = null;
    let modelNewlyDownloaded = false;

    // Updated saveHistory/loadHistory wrappers
    async function loadHistory() {
        await loadSessions();
    }

    function saveHistory() {
        saveCurrentSession();
    }

    // The shared options for both availability check and session creation
    const llmOptions = {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }]
    };

    const createSession = async () => {
        const progressElement = document.getElementById('model-progress');
        const outputElement = document.getElementById('download-output');

        let createConfig = {
            ...llmOptions,
            monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                    // Official documentation pattern
                    progressElement.value = e.loaded;

                    // Output some human readable text next to the progress bar
                    let loadedText = e.loaded;
                    if (e.loaded > 1) { // It's providing bytes and not percentage
                        loadedText = (e.loaded / (1024 * 1024)).toFixed(1) + ' MB';
                    } else if (e.loaded > 0 && e.loaded <= 1) {
                        loadedText = Math.round(e.loaded * 100) + '%';
                    }
                    outputElement.textContent = `已下载: ${loadedText}`;

                    if (modelNewlyDownloaded && e.loaded === 1) {
                        // The model was newly downloaded and needs to be extracted
                        // and loaded into memory, so show the undetermined state.
                        progressElement.removeAttribute('value');
                        outputElement.textContent = '提取并加载到内存中 (请稍侯...)';
                    }
                });
            }
        };

        // Use the new standard initialPrompts instead of systemPrompt
        if (sessionHistory.length > 0) {
            // If we have history, pre-fetch it contextually
            createConfig.initialPrompts = [
                { role: 'system', content: "你是一个集成在浏览器中的有用的、聪明的、友好的 AI 助手。请用中文回答用户的所有问题，并保持回复简洁易读。" },
                ...sessionHistory
            ];
            // Render history to DOM ONLY if it hasn't been rendered yet
            if (document.querySelectorAll('.message').length <= 1) { // Only greeting exists
                sessionHistory.forEach((msg, idx) => {
                    const bubble = addMessage(msg.content, msg.role === 'user', idx);
                    if (msg.role === 'assistant') {
                        bubble.innerHTML = formatText(msg.content);
                        addCopyButton(bubble, msg.content);
                    }
                });
            }
        } else {
            createConfig.systemPrompt = "你是一个集成在浏览器中的有用的、聪明的、友好的 AI 助手。请用中文回答用户的所有问题，并保持回复简洁易读。";
        }

        try {
            const llmSession = await aiModel.create(createConfig);
            return llmSession;
        } catch (error) {
            throw error;
        }
    };

    async function checkAvailability() {
        let availabilityStr = 'no';

        // Load history before doing anything
        await loadHistory();

        try {
            // Newest Chrome standard (window.LanguageModel or just LanguageModel)
            if (typeof LanguageModel !== 'undefined' && LanguageModel.availability) {
                aiModel = LanguageModel;
                const availabilityArgs = {
                    expectedInputs: [{ type: 'text', languages: ['en'] }],
                    expectedOutputs: [{ type: 'text', languages: ['en'] }]
                };
                // Check if availability needs args
                availabilityStr = await LanguageModel.availability(availabilityArgs).catch(() => LanguageModel.availability());
            }
            // Older Chrome standard (window.ai)
            else if (window.ai && window.ai.languageModel) {
                aiModel = window.ai.languageModel;
                if (typeof aiModel.capabilities === 'function') {
                    const capabilities = await aiModel.capabilities();
                    availabilityStr = capabilities.available;
                }
            }

            if (!aiModel) {
                showError("未检测到 Chrome Built-in AI API。请确保您的 Chrome 已更新到最新版。");
                return;
            }

            if (availabilityStr === 'no' || availabilityStr === 'unavailable') {
                showError("您的设备不支持或未开启 Gemini Nano 模型。");
                return;
            }

            const downloadContainer = document.getElementById('download-container');
            const downloadPrompt = document.getElementById('download-prompt');
            const downloadProgressArea = document.getElementById('download-progress-area');
            const startDownloadBtn = document.getElementById('start-download-btn');
            const progressElement = document.getElementById('model-progress');
            const outputElement = document.getElementById('download-output');

            if (availabilityStr !== 'available') {
                modelNewlyDownloaded = true;
                statusIndicator.style.backgroundColor = 'var(--warning-color)';
                downloadContainer.classList.remove('hidden');

                // Set up manual trigger for downloading
                startDownloadBtn.addEventListener('click', async () => {
                    downloadPrompt.classList.add('hidden');
                    downloadProgressArea.classList.remove('hidden');
                    startDownloadBtn.disabled = true;

                    try {
                        activeSession = await createSession();
                        downloadContainer.classList.add('hidden');
                        isReady = true;
                        setStatus(true);
                    } catch (err) {
                        console.error(err);
                        showError("下载加载 AI 模型失败：" + err.message);
                    }
                });
                return; // Wait for user gesture
            }

            // If already available without download
            try {
                activeSession = await createSession();
                downloadContainer.classList.add('hidden');
                isReady = true;
                setStatus(true);
            } catch (err) {
                console.error(err);
                showError("初始化 AI 模型会话失败：" + err.message);
            }
        } catch (err) {
            console.error(err);
            showError("检查 AI 模型可用性失败：" + err.message);
        }
    }

    function setStatus(ready) {
        statusIndicator.className = 'status-indicator ' + (ready ? 'ready' : 'error');
        const resetBtn = document.getElementById('reset-btn');

        if (!ready) {
            // During transition, we just disable the buttons but DON'T show the setup warning
            resetBtn.classList.add('hidden');
            sendBtn.disabled = true;
        } else {
            setupWarning.classList.add('hidden');
            sendBtn.disabled = !promptInput.value.trim();
            resetBtn.classList.remove('hidden');
        }
    }

    // Handle Reset Button
    document.getElementById('reset-btn').addEventListener('click', async () => {
        if (!activeSession) return;

        // Ask for confirmation briefly visually
        const btn = document.getElementById('reset-btn');
        const originalText = btn.textContent;

        try {
            activeSession.destroy();
            activeSession = null;

            // Wipe memory for CURRENT session
            sessionHistory = [];
            if (currentSessionId && savedSessions[currentSessionId]) {
                savedSessions[currentSessionId].history = [];
            }
            saveCurrentSession();

            // Clear messages from UI except the first greeting
            const messages = document.querySelectorAll('.message:not(.greeting)');
            messages.forEach(msg => msg.remove());

            // Re-initialize session
            setStatus(false); // Wait state
            activeSession = await createSession();
            setStatus(true);

            btn.textContent = '✔️';
            setTimeout(() => { btn.textContent = originalText; }, 1500);

        } catch (e) {
            console.error("重置会话失败", e);
            showError("重置模型内存失败: " + e.message);
        }
    });

    function showError(msg) {
        console.error(msg);
        isReady = false;
        setStatus(false);
        setupWarning.classList.remove('hidden');
    }

    function addMessage(text, isUser = false, index = -1) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user' : 'assistant'}`;
        if (index !== -1) msgDiv.dataset.index = index;

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';

        // Use textContent for user messages, but allow empty for assistant
        if (text) {
            bubble.textContent = text;
        }

        msgDiv.appendChild(bubble);

        if (isUser) {
            if (index !== -1) addEditButton(bubble, index);
            addCopyButton(bubble, text);
        }

        messagesContainer.appendChild(msgDiv);
        scrollToBottom();
        return bubble;
    }

    function addEditButton(bubble, index) {
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14">
                <path d="M7 7H6C5.46957 7 4.96086 7.21071 4.58579 7.58579C4.21071 7.96086 4 8.46957 4 9V18C4 18.5304 4.21071 19.0391 4.58579 19.4142C4.96086 19.7893 5.46957 20 6 20H15C15.5304 20 16.0391 19.7893 16.4142 19.4142C16.7893 19.0391 17 18.5304 17 18V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M16 5L19 8M20.385 6.585C20.7788 6.19114 21.0001 5.65709 21.0001 5.10025C21.0001 4.54341 20.7788 4.00936 20.385 3.6155C19.9911 3.22164 19.4571 3.00024 18.9002 3.00024C18.3434 3.00024 17.8094 3.22164 17.4155 3.6155L9 12V15H12L20.385 6.585Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        editBtn.title = "重新编辑并回档到此处";
        editBtn.onclick = (e) => {
            e.stopPropagation();
            reEditMessage(index);
        };
        bubble.appendChild(editBtn);
    }

    async function reEditMessage(index) {
        const originalText = sessionHistory[index].content;

        // Populate prompt input but DON'T rollback yet
        promptInput.value = originalText;
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';

        editingIndex = index;
        promptInput.focus();

        // Optional: show a small hint that they are in re-editing mode
        console.log("进入重新编辑模式，索引:", index);
    }

    function scrollToBottom() {
        const main = document.getElementById('chat-container');
        main.scrollTop = main.scrollHeight;
    }

    function formatText(text) {
        if (!text) return text;

        // Configure marked options
        marked.setOptions({
            breaks: true, // Supports single line breaks
            gfm: true,    // GitHub Flavored Markdown
            headerIds: false,
            mangle: false
        });

        try {
            return marked.parse(text);
        } catch (e) {
            console.error("Markdown parsing failed", e);
            // Fallback to simple line breaks if marked fails
            return text.replace(/\n/g, '<br>');
        }
    }

    // For aborting ongoing prompts
    let abortController = null;

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // If we are currently generating, act as a Stop button
        if (abortController) {
            abortController.abort();
            abortController = null;
            return;
        }

        if (!isReady || !activeSession || !promptInput.value.trim()) return;

        // If we were in re-editing mode, perform the actual rollback now
        if (editingIndex !== -1) {
            // Trim history
            sessionHistory.splice(editingIndex);

            // Visually clear messages from UI
            const messageDivs = document.querySelectorAll('.message:not(.greeting)');
            messageDivs.forEach((div, i) => {
                if (i >= editingIndex) div.remove();
            });

            // Re-sync the model session if we have history before the edit point
            if (activeSession) {
                activeSession.destroy();
                activeSession = null;
            }

            setStatus(false);
            activeSession = await createSession();
            setStatus(true);

            editingIndex = -1;
        }

        const userText = promptInput.value.trim();

        // Immediate push user message to history so it has an index for the edit button
        const userMsgIndex = sessionHistory.length;
        sessionHistory.push({ role: 'user', content: userText });

        // Reset input
        promptInput.value = '';
        promptInput.style.height = 'auto';
        sendBtn.disabled = true;

        // Show user message with index (addMessage now handles textContent)
        const userBubble = addMessage(userText, true, userMsgIndex);

        // Create assistant bubble for streaming or loading
        const assistantBubble = addMessage('', false);
        assistantBubble.innerHTML = `
      <div class="typing-indicator">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    `;

        // Switch button to Stop mode
        abortController = new AbortController();
        sendBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
          </svg>`;
        sendBtn.classList.add('stop-mode');
        sendBtn.disabled = false; // Always enabled when stopping

        try {
            if (activeSession.promptStreaming) {
                const stream = activeSession.promptStreaming(userText, { signal: abortController.signal });
                let firstChunk = true;
                let responseText = '';

                let previousLength = 0;

                for await (const chunk of stream) {
                    if (firstChunk) {
                        assistantBubble.innerHTML = '';
                        firstChunk = false;
                    }

                    // 打印控制台日志，方便分析模型实际返回内容 (使用 JSON.stringify 可以看清隐藏的换行符 \n 等)
                    console.log('收到数据流 Chunk:', JSON.stringify(chunk));

                    // Some versions of Chrome return cumulative strings, while newer ones return partial deltas.
                    // If chunk starts with previous text, it's cumulative. Otherwise it's a delta.
                    if (chunk.startsWith(responseText) && responseText.length > 0) {
                        responseText = chunk;
                    } else if (responseText.startsWith(chunk) && chunk.length > 0) {
                        // Strange edge case where it returns parts
                        responseText += chunk;
                    } else {
                        // Delta appending (standard stream behavior)
                        responseText += chunk;
                    }

                    assistantBubble.innerHTML = formatText(responseText);
                    scrollToBottom();
                }

                // Add to persistent history
                sessionHistory.push({ role: 'assistant', content: responseText });
                saveHistory();

                // Add copy button after stream finishes
                addCopyButton(assistantBubble, responseText);
            } else {
                const response = await activeSession.prompt(userText, { signal: abortController.signal });
                assistantBubble.innerHTML = formatText(response);

                // Add to persistent history
                sessionHistory.push({ role: 'assistant', content: response });
                saveHistory();

                addCopyButton(assistantBubble, response);
            }
        } catch (err) {
            // Check if it was aborted by user
            if (err.name === 'AbortError') {
                console.log("用户中止了生成");
                assistantBubble.innerHTML += '<br><span style="color:var(--text-secondary); font-size: 12px;">[已停止生成]</span>';
            } else {
                console.error("生成回复出错:", err);
                assistantBubble.innerHTML = '<span style="color:var(--danger-color)">生成回复出错，请重试。</span>';
            }
        } finally {
            abortController = null;
            sendBtn.classList.remove('stop-mode');
            sendBtn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.01 21L23 12L2.01 3L2 10L17 12L2 14L2.01 21Z" fill="currentColor" />
              </svg>`;
            sendBtn.disabled = !promptInput.value.trim();
            scrollToBottom();
        }
    });

    function addCopyButton(container, textToCopy) {
        // Only append to assistant bubbles
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z" fill="currentColor"/></svg>`;
        btn.title = "复制内容";

        btn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(textToCopy);
                const originalHtml = btn.innerHTML;
                btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14" color="var(--success-color)"><path d="M9 16.17L4.83 12L3.41 13.41L9 19L21 7L19.59 5.59L9 16.17Z" fill="currentColor"/></svg>`;
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy text: ', err);
            }
        });

        container.appendChild(btn);
    }

    // Start initialization
    checkAvailability();
});
